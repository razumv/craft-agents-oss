import { query } from '@anthropic-ai/claude-agent-sdk'

console.log('CLAUDE_CODE_OAUTH_TOKEN set:', !!process.env.CLAUDE_CODE_OAUTH_TOKEN)
console.log('Token prefix:', process.env.CLAUDE_CODE_OAUTH_TOKEN?.slice(0, 20))

const iter = query({ prompt: 'Hello, say hi', options: { cwd: '/home/moltbot/projects/trading' } })
let count = 0
for await (const msg of iter) {
  const m = msg as any
  console.log('MSG:', m.type, m.subtype ?? '')
  count++
  if (count > 5 || m.type === 'result') break
}
console.log('Done, got', count, 'messages')
