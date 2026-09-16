// The session is handed to GitLoom's ingestion, which extracts the facts,
// writes the cues and reconciles against what is stored. That is why this sends
// turns rather than a summary it wrote itself.
const { load } = require('./lib/config')
const { remember } = require('./lib/api')
const { readStdin, pass, write, MARK } = require('./lib/io')
const { delta } = require('./lib/transcript')

async function main() {
  const input = await readStdin()
  const cwd = input.cwd || process.cwd()
  if (!input.transcript_path || !input.session_id) return pass()

  const cfg = load(cwd)
  if (!cfg) return pass()

  const d = delta(input.transcript_path, input.session_id)
  if (!d) return pass()

  await remember(cfg, d.messages, {
    sessionId: String(input.session_id),
    date: d.date,
    tags: ['session', cfg.project ? 'project' : 'personal'],
  })
  d.commit()

  write({
    systemMessage: `${MARK} gitloom · saved ${d.messages.length} turn${d.messages.length === 1 ? '' : 's'} to ${cfg.namespace}`,
    continue: true,
  })
}

main().catch(() => pass())
