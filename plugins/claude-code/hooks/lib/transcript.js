const fs = require('node:fs')
const path = require('node:path')
const { readJson, writeJson, redact, sessionDir } = require('./io')

const MAX_TURNS = 60
const MAX_CHARS = 60_000

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  // text only: thinking is not the user's words, and tool_use/tool_result are
  // the mechanics of this session rather than anything worth remembering.
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

/**
 * When a turn happened: the instant in epoch seconds when its timestamp has a
 * time, else the date it names. Never now, which would misfile a late capture.
 */
function occurredAt(timestamp) {
  const s = String(timestamp || '')
  const day = /^\d{4}-\d{2}-\d{2}/.exec(s)?.[0]
  const ms = s.length > 10 ? Date.parse(s) : NaN
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : day
}

function parse(transcriptPath) {
  let raw
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.type !== 'user' && e.type !== 'assistant') continue
    if (e.isSidechain) continue // a subagent's transcript, not this conversation
    const role = e.message?.role || e.type
    const text = textOf(e.message?.content)
    if (!text) continue
    out.push({ uuid: e.uuid || '', role, content: text, timestamp: e.timestamp || '' })
  }
  return out
}

/**
 * The turns added since this session was last captured. A session is captured
 * on every Stop, so without a marker each capture would resend the whole
 * conversation and ingestion would reconcile it against itself.
 */
function delta(transcriptPath, sessionId) {
  const dir = sessionDir(sessionId)
  const marker = dir ? path.join(dir, 'captured.json') : null
  const last = marker ? readJson(marker, {}).uuid : null

  const all = parse(transcriptPath)
  if (!all.length) return null

  const from = last ? all.findIndex((t) => t.uuid === last) : -1
  const fresh = all.slice(from + 1)
  if (!fresh.length) return null

  let turns = fresh.slice(-MAX_TURNS)
  let total = 0
  const kept = []
  for (let i = turns.length - 1; i >= 0; i--) {
    total += turns[i].content.length
    if (total > MAX_CHARS) break
    kept.unshift(turns[i])
  }
  if (!kept.length) return null

  return {
    messages: kept.map((t) => ({ role: t.role, content: redact(t.content) })),
    lastUuid: fresh[fresh.length - 1].uuid,
    occurredAt: occurredAt(kept[0].timestamp),
    commit() {
      if (marker) writeJson(marker, { uuid: this.lastUuid, at: new Date().toISOString() })
    },
  }
}

module.exports = { parse, delta, textOf, occurredAt, MAX_TURNS, MAX_CHARS }
