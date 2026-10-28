# Troubleshooting a mod

This reference is condensed from https://code.claude.com/docs/en/plugins/mods/troubleshoot. A broken mod usually looks like one that does nothing, because Claude Code skips a module or hook that fails and carries on.

## First steps

1. Run `claude plugin validate <dir>`. It catches a misspelled event, a bad manifest, and a module Claude Code can't read, without starting a session. Check that every event you meant to handle is on the `hooks:` line.
2. Find the line that names the mod. Where it appears depends on the session:
   - **An interactive session started with `--plugin-dir`**: a dim line in the transcript. Claude doesn't see it, so ask the user to paste it.
   - **Any other interactive session**, such as one running an installed mod: the debug log only. Start the session with `claude --debug` or `claude --debug-file ./mod.log`.
   - **A `claude -p` run with `--plugin-dir`**: stderr.
3. Read the debug log:

   ```bash
   claude --debug-file ./mod.log --plugin-dir ./my-mod
   tail -f ./mod.log | grep my-mod
   ```

   A mod that loaded has a line like `hooks module my-mod@inline loaded (worker, environment 2, tier user); events: ...`. To write lines of your own to the log, use `$.ui.log('msg', { to: 'debug' })`.
4. Run `claude plugin test` from a directory with no mod to check whether mods can load at all:

| Output includes | Meaning |
| :- | :- |
| `no hooks module to load` | Mods can load |
| `hooks modules are turned off here` | `disableAllHooks` or an organization policy blocks them |
| `...the rollout switch served off` | Anthropic has turned installed mods off remotely |
| `...the rollout switch was saved off by an earlier session` | The value is stale. Start `claude` once to refresh it, then try again. |

## The mod doesn't load

| Symptom or message | Cause and fix |
| :- | :- |
| Nothing appears, and `/plugin` doesn't list `N mod active · <name>` | Search the debug log for `hooks module <name> not loaded:` and read the reason, using the table below. Also check `claude --version` (2.1.287 or later is needed), the workspace trust prompt, `--safe-mode`, and `--bare`. |
| `validate` passes but shows no `hooks:` line | `hooks/hooks.json` has no `modules` key, or it's misspelled |
| `"tool.calls" is not an event` | The event name is misspelled |
| `$.ui is used as a value` | `$` or a namespace was aliased or destructured. Write each call in full. |
| `the event name passed to on() is not a string literal` | The event name came from a variable or a loop. Use one literal `on()` per event. |
| `"on" is declared again (shadowed)` | Rename the inner variable |
| `a dynamic import()...` | Use a static `import` declaration at the top of the file |
| `on("session.start") is registered twice without a matcher` | Merge the hooks into one |
| `<plugin>.<key> is not declared` or `takes a source the scan can read` | A `$.state` atom isn't declared in `types/index.d.ts`, isn't in a `const`, or has a `plugin` or `key` that isn't a literal |
| `types: ... a contract exports types and nothing else` | `types/index.d.ts` has a stray `export`, such as `export {}`. Keep only the `declare module 'claude-code' { ... }` block. |
| `hooks module did not load: <reason>` | The module's top-level code threw, or there's a syntax error. The reason names the file and line. If the reason ends with `the version loaded before is unloaded`, fix it and run `/reload-plugins`. |
| `reload failed, the previous version stays loaded:` | The last save broke the module, and the earlier version is still running. Fix the error. |
| `options do not fit plugin.json userConfig` | A `pluginConfigs` value doesn't fit its `userConfig` field |
| `code nested too deep to scan`, `ran out of stack` | The code is nested too deeply, or the import chain is too long. Flatten it. |
| `another plugin of that name loads first` | Another enabled plugin has the same name. Rename the mod. |
| `disableAllHooks in managed settings`, `only managed plugins and built-in plugins run` | Policy. The user's administrator decides this. |
| `mods are limited to your organization's by policy (allowManagedModsOnly)` | Only the organization's own mods may run |
| Edits don't take effect | The user is running the installed, cached copy. Develop with `--plugin-dir`, and bump `version` before reinstalling. |

## A hook doesn't run or is skipped

| Symptom or message | Cause and fix |
| :- | :- |
| `<mod>: <event> hook skipped: threw ...`, `timed out`, or `returned the wrong shape` | Fix what the reason names. A hook gets 10 s of its own execution time, or 50 ms for `prompt.edit`. The result must match the shape in events.md. |
| `registered /x but no command.run hook answered it` | No `command.run` hook matches `{ command: 'x' }`, the hook returned `next(e)`, or the hook was skipped. Look for a `hook skipped` line. |
| `"/x" refused: it is the built-in /x` | Pick another command name. The throw also skipped the rest of the `session.start` hook. |
| `<mod> was unloaded: it crashed the hooks worker` | A hook blocked the thread, for example with a loop that never awaits |
| `mods that run in the hooks worker are off for this session: it crashed 3 times` | Run `/reload-plugins` |
| `its session.start ran again in a fresh copy` | Informational. Claude Code didn't repeat `$.prompt.submit`, `$.command.run` or `$.agent.spawn`. |
| `$.agent.register refused: the hooks module that made the call is no longer loaded` | The call came from an old copy of the module after a reload. Register in `session.start`. |
| A `classic.*`, `prompt.section` or `settings.read` hook never runs | The built-in guard skips those events for user-installed mods on managed machines. `/plugin` shows a note. See events.md. |
| `settings.read bypassed by cc-plugin-sec-default` | Same cause as the row above |
| A tool call is denied with `a hook changed this call's input after the model wrote it` | In auto mode, a `tool.call` or `turn.step` hook rewrote the input. Don't rewrite it, or have the user approve the call themselves. |
| `tried to lift a deny rule in your settings` | A `tool.check` `allow` can't override a `deny` rule where the guard loads |
| The toast `Stopped: type a message to continue` | After the user interrupts, the mod's calls are refused until their next input. See api.md for how to retry. |

## Drawing problems

| Symptom or message | Cause and fix |
| :- | :- |
| A pane or the band is empty, or shows Claude Code's usual content | The tree didn't validate. Look for `ui.render hook skipped: returned the wrong shape (a tree Pane refuses: ...)` and fix the prop or child it names. If the line is cut short, search the debug log for `a hook returned a tree that does not validate`. |
| `ui.render (<Site>) refused: ...` or `the chain settled on a tree that does not validate` | The tree is over a size limit: more than 32 levels deep, more than 20,000 elements, or too many `Raster` cells or `Image` bytes. Draw a smaller tree. |
| `ui.render (<Site>) threw while drawn: ...; the engine drew its own` | A value in the tree or in the props passed to `next` broke the drawing. Fix it. |
| `<Input> needs a key`, `is drawn twice; each takes its own key`, `key each once` | Give every `Input`, `Select` and `Button` a unique, non-empty string `key` |
| `$.ui.open` runs but no pane appears | The pane was opened without a user action in a narrow terminal. Open it from a command or a button, or check `isPlaced`. |
| `ui.open: focus is true or left out` | A boolean option was passed as `false`. Leave it out instead. |
| Another mod's band shows and yours doesn't | A mod earlier in the chain returned a tree without `await next(e)` in it. In the debug log, search for `answered ui.render without next()`. |
| The band shows `plugin panel hidden` | The user collapsed it. Ctrl+X Ctrl+A expands it again. |
| Hotkeys do nothing | The pane or band has no focus (Ctrl+X Tab gives it focus, or open with `focus: true`), the band is collapsed, or this is VS Code, which has no hotkeys |
| It works in the terminal but not in Desktop or VS Code | The site or element isn't drawn in that app. Check the tables in interface.md and branch on `e.surface`. VS Code needs extension 2.1.299 or later. |
| A tree with `'md'` spacing or `weight` doesn't draw | Those need v2.1.299 or later |
| A toast doesn't appear | The debug log has `$.ui.toast (<mod>): <text>`, or a line saying why the toast was dropped (such as a bad `timeoutMs`). Also check for a pane opened with `holdToasts`, a newer toast that replaced it (`gave way`), or more than three toasts at once (`left the stack, never drawn`). |
| A line reads `Client <file>: the module failed without a message` | Give the thrown `Error` a message |

## Values lost

| Symptom | Cause and fix |
| :- | :- |
| A value resets on every save | Module variables reset when the module reloads. Use `$.state` or `$.store`. |
| A value resets after `/clear`, `/resume` or `/branch` | `$.state` resets, and `session.start` doesn't fire again. Reload the value in `classic.SessionStart` with the matcher `{ source: ['clear', 'resume', 'fork'] }`. |
| Two sessions overwrite each other's data | Give each item its own `$.store` key, and `get` again right before you `set` |
| A permission rule or `env` returned from `settings.read` has no effect | Those keys aren't applied from a hook. Use a settings file, or `$.env.set`. |
