// Makes the namespace exist and says which one is in use. A memory scoped to
// the wrong namespace looks exactly like a memory that holds nothing, so the
// one thing worth spending a line on is naming it.
const { load } = require('./lib/config')
const { ensureNamespace } = require('./lib/api')
const { readStdin, write, pass, MARK } = require('./lib/io')

async function main() {
  const input = await readStdin()
  const cfg = load(input.cwd || process.cwd())
  if (!cfg) return pass()

  await ensureNamespace(cfg).catch(() => {})

  write({
    systemMessage: `${MARK} gitloom · memory ${cfg.namespace}${cfg.scoped ? ' (this repository)' : ''}`,
    continue: true,
    suppressOutput: true,
  })
}

main().catch(() => pass())
