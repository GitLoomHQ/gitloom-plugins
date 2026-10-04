// Recall runs here rather than waiting for the model to spend a tool call on
// it, so memory participates in every substantive prompt instead of only the
// ones where the model happens to think of it.
const path = require('node:path')
const { load } = require('./lib/config')
const { retrieve } = require('./lib/api')
const { readStdin, write, pass, promptOf, sessionDir, readJson, writeJson, hash, MARK } = require('./lib/io')

const MIN_PROMPT = 12
const MAX_QUERY = 500
const LIMIT = 5
const MIN_SCORE = 0.35
const MAX_CHARS = 400
const TIMEOUT_MS = 4000
const MAX_SEEN = 500

function skip(prompt) {
  return prompt.length < MIN_PROMPT || ['/', '!', '#'].includes(prompt[0])
}

// When the memory's subject happened. created_at and updated_at are when
// ingestion wrote it, and shown to the model they read as when it happened.
function happened(m) {
  const d = new Date(Number(m.occurred_at) * 1000)
  return m.occurred_at && !Number.isNaN(d.getTime()) ? `[${d.toISOString().slice(0, 10)}] ` : ''
}

function render(memories) {
  const lines = memories.map((m) => {
    const body = String(m.content || m.snippet || '').replace(/\s+/g, ' ').slice(0, MAX_CHARS)
    const title = m.title && !body.startsWith(m.title) ? `${m.title} — ` : ''
    return `- ${happened(m)}${title}${body} (${m.path})`
  })
  return `<gitloom-recall>
What GitLoom already knows that bears on this message. Treat it as background
from earlier sessions, not as something the user just said. If one of these
shapes your answer, say where it came from. A [date] is when it happened.

${lines.join('\n')}
</gitloom-recall>`
}

async function main() {
  const input = await readStdin()
  const cwd = input.cwd || process.cwd()
  const prompt = promptOf(input)
  if (skip(prompt)) return pass()

  const cfg = load(cwd)
  if (!cfg) return pass()

  const res = await retrieve(
    cfg,
    prompt.slice(0, MAX_QUERY),
    { limit: String(LIMIT), min_score: String(MIN_SCORE), context: '0' },
    TIMEOUT_MS,
  )

  // A memory matched only by `graph` rode in beside a real match; it is context,
  // not evidence, and presenting it as recall invites the model to state it as
  // fact. context=0 asks the server to drop them; this is the belt to that
  // braces, and also drops anything with no body to show.
  const hits = (res.memories || []).filter(
    (m) => (m.content || m.snippet) && !(Array.isArray(m.matched) && m.matched.length === 1 && m.matched[0] === 'graph'),
  )
  if (!hits.length) return pass()

  const dir = sessionDir(input.session_id)
  const seenFile = dir ? path.join(dir, 'recalled.json') : null
  const seen = seenFile ? readJson(seenFile, []) : []
  const seenSet = new Set(seen)

  // A memory injected once is still in the conversation. Re-injecting it buys
  // nothing and costs context every turn.
  const fresh = hits.filter((m) => !seenSet.has(hash(m.path + (m.content || m.snippet))))
  if (!fresh.length) return pass()

  if (seenFile) {
    writeJson(seenFile, [...seen, ...fresh.map((m) => hash(m.path + (m.content || m.snippet)))].slice(-MAX_SEEN))
  }

  const context = render(fresh)
  const tokens = Math.round(context.length / 4)
  const repeated = hits.length - fresh.length
  write({
    systemMessage:
      `${MARK} gitloom · recalled ${fresh.length} ${fresh.length === 1 ? 'memory' : 'memories'} (~${tokens} tok)` +
      (repeated ? ` · ${repeated} already in context` : ''),
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  })
}

main().catch(() => pass())
