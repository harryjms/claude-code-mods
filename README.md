# claude-code-mods

[Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview), and the tools for making them. This repository is a Claude Code plugin marketplace named `harryjms-mods`.

## Plugins

| Plugin | What it does |
| :- | :- |
| [`mod-creator`](plugins/mod-creator) | A `create-mod` skill that has Claude build, test, debug and share mods, with four tested starter templates |
| [`agent-map`](plugins/agent-map) | A mod that adds `/agent-map`, a pane that draws the session's agents as a node map: who started whom, who messaged whom, and what each is doing |

## Install

```bash
claude plugin marketplace add harryjms/claude-code-mods
```

```bash
claude plugin install mod-creator@harryjms-mods
```

## Working in this repository

The `create-mod` skill is also linked into `.claude/skills/`, so it's available in any Claude Code session started here without installing anything. Ask for a mod, such as `make a mod that shows the current git branch above the prompt`, or run `/create-mod <description>`.

When the skill works in this repository, it puts each new mod in `plugins/<name>/` and adds an entry for it to `.claude-plugin/marketplace.json`. To check a mod and try it:

```bash
claude plugin validate plugins/<name>
```

```bash
(cd plugins/<name> && claude plugin test)
```

```bash
claude --plugin-dir plugins/<name>
```

To check the starter templates after a Claude Code update:

```bash
for t in plugins/mod-creator/skills/create-mod/templates/*/; do claude plugin validate "$t" && (cd "$t" && claude plugin test); done
```
