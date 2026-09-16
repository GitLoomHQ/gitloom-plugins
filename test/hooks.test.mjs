// The hooks sit between the user and the model. Everything here is about the
// two failure modes that matter: injecting something wrong, and blocking a
// session.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

const HOOKS = new URL('../hooks/', import.meta.url).pathname
const work = mkdtempSync(join(tmpdir(), 'gitloom-hooks-'))
process.on('exit', () => rmSync(work, { recursive: true, force: true }))

/** A fake API that records what it was asked for. */
async function withServer(handler, fn) {
  const calls = []
  const srv = createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url.split('?')[0], url: req.url, body: body ? JSON.parse(body) : null })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(handler(req) ?? {}))
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}`, calls)
  } finally {
    srv.close()
  }
}

function run(hook, input, env = {}) {
  return new Promise((resolve) => {
    const p = spawn('node', [join(HOOKS, hook)], {
      env: { ...process.env, GITLOOM_NAMESPACE: 'ns', GITLOOM_STATE_DIR: join(work, 'state'), ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('exit', (code) => {
      let json = null
      try {
        json = JSON.parse(out)
      } catch {}
      resolve({ code, out, json })
    })
    p.stdin.end(JSON.stringify(input))
  })
}

const memories = (extra = []) => ({
  namespace: 'ns',
  memories: [
    { path: 'facts/a.md', title: 'Camera', content: 'Bought a Sony A7III.', score: 0.9, matched: ['lexical'] },
    ...extra,
  ],
})

test('recall injects a memory and reports what it cost', async () => {
  await withServer(() => memories(), async (baseUrl) => {
    const r = await run('recall.js', { session_id: 's1', cwd: work, user_prompt: 'what camera did I buy' }, { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl })
    assert.equal(r.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
    assert.match(r.json.hookSpecificOutput.additionalContext, /Sony A7III/)
    assert.match(r.json.systemMessage, /recalled 1 memory/)
  })
})

test('recall reads both harnesses spellings of the prompt', async () => {
  await withServer(() => memories(), async (baseUrl) => {
    for (const [field, session] of [['user_prompt', 'a'], ['prompt', 'b']]) {
      const r = await run('recall.js', { session_id: session, cwd: work, [field]: 'what camera did I buy' }, { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl })
      assert.match(r.json.hookSpecificOutput.additionalContext, /Sony A7III/, `${field} was not read`)
    }
  })
})

test('a graph-only match is context, not evidence, and is never injected', async () => {
  const neighbour = { path: 'facts/b.md', content: 'The kit lens came with it.', score: 0.4, matched: ['graph'], via: ['facts/a.md'] }
  await withServer(() => memories([neighbour]), async (baseUrl) => {
    const r = await run('recall.js', { session_id: 'g', cwd: work, user_prompt: 'what camera did I buy' }, { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl })
    assert.match(r.json.hookSpecificOutput.additionalContext, /Sony A7III/)
    assert.doesNotMatch(r.json.hookSpecificOutput.additionalContext, /kit lens/)
  })
})

test('a memory already injected this session is not injected again', async () => {
  await withServer(() => memories(), async (baseUrl) => {
    const env = { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl }
    const first = await run('recall.js', { session_id: 'dedup', cwd: work, user_prompt: 'what camera did I buy' }, env)
    assert.ok(first.json.hookSpecificOutput)
    const second = await run('recall.js', { session_id: 'dedup', cwd: work, user_prompt: 'what camera did I buy' }, env)
    assert.equal(second.json.hookSpecificOutput, undefined)
    assert.equal(second.json.continue, true)
  })
})

test('recall sends the score floor and drops graph neighbours server-side', async () => {
  await withServer(() => memories(), async (baseUrl, calls) => {
    await run('recall.js', { session_id: 'q', cwd: work, user_prompt: 'what camera did I buy' }, { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl })
    const q = new URL(calls[0].url, 'http://x').searchParams
    assert.equal(q.get('context'), '0')
    assert.ok(Number(q.get('min_score')) > 0)
  })
})

test('short prompts and slash commands never reach the API', async () => {
  await withServer(() => memories(), async (baseUrl, calls) => {
    for (const p of ['ok', '/help me out here', '!ls -la somewhere']) {
      await run('recall.js', { session_id: 's', cwd: work, user_prompt: p }, { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl })
    }
    assert.equal(calls.length, 0)
  })
})

test('capture sends turns, redacted, without thinking or tool mechanics', async () => {
  const transcript = join(work, 't.jsonl')
  writeFileSync(transcript, [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-14T10:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'I bought a camera. <private>secret</private>' }] } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-09-14T10:00:01Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal' }, { type: 'text', text: 'Nice.' }] } },
    { type: 'assistant', uuid: 'a2', timestamp: '2026-09-14T10:00:02Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
    { type: 'user', uuid: 'u2', isSidechain: true, timestamp: '2026-09-14T10:00:03Z', message: { role: 'user', content: [{ type: 'text', text: 'subagent chatter' }] } },
  ].map((o) => JSON.stringify(o)).join('\n'))

  await withServer(() => ({ id: 'm', status: 'accepted' }), async (baseUrl, calls) => {
    await run('capture.js', { session_id: 'cap', cwd: work, transcript_path: transcript }, { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl })
    const sent = calls.find((c) => c.path === '/v1/memories').body
    const all = JSON.stringify(sent)
    assert.equal(sent.messages.length, 2, 'tool-only and subagent turns must be dropped')
    assert.doesNotMatch(all, /secret/, '<private> must never leave the machine')
    assert.doesNotMatch(all, /internal/, 'thinking is not the conversation')
    assert.doesNotMatch(all, /subagent chatter/)
    assert.equal(sent.date, '2026-09-14', 'dates the memory when it happened, not now')
  })
})

test('capture sends nothing when there is nothing new', async () => {
  const transcript = join(work, 't2.jsonl')
  writeFileSync(transcript, JSON.stringify({ type: 'user', uuid: 'x1', timestamp: '2026-09-14T10:00:00Z', message: { role: 'user', content: [{ type: 'text', text: 'hello there friend' }] } }))
  await withServer(() => ({ id: 'm' }), async (baseUrl, calls) => {
    const env = { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl }
    await run('capture.js', { session_id: 'once', cwd: work, transcript_path: transcript }, env)
    await run('capture.js', { session_id: 'once', cwd: work, transcript_path: transcript }, env)
    assert.equal(calls.filter((c) => c.path === '/v1/memories').length, 1)
  })
})

test('read-only tools are allowed and writes are left to ask', async () => {
  const allow = await run('approve.js', { tool_name: 'mcp__plugin_gitloom_gitloom__recall_memory', tool_input: { query: 'x' } })
  assert.equal(allow.json.hookSpecificOutput.permissionDecision, 'allow')

  const skill = await run('approve.js', { tool_name: 'mcp__gitloom__find_skill', tool_input: { task: 'x' } })
  assert.equal(skill.json.hookSpecificOutput.permissionDecision, 'allow')

  const write = await run('approve.js', { tool_name: 'mcp__plugin_gitloom_gitloom__save_memory', tool_input: { fact: 'x' } })
  assert.equal(write.json.hookSpecificOutput, undefined, 'a write must still ask')

  const other = await run('approve.js', { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } })
  assert.equal(other.json.hookSpecificOutput, undefined, 'only gitloom tools are decided here')
})

test('every hook exits clean with no key, bad input, or a dead API', async () => {
  const cases = [
    ['recall.js', { session_id: 's', cwd: work, user_prompt: 'what camera did I buy' }],
    ['capture.js', { session_id: 's', cwd: work, transcript_path: join(work, 'missing.jsonl') }],
    ['session-start.js', { session_id: 's', cwd: work }],
    ['approve.js', { tool_name: 'mcp__gitloom__recall_memory' }],
  ]
  for (const [hook, input] of cases) {
    const noKey = await run(hook, input, { GITLOOM_API_KEY: '' })
    assert.equal(noKey.code, 0, `${hook} must exit 0 without a key`)
    assert.notEqual(noKey.json, null, `${hook} must still answer the harness`)

    const dead = await run(hook, input, { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: 'http://127.0.0.1:9' })
    assert.equal(dead.code, 0, `${hook} must exit 0 when the API is unreachable`)

    const garbage = await new Promise((resolve) => {
      const p = spawn('node', [join(HOOKS, hook)], { env: { ...process.env, GITLOOM_API_KEY: 'k' }, stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      p.stdout.on('data', (d) => (out += d))
      p.on('exit', (code) => resolve({ code, out }))
      p.stdin.end('this is not json')
    })
    assert.equal(garbage.code, 0, `${hook} must survive malformed stdin`)
  }
})

test('a namespace is derived from the git remote, not the checkout path', async () => {
  const { normalizeRemote, slug, sha } = await import(new URL('../hooks/lib/config.js', import.meta.url))
  const forms = [
    'git@github.com:GitLoomHQ/gitloom.git',
    'https://github.com/GitLoomHQ/gitloom.git',
    'https://github.com/GitLoomHQ/gitloom',
    'HTTPS://GitHub.com/GitLoomHQ/gitloom/',
  ]
  const ids = new Set(forms.map((f) => sha(normalizeRemote(f))))
  assert.equal(ids.size, 1, 'every spelling of one remote must agree')
  assert.notEqual(sha(normalizeRemote('git@github.com:other/gitloom.git')), [...ids][0], 'same name, different repo must not collide')
  assert.match(`repo-${slug('gitloom')}-${[...ids][0]}`, /^[a-z0-9-]{1,64}$/, 'must satisfy the namespace charset')
})
