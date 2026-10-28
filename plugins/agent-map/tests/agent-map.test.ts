import { expect, mock, test } from 'claude-code/testing'

// What Claude Code passes to a ui.render hook for this pane, apart from the app
const PANE = {
  plugin: 'agent-map',
  component: 'Pane',
  requestId: 'agent-map',
  viewport: { columns: 160, rows: 45 },
  props: {
    title: 'Agent map',
    isFocused: true,
    bodyColumns: 120,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// Answer the calls the mod makes, with `roster` as $.agent.list()'s answer
function stubEngine(on, roster: unknown[] = []) {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('agent.list', () => ({ value: roster }))
  on('agent.spawn', ($, e) => ({ model: 'claude-haiku-5-5', agentId: e.name === 'scout' ? 'a2' : 'a1' }))
  on('tool.call', () => ({ result: 'ok' }))
  on('session.send', () => ({ isDelivered: true }))
  on('turn.complete', () => ({ text: '' }))
  return clock
}

function spawn($, fields) {
  return $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt: 'Find where session tokens are checked',
    description: 'find auth code',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
    ...fields,
  })
}

test('/agent-map opens the pane with keyboard focus', async ($, on) => {
  stubEngine(on)
  const opened: unknown[] = []
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })

  const answer = await $.command.run({ command: 'agent-map', args: '' })
  expect(answer).toEqual({})
  expect(opened).toMatchObject([{ id: 'agent-map', focus: true, closeOnEscape: true }])
})

test('draws only the main conversation before any agent starts', async ($, on) => {
  stubEngine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'map' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^No agents yet/ })).toBeDefined()
  await ui.unmount()
})

test('a spawned agent, its tool calls and its messages reach the map', async ($, on) => {
  stubEngine(on)
  await spawn($, {})
  await spawn($, { name: 'scout', subagentType: 'general-purpose', description: 'scout the tests', parentAgentId: 'a1' })
  await $.tool.call({ tool: 'Grep', pattern: 'verifySession', agentId: 'a1' })
  await $.tool.call({ tool: 'Read', file_path: 'src/auth.ts', agentId: 'a1' })
  await $.session.send({ to: 'main', text: 'found 3 files', origin: { kind: 'model' }, agentId: 'a2' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The map itself, and the message under it
  const raster = await ui.find({ key: 'map' })
  expect(raster.type).toBe('Raster')
  expect(await ui.find({ type: 'Text', text: 'scout ╌► main ×1  "found 3 files"' })).toBeDefined()
  // Select the first agent and read its details
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: '● Explore · running 0:00' })).toBeDefined()
  // The second agent is a child of the first, and its type differs from its name
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: '● scout · running 0:00 · general-purpose' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'parent Explore · haiku-5-5 · 0 tool calls' })).toBeDefined()
  await ui.press({ key: 'prev' })
  expect(await ui.find({ type: 'Text', text: 'parent main · haiku-5-5 · 2 tool calls' })).toBeDefined()
  await ui.unmount()
})

test('Desktop and VS Code get the map as an Svg', async ($, on) => {
  stubEngine(on)
  await spawn($, {})
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const svg = await ui.find({ type: 'Svg' })
    expect(svg.props.source).toContain('>Explore<')
    expect(svg.props.alt).toContain('● Explore (running)')
    await ui.unmount()
  }
})

test('a finished agent shows its time, and can be hidden', async ($, on) => {
  const clock = stubEngine(on)
  await spawn($, {})
  await clock.advance(65_000)
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 65_000, isAborted: false, reason: 'answer', usage: null, agentId: 'a1' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: /^✓ Explore · completed 1:05/ })).toBeDefined()

  await ui.press({ key: 'finished' })
  expect(await ui.find({ type: 'Text', text: /Explore/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^No agents yet/ })).toBeDefined()
  await ui.unmount()
})

test('the roster sets parents and statuses, for agents started before the mod loaded', async ($, on) => {
  stubEngine(on, [
    { id: 'r1', type: 'Plan', description: 'design it', status: 'running' },
    { id: 'r2', type: 'Explore', description: 'look around', status: 'failed', parentId: 'r1' },
  ])
  on('session.start', () => ({ cwd: '/work' }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', () => ({ value: undefined }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg.props.alt).toBe(['◆ main', '  ● Plan (running)', '    ✗ Explore (failed)'].join('\n'))
  await ui.unmount()
})

test('/clear starts an empty map', async ($, on) => {
  stubEngine(on)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  await spawn($, {})
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^No agents yet/ })).toBeDefined()
  await ui.unmount()
})
