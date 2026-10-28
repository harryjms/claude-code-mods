# mod-creator

A Claude Code plugin with one skill, `create-mod`, that helps Claude build, test, debug and share Claude Code [mods](https://code.claude.com/docs/en/plugins/mods/overview). A mod is a plugin whose JavaScript or TypeScript hooks module runs inside Claude Code. It can draw panes and a band above the prompt, restyle the spinner or tool rows, add `/commands` and tools, and observe, rewrite or block tool calls, prompts and model requests.

## What the skill gives Claude

- **A workflow**: decide whether a mod is the right tool, check the environment, design, scaffold, write, `claude plugin validate`, `claude plugin test`, try it with `--plugin-dir`, and share it.
- **The validator's rules and the runtime pitfalls**, so that the first draft loads.
- **References** condensed from the official docs: events, the mods API, drawing, testing and troubleshooting.
- **Four starter mods** that pass `claude plugin validate` and `claude plugin test`:

| Template | What it is |
| :- | :- |
| `basic` | Counts tool calls, adds the count to the spinner, and adds a `/my-mod-stats` command |
| `pane` | A command that opens a notes pane with an input and delete buttons, using `$.state` and `$.store` |
| `guard` | Holds risky Bash commands, asks the user, and fails closed |
| `band` | Shows the git branch and the count of changed files above the prompt |

## Install

```bash
claude plugin marketplace add harryjms/claude-code-mods
```

```bash
claude plugin install mod-creator@harryjms-mods
```

Inside a session, use `/plugin marketplace add harryjms/claude-code-mods`, then `/plugin install mod-creator@harryjms-mods`. If a session is already open, run `/reload-plugins` there.

## Use

Ask for a mod in your own words, such as `make a mod that shows my context usage in a pane`, or run the skill directly:

```text
/mod-creator:create-mod a /todo command that opens a pane listing TODO comments in this repo
```

Claude scaffolds the mod in a directory of its own, writes and tests it, and gives you the command to load it:

```bash
claude --plugin-dir ./your-mod
```

## Requirements

- Claude Code v2.1.287 or later, which is when mods became available. The skill and templates were checked against v2.1.312.
- Mods draw in the terminal, the Desktop app's Code tab, and the VS Code extension 2.1.299 or later. In `claude -p`, the Agent SDK and cloud sessions, hooks run but nothing draws.

Mods run with your permissions and aren't sandboxed. Before you load a mod, run `claude plugin validate` on it and read its `calls:` line to see what it can reach.
