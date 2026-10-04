// Hooks sit between the user and the model, so a slow or dead network must
// never hold a session hostage. Every call is bounded and every failure means
// "no memory this time" rather than an error the user has to deal with.
const TIMEOUT_MS = 4000

async function request(cfg, method, path, body, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`gitloom ${res.status}: ${text.slice(0, 200)}`)
    err.status = res.status
    try {
      err.code = JSON.parse(text).error?.code
    } catch {}
    throw err
  }
  return text ? JSON.parse(text) : {}
}

function retrieve(cfg, query, params = {}, timeoutMs) {
  const q = new URLSearchParams({ q: query, namespace: cfg.namespace, ...params })
  return request(cfg, 'GET', `/v1/retrieve?${q}`, null, timeoutMs)
}

function remember(cfg, messages, { sessionId, occurredAt, timezone, tags } = {}) {
  const body = { namespace: cfg.namespace, messages }
  if (sessionId) body.session_id = sessionId
  if (occurredAt) body.occurred_at = occurredAt
  if (timezone) body.timezone = timezone
  if (tags) body.tags = tags
  // Older deployments ignore an unknown field rather than rejecting it, so
  // sending author unconditionally is safe against an un-upgraded API.
  if (cfg.author) body.author = cfg.author
  return request(cfg, 'POST', '/v1/memories', body)
}

function ensureNamespace(cfg) {
  return request(cfg, 'POST', '/v1/namespaces', { namespace: cfg.namespace })
}

module.exports = { request, retrieve, remember, ensureNamespace, TIMEOUT_MS }
