const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Overridable so a test run, or a sandbox with no writable home, does not
// inherit another run's dedup state.
const STATE_ROOT = process.env.GITLOOM_STATE_DIR || path.join(os.homedir(), '.gitloom', 'sessions')
const MARK = '◆'

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
  const dir = path.join(STATE_ROOT, String(sessionId).replace(/[^\w.-]/g, '_'))
  try {
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

module.exports = { readStdin, write, pass, promptOf, sessionDir, readJson, writeJson, hash, redact, MARK }
