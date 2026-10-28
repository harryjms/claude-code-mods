import { expect, test } from 'claude-code/testing'

// What Claude Code passes to a ui.render hook for this pane, apart from the app
const PANE = {
  plugin: 'my-mod',
  component: 'Pane',
  requestId: 'my-mod',
  viewport: { columns: 100, rows: 30 },
  props: {
    title: 'Notes',
    isFocused: true,
    bodyColumns: 60,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('/my-mod opens the pane with keyboard focus', async ($, on) => {
  const opened: unknown[] = []
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })

  const answer = await $.command.run({ command: 'my-mod', args: '' })
  expect(answer).toEqual({})
  expect(opened).toMatchObject([{ id: 'my-mod', focus: true, closeOnEscape: true }])
})

test('adds a note, deletes it, and saves each change', async ($, on) => {
  const saved = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'new-note', text: 'buy milk' })
  expect(await ui.find({ type: 'Text', text: 'buy milk' })).toBeDefined()
  expect(saved.get('notes')).toEqual(['buy milk'])

  await ui.press({ key: 'delete-0' })
  expect(await ui.find({ type: 'Text', text: 'buy milk' })).toBeUndefined()
  expect(saved.get('notes')).toEqual([])
  await ui.unmount()
})

test('draws on every app that shows panes', async ($) => {
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'No notes yet' })).toBeDefined()
    await ui.unmount()
  }
})

test('the saved notes come back after /clear', async ($, on) => {
  on('store.get', () => ({ value: ['call bob'] }))
  // Answer the event after the hook passes it on with next(e)
  on('classic.SessionStart', () => ({}))

  await $.classic.SessionStart({ source: 'clear' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'call bob' })).toBeDefined()
  await ui.unmount()
})
