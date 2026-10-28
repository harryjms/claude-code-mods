# Testing a mod

This reference is condensed from https://code.claude.com/docs/en/plugins/mods/test. The test kit's declarations are in the `declare module 'claude-code/testing'` block of `.claude-plugin/types/claude-code/index.d.ts`.

## Contents

- [Running tests](#running-tests)
- [Test structure](#test-structure)
- [Kit rules](#kit-rules)
- [What a stub returns](#what-a-stub-returns)
- [Mocks](#mocks)
- [Timers](#timers)
- [Drawings](#drawings)
- [Drawings after `/clear`](#drawings-after-clear)
- [Policy mods](#policy-mods)
- [What to cover](#what-to-cover)

## Running tests

```bash
cd <mod-dir> && claude plugin test        # or: claude plugin test <mod-dir>
```

- **Which files run**: every file under the directory whose name ends in `.test.ts` or `.test.tsx`.
- **Environment**: no session, sign-in or network is needed, and the tests have no fs, network or process access.
- **Exit status**: 1 when a test fails, so it works in CI.
- **Timeout**: each test gets 5 s unless it sets `timeoutMs`.
- **A file with no `test()`** fails with `declares no test(): nothing ran`.
- **`hooks modules are turned off`** means mods can't load in this shell at all. See troubleshooting.md.

Test files can import the mod's own files and sibling `.ts` helpers, so you can unit-test plain functions without the kit.

## Test structure

```ts
import { expect, test, mock, describe, tier } from 'claude-code/testing'

test('name', async ($, on) => {
  // 1. Register stubs first. A stub answers in Claude Code's place, beneath every mod.
  on('tool.call', () => ({ result: 'ok' }))
  // 2. Fire events through the mod's hooks with the test's own $. This $ is Claude Code, not the mods API.
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  const answer = await $.command.run({ command: 'my-cmd', args: '' })
  // 3. Assert
  expect(answer.text).toBe('...')
})
```

- **Firing events**: each method on the test's `$` fires the event of the same name and resolves to its result. The common ones are `$.tool.call`, `$.tool.check`, `$.command.run`, `$.prompt.submit`, `$.session.start`, `$.turn.complete`, `$.turn.step`, `$.session.receive`, and `$.classic.<Event>`.
- **Mods API calls**: a test can't fire one directly, such as `ui.close`. Trigger it through the mod instead, for example by pressing the button that makes the call.
- **Assertions**: `expect` has `toBe`, `toEqual`, `toMatch`, `toMatchObject`, `toContain`, `toBeDefined`, `toBeUndefined` and `toThrow`, each of which can follow `.not`.

## Kit rules

- **Register every stub before the test's first call on `$`.** Registering one afterward throws an error such as `on("ui.render") after the test first called $`.
- **`session.start` doesn't run by itself.** Each test starts with a freshly loaded module, and none of its hooks have run. Fire `session.start` when the hooks depend on it:

  ```ts
  on('session.start', () => ({ cwd: '/work' }))              // answers the event after the hook calls next(e)
  on('command.register', () => ({ value: undefined }))       // answers the hook's $.command.register
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  ```

  Without the `command.register` stub, that call rejects with `no implementation for command.register`, and the kit quietly skips the rest of the hook.
- **Every mods API call the mod makes needs a stub.** The exceptions are `$.ui.invalidate`, `$.state` and `$.session.append`, which the kit answers itself, and `$.clock`, which needs `mock.clock(on)`.
- **A hook that returns `next(e)` needs a stub** to answer it. For `ui.render`, return an element as plain data: `{ type: 'Text', props: {}, children: ['...'] }`.
- **Two kinds of stub return**:
  - A stub for a **mods API call** returns `{ value }`, or `{ deny }` to make the call reject. A bare value fails the test with `returned neither { value } nor { deny }`.
  - A stub for a **Claude Code event** returns that event's own result, such as `{ result }` for `tool.call`.
- **A stub that throws is skipped.** When an `expect` inside a plain-function stub fails, the test fails, and the output names the hook.
- **`turn.step` stubs are async generators.** Read the stream to its end:

  ```ts
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-test', messageCount: 1 })
  let step = await stream.next(); while (step.done !== true) step = await stream.next()
  const result = step.value
  ```

- **Reading failures**: a failed test's output includes a block headed `the engine reported:`, which lists the hooks that were skipped and the reasons.

## What a stub returns

| The mod calls, or passes on with `next(e)` | Stub |
| :- | :- |
| `$.command.register`, `$.tool.register`, `$.ui.toast`, `$.ui.log`, `$.ui.status`, `$.ui.close`, `$.store.set` | `() => ({ value: undefined })`. For toasts and logs, the text is `e.text`. |
| `$.store.get` | `($, e) => ({ value: saved.get(e.key) })` |
| `$.fs.read` | `($, e) => ({ value: e.path.endsWith('notes.md') ? '# Notes' : '' })`. `e.path` arrives absolute. |
| `$.ui.open` | `() => ({ value: { isPlaced: true } })`. The pane's options are fields of `e`. |
| `$.ui.ask` | A **`tool.call`** stub, because the question arrives as an `AskUserQuestion` call: `($, e) => ({ result: { answers: { [e.questions[0].question]: 'Run it' } } })`. Return `{ deny: '...' }` to simulate a dismissal. Check `e.tool` first. |
| `$.model.complete` | `() => ({ value: { isAnswered: true, text: '...', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })` |
| `$.process.run` | `($, e) => ({ value: { exitCode: 0, stdout: '...', stderr: '' } })`. `e.argv` is the argument list, and `e.init` holds `cwd` and `timeoutMs`. |
| Any mods API call that should fail | `() => ({ deny: 'reason' })` |
| `session.start` | `() => ({ cwd: '/work' })` |
| `turn.start` | `($, e) => ({ turnId: e.turnId })` |
| `tool.call` | `() => ({ result: '...' })` |
| `turn.complete` | `() => ({ text: '' })`. Fire it with `$.turn.complete({ turnId, answer, durationMs, isAborted: false, usage: null })`. |
| `prompt.submit` | `($, e) => ({ text: e.text })` |
| `prompt.fill` | `() => ({ isFilled: true })` |
| `$.prompt.read` | `() => ({ value: { text: '...', cursor: 0 } })` |
| `$.ui.copy` | `() => ({ value: { isCopied: true } })` |
| `$.ui.notify` | `() => ({ value: { isSent: true, channel: 'terminal_bell' } })` |
| `$.session.messages` | `() => ({ value: [{ role: 'assistant', text: '...', toolUses: [] }] })` |
| `$.session.id`, `$.agent.list` | `() => ({ value: 'abc123' })`, `() => ({ value: [] })` |
| `session.send` | `() => ({ isDelivered: true })`. `e.to` arrives as a string. |
| `session.receive` | `($, e) => ({ text: e.text })`. Fire it with `$.session.receive({ origin: { kind: 'peer-send-message' }, text })`. |
| `classic.<Event>` | `() => ({})` |
| `ui.render` | `() => ({ type: 'Text', props: {}, children: ['...'] })` |

## Mocks

- **`mock.clock(on, { now? })`** answers `$.clock` and returns a clock the test controls. See [Timers](#timers).
- **`mock.store(on, { key: value })`** answers `$.store` from those starting entries and returns nothing. To check what the mod saved, write your own `store.get` and `store.set` stubs backed by a `Map`.
- **`mock.env(on, { CI: 'true' })`** answers `$.env.get`.
- **`mock.session(on)`** returns an object whose `appended()` lists the rows the mod added with `$.session.append`. Needs v2.1.293 or later.

## Timers

```ts
const clock = mock.clock(on)          // starts at 0, and moves only when the test moves it
await $.command.run({ command: 'countdown', args: '3' })
await clock.advance(2000)             // runs every timer that comes due
expect(toasts).toEqual([])
await clock.advance(1000)
expect(toasts).toEqual(['Time is up'])
```

The clock also has these methods:

- `clock.set(ms)`: moves the time forward to `ms`.
- `clock.now()`: the current time.
- `clock.settle()`: runs timers that are already due.
- `clock.sleep(ms)`: inside a stub, delays that stub's answer until the test has advanced that far.

## Drawings

```ts
const PANE = {
  plugin: 'my-mod', component: 'Pane', requestId: 'my-mod',
  viewport: { columns: 100, rows: 30 },
  props: { title: 'T', isFocused: true, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
  const ui = await $.ui.mount({ ...PANE, surface })
  await ui.press({ key: 'more' })
  await ui.input({ key: 'new-note', text: 'buy milk' })     // types the text and presses Enter
  await ui.input({ key: 'q', text: 'x', kind: 'change' })   // types without submitting
  await ui.select({ key: 'size', value: 'large' })
  expect(await ui.find({ type: 'Text', text: /^Count: \d+$/ })).toBeDefined()
  await ui.unmount()
}
```

- **Addressing controls**: `press`, `input`, `select` and `find` address elements by `key`. `find` also matches `{ type, text }`, where `text` is a string or a regular expression, and returns `{ type, props, children }` or `undefined`.
- **Timing**: each method resolves after the handler finishes, so the next line can check the result.
- **Props**: set `props` to what Claude Code would pass for that site. For `AbovePrompt`, use `{ hasSurvey, isWorking, maxRows, bodyColumns, scroll, view }`. For `Spinner`, use `{ word, message, suffix, mode }`.
- **What the test checks**: the tree's validity for each surface, not how the app paints it. Look at a new layout in a real session too.
- **Shared module**: mounts in one test share the loaded module, so module state carries from one mount to the next.

## Drawings after `/clear`

Each test starts with every `$.state` value at its default, which is how `/clear` leaves them. To test the reload, skip `session.start`, fire `classic.SessionStart` with `source: 'clear'`, and check what the mod draws:

```ts
on('store.get', () => ({ value: 7 }))
on('classic.SessionStart', () => ({}))
await $.classic.SessionStart({ source: 'clear' })
const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
expect(await ui.find({ type: 'Text', text: 'Count: 7' })).toBeDefined()
```

## Policy mods

To test a policy mod, set its tier and load inline mods beside it:

```ts
tier('prepend')                                     // once, at the top of the file
const runner = { name: 'runner', register(on) { on('tool.call', async ($) => { await $.process.run(['ls']); return { result: 'x' } }) } }
test('refuses a mod that starts a process', { plugins: [runner] }, async ($, on) => {
  on('tool.call', () => ({ result: 'claude code answered' }))
  let message = ''
  try {
    await $.tool.call({ tool: 'Bash', command: 'ls' })   // the first call on $ loads the mods
  } catch (error) {
    message = error.message
  }
  expect(message).toBe('runner: refused by acme-guard: Acme policy: mods may not call process.run')
})
```

- **When mods load**: the kit loads every mod at the test's first call on `$`.
- **A refusal** makes that call throw. The message names the refused mod, the refusing mod, and the reason, as in `runner: refused by acme-guard: ...`.

## What to cover

- Each command's output, including empty and invalid `args`.
- Each branch of a guard: allowed, refused, the user agreed, the user declined, and nobody answered.
- Each render site on each surface the mod supports, including the empty state and the fallback for a surface that lacks an element.
- State that must survive: a reload (`session.start` fired again) and `/clear` (`classic.SessionStart`).
- Failures: `$.process.run` with a non-zero exit, `$.model.complete` with `isAnswered: false`, and a stub that returns `{ deny }`.
