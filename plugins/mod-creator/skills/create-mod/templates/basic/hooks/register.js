// my-mod: counts the tool calls Claude makes, shows the count beside the
// spinner while Claude works, and adds /my-mod-stats to print it.

// Shared by every hook below. A module-level variable resets each time the
// module reloads; keep values that must survive in $.state or $.store.
let calls = 0

// Claude Code calls this once each time the module loads
export function register(on) {
  // The one session.start hook: register commands and tools here
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'my-mod-stats',
      description: 'Show how many tool calls Claude has made',
    })
    return next(e)
  })

  // Observe: count the call, ask for a redraw, and let the tool run as usual
  on('tool.call', async ($, e, next) => {
    calls += 1
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // Answer: this mod owns the command, so the hook never calls next
  on('command.run', { command: 'my-mod-stats' }, async () => {
    return { text: 'Claude has made ' + calls + ' tool calls since this mod loaded' }
  })

  // Rewrite: keep Claude Code's spinner and add the count after its word
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (calls === 0) return next(e)
    return next({ ...e, props: { ...e.props, suffix: ' · tool calls: ' + calls + '…' } })
  })
}
