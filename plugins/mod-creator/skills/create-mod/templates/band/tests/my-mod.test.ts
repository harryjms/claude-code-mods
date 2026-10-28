import { expect, test } from 'claude-code/testing'

// What Claude Code passes to a ui.render hook for the band, apart from the app
const BAND = {
  plugin: 'my-mod',
  component: 'AbovePrompt',
  requestId: 'band',
  viewport: { columns: 100, rows: 30 },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

// Answer the mod's $.process.run calls with fixed git output
function stubGit(on, branch: { exitCode: number; stdout: string }, porcelain: string) {
  on('process.run', ($, e) => {
    if (e.argv[1] === 'branch') return { value: { ...branch, stderr: '' } }
    return { value: { exitCode: 0, stdout: porcelain, stderr: '' } }
  })
}

// Stands for what the mods after this one, or Claude Code, draw in the band
function stubBand(on) {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['another band'] }))
}

test('shows the branch and the changed files, and keeps other bands', async ($, on) => {
  stubGit(on, { exitCode: 0, stdout: 'main\n' }, ' M a.js\n?? b.js\n')
  stubBand(on)
  on('session.start', () => ({ cwd: '/work' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: 'git: main · 2 changed' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'another band' })).toBeDefined()
    await ui.unmount()
  }
})

test('refreshes after the main conversation finishes a turn', async ($, on) => {
  let porcelain = ''
  on('process.run', ($, e) => {
    if (e.argv[1] === 'branch') return { value: { exitCode: 0, stdout: 'feature\n', stderr: '' } }
    return { value: { exitCode: 0, stdout: porcelain, stderr: '' } }
  })
  stubBand(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  porcelain = ' M a.js\n'
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 10, isAborted: false, usage: null })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'git: feature · 1 changed' })).toBeDefined()
  await ui.unmount()
})

test('draws nothing of its own outside a git repository', async ($, on) => {
  stubGit(on, { exitCode: 128, stdout: '' }, '')
  stubBand(on)
  on('session.start', () => ({ cwd: '/work' }))

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^git: / })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'another band' })).toBeDefined()
  await ui.unmount()
})
