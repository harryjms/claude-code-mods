# Events

This reference is condensed from https://code.claude.com/docs/en/plugins/mods/events and https://code.claude.com/docs/en/plugins/mods/reference#events. For your installed version, `.claude-plugin/types/claude-code/index.d.ts` is authoritative.

## Contents

- [The hook function](#the-hook-function)
- [Observe, rewrite, answer](#observe-rewrite-answer)
- [Matchers](#matchers)
- [Event tables](#event-tables)
- [Tool calls](#tool-calls)
- [Prompts](#prompts)
- [Turns](#turns)
- [Settings reads](#settings-reads)
- [Settings hook events](#settings-hook-events-classic)
- [Order of mods](#order-of-mods)
- [When a hook fails](#when-a-hook-fails)
- [Events the built-in guard passes over](#events-the-built-in-guard-passes-over)

## The hook function

`on(event, [matcher], hook)` returns a registration with one method, `.catch(handler)`. A hook is `async ($, e, next) => result`. The exceptions are `turn.step` and `process.spawn`, whose hooks are **async generators** (`async function* ($, e, next) { ... }`).

| Argument | What it is |
| :- | :- |
| `$` | The mods API. See api.md. |
| `e` | The event's input, as deeply frozen plain data. To change it, pass a copy to `next`. |
| `next(e)` | The next handler: the hooks after this one, then Claude Code's own behavior. Resolves to the event's result. |
| `next.signal` | An `AbortSignal` that aborts when the event is abandoned, for example when the user interrupts. Pass it to long-running work. |
| `next.origin` | `{ plugin, tier }` of whoever fired the event. Claude Code itself is `{ plugin: 'engine', tier: 'core' }`. |
| `next.budget` | `{ ms, remainingMs }`: the hook's time limit, and how much of it is left |
| `next.to(e, tier)` | Skips to `append`, `builtin` or `core`. Only a mod in `prependPlugins` or `appendPlugins` can call it. |
| `next.error` | In a `.catch` handler only. `{ kind: 'throw' \| 'timeout' \| 're-entry', message, cause? }` |
| `next.called` | In a `.catch` handler only. `true` when the hook had already called `next`. |

## Observe, rewrite, answer

```js
// Observe before the event
on('tool.call', async ($, e, next) => { $.ui.log('about to use ' + e.tool); return next(e) })

// Observe after the event
on('tool.call', async ($, e, next) => { const r = await next(e); $.ui.log(e.tool + ' done'); return r })

// Rewrite
on('prompt.submit', async ($, e, next) => next({ ...e, text: e.text.trim() }))

// Answer: this short-circuits the chain, so later mods and Claude Code don't run
on('tool.call', { tool: 'Bash' }, async () => ({ deny: 'Bash is off in this project. Use the file tools.' }))
```

## Matchers

A matcher is the optional second argument to `on`. It's an object whose fields are compared with the event's, and the hook runs only when every field matches. Each field takes one of these:

- **A value**: `{ tool: 'Bash' }`
- **An array of allowed values**: `{ tool: ['Edit', 'Write'] }`
- **A regular expression**: `{ tool: /^mcp__github__/ }`

These rules apply to matchers and event names:

- **Common matcher fields**: `ui.render` takes `{ component }`, `command.run` takes `{ command }`, and `classic.SessionStart` takes `{ source }`.
- **`isReadOnly` on `tool.check`**: `{ isReadOnly: true }` works. `isReadOnly: false` never matches, so test `!e.isReadOnly` in the hook body instead.
- **Wildcard event names**:
  - `'*'` matches every event except the telemetry events.
  - `'classic.*'` matches every settings hook event.
  - Telemetry hooks need the filter `{ to: 'collector' }`.
- **One registration per event and matcher.** Registering an event twice with no matcher fails the load, with a message like `on("session.start") is registered twice without a matcher`.

## Event tables

In the "Return" columns:

- `next(e)` passes the event on unchanged.
- `next({ ...e, x })` passes on a copy with one field changed.
- An object answers the event without calling `next`.

### Tools

| Event | Fires when | Return |
| :- | :- | :- |
| `tool.call` | A tool is about to run. Covers subagents' calls and MCP tools. `e.tool` is the tool's name, and the tool's arguments are fields of `e`, such as `e.command` for Bash and `e.file_path` for Read, Edit and Write. | `next(e)`, `next({ ...e, command })`, `{ deny: reason }`, or `{ result }` |
| `tool.check` | Claude Code decides whether a call may run. This happens after the `tool.call` hooks and the `PreToolUse` hooks, and before the permission prompt, auto mode's classifier and `PermissionRequest` hooks. `e.input` holds the arguments. `e.agentId` is set for a subagent's call. `e.ceiling` is `'ask'` for a connector tool the organization set to ask. `e.isReadOnly` is `true` or absent, and needs v2.1.304 or later. | `await next(e)`, which resolves to `{ decision }`, or your own `{ decision: 'allow' \| 'ask' \| 'deny', reason? }` |
| `tool.describe` | A tool's description is first sent to Claude | `{ description, isDeferred? }` |

### Prompts and what Claude reads

| Event | Fires when | Return |
| :- | :- | :- |
| `prompt.submit` | A prompt is submitted. `e.text` is what was typed. | `next({ ...e, text })` to rewrite it, `next({ ...e, context: [...(e.context ?? []), extra] })` to add text only Claude reads, or `{ drop: reason }` to stop it |
| `prompt.fill`, `prompt.suggest` | Text is about to go into the prompt box as a draft, or as a dim suggestion | `next(e)` with changed text |
| `prompt.edit` | The user edits the prompt box. The hook has a 50 ms limit. | `next(e)` |
| `prompt.autocomplete` | A word ends at the cursor (`e.token`) | `{ suggestions: [{ text, label, description }] }` |
| `prompt.compose` | Claude Code renders a system prompt | `{ sections: [{ id, text, scope }] }` |
| `prompt.section` | Once for each system prompt section (`e.name`) | `{ text }`, or `{ text: null }` to omit the section |
| `prompt.context` | Once for each conversation, for the context sent with the first message | `{ blocks }` |
| `prompt.attachment` | Claude Code adds a message of its own for Claude, such as a reminder (`e.type`, `e.detail`) | `{ text }`, or `{ text: null }` |
| `prompt.mention` | Claude Code is about to read an @-mentioned file. Needs v2.1.290 or later. | `next({ ...e, path })` or `{ deny }` |
| `skill.prompt` | A skill's text is expanded. The fields are `e.skill`, `e.text`, `e.source`, `e.pluginName`, `e.path`, `e.frontmatter` and `e.frontmatterProblem`, and need v2.1.299 or later. | `{ text }`. A hook can change only `text` and `frontmatter`. |
| `attribution.text` | Claude Code composes commit or pull request attribution | `{ text }` |

Hook text that changes from one request to the next invalidates the prompt cache.

### Commands and configuration

| Event | Fires when | Return |
| :- | :- | :- |
| `command.run` | A command is about to run. `e.args` is the text after the name. | `{ text }`, which prints and which Claude reads; `{}` to print nothing; or `next(e)` |
| `command.describe` | Once for each command, for the command list | `{ description, argumentHint, isHidden }` |
| `config.set` | A `/config` row is about to change | `next({ ...e, value })` or `{ deny: reason }` |
| `config.describe` | Once for each `/config` row | `{ label, description, isHidden }` |
| `settings.read` | A mod calls `$.settings.read`, or Claude Code merges the session's settings. Claude Code's own read needs v2.1.304 or later. | `next(e)`, `{ value }` or `{ deny }` |

### Turns

| Event | Fires when | Return |
| :- | :- | :- |
| `turn.start` | A turn begins (`e.turnId`) | `next(e)` |
| `turn.step` | One request is about to go to the model. This is an **async generator**. | `yield* next(e)` (the finished result), `yield* next({ ...e, model })`, or `next({ ...e, effort })` |
| `turn.complete` | A turn ended. The fields are `e.answer`, `e.durationMs`, `e.usage`, `e.isAborted`, and `e.agentId` for a subagent's turn. | `next(e)`, or `{ text }` to show a line under the answer |

### Session

| Event | Fires when | Return |
| :- | :- | :- |
| `session.start` | Once for each mod before the first prompt, and again after each reload. Not after `/clear`, `/resume` or `/branch`. Claude Code waits for it before the first prompt. | `next(e)` |
| `session.end` | The session ends, or `/clear`, `/resume` or `/branch` runs. `e.reason` is `clear`, `resume`, `logout`, `prompt_input_exit` or `other`. All `session.end` hooks together get about 1.5 s. | `next(e)` |
| `session.compact` | The conversation is about to be compacted | `{ skip: reason }` |
| `session.receive` | A message arrives from another session or agent. The fields are `e.text` and `e.origin.kind`. | `next(e)`, or `{ consumed: reason }` to keep it from Claude |
| `session.send` | A message is about to leave. The fields are `e.to`, `e.text` and `e.origin.kind`. | `next(e)`, or `{ isDelivered: false, reason }` |
| `session.append` | A row is about to be stored in the conversation | `next({ ...e, message })` with changed text in `message.content` |
| `session.attach`, `session.detach` | Another app connects to or disconnects from the session | `next(e)` |
| `session.measure` | After each turn, and when a plan limit's percent used changes | `next(e)` |

### Subagents

| Event | Fires when | Return |
| :- | :- | :- |
| `agent.offer` | A subagent type is offered to Claude | `{ isOffered: false }` to withhold it |
| `agent.spawn` | A subagent or teammate is about to start. `e.isTeammate` is set for a teammate. Doesn't fire again when SendMessage resumes a subagent. | `next({ ...e, model })` or `{ deny }` |

### Interface

| Event | Fires when |
| :- | :- |
| `ui.render` | A render site is about to be drawn. See interface.md. |
| `ui.resolve` | Mods load, once for each app, site and mod |
| `ui.press`, `ui.input`, `ui.select` | A `Button`, `Input` or `Select` that a mod drew is used. `e.element` is the control's key, and the hook runs before the control's callback. |
| `ui.focus`, `ui.scroll` | Focus or the scroll position of a pane or the band is about to change |
| `ui.close` | A pane is about to close. `e.id` is the pane, and `e.origin.kind` is `plugin`, `person` or `unload`. |
| `ui.message` | A `Client` element posts data to its mod |
| `ui.fault` | A `Client` failed to load, draw or run (`e.phase`, `e.reason`). Needs v2.1.289 or later. |

### Other mods, telemetry, and mods API calls as events

| Event | Fires when | Return |
| :- | :- | :- |
| `plugin.register` | A hooks module is about to load. `e.uses` lists its events, calls, environment variables and state, written without `$.` (as in `process.run`), and `e.tier` is its tier. | `{ refuse: reason }` |
| `engine.create` | The mods API is being built for a mod | A changed API, to add a namespace |
| `telemetry.log`, `telemetry.mark` | A telemetry record is about to be logged. The hook needs `{ to: 'collector' }`. | `next(e)` or `{ deny }` |
| `<namespace>.<method>`, such as `fs.read`, `http.fetch` or `model.complete` | Another mod later in the chain calls that `$` method | `next(e)`, `{ deny: reason }`, or `{ value }` |

## Tool calls

The patterns below build on the `tool.call` and `tool.check` rows in [Event tables](#tools).

**Act after the tool runs**: `await next(e)` first. A refused call comes back as `{ deny }`, and a failed one has `isError` set:

```js
on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
  const result = await next(e)
  if (!result.deny && !result.isError && e.file_path.endsWith('.mdx')) $.ui.log('changed ' + e.file_path)
  return result
})
```

Other moves a `tool.call` hook can make:

- **Change the call**: `next({ ...e, command: rewritten })`. In auto mode, a changed input can be denied with the message `a hook changed this call's input after the model wrote it`.
- **Retry**: call `next(e)` again after a result with `isError`.
- **Answer without running the tool**: return `{ result }` without calling `next`. No prompt appears and the tool doesn't run. For a built-in tool, give `result` the shape that tool's own result has, as declared in `claude-code-tools/index.d.ts`.
- **Withhold a result that already exists**: return `{ deny: reason }` after `await next(e)`. This undoes nothing the tool did, and Claude reads `<Tool> ran, and a plugin withheld its result:` followed by your reason.

`PreToolUse` hooks run at two points around a mod's `tool.call` hook:

- **Managed `PreToolUse` hooks** run before every mod's `tool.call` hook. If one blocks the call, no mod's hook runs.
- **Other `PreToolUse` hooks** run after the last mod calls `next`. A mod that answers the call without calling `next` keeps them from running.

**Hold a call until the user decides**: `await $.ui.ask(question, ['Run it', 'Refuse'])`.

- The question should end with a question mark, and the call takes 2 to 4 options.
- It resolves to the label the user picks, or to the free text they typed under "Other".
- It rejects when the user dismisses the question or picks "Chat about this", and in a `-p` run. Default to the safe answer in a `catch` block, and compare the result with your labels exactly.
- The wait inside a `$` call doesn't count against the time limit. See `templates/guard`.

**Approve or refuse a call from `tool.check`**:

```js
on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
  const decided = await next(e)                         // Claude Code's own decision; no prompt is shown yet
  if (!e.input.command.includes('git push')) return decided
  const branch = await $.process.run(['git', 'branch', '--show-current'])
  if (branch.stdout.trim() !== 'main') return decided
  return { decision: 'deny', reason: 'Push from a branch other than main' }
})
```

`tool.check` has these limits:

- **Fixed rules**: for a fixed command or path, use a permission rule such as `Bash(npm test)`, which needs no code.
- **Plan mode**: a hook can only tighten the decision for a call that isn't read-only.
- **The built-in guard**: where it loads, a mod's `allow` can't lift a `deny` rule or an `ask` rule, or pass a call that a `PreToolUse` hook blocked.
- **`e.isReadOnly`**: this is the tool's own report. WebFetch and Agent report read-only, so don't approve a call on this field alone.

## Prompts

| To do this | Return |
| :- | :- |
| Rewrite the prompt. The transcript and the history show the new text. | `next({ ...e, text })` |
| Add context that only Claude reads | `next({ ...e, context: [...(e.context ?? []), 'Current branch: x'] })` |
| Stop the prompt | `{ drop: 'reason for the user' }`. The text goes back into the prompt box, and the user sees `Prompt dropped by a hook:` followed by your reason. |

The prompt goes through anyway in these cases:

- The hook returns `drop` after its `next` let the prompt through.
- The hook throws or times out. Add `.catch` returning `{ drop }` to prevent this.

## Turns

```js
on('turn.step', async function* ($, e, next) {
  const result = yield* next(e)               // forwards the stream and gives back the finished result
  if (result.usage && e.agentId === undefined) $.ui.log('cache read ' + result.usage.cache_read_input_tokens)
  return result
})
```

- **`result.usage`** holds `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` and `model`.
- **`result.serverToolUses`** lists the calls the API ran itself, such as the advisor tool. Needs v2.1.290 or later.
- **Routing a request to another model**: `yield* next({ ...e, model: 'haiku' })`. Aliases need v2.1.309 or later; on older versions, use a full model id.

## Settings reads

- **Who calls it**: `$.settings.read` from a mod, and Claude Code's own merge of the settings from v2.1.304. Tell them apart with `next.origin`: Claude Code's own read is `{ plugin: 'engine', tier: 'core' }`.
- **`e.layers`**: one `{ source, settings }` object for each source, lowest precedence first: `plugin`, `user`, `project`, `local`, `flag`, `policy`.
- **`e.source`**: set when a mod asked for a single source.
- **What `await next(e)` gives you**: `{ value }` or `{ deny }`. Return a `{ deny }` from a later hook unchanged.
- **Changing one key**:

  ```js
  on('settings.read', async ($, e, next) => {
    const read = await next(e)
    if (e.source || !read.value) return read
    return { value: { ...read.value, spinnerTipsEnabled: false } }
  })
  ```

- **Keys you can't change this way**: permission rules and `env` returned here don't take effect. Use settings files, or `$.env.set`.
- **The built-in guard skips this hook** in user-installed mods.

## Settings hook events (`classic.*`)

Every settings hook event is also a mod event named `classic.<Event>`, such as `classic.Stop`, `classic.PostToolUse` or `classic.SessionStart`. `e` is the JSON a settings hook receives on stdin. Return `next(e)` so that the settings hooks still run.

`classic.SessionStart` fires at startup, after compaction, and after `/clear`, `/resume` and `/branch`. `e.source` is `startup`, `compact`, `clear`, `resume` or `fork`. Use it to reload `$.state` after a reset.

## Order of mods

Hooks on the same event form one middleware chain. The first mod is the outermost: it sees the event first and the result last. The order is:

1. The built-in guard `sec-default@builtin`, where it loads; then the organization's `prependPlugins`; then other mods that count as the organization's.
2. The mods the user installed. A mod runs before the mods it lists under `dependencies`.
3. The organization's `appendPlugins`.
4. The other mods built into Claude Code.

Within one module, hooks run in the order `register` called `on`.

## When a hook fails

A hook that throws, times out, or returns the wrong shape (including a `ui.render` tree that doesn't validate) is handled this way:

- **It failed before calling `next`**: Claude Code skips it, and the next handler runs. The hook fails open.
- **It failed after `next` resolved**: the result stands, and nothing runs again.
- **Either way**, one line reports it, such as `my-mod: tool.call hook skipped: threw Error: boom`.

To fail closed, chain a `.catch` handler. It gets 1 s:

```js
on('tool.call', { tool: 'Bash' }, guard).catch(async ($, e, next) => {
  if (next.called) return next(e)              // gives back the result guard's own call produced, without running again
  return { deny: 'The command guard failed (' + next.error.kind + '), so the command was not run.' }
})
```

What a `.catch` handler returns depends on the event:

| Event | When `next.called` is false, return |
| :- | :- |
| `tool.call`, `config.set`, `ui.notify` and other `$` method events | `{ deny: reason }` |
| `prompt.submit` | `{ drop: reason }` |
| `tool.check` | `{ decision: 'deny', reason }`. A refusal here holds even after `next`, so you don't need to test `next.called`. |
| `plugin.register` | `{ refuse: reason }`. This also holds after `next`, so you don't need to test `next.called`. |

If the `.catch` handler itself fails, Claude Code skips the hook as if it had no handler.

## Events the built-in guard passes over

On a machine with managed settings, or in a session signed in to a Team or Enterprise account, a mod the user installed never runs hooks on these events:

- `classic.*`
- `prompt.compose`, `prompt.section`, `prompt.context` and `prompt.attachment`
- `skill.prompt`
- `attribution.text`
- `session.compact`
- `settings.read`
- `session.append` with a `door` filter of `attachment`, `hook-context` or `compaction`

`/plugin` shows the user a note about it. Only a mod the organization installs as its own runs these hooks there.
