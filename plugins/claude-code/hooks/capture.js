// The session is handed to GitLoom's ingestion, which extracts the facts,
// writes the cues and reconciles against what is stored. That is why this sends
// turns rather than a summary it wrote itself.
const { load } = require('./lib/config')
const { remember } = require('./lib/api')
const { readStdin, pass, write, MARK } = require('./lib/io')
const { delta } = require('./lib/transcript')

function localZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

async function main() {
  const input = await readStdin()
  const cwd = input.cwd || process.cwd()
  if (!input.transcript_path || !input.session_id) return pass()

  const cfg = load(cwd)
  if (!cfg) return pass()

  const d = delta(input.transcript_path, input.session_id)
  if (!d) return pass()

  const opts = {
    sessionId: String(input.session_id),
    occurredAt: d.occurredAt,
    timezone: localZone(),
    tags: ['session', cfg.project ? 'project' : 'personal'],
  }
  // The zone only places the session on the user's calendar. One this machine
  // names but the API cannot read must not cost the session itself.
  await remember(cfg, d.messages, opts).catch((err) => {
    if (err.code !== 'invalid_timezone' || !opts.timezone) throw err
    return remember(cfg, d.messages, { ...opts, timezone: undefined })
  })
  d.commit()

  write({
    systemMessage: `${MARK} gitloom · saved ${d.messages.length} turn${d.messages.length === 1 ? '' : 's'} to ${cfg.namespace}`,
    continue: true,
  })
}

main().catch(() => pass())
