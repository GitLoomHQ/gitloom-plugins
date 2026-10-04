const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const MARK = '◆'

/**
 * The platform's state directory. Never ~/.gitloom: the GitLoom CLI looks for
 * a .gitloom marker walking up from the cwd, so one in the home directory made
 * every command under $HOME write into it.
 */
function defaultStateRoot(env = process.env, platform = process.platform, home = os.homedir()) {
  const p = platform === 'win32' ? path.win32 : path.posix
  const abs = (v) => (v && p.isAbsolute(v) ? v : '')
  if (abs(env.XDG_STATE_HOME)) return p.join(env.XDG_STATE_HOME, 'gitloom', 'sessions')
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'gitloom', 'sessions')
  if (platform === 'win32') return p.join(abs(env.LOCALAPPDATA) || p.join(home, 'AppData', 'Local'), 'gitloom', 'sessions')
  return p.join(home, '.local', 'state', 'gitloom', 'sessions')
}

function moveDir(from, to) {
  try {
    fs.renameSync(from, to)
    return
  } catch (err) {
    if (err.code !== 'EXDEV') throw err
  }
  const tmp = `${to}.${process.pid}.tmp`
  try {
    fs.cpSync(from, tmp, { recursive: true })
    fs.renameSync(tmp, to)
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true })
    throw err
  }
  fs.rmSync(from, { recursive: true, force: true })
}

/**
 * State used to live in ~/.gitloom/sessions. It holds each session's capture
 * offset, so leaving it behind would resend sessions already captured.
 */
function migrateLegacyState(home, root) {
  const legacy = path.join(home, '.gitloom')
  const from = path.join(legacy, 'sessions')
  if (!fs.existsSync(from) || fs.existsSync(root)) return
  fs.mkdirSync(path.dirname(root), { recursive: true })
  moveDir(from, root)
  try {
    fs.rmdirSync(legacy) // only if empty: it may hold something that is not ours
  } catch {}
}

let root
function stateRoot() {
  if (root) return root
  // Overridable so a test run, or a sandbox with no writable home, does not
  // inherit another run's dedup state.
  if (process.env.GITLOOM_STATE_DIR) return (root = process.env.GITLOOM_STATE_DIR)
  const home = os.homedir()
  root = defaultStateRoot(process.env, process.platform, home)
  try {
    migrateLegacyState(home, root)
  } catch {
    // Until a move succeeds, the old directory still holds every offset.
    const legacy = path.join(home, '.gitloom', 'sessions')
    if (fs.existsSync(legacy)) root = legacy
  }
  return root
}

function readStdin() {
  return new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (d) => {
      raw += d
    })
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve({})
      }
    })
    process.stdin.on('error', () => resolve({}))
  })
}

function write(out) {
  process.stdout.write(JSON.stringify(out))
}

/** Say nothing, change nothing, never block the session. */
function pass() {
  write({ continue: true, suppressOutput: true })
}

/**
 * Claude Code sends the prompt as `user_prompt`; Codex sends `prompt`. Reading
 * only one silently disables recall on the other harness.
 */
function promptOf(input) {
  return String(input.user_prompt ?? input.prompt ?? '').trim()
}

function sessionDir(sessionId) {
  if (!sessionId) return null
  try {
    const dir = path.join(stateRoot(), String(sessionId).replace(/[^\w.-]/g, '_'))
    fs.mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    return null
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  try {
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value))
    fs.renameSync(tmp, file)
  } catch {
    // State is an optimisation; losing it costs a duplicate injection, not
    // correctness.
  }
}

function hash(s) {
  return crypto.createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16)
}

/**
 * Anything the user wrapped in <private> never leaves the machine. Applied to
 * everything sent, not just what a hook decides to send.
 */
function redact(text) {
  return String(text).replace(/<private>[\s\S]*?<\/private>/gi, '[redacted]')
}

module.exports = {
  readStdin,
  write,
  pass,
  promptOf,
  sessionDir,
  defaultStateRoot,
  migrateLegacyState,
  readJson,
  writeJson,
  hash,
  redact,
  MARK,
}
