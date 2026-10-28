# The mods API (`$`)

This reference is condensed from https://code.claude.com/docs/en/plugins/mods/api and https://code.claude.com/docs/en/plugins/mods/reference#mods-api-methods. Every method has a comment and an example in `.claude-plugin/types/claude-code/index.d.ts`; search that file for the method's name.

## Contents

- [Namespaces](#namespaces)
- [Commands](#commands)
- [Tools for Claude](#tools-for-claude)
- [Model calls](#model-calls)
- [Background work and timers](#background-work-and-timers)
- [Showing something without a turn](#showing-something-without-a-turn)
- [Starting a turn, and interruptions](#starting-a-turn-and-interruptions)
- [Messages between sessions](#messages-between-sessions)
- [Files, processes, network, env, settings, MCP](#files-processes-network-env-settings-mcp)
- [User configuration](#user-configuration-options)
- [Limits](#limits)

## Namespaces

| Namespace | Methods |
| :- | :- |
| `$.plugin` | `name`, `root`: this plugin's name and directory |
| `$.ui` | `resolve`, `invalidate`, `open`, `close`, `panes`, `focus`, `scroll`, `toast`, `notify`, `status`, `log`, `notice`, `ask`, `copy`, `selection`, `blit` |
| `$.command` | `register`, `run`, `list` |
| `$.tool` | `register`, `call`, `check`, `list` |
| `$.agent` | `register`, `spawn`, `list`. `list()` gives each agent a `status`: `pending`, `running`, `waiting`, `idle`, `completed`, `failed` or `killed`. |
| `$.model` | `complete`, `fork`, `classify` |
| `$.prompt` | `submit`, `read`, `fill`, `suggest`, `compose` |
| `$.turn` | `abort` |
| `$.session` | `messages`, `cwd`, `root`, `model`, `turns`, `id`, `repo`, `surfaces`, `usage`, `version`, `compact`, `send`, `append`, `authorize` |
| `$.config` | `list`, `set`: the `/config` rows |
| `$.settings` | `read` |
| `$.env` | `get`, `set` |
| `$.fs` | `read`, `write`, `list`, `exists`, `stat`, `ancestors` |
| `$.store` | `get`, `set`, `delete`, `keys` |
| `$.state` | `get` and `set`, usually called through the `atom`, `read`, `update`, `derive` and `memberOf` helpers imported from `'claude-code'` |
| `$.clock` | `now`, `sleep`, `after`, `every` |
| `$.http` | `fetch` |
| `$.process` | `run`, `spawn` |
| `$.mcp` | `call`, and `connect(server)` for an MCP server the mod's own manifest lists |
| `$.audio` | `play`, `speak` |
| `$.telemetry` | `log`, `mark`. A record is sent only when Claude Code or a built-in mod makes the call. |

Each call is also an event named `<namespace>.<method>`. A mod earlier in the chain can observe, rewrite or refuse it. That's how organizations restrict mods, and how tests stub calls.

## Commands

A command is for the user. Register it in `session.start`, then answer it in `command.run`:

```js
on('session.start', async ($, e, next) => {
  await $.command.register({ name: 'standup', description: 'Summarize what changed today', argumentHint: '[days]' })
  return next(e)
})
on('command.run', { command: 'standup' }, async ($, e) => {
  return { text: 'Summary for the last ' + (e.args || '1') + ' day(s): ...' }
})
```

- **`$.command.register`** takes these fields:
  - `name`: letters, digits, `_` and `-`, up to 64 characters
  - `description`
  - `argumentHint`, optional
  - `immediate: true`, optional, so the command runs while Claude is working instead of waiting for the turn to end
- **A taken name throws**, as in `"/focus" refused: it is the built-in /focus`, and the rest of the hook doesn't run. Register commands last, or wrap the call in try/catch. Registering the same name again replaces the earlier registration.
- **What the hook returns**:
  - `{ text }` prints in the transcript after the plugin's name, and Claude reads it.
  - `{}` prints nothing, which suits a command that opens a pane.
  - Returning `next(e)` for your own command gives the error `registered /x but no command.run hook answered it`.
- **`$.command.run({ command, args })`** runs any command as if the user typed it. The command queues until the session is idle.

## Tools for Claude

```js
on('session.start', async ($, e, next) => {
  await $.tool.register({
    name: 'ticket',
    description: 'Look up a ticket by its id and return its title and status',  // Claude decides when to call it from this
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    // isDeferred: false,   // v2.1.293+: always load the tool, so tool search doesn't defer it
  })
  return next(e)
})
// Claude sees the tool as mcp__<plugin>__<name>
on('tool.call', { tool: 'mcp__my-mod__ticket' }, async ($, e) => {
  const r = await $.http.fetch('https://tickets.example.com/api/' + encodeURIComponent(e.id))
  return { result: r.ok ? r.text : 'Lookup failed with status ' + r.status }
})
```

A call that no hook answers fails. Always return a `result`, so that Claude learns when a lookup failed.

## Model calls

`$.model.complete` uses the session's credentials, so it bills to the user's plan, API key or cloud provider.

```js
const r = await $.model.complete({
  model: 'haiku',
  system: 'Reply with one word: bug, feature, or question.',
  prompt: e.args,
  maxTokens: 20,         // the default is 1024, and the maximum is 64,000 or the model's output limit
  timeoutMs: 15000,
  // effort: 'low',
})
const label = r.isAnswered ? r.text.trim() : 'unknown'   // check r.reason when isAnswered is false
```

- **API failures don't reject.** The call resolves with `isAnswered: false` and a `reason`. It rejects only for a request Claude Code won't send, such as a model the organization blocks.
- **Prompt caching** needs v2.1.292 or later:
  - Pass `prompt` as an array of blocks, as in `[{ text: RULES, cache: true }, { text: e.args }]`.
  - Put the static content in `prompt`, not `system`. Through Bedrock, Vertex, Foundry or a gateway, a breakpoint in `system` can miss the cache.
  - The API allows 4 breakpoints at most.
  - Check `r.usage.cache_read_input_tokens` to confirm cache hits.
- **`$.model.fork({ prompt })`** sends the whole conversation, with the session's model, system prompt and context, followed by your prompt. It's served mostly from the prompt cache.
- **`$.model.classify(text, labels, options?)`** resolves to one of the labels, or `undefined`.

## Background work and timers

- **Start timers from `session.start`:**
  - `$.clock.every(ms, fn)` and `$.clock.after(ms, fn)` replace `setInterval` and `setTimeout`, with the delay first.
  - Each returns a timer with a `cancel()` method.
  - `await $.clock.now()` gives the time in milliseconds.
  - `$.clock.sleep(ms)` counts against the hook's time limit.
- **Timers stop when the module reloads.** A timer callback runs outside any event, so it keeps running between turns and doesn't start one.
- **A callback that throws** writes to the debug log, and the timer runs again at its next interval.
- **Return from `session.start` without awaiting the timer**, so the session starts right away.

```js
on('session.start', async ($, e, next) => {
  $.clock.every(60_000, async () => {
    const r = await $.process.run(['gh', 'pr', 'checks', '--json', 'state'])
    $.ui.status('checks: ' + summarize(r.stdout))
  })
  return next(e)
})
```

## Showing something without a turn

| Call | What the user sees |
| :- | :- |
| `$.ui.status(text)` | One line under the prompt that stays until the next call replaces it, as in `⚠ my-mod: ...`. Each mod has one. `$.ui.status(undefined)` clears it. |
| `$.ui.toast(text, { timeoutMs? })` | A toast with the mod's name, for 4 s by default. In fullscreen rendering it's a box at the top right; in the classic renderer it's one line at the right under the prompt. At most three draw at once, so combine messages into one toast. |
| `$.ui.log(text)` | A dim line in the transcript, as in `● my-mod: ...`, which Claude doesn't read. `$.ui.log(text, { to: 'debug' })` writes to the debug log instead. |
| `$.ui.notify(text, { title? })` | A notification from the user's terminal, sent through their `preferredNotifChannel` setting. It resolves to `{ isSent: true, channel }`, or to `{ isSent: false, reason }` where `reason` is `disabled`, `no-channel`, `no-surface` or `refused`. |
| `await $.ui.ask(question, options)` | Claude Code's question dialog. It takes 2 to 4 options, resolves to a label or to free text, and rejects when the question is dismissed or in a `-p` run. |
| `$.ui.notice(tool_use_id, text)` | One line under the open dialog for that tool call |
| `$.ui.copy(...)` | Copies text to the clipboard |

In the VS Code extension, status lines and toasts show above the prompt box. The extension cuts a status line at 200 characters and a toast at 500.

## Starting a turn, and interruptions

- **`$.prompt.submit({ text })`** starts a new turn once the session is idle. Claude reads your text after a sentence that names your mod as the sender; add `asUser: true` to send it as the user's own words.
  - It resolves only when the new turn starts, so never `await` it in a hook that runs while Claude is working.
  - In `-p` runs, use `--max-turns` or `--max-budget-usd`, or the mod can loop forever.
- **After the user interrupts a turn** with Esc or Stop, calls that start new work are refused until the user's next input. Their result or error contains one of these strings:
  - `the session was stopped and nobody has sent input since`: the call was refused.
  - `was removed from the queue before it ran`: a queued prompt or command was dropped.

  To retry, keep the arguments and make the call again from a `turn.complete` hook. This behavior needs v2.1.304 or later, apart from `$.prompt.submit` and `$.command.run`.
- **How refused calls come back:**

  | Call | When refused |
  | :- | :- |
  | `$.prompt.submit` | Resolves `{ drop: reason }` |
  | `$.command.run` | Rejects |
  | `$.agent.spawn` | Resolves `{ deny }` |
  | `$.session.send` | Resolves `{ isDelivered: false, reason }` |

## Messages between sessions

`$.session.send({ to, text })` takes one of these forms of `to`:

- `{ sessionId }`: another of the user's sessions
- `{ agentId }`: a subagent or teammate, with an id from `$.agent.list()`
- The string address that a received message came from

It resolves with `{ isDelivered: true }`, or with `{ isDelivered: false, reason }`.

To observe messages, hook `session.receive` and `session.send` (see events.md). The sender's name on a received message is whatever the sender wrote, so don't make decisions based on it.

## Files, processes, network, env, settings, MCP

The module itself has no Node APIs, no timer globals, and no network or file access. Every one of these goes through `$`, with the user's own permissions:

| Call | Details |
| :- | :- |
| `$.fs.read(path)` and `$.fs.write(path, text)` | Up to 4 MiB per file. A relative path resolves against the working directory of the session, or of the subagent whose event the hook handles. `write` isn't atomic, so keep data that several sessions change in `$.store`. |
| `$.fs.list(path)` | One directory's entries, each `{ name, kind, size, isLink }`. Not recursive. |
| `$.fs.exists(path)`, `$.fs.stat(path)`, `$.fs.ancestors(...)` | |
| `$.process.run(argv, { cwd?, timeoutMs? })` | Uses no shell. Resolves `{ exitCode, stdout, stderr }` whatever the exit code, with up to 4 MiB of output each and `isStdoutTruncated` or `isStderrTruncated` set when output was cut. **Rejects** when the program can't start or runs past the timeout, which is 30 s by default and 10 min at most. |
| `$.process.spawn(...)` | Streams a long-running command's output. A hook on `process.spawn` is an async generator. |
| `$.http.fetch(url, init)` | `http` or `https`. Resolves `{ status, ok, headers, text }`. Follows up to 5 redirects; on a redirect to another origin, it keeps only the `accept`, `accept-language`, `content-type` and `user-agent` headers. Times out after 30 s, and each body can be up to 4 MiB. An organization that disallows WebFetch also refuses it. |
| `$.store.get(key)`, `set(key, json)`, `delete(key)`, `keys()` | A persistent key-value store for this plugin, shared by every session on the machine. Holds up to 4 MiB of JSON, in `~/.claude/plugins/store/`. A `--plugin-dir` copy keeps its own file, named `<name>_inline-...`. A `set` changes only its own key, but a `get` followed by a `set` isn't atomic: give each item its own key, and `get` again right before you write. |
| `$.env.get('NAME')` and `$.env.set('NAME', value)` | Write the name as a string literal. `set` applies to Claude Code and to every command and MCP server it starts afterward. |
| `$.settings.read()` | The merged settings. Also takes `{ source: 'user' \| 'project' \| 'local' \| 'flag' \| 'policy' }` and `{ key }`; `key` needs v2.1.304 or later. |
| `$.session.messages()` | The transcript as `{ role, text, toolUses }`, up to the newest 4,096 entries |
| `$.session.usage()` | `{ startedAt, context: { tokens, window, percent }, rateLimits: [{ kind, percentUsed, resetsAt }], cost }` |
| `$.session.cwd()`, `id()`, `model()`, `repo()`, `surfaces()`, `version()` | Facts about the session |
| `$.mcp.call(...)` | Calls a tool on a connected MCP server, under the session's permission rules |

These rules apply to the calls above:

- **Permission rules don't cover `$.fs` and `$.process`.** A `Read(.env)` deny rule doesn't stop a mod's `$.fs.read`.
- **Pass `next.signal` to long-running work**, so it stops when the user interrupts.

## User configuration (options)

Declare `userConfig` fields in `plugin.json` (see https://code.claude.com/docs/en/plugins/components#user-configuration). `register(on, options)` receives the values, with defaults filled in.

Users set the values in `pluginConfigs` in their settings, keyed by plugin id: `<name>@<marketplace>`, or `<name>@inline` for a mod loaded with `--plugin-dir`. A value that doesn't fit its field stops the module from loading, with the message `options do not fit plugin.json userConfig`.

## Limits

| Limit | Value |
| :- | :- |
| A hook's own execution time, not counting time in `next` or `$` calls other than `$.clock.sleep` | 10 s, or 50 ms for `prompt.edit` |
| A `.catch` handler | 1 s |
| All `session.end` hooks together | The SessionEnd hook budget, 1.5 s by default |
| `$.process.run` | 30 s by default and 10 min at most; 4 MiB each of stdout and stderr |
| `$.model.complete` `maxTokens` | 1024 by default, up to 64,000 |
| `$.fs.read` and `$.fs.write` | 4 MiB per file |
| `$.http.fetch` | 4 MiB request body, 4 MiB response body, 30 s, 5 redirects |
| A `drop` or `deny` reason | 4,096 characters |
| `$.store` | 4 MiB of JSON in total |
| `$.session.messages()` | The newest 4,096 entries |
| Command, tool, subagent type and pane names | Letters, digits, `_` and `-`, up to 64 characters |
| Scopes nested in one file of a hooks module | 2,000 |
| One `claude plugin test` test | 5 s unless the test sets `timeoutMs` |

For the drawing limits (tree size, redraw rate, toasts), see interface.md.
