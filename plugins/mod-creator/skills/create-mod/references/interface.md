# Drawing in the interface

This reference is condensed from https://code.claude.com/docs/en/plugins/mods/interface, https://code.claude.com/docs/en/plugins/mods/gallery and https://code.claude.com/docs/en/plugins/mods/reference#render-sites. For the exact props of each element on your version, see `.claude-plugin/types/claude-code/index.d.ts`.

## Contents

- [How drawing works](#how-drawing-works)
- [Render sites](#render-sites)
- [Panes](#panes)
- [The band above the prompt](#the-band-above-the-prompt-aboveprompt)
- [Changing what Claude Code draws](#changing-what-claude-code-already-draws)
- [Elements](#elements)
- [Keyboard, focus and hotkeys](#keyboard-focus-and-hotkeys)
- [Redrawing](#redrawing)
- [State](#state)
- [The VS Code extension](#the-vs-code-extension)
- [Drawing limits](#drawing-limits)

## How drawing works

Each time Claude Code is about to draw a render site, it fires `ui.render`. The hook returns one of these:

- **An element tree** to draw there
- **`next(e)`** to leave the site as it is
- **`next({ ...e, props: { ...e.props, x } })`** to keep Claude Code's drawing with a changed prop

To build the tree, get the elements from `$.ui.resolve(e)`. Each element is a function that takes props, with nested content in `children`. A `.tsx` or `.jsx` module can write the tree as JSX, compiled against the global `h`, once the elements are destructured from `$.ui.resolve(e)`.

```js
on('ui.render', { component: 'Pane' }, async ($, e, next) => {
  if (e.requestId !== PANE) return next(e)          // leave other mods' panes alone
  const { Box, Text, Button } = $.ui.resolve(e)
  return Box({ flexDirection: 'row', columnGap: 2, children: [
    Button({ key: 'more', label: 'Add one', hotkey: 'a', onPress: () => { count += 1; $.ui.invalidate('ui.render') } }),
    Text({ children: ['Count: ' + count] }),
  ] })
})
```

Callbacks run in your module. A callback changes state and asks for a redraw, and then the hook builds a new tree from the new state.

The hook's `e` carries these fields:

- **`e.component`**: the render site
- **`e.surface`**: the app drawing it: `terminal`, `desktop` or `vscode`
- **`e.props`**: the site's own data
- **`e.requestId`**: the pane's id, a tool call's id, or a message's id, depending on the site
- **`e.viewport`**: `{ columns, rows, isFullscreen }`. In the terminal and the Desktop app, it's absent until the app has measured its window.

## Render sites

| Site (`e.component`) | `e.props` | `e.requestId` | Drawn on |
| :- | :- | :- | :- |
| `Pane` | `title`, `isFocused`, `bodyColumns`, `placement` (`'dock'` or `'inline'`), `scroll` (`{ offset, bodyRows }`), `view` | The pane's `id` | Terminal, Desktop, VS Code |
| `AbovePrompt` (the band) | `hasSurvey`, `isWorking`, `maxRows`, `bodyColumns`, `scroll`, `view` | One instance | Terminal, Desktop |
| `UserMessage` | `text`, `origin`, `isExpanded`, and `task` or `from` | The message id | Terminal, Desktop, VS Code |
| `AssistantMessage` | The reply's text | The message id | Terminal, Desktop, VS Code |
| `ToolUse`, `ToolResult`, `ToolGroup` | The tool's name, input and result | The tool call id | Terminal, Desktop, VS Code |
| `CommandOutput` | `command`, `text` | The message id | Terminal, Desktop |
| `AskUserQuestion` | The question and its options | The tool call id | Terminal, Desktop, VS Code |
| `ToolProgress` | `kind` | The tool call id | Terminal |
| `Spinner` | `word`, `message`, `suffix`, `mode` | The agent id | Terminal, Desktop, VS Code |
| `TurnDuration` | `word`, `durationMs` | The message id | Terminal |
| `InfoNotice` | `text`, `command` | The message id | Terminal |
| `SessionMode` | `modes` | One instance | Terminal, Desktop |
| `PromptHint` | `isDraft`, `isWorking`, `hint` | One instance | Terminal, Desktop |

The permission prompt isn't a render site, so no mod can change it.

To fit a tree to its site:

- **Width**: draw to `e.props.bodyColumns`.
- **Height of a docked pane** (`placement === 'dock'`): `e.props.scroll.bodyRows` is the number of rows.
- **Height of an inline pane** (`placement === 'inline'`): the pane grows with the tree up to `bodyRows`.
- A tree taller than its site scrolls as a whole.

## Panes

A pane is a sidebar beside the transcript in a wide terminal with fullscreen rendering. Otherwise it's a framed region above the prompt. With several panes open, each one gets a tab.

```js
await $.ui.open({ id: 'my-pane', title: 'My pane', focus: true, closeOnEscape: true })
await $.ui.close({ id: 'my-pane' })
const isOpen = (await $.ui.panes()).some(p => p.id === 'my-pane')
```

`$.ui.open` takes these fields:

| Field | Meaning |
| :- | :- |
| `id` | Required. Letters, digits, `_` and `-`, up to 64 characters. Opening an id that's already open retitles that pane. |
| `title` | The tab label |
| `focus: true` | Requests keyboard focus. Claude Code grants it only while the prompt is empty and nothing else has focus. |
| `closeOnEscape: true` | Esc closes the pane |
| `holdToasts: true` | Holds toasts while a dialog-like pane shows |
| `rows` | The height to ask for when the pane sits above the prompt. The default is a third of the space. |
| `columns` | The width to ask for when the pane is docked, up to 45% of the terminal. A width the user chose by resizing takes precedence. |

- **Boolean fields accept only `true`.** Leave a field out instead of passing `false`, which throws. To set one conditionally, build the object: `$.ui.open(cond ? { ...pane, focus: true } : pane)`.
- **Opening a pane draws nothing by itself.** Claude Code then fires `ui.render` with `component: 'Pane'` and `requestId: id`.
- **A pane the mod opens without a user action**, for example from a timer or `turn.start`, appears only when the terminal is at least 144 columns wide, or 110 once the user has opened that pane. Otherwise it waits. The call resolves to `{ isPlaced: false, reason }` when the pane is waiting, and `{ isPlaced: true }` once it's placed. To tell the user something is ready without opening a pane, use `$.ui.toast`.
- **A command that opens a pane mid-turn** needs `immediate: true` in its registration.
- **`ui.close` fires** whenever a pane closes. `e.origin.kind` is `plugin`, `person` or `unload`.

## The band above the prompt (`AbovePrompt`)

The band is one strip, shared by every mod. A tree you return there replaces whatever the mods after yours draw. To keep their bands, put `await next(e)` among the children of your `Box`:

```js
on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
  if (!line) return next(e)                           // nothing to show: draw nothing of your own
  const { Box, Text } = $.ui.resolve(e)
  const theirs = await next(e)
  return Box({ flexDirection: 'column', children: [Text({ dimColor: true, children: [line] }), theirs] })
})
```

- **Keep the `Box` that wraps `theirs` plain.** Neither it nor any `Box` around it can take `width`, `height`, `minWidth`, `minHeight`, `position`, `top`, `left`, `right`, `bottom`, `display` or `overflow`.
- **The user can collapse the band**, with Ctrl+X Ctrl+A or the `[-]` mark. Collapsed, it shows one dim row, and no hotkey presses its buttons. A mod can't tell that the band is collapsed, so don't make the band the only place the user has to answer something.
- **A digit `hotkey` on a band button** also fires when the user types that digit into an empty prompt and pauses.
- **The VS Code extension doesn't draw the band.**

## Changing what Claude Code already draws

To change a site Claude Code draws, such as `Spinner`, `ToolUse` or `AssistantMessage`, the hook has three choices:

- **Change a detail**: `next({ ...e, props: { ...e.props, suffix: ' · 3 calls…' } })`
- **Replace it**: return your own tree without calling `next`.
- **Wrap it**: `const theirs = await next(e)`, then return `Box({ children: [theirs, Text(...)] })`. `theirs` is a reference to Claude Code's drawing, `{ type: 'engine', ref }`, unless a later mod drew its own tree.

At `AskUserQuestion`, your tree must hold the reference exactly once, with your elements above it; otherwise Claude Code draws its own dialog. The VS Code extension keeps its own question card and draws your elements above it.

## Elements

| Element | Main props | Terminal | Desktop | VS Code |
| :- | :- | :-: | :-: | :-: |
| `Box` | `key`, flex layout (`flexDirection`, `alignItems`, `justifyContent`, `flexGrow`, ...), `gap`, `columnGap`, `rowGap`, `padding*`, `margin*`, `width`, `height`, `minWidth`, `minHeight`, `borderStyle`, `borderColor`, `borderDimColor`, `backgroundColor`, `position` and `top`/`left`/`right`/`bottom`, `overflow`, `display`, `hover` | ✓ | ✓ | ✓ |
| `Text` | `color` (a theme key or a color such as `'red'`), `backgroundColor`, `weight`, `bold` (deprecated), `italic`, `underline`, `strikethrough`, `dimColor`, `inverse`, `wrap` (`'wrap'`, `'truncate'`, `'truncate-start'`, `'truncate-middle'` or `'truncate-end'`), `size`, `mono`, `tabular`, `hover` | ✓ | ✓ | ✓ |
| `Button` | `key`, `label`, `children`, `onPress`, `hotkey`, `plain`, `dimColor`, `autoFocus`, `action`, `variant` (`'primary'` or `'secondary'`), `role` (`'dismiss'`), `hover` | ✓ | ✓ | ✓ |
| `Link` | `href`, `label` | ✓ | ✓ | ✓ |
| `Code` | `source`, `language`, `path`, `startLine`, `format` (`'diff'` for unified diff hunks), `wrap` | ✓ | ✓ | ✓ |
| `Markdown` | `text` (not `children`), `key`, `dimColor`, `onLinkPress` (needs a `key`), `pressableLinks` | ✓ | ✓ | ✓ |
| `Input` | `key` (required), `label`, `placeholder`, `value`, `submitLabel`, `rows` (2 or more for several lines; v2.1.301+), `onSubmit(value)`, `onInput(value)`, `autoFocus` | ✓ | ✓ | ✓ |
| `Select` | `key` (required), `label`, `options` (`[{ value, label }]`, with unique values), `value`, `onSelect(value)`, `autoFocus` | ✓ | ✓ | ✓ |
| `Svg` | `source` (SVG markup, up to 131,072 characters), `alt`, `width`, `height`, `isInteractive` | | ✓ | ✓ |
| `Client` | `module` (a second file of yours), `key`, `props`, `width`, `height`, `flexGrow` | ✓ | ✓ | |
| `Raster` | `key`, `columns` (up to 512), `rows` (up to 256), `cells` (base64) | ✓ | | |
| `Image` | `key`, `source` (`png` or `rgba` bytes up to 2 MiB, or `file`), `columns` and `rows` (up to 255), `alt` | ✓ | | |

A tree with a prop an element doesn't take, or a child where none goes, fails the hook with a message like `my-mod: ui.render hook skipped: returned the wrong shape (a tree Pane refuses: Text prop "bogusProp" is not allowed)`.

These rules apply to individual elements:

- **Keys**:
  - Every `Input` and `Select` needs a non-empty string `key`.
  - A `Button` can do without a `key` when it has a `label` or a single string child, which then serves as its key.
  - No key can appear twice in one drawing. Duplicates produce the errors `is drawn twice; each takes its own key` and `key each once`.
- **Button `children`**: strings and `Text` only, and they need v2.1.295 or later. A button whose children aren't a single string needs a `key` or a `label`. Only the terminal draws the children; the other apps draw the `label`.
- **Button `hotkey`**: one digit or one lowercase letter. The terminal shows it only with `plain: true`, as in `1: One`, so name the key in a bracketed button's label. When two buttons share a hotkey, the later one gets it.
- **Button `action`**: names a Claude Code keybinding action. The user's binding for that action presses the button, when the binding is a chord or a modified key.
- **`autoFocus`**: accepts only `true`.
- **Box `borderStyle`**: `'single'`, `'double'`, `'round'`, `'bold'`, `'singleDouble'`, `'doubleSingle'`, `'classic'`, `'arrow'`, `'dashed'` or `'quote'`. Any other value, such as `'rounded'`, draws no border.
- **Box spacing steps** `'xs'`, `'sm'`, `'md'`, `'lg'` and `'xl'` need v2.1.299 or later, and so do the Text props `size`, `weight`, `mono` and `tabular`. **On older versions, a tree that uses them doesn't draw at all.** To support older versions, use cell counts and `bold`.
- **`Link`**: in the Desktop app and VS Code, a link is clickable only when its `href` meets all of these; otherwise it draws as plain text:
  - It uses `https:`, or `http://localhost`.
  - It has no raw `@`. Write `%40` instead.
  - It's already in the form `new URL(href).href` returns.
- **`Raster`**: each cell is three numbers: a code point, a color, and a background color, each a 24-bit RGB value. `0x01000000` means the terminal's default color. To pack the cells:

  ```js
  const DEFAULT = 0x01000000
  function cellsOf(rows) {   // rows: [[[char, 0xRRGGBB], ...], ...]
    const n = rows.flat().flatMap(([ch, color]) => [ch.codePointAt(0), color, DEFAULT])
    return new Uint8Array(Uint32Array.from(n).buffer).toBase64()
  }
  ```

  Each character must be one cell wide. To animate without a redraw, call `$.ui.blit({ requestId, key, columns, rows, cells })`.
- **`Image`**: draws as a picture in kitty 0.28+, Ghostty, and iTerm2 3.5+ (iTerm2 needs v2.1.305 or later). Every other terminal, GNU screen, and background sessions show the `alt` text, so write `alt` that stands on its own. Pass bytes rather than a `file` path for iTerm2 and tmux.
- **`Client`**: runs a second file of yours that draws a region. That file gets no mods API; it posts data, which arrives in your hooks as `ui.message`. A failure arrives as `ui.fault`.
- **Elements an app lacks**: check `e.surface` and return a tree that app can draw. A pane that returns only an `Svg` opens empty in the terminal.

## Keyboard, focus and hotkeys

The mod never reads the keyboard. Claude Code routes keys to controls only while your pane or band has focus. The exceptions are band digit hotkeys and `action` bindings.

A pane gets focus in these cases:

- The mod opens it with `focus: true` from a command or a button press.
- The user presses Ctrl+X then Tab.
- The user clicks it, which in the terminal needs fullscreen rendering.

| Key | Effect while the pane or band has focus |
| :- | :- |
| Tab | Moves to the next control |
| Up and Down | Move between controls; scroll a pane that overflows; move between the rows of a multi-row `Input` |
| Enter | Presses the focused button, submits the focused `Input`, or picks in a `Select` |
| A hotkey | Presses its button. While an `Input` has focus, printable keys go to the `Input`. |
| PgUp, PgDn, Home, End | Scroll |
| Ctrl+X then an arrow | Resizes the pane |
| Ctrl+X then X | Closes the pane |
| Esc | Returns focus to the prompt, and closes the pane when it was opened with `closeOnEscape` |

A mod can't bind Tab or the arrow keys, so a game steers with `w`, `a`, `s` and `d`.

## Redrawing

A drawing is a snapshot of what the hook returned. Claude Code runs the hook again in these cases:

- **Props or width**: the site's props change, or the terminal's width changes.
- **A failed `Client`**: after your `ui.fault` hooks return.
- **`$.ui.invalidate('ui.render')`**: call it after changing module data that a drawing reads.
- **A `$.state` write**: this redraws the sites that read the value, with no call needed.
- **A timer**: for a clock or a poller, run `$.clock.every(1000, () => $.ui.invalidate('ui.render'))` from `session.start`.

Redraws are throttled to 10 per second, or 30 in the terminal for the visible pane, the expanded band, and the hint line. Calls that come faster are combined into one, so an animation can't run faster than that.

## State

| Keep it in | It lasts until | Use it for |
| :- | :- | :- |
| A module variable | The module reloads, which happens on every save during development | Values you can afford to lose, such as the open tab |
| `$.state` | The session ends, or the user runs `/clear`, `/resume` or `/branch` | Values a drawing depends on that should survive a reload; writes redraw for you |
| `$.store` | The mod deletes it, or no session uses the store for `cleanupPeriodDays` | Settings and history, anything the user expects to find next time |

To set up `$.state`, follow `templates/pane`:

1. **Declare the values** in `types/index.d.ts`. The file holds only this block, with no other top-level `export`:

   ```ts
   declare module 'claude-code' {
     interface PluginState {
       'my-mod': { notes: string[]; tab: 'one' | 'two' }
     }
   }
   ```

2. **Point the manifest at the file**: `"types": "./types/index.d.ts"`. From v2.1.299 this is optional for the default path.
3. **Define and use each value** in the module:

   ```js
   import { atom, read, update } from 'claude-code'
   const notes = atom({ plugin: 'my-mod', key: 'notes' }, [])   // in a const, with literal plugin and key
   const list = await read($, notes)                             // in ui.render: this subscribes the site
   onPress: () => update($, notes, (v) => [...v, 'x'])           // write from a callback or another event's hook
   ```

4. **Respect the write rule**: a `ui.render` hook can read state but can't write it.
5. **Reload after a reset.** `/clear`, `/resume` and `/branch` reset `$.state`, and `session.start` doesn't fire again. Copy values from `$.store` back in a `classic.SessionStart` hook with the matcher `{ source: ['clear', 'resume', 'fork'] }`. Where the built-in guard loads, that hook doesn't run for a user-installed mod.
6. **With several sessions**: every session shares one `$.store`. Give each item its own key, and `get` again right before you `set`.

## The VS Code extension

The extension draws mods from extension version 2.1.299, or 2.1.304 for sessions that don't fetch feature flags, such as Bedrock. `e.surface` is `vscode`. It differs from the terminal in these ways:

- **Panes**: in a panel at least 800 px wide, panes dock with `placement: 'dock'`. In a narrower panel they draw inline and show 12 rows before scrolling. The extension ignores `rows` and `columns`.
- **No band**: the extension doesn't draw `AbovePrompt`. Status lines and toasts stack above the prompt box, and the stack is hidden while a dialog shows.
- **No hotkeys**: the user clicks a button, or presses Enter once it has focus.
- **Ignored props**:
  - `Box`: `position`, `alignSelf`, `borderDimColor` and `hover`
  - `Text`: `size`, `mono`, `tabular` and `hover`
  - `Button`: `hotkey`, `plain`, `autoFocus`, `action`, `variant`, `role` and `hover`
  - `Code`: everything but `source`, so code shows as plain text
  - `Input` and `Select`: `autoFocus`, and `rows` on an `Input`
  - `Svg`: `isInteractive`
- **Focus**: granted only when the panel has focus, Claude is idle, and the prompt is empty.
- **Prompt suggestions**: `$.prompt.suggest` resolves with `isShown: false`.
- **Labels**: the extension frames what a mod draws, with a label such as "From the my-mod plugin".

## Drawing limits

| Limit | Value |
| :- | :- |
| Text drawn from one tree | The first 100,000 characters |
| Nesting depth of one tree | 32 levels below the root, counting all the mods that draw in the band together |
| Elements and text children in one tree | 20,000 |
| `Raster` cells in one tree | 262,144 |
| `Image` bytes in one tree | 2 MiB |
| A `Code` `language` or `path`, a `Select` option value, or a `Client` `module` | 10,000 characters |
| A `Link` `href` | 2,048 characters |
| Redraws | 10 per second, or 30 for the visible terminal sites |
| A toast | 4 s by default; at most three draw at once in fullscreen rendering |
