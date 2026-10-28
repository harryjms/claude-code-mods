// my-mod: holds a risky Bash command and asks the user whether to run it.
// The pattern matches the text of the command, so treat it as a reminder for
// Claude rather than a security boundary.

// rm with a recursive flag, git reset --hard, and git push with --force or -f
const RISKY = /\brm\s+-\w*[rR]\w*\b|\bgit\s+reset\s+--hard\b|\bgit\s+push\b.*\s(--force|-f)\b/

// Claude reads a deny reason as the tool's result, so write it as an instruction
const DECLINED = 'The user declined this command. Ask them before trying a different approach.'

// A top-level function, so it can take $ and still pass validation
async function guard($, e, next) {
  // Every other command goes on to the permission check and then to Bash
  if (!RISKY.test(e.command)) return next(e)
  // Start from the safe answer, so a question nobody answers refuses the command
  let answer = 'Refuse'
  try {
    // The call waits here, and that wait doesn't count against the time limit
    answer = await $.ui.ask('Claude wants to run `' + e.command + '`. Run it?', ['Run it', 'Refuse'])
  } catch {
    // Dismissed, "Chat about this", or a claude -p run with nobody to ask
  }
  // A typed answer under "Other" is free text, so compare with the label exactly
  if (answer !== 'Run it') return { deny: DECLINED }
  return next(e)
}

export function register(on) {
  // Without .catch, a hook that throws or times out is skipped and the command
  // runs. The handler makes the guard fail closed instead.
  on('tool.call', { tool: 'Bash' }, guard).catch(async ($, e, next) => {
    // The guard had already let the call through, so return what it produced
    if (next.called) return next(e)
    return { deny: 'The command guard failed (' + next.error.kind + '), so this command was not run.' }
  })
}
