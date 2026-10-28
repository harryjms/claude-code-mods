// my-mod: /my-mod opens a pane with a text field and a list of notes. Each
// note has a button that deletes it, and the notes last between sessions.
import { atom, read, update } from 'claude-code'

// The pane's id: passed to $.ui.open and checked against e.requestId
const PANE = 'my-mod'

// $.state lasts for the session, survives a reload of this module, and
// redraws every site that read it when it changes. Declared in types/index.d.ts.
const notes = atom({ plugin: 'my-mod', key: 'notes' }, [])

// Copy the notes an earlier session saved from $.store into $.state
async function loadNotes($) {
  const saved = await $.store.get('notes')
  await update($, notes, () => (Array.isArray(saved) ? saved : []))
}

// Save to $.store for the next session, then to $.state to redraw
async function saveNotes($, list) {
  await $.store.set('notes', list)
  await update($, notes, () => list)
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await loadNotes($)
    // immediate: the command opens the pane even while Claude is working.
    // Registered last: a taken name throws, which would skip the rest.
    await $.command.register({ name: 'my-mod', description: 'Open the notes pane', immediate: true })
    return next(e)
  })

  // /clear, /resume and /branch reset $.state, and session.start doesn't run
  // again, so load the notes once more. Where the built-in guard loads
  // (managed settings, Team or Enterprise login), classic.* hooks of a
  // user-installed mod don't run.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadNotes($)
    return next(e)
  })

  on('command.run', { command: 'my-mod' }, async ($) => {
    // Opening a pane draws nothing by itself: Claude Code then fires ui.render
    await $.ui.open({ id: PANE, title: 'Notes', focus: true, closeOnEscape: true })
    // Print nothing in the transcript
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    // Leave other mods' panes alone
    if (e.requestId !== PANE) return next(e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    // Reading the atom subscribes this site, so a write redraws it
    const list = await read($, notes)

    const rows = list.map((note, i) =>
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Button({
            // Every control in one drawing needs a key of its own
            key: 'delete-' + i,
            label: 'x',
            plain: true,
            onPress: () => saveNotes($, list.filter((_, j) => j !== i)),
          }),
          Text({ wrap: 'wrap', children: [note] }),
        ],
      }),
    )

    return Box({
      flexDirection: 'column',
      children: [
        Input({
          key: 'new-note',
          label: 'Note',
          placeholder: 'Type a note and press Enter',
          value: '',
          submitLabel: 'add',
          autoFocus: true,
          onSubmit: async (value) => {
            if (!value.trim()) return
            await saveNotes($, [...list, value.trim()])
          },
        }),
        ...(rows.length > 0 ? rows : [Text({ dimColor: true, children: ['No notes yet'] })]),
      ],
    })
  })
}
