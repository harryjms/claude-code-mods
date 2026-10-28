// my-mod: shows the current git branch and how many files changed in the
// band above the prompt, refreshed when the session starts and after each turn.
// The terminal and the Desktop app draw the band; the VS Code extension doesn't.

// What the band shows. Empty outside a git repository, which hides the line.
let line = ''

// Run git and rebuild the line, then ask Claude Code to draw the band again
async function refresh($) {
  try {
    // An argument list and no shell; a non-zero exit code resolves, not rejects
    const branch = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 5000 })
    if (branch.exitCode !== 0) {
      line = ''
    } else {
      const status = await $.process.run(['git', 'status', '--porcelain'], { timeoutMs: 5000 })
      const changed = status.stdout.split('\n').filter(Boolean).length
      line = (branch.stdout.trim() || 'detached HEAD') + ' · ' + (changed ? changed + ' changed' : 'clean')
    }
  } catch {
    // git isn't installed, or it ran past the timeout
    line = ''
  }
  $.ui.invalidate('ui.render')
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  // Claude may have switched branches or edited files during the turn
  on('turn.complete', async ($, e, next) => {
    // A subagent's turn sets e.agentId; only the main conversation's matters
    if (e.agentId === undefined) await refresh($)
    return next(e)
  })

  // Every mod shares the one band: keep what the mods after this one draw
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!line) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const theirs = await next(e)
    return Box({
      flexDirection: 'column',
      children: [Text({ dimColor: true, wrap: 'truncate-end', children: ['git: ' + line] }), theirs],
    })
  })
}
