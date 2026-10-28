import { expect, test } from 'claude-code/testing'

// Answer tool calls in Claude Code's place. $.ui.ask reaches the stub as a
// call to the AskUserQuestion tool; every other call "runs" and returns 'ran'.
function stubTools(on, answer: string | null) {
  on('tool.call', ($, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ran' }
    // null stands for a question the user dismissed
    if (answer === null) return { deny: 'dismissed' }
    return { result: { answers: { [e.questions[0].question]: answer } } }
  })
}

test('lets a safe command through without asking', async ($, on) => {
  stubTools(on, 'Refuse')
  expect(await $.tool.call({ tool: 'Bash', command: 'ls -la' })).toEqual({ result: 'ran' })
})

test('runs a risky command the user agrees to', async ($, on) => {
  stubTools(on, 'Run it')
  expect(await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })).toEqual({ result: 'ran' })
})

test('refuses a risky command the user declines', async ($, on) => {
  stubTools(on, 'Refuse')
  const out = await $.tool.call({ tool: 'Bash', command: 'git push -f origin main' })
  expect(out.deny).toMatch(/declined/)
})

test('refuses a risky command when nobody answers', async ($, on) => {
  stubTools(on, null)
  const out = await $.tool.call({ tool: 'Bash', command: 'git reset --hard HEAD~3' })
  expect(out.deny).toMatch(/declined/)
})
