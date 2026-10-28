---
name: create-mod
description: Build, change, test and debug Claude Code mods, which are plugins whose JavaScript or TypeScript hooks module runs inside Claude Code. A mod can draw a pane, a band above the prompt, toasts and status lines, restyle the spinner or tool rows, add /commands and tools, and observe, rewrite or block tool calls, prompts and model requests. Use when the user asks for a mod, wants to change how Claude Code itself looks or behaves with code, or has a mod that does nothing or fails `claude plugin validate`.
argument-hint: "[what the mod should do]"
---

# Create a Claude Code mod

A mod is a plugin with a **hooks module**: an ES module that exports `register(on)`. Each `on(event, [matcher], hook)` call attaches a hook. Claude Code runs the hook *before* it acts on the event, and the hook can:

- **observe** the event and return `next(e)`
- **rewrite** it by returning `next({ ...e, field })`
- **answer** it by returning a result without calling `next`

To reach anything outside its own code (drawing, commands, model calls, files, processes, network), a hook must call the mods API, `$`.

**The API changes between releases.** When sources disagree, trust them in this order:

1. `.claude-plugin/types/claude-code/index.d.ts`. Claude Code writes this beside a mod loaded with `--plugin-dir` in an interactive session, and it documents every event, method and element for the installed version. Search it for a name such as `'tool.call'`.
2. The output of `claude plugin validate <dir>`.
3. The references in this skill, written against Claude Code v2.1.312 and the docs at https://code.claude.com/docs/en/plugins/mods/overview.

## 1. Confirm a mod is the right tool

A mod is right when the user wants one of these:

- an interface they use (a pane or a band, with buttons and fields)
- a restyle of something Claude Code draws (the spinner, tool rows, messages, the question dialog)
- a `/command` that runs code immediately, with no Claude turn
- rewriting or answering a tool call, prompt or model request
- state shared between hooks

Use something else when:

- an existing script should block, allow or log an event: use a **settings hook**
- the user wants Claude to follow instructions: use a **skill**
- Claude needs to reach an external system: use an **MCP server**

One plugin can ship a mod together with skills and MCP servers.

## 2. Check the environment

- Run `claude --version`. Mods need **v2.1.287 or later**, and the VS Code panel draws mods from extension 2.1.299. The references note any feature that needs a newer version.
- To check that mods can load, run `claude plugin test` from a directory that holds no mod:
  - `no hooks module to load` means mods can load.
  - `hooks modules are turned off` means something blocks them: `disableAllHooks`, an organization policy, or a remote rollout switch.
- In a cloud session, `claude -p` and the Agent SDK, hooks run but **nothing draws**. You can still validate, test, and run a command with `claude -p "/<command>" --plugin-dir <dir>`.

## 3. Settle the design before writing code

- **Events**: which events drive the mod. See [references/events.md](references/events.md).
- **Drawing**: which render site the mod draws in and which apps must show it.
  - Everywhere: `Pane`, `Spinner`, tool rows, messages, `AskUserQuestion`.
  - Terminal and Desktop only: `AbovePrompt` (the band).
  - Terminal only: `Raster`, `Image`.
  - Desktop and VS Code only: `Svg`.
  - See [references/interface.md](references/interface.md).
- **State**: how long each value must last.
  - A module variable lasts until the module reloads.
  - `$.state` lasts for the session and survives reloads.
  - `$.store` persists across sessions.
- **Refusals**: whether a hook refuses anything. If one does, it needs a `.catch` handler so that it fails closed.
- **Names** for commands, tools and panes: letters, digits, `_` and `-`, up to 64 characters. A command can't use the name of a built-in command.

Ask the user only when the behavior they want is ambiguous. Otherwise choose sensible defaults and say what you chose.

## 4. Scaffold from a template

Choose the mod's directory:

- **Inside a marketplace repo** (one with `.claude-plugin/marketplace.json`, like the repo this skill ships in): use `plugins/<name>/`, and add an entry for the mod to `marketplace.json`.
- **Otherwise**: use the directory the user names, or `./<name>/` by default.

Copy the template closest to the mod, then rename it. Every template uses `my-mod` as its plugin name, its command name and its `$.state` key:

```bash
cp -r "${CLAUDE_SKILL_DIR}/templates/<template>" <dest>
grep -rl 'my-mod' <dest> | xargs sed -i 's/my-mod/<name>/g'   # on macOS: sed -i ''
mv <dest>/tests/my-mod.test.ts <dest>/tests/<name>.test.ts
```

| Template | What it shows | Use it for |
| :- | :- | :- |
| `basic` | Registering a command in `session.start`, observing `tool.call`, answering `command.run`, and changing the `Spinner`'s props | Counters, commands, restyling a built-in site |
| `pane` | A command that opens a `Pane` with an `Input` and a delete button on each row, `$.state` declared in `types/index.d.ts` with `$.store` for persistence, reloading after `/clear`, and tests that use `$.ui.mount` on three apps | Lists, forms, dashboards, anything interactive |
| `guard` | A `tool.call` guard that holds a call and asks with `$.ui.ask`, a `deny` reason Claude can act on, and a `.catch` handler that fails closed | Confirming, blocking or rewriting tool calls |
| `band` | An `AbovePrompt` band that keeps the bands other mods draw, uses `$.process.run`, and refreshes on `turn.complete` | Ambient status above the prompt |

Every template passes `claude plugin validate` and `claude plugin test`.

These files make up a mod:

| File | Required | Contents |
| :- | :- | :- |
| `.claude-plugin/plugin.json` | Yes | The manifest: `name` (kebab-case), `version`, `description`, `author`. Validation fails a name that starts with `claude-`, `anthropic-`, `anthropics-` or `cc-plugin-`; a name that is `claude`, `anthropic`, `anthropics`, `claude-code` or `claude-mods`; and a name that puts `official` beside `claude` or `anthropic`. |
| `hooks/hooks.json` | Yes | `{ "modules": ["./register.js"] }`, one path relative to this file. The `modules` key is what makes the plugin a mod. The file can also hold settings hooks under `hooks`. |
| `hooks/register.js` | Yes | The hooks module. It can also be `.ts`, `.tsx`, `.jsx`, `.mjs`, `.cjs`, `.mts` or `.cts`, and needs no build step. |
| `types/index.d.ts` | Only for `$.state`, or for a namespace the mod adds to `$` | Contains only `declare module 'claude-code' { interface PluginState { '<name>': { ... } } }`, with no other top-level `export`. Point the manifest's `"types"` field at it; from v2.1.299 the field is optional for this default path. |
| `tests/*.test.ts` | No | Tests that `claude plugin test` runs |
| `README.md` and `LICENSE` | To share the mod | Expected by the plugin directory's submission checks |

## 5. Write the hooks module

```js
let count = 0                                    // module state: resets on every reload

export function register(on, options) {          // options: the manifest's userConfig values
  on('session.start', async ($, e, next) => {    // exactly one session.start hook
    await $.command.register({ name: 'x', description: '...' })  // a taken name throws: register last
    return next(e)
  })
  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const result = await next(e)                 // the permission check and the tool run here
    if (!result.deny && !result.isError) count += 1
    $.ui.invalidate('ui.render')                 // redraw whatever reads `count`
    return result
  })
  on('command.run', { command: 'x' }, async () => ({ text: 'count: ' + count }))  // answer, no next
}
```

Each hook receives three arguments:

- `$`: the mods API
- `e`: the event, deeply frozen
- `next`: calls the next handler, and carries `next.signal`, `next.origin`, `next.budget`, and `next.called` and `next.error` inside a `.catch` handler

### Rules the validator enforces

The module fails to load if it breaks any of these:

- **Write each mods API call in full**, as in `$.fs.read(path)`. Never alias, destructure or index `$` or a namespace: `const ui = $.ui` fails.
- **Pass `$` only to functions declared at the top level of the same file.** The validator then reports the call as `$.x.y (via fn)`. Passing `$` to a method, to a function defined inside a hook, or to an imported function fails. The exceptions are the `claude-code` helpers `read` and `update`.
- **Write the event name in each `on()` call as a string literal.** A variable, or a loop over a list of names, fails. Don't declare anything else named `on` inside `register`.
- **Use static `import` declarations at the top of the file**, with relative paths that stay inside the plugin. The only bare import allowed is `'claude-code'`, for types and for the `atom`, `read`, `update`, `derive` and `memberOf` helpers. `import()` and `require` don't work, and every file is an ES module.
- **Declare each `$.state` atom correctly**: `const x = atom({ plugin: '<literal>', key: '<literal>' }, defaultValue)`, held in a `const` and declared in `types/index.d.ts`. A `ui.render` hook can read state but can't write it.
- **Write each `$.env` variable name as a string literal.** A hook on a telemetry event needs the matcher `{ to: 'collector' }`.

### Runtime rules

- **The module has no Node APIs, timer globals or `fetch`.**
  - Timers: `$.clock.every` and `$.clock.after`.
  - Network: `$.http.fetch`.
  - Files: `$.fs`.
  - Programs: `$.process.run` and `$.process.spawn`.
  - Standard JavaScript, `URL`, `TextEncoder`, `AbortController` and `crypto.subtle` are available.
- **`e` is frozen.** To change it, pass a copy, as in `next({ ...e, text })`.
- **Register each event once per matcher.** Registering an event twice with no matcher fails the load.
  - Register commands and tools in the single `session.start` hook.
  - `session.start` runs again after every reload, but not after `/clear`, `/resume` or `/branch`.
- **Filter every `ui.render` hook with `{ component: '<Site>' }`.** For a pane, also check `e.requestId === PANE_ID` and return `next(e)` for any other pane.
- **Redraw when data changes.** After changing data that a drawing reads, call `$.ui.invalidate('ui.render')`. A write to `$.state` redraws on its own.
- **A hook that throws, times out or returns the wrong shape is skipped**, so it fails open. Give every hook that refuses something a `.catch(($, e, next) => next.called ? next(e) : refusal)` handler.
- **Time limits:**
  - A hook's own execution: 10 s, or 50 ms for `prompt.edit`. Time spent waiting in `next` or in a `$` call doesn't count, except `$.clock.sleep`.
  - A `.catch` handler: 1 s.
  - A synchronous loop that never yields can crash the shared worker, and Claude Code then unloads the mod.
- **Write `deny` reasons for Claude to act on, and `drop` reasons for the user.**
- **Options that take only `true`** (`focus`, `closeOnEscape`, `holdToasts`, `autoFocus`, `immediate`): leave them out instead of passing `false`, which throws.
- **Keys:**
  - Every `Input` and `Select` needs a `key`.
  - Buttons need a unique `key`, or a unique `label`.
  - No key can appear twice in one drawing.
- **Pane width:** a pane the mod opens without a user action waits until the terminal is at least 144 columns wide (110 once the user has opened it). Open panes from a command or a button press.
- **Missing elements:** before you draw an element that some app lacks, check `e.surface` and draw something else there.
  - Box spacing step names (`'md'`) and the Text props `size`, `weight`, `mono` and `tabular` need v2.1.299 or later.
  - On older versions, a tree that uses them doesn't draw at all.
- **`$.process.run`:**
  - Takes an argument list and uses no shell.
  - Resolves whatever the exit code is.
  - Rejects when the program can't start or runs past the timeout (30 s by default), so wrap it in try/catch.
- **`$.model.complete` doesn't reject when the Claude API fails.** Check `r.isAnswered`.
- **Never `await $.prompt.submit` inside a hook that runs while Claude works.** It resolves only once the new turn starts.

## 6. Validate

```bash
claude plugin validate <dir>          # add --strict to treat warnings as errors
```

Read the output:

- **`hooks:`**: every event you meant to handle, each with its matcher in braces. An event missing from this line won't run, and the usual cause is a misspelled name.
- **`calls:`**: every `$` method the module calls. Use it to tell users what the mod can reach.
- **`gating hook without .catch`**: fine for a hook that only observes. Add `.catch` to a hook that refuses.

Fix every error. The README, LICENSE and icon notes come from the plugin directory's submission checks and don't fail validation.

## 7. Test

Write `tests/<name>.test.ts` to cover each path through each hook, then run `claude plugin test` from the mod's directory. It exits with status 1 when a test fails, and needs no session, sign-in or network. See [references/testing.md](references/testing.md) for the stub table, the mocks for the clock, store and env, and `$.ui.mount`.

Three test-kit rules catch new test authors most often:

- Register every stub before the test's first call on `$`.
- `session.start` doesn't run by itself, so fire it when your hooks depend on it.
- Every `$` call the mod makes needs a stub, except `$.ui.invalidate`, `$.state` and `$.session.append`.

## 8. Try it in a session

- **Load the mod**: the user runs `claude --plugin-dir <dir>`, repeating the flag to load several mods. Claude Code hot-reloads the mod on save and prints a line that lists its hooks.
  - When a save breaks the module, the line says `reload failed, the previous version stays loaded:`.
  - If this session was started with `--plugin-dir` on the mod, your edits reload when the turn ends.
- **Confirm it loaded**: `/plugin` shows `1 mod active · <name>`.
- **Diagnose problems**: Claude doesn't see transcript lines that start with the mod's name, so ask the user to paste them. For the debug log, run `claude --debug-file ./mod.log --plugin-dir <dir>`, then `grep <name> ./mod.log`.
- **Find the types**: the first interactive load writes the type files to `.claude-plugin/types/`, along with a `tsconfig.json` at the mod's root. The generated files carry their own `.gitignore`.
- **Quick experiments**: for a throwaway mod that should hot-reload inside the current session, Claude Code's built-in `/plugin-authoring` skill writes to `~/.claude/dev-mods/<session-id>/`.

## 9. Share it

- **README**: say what the mod does, how to use it, which apps draw it, and the Claude Code version you tested with.
- **License**: add a LICENSE file, or set `license` in `plugin.json`. Ask the user which license to use.
- **Version**: bump `version` on every release, because installed plugins are cached by version. Keep developing against `--plugin-dir`, not against the installed copy.
- **Marketplace**: add an entry to the marketplace. Users then run `/plugin marketplace add <owner>/<repo>` and `/plugin install <name>@<marketplace>`, and `/reload-plugins` loads it into an open session.
- **Trust**: a mod runs with the user's own permissions and isn't sandboxed. Before anyone installs it, the `calls:` line from `claude plugin validate` shows what it reaches.
- **Organization guard**: where the built-in guard loads (machines with managed settings, or a Team or Enterprise `/login`), these hooks in a user-installed mod never run: `classic.*`, `prompt.compose`, `prompt.section`, `prompt.context`, `prompt.attachment`, `skill.prompt`, `attribution.text`, `session.compact` and `settings.read`. Don't build a mod's core feature on them.

## References

Load a reference only when the task needs it:

- [references/events.md](references/events.md): every event and what a hook on it can return, matchers, the order mods run in, `tool.call` and `tool.check` patterns, prompts, turns, settings reads, and handling a hook that fails
- [references/api.md](references/api.md): every `$` namespace, commands and tools, model calls, timers, toasts, status lines, logs and questions, submitting prompts, messages between sessions, files, processes, the network, `userConfig`, and limits
- [references/interface.md](references/interface.md): render sites, panes and the band, restyling built-in sites, elements and their props on each app, keyboard focus, redrawing, state, and VS Code differences
- [references/testing.md](references/testing.md): the `claude-code/testing` kit, stubs, mocks, timers, drawings and policy mods
- [references/troubleshooting.md](references/troubleshooting.md): each symptom or message, its cause and its fix, and the debug log
