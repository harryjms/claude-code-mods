import { expect, test } from 'claude-code/testing'

test('registers its command when the session starts', async ($, on) => {
  const registered: string[] = []
  // Answer the event after the mod passes it on with next(e)
  on('session.start', () => ({ cwd: '/work' }))
  // Answer the mod's $.command.register call
  on('command.register', ($, e) => {
    registered.push(e.name)
    return { value: undefined }
  })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toEqual(['my-mod-stats'])
})

test('/my-mod-stats reports the tool calls the mod has seen', async ($, on) => {
  // Answer each tool call in Claude Code's place, so no tool runs
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: 'README.md' })

  const answer = await $.command.run({ command: 'my-mod-stats', args: '' })
  expect(answer.text).toBe('Claude has made 2 tool calls since this mod loaded')
})

test('the spinner shows the count once there is one', async ($, on) => {
  on('tool.call', () => ({ result: 'ok' }))
  // Stands for Claude Code's own spinner: draw the suffix the mod passed on
  on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: [String(e.props.suffix ?? '')] }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })

  const ui = await $.ui.mount({
    plugin: 'my-mod',
    component: 'Spinner',
    surface: 'terminal',
    requestId: 'main',
    viewport: { columns: 100, rows: 30 },
    props: { word: 'Thinking', message: '', suffix: '…', mode: 'requesting' },
  })
  expect(await ui.find({ type: 'Text', text: ' · tool calls: 1…' })).toBeDefined()
  await ui.unmount()
})
