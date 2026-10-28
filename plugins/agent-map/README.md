# agent-map

A Claude Code [mod](https://code.claude.com/docs/en/plugins/mods/overview) that adds `/agent-map`. The command opens a pane that draws the current session's agents as a node map: who started whom, who sent messages to whom, and what each agent is doing now.

```text
                         ╔════════════════╗     ╭────────────────╮
                      ┌──╢ ● Explore      ╟─────┤ ✓ reader       │
                  ╭╌╌╌┼╌╌║ ↻ Grep         ║     │ 6 calls · hai… │
                  ╎   │  ╚════════════════╝     ╰────────────────╯
                  ▼   │
  ╭────────────────╮  │  ╭────────────────╮
  │ ◆ main         ├──┼──┤ ● Plan         │
  │ 38 calls       │  │  │ 3 calls · opu… │
  ╰────────────────╯  │  ╰────────────────╯
                      │          ⇅
                      │  ╭────────────────╮
                      └──┤ ◌ scout        │
                         │ teammate       │
                         ╰────────────────╯
```

Here Explore has sent main messages, and Plan and scout have messaged each other.

## What the map shows

- **Boxes**: each box is an agent, and the main conversation is the root. The status icons are:
  - ● running
  - ◌ idle or waiting
  - … pending
  - ✓ completed
  - ✗ failed
  - ⊘ killed
  - ◇ another session or an address outside this map
- **Inside each box**: the agent's name, or its type when it has no name. Below that, the tool it's running now; or, once it's idle, its tool call count and model.
- **Solid lines** join each agent to the agent that started it. This covers subagents, teammates, forks and workflow agents.
- **Dashed arrows** show who sent messages to whom with `SendMessage`. They're routed around the boxes, with arrowheads at the recipient's end.
- **Details**: the selected agent, drawn with a double border, gets details under the map: its type, whether it runs in the background or is a fork or teammate, its run time, its task description, its parent, its model, its tool call count, the tool it's running now, and the messages it sent and received.
- **Recent messages**: the last four are listed under the map, with a preview of each.

## Use

| Key | Action |
| :- | :- |
| `n`, `p` | Select the next or previous agent |
| `h` | Hide finished agents, apart from those with unfinished agents under them, or show them again |
| `l` | Switch the layout: `auto`, top-down, or left-to-right |
| Esc | Close the pane |

- **Layout**: `auto` draws the map top-down when the pane is above the prompt, and left-to-right when it's docked beside the transcript in a wide terminal. If the map is still too wide, it narrows the boxes.
- **Mid-turn**: `/agent-map` runs immediately, even while Claude is working.
- **Updates**: while the pane is open, the mod checks the agent list every two seconds, and every agent event redraws the map.

## Where it draws

| App | Drawn as |
| :- | :- |
| Terminal | A colored character map, drawn as a `Raster` |
| Desktop app (Code tab) | An SVG diagram, from the same layout |
| VS Code extension 2.1.299 or later | An SVG diagram |
| `claude -p`, the Agent SDK, cloud sessions | Nothing. Hooks run, but these don't draw. |

A map larger than 512 × 256 cells is drawn as an indented outline instead.

## Limits

- **Message history starts when the mod loads.** The agents and their parents come from `$.agent.list()`, so they're right even for agents started earlier. Messages sent before the mod loaded aren't shown.
- **A reload resets the counts.** After `/reload-plugins`, or a save while developing, the agents are rebuilt but the tool call counts and messages start from zero.
- **Teammates in their own terminal panes** report only a coarse status, either running or idle.
- **Claude Code's own forks**, such as compaction, never appear.
- **The mod can't stop or message an agent.** It only reads.

The mod calls nothing outside Claude Code: no files, processes or network. Run `claude plugin validate` and read the `calls:` line to confirm.

## Install

```bash
claude plugin marketplace add harryjms/claude-code-mods
```

```bash
claude plugin install agent-map@harryjms-mods
```

To develop it, load the directory directly:

```bash
claude --plugin-dir plugins/agent-map
```

The tests need no session:

```bash
cd plugins/agent-map && claude plugin test
```

Tested with Claude Code v2.1.312. Mods need v2.1.287 or later.
