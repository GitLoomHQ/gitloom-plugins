// The hooks sit between the user and the model. Everything here is about the
// two failure modes that matter: injecting something wrong, and blocking a
// session.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

const HOOKS = new URL('../hooks/', import.meta.url).pathname
const work = mkdtempSync(join(tmpdir(), 'gitloom-hooks-'))
process.on('exit', () => rmSync(work, { recursive: true, force: true }))

const { defaultStateRoot, migrateLegacyState, hash } = await import(new URL('../hooks/lib/io.js', import.meta.url))

// A hook run from a test must never see the real home directory, nor a git
// repository above the scratch directory.
function envFor(env) {
  const home = join(work, 'home')
  mkdirSync(home, { recursive: true })
  return {
    ...process.env,
    HOME: home,
    XDG_STATE_HOME: undefined,
    LOCALAPPDATA: undefined,
    GIT_CEILING_DIRECTORIES: dirname(work),
    GITLOOM_NAMESPACE: 'ns',
    GITLOOM_STATE_DIR: join(work, 'state'),
    ...env,
  }
}

function writeJsonFile(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value))
}

const readJsonFile = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** A fake API that records what it was asked for. */
async function withServer(handler, fn) {
  const calls = []
  const srv = createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const call = { method: req.method, path: req.url.split('?')[0], url: req.url, body: body ? JSON.parse(body) : null }
      calls.push(call)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(handler(req, res, call) ?? {}))
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
    const p = spawn('node', [join(HOOKS, hook)], { env: envFor(env), stdio: ['pipe', 'pipe', 'pipe'] })
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

test('recall dates a memory by when it happened, never by when it was written', async () => {
  const written = { created_at: Date.parse('2026-10-01T09:00:00Z') / 1000, updated_at: Date.parse('2026-10-03T09:00:00Z') / 1000 }
  const res = {
    namespace: 'ns',
    memories: [
      { path: 'facts/a.md', title: 'Camera', content: 'Bought a Sony A7III.', occurred_at: Date.UTC(2026, 7, 14, 12) / 1000, occurred_precision: 'day', ...written, matched: ['lexical'] },
      { path: 'facts/b.md', content: 'Ordered a 35mm lens.', occurred_at: Date.parse('2026-08-15T03:30:00Z') / 1000, occurred_precision: 'instant', ...written, matched: ['cue'] },
      { path: 'facts/c.md', content: 'Prefers prime lenses.', ...written, matched: ['body'] },
    ],
  }
  await withServer(() => res, async (baseUrl) => {
    const r = await run('recall.js', { session_id: 'dated', cwd: work, user_prompt: 'what camera did I buy' }, { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl, TZ: 'America/New_York' })
    const ctx = r.json.hookSpecificOutput.additionalContext
    assert.match(ctx, /^- \[2026-08-14\] Camera — Bought a Sony A7III\./m, 'a day is its stored date')
    assert.match(ctx, /^- \[2026-08-15\] Ordered a 35mm lens\./m, 'an instant is its UTC date, whatever the local zone')
    assert.match(ctx, /^- Prefers prime lenses\./m, 'no occurred_at means no date, not a stand-in')
    assert.doesNotMatch(ctx, /2026-10-0[13]/, 'ingestion times are not when anything happened')
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
    await run('capture.js', { session_id: 'cap', cwd: work, transcript_path: transcript }, { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl, TZ: 'Europe/Berlin' })
    const sent = calls.find((c) => c.path === '/v1/memories').body
    const all = JSON.stringify(sent)
    assert.equal(sent.messages.length, 2, 'tool-only and subagent turns must be dropped')
    assert.doesNotMatch(all, /secret/, '<private> must never leave the machine')
    assert.doesNotMatch(all, /internal/, 'thinking is not the conversation')
    assert.doesNotMatch(all, /subagent chatter/)
    assert.equal(sent.occurred_at, Date.parse('2026-09-14T10:00:00Z') / 1000, 'dates the memory when it happened, not now')
    assert.equal(sent.date, undefined, 'date is the deprecated spelling of occurred_at')
    assert.equal(sent.timezone, 'Europe/Berlin')
    assert.ok(sent.tags.length > 0 && sent.tags.length <= 32)
    for (const t of sent.tags) assert.match(t, /^[\p{Ll}\p{Lo}\p{N}\p{M} _.:\/#@-]{1,64}$/u, `${t} breaks the API's tag rules`)
  })
})

test('a turn is dated as an instant when it has a time, else by its date', async () => {
  const { occurredAt } = await import(new URL('../hooks/lib/transcript.js', import.meta.url))
  const t = Date.parse('2026-09-14T10:00:00Z') / 1000
  assert.equal(occurredAt('2026-09-14T10:00:00.123Z'), t)
  assert.equal(occurredAt('2026-09-14T15:30:00+05:30'), t)
  assert.equal(occurredAt('2026-09-14'), '2026-09-14')
  assert.equal(occurredAt('2026-09-14Tnonsense'), '2026-09-14')
  assert.equal(occurredAt(''), undefined)
})

test('a zone the API cannot read does not cost the session', async () => {
  const transcript = join(work, 'tz.jsonl')
  writeFileSync(transcript, [
    { type: 'user', uuid: 'z1', timestamp: '2026-09-14T10:00:00Z', message: { role: 'user', content: 'I moved to Pune.' } },
    { type: 'assistant', uuid: 'z2', timestamp: '2026-09-14T10:00:01Z', message: { role: 'assistant', content: 'Noted.' } },
  ].map((o) => JSON.stringify(o)).join('\n'))
  const refuseZones = (req, res, call) => {
    if (!call.body?.timezone) return { id: 'm' }
    res.statusCode = 400
    return { error: { code: 'invalid_timezone', message: 'timezone: a timezone is an IANA name' } }
  }
  await withServer(refuseZones, async (baseUrl, calls) => {
    const r = await run('capture.js', { session_id: 'tz', cwd: work, transcript_path: transcript }, { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl, TZ: 'Europe/Berlin' })
    const writes = calls.filter((c) => c.path === '/v1/memories')
    assert.equal(writes.length, 2)
    assert.equal(writes[1].body.timezone, undefined)
    assert.equal(writes[1].body.occurred_at, writes[0].body.occurred_at)
    assert.match(r.json.systemMessage, /saved 2 turns/)
  })
})

const ROLLOUT = new URL('./fixtures/codex-rollout.jsonl', import.meta.url).pathname
const rollout = readFileSync(ROLLOUT, 'utf8').trimEnd().split('\n')
const CODEX_TURNS = [
  ['user', 'I always indent with tabs, never spaces. Our releases go out on Thursdays.'],
  ['assistant', 'Noted: tabs over spaces, and releases go out on Thursdays.'],
  ['user', 'The staging database is called birch. Please remember that.'],
  ['assistant', 'Understood, the staging database is called birch.'],
]

test('a Codex rollout yields the conversation and nothing Codex injected', async () => {
  const { parse } = await import(new URL('../hooks/lib/transcript.js', import.meta.url))
  const turns = parse(ROLLOUT)
  assert.deepEqual(turns.map((t) => [t.role, t.content]), CODEX_TURNS)
  const all = JSON.stringify(turns)
  for (const injected of ['AGENTS.md', 'British English', 'environment_context', 'skills_instructions', 'permissions instructions', 'gitloom-recall', 'Neovim']) {
    assert.ok(!all.includes(injected), `${injected} is not the user's words`)
  }
})

test('only a whole tagged block counts as injected, never a user who types a tag', async () => {
  const { parse } = await import(new URL('../hooks/lib/transcript.js', import.meta.url))
  const file = join(work, 'codex-tags.jsonl')
  const msg = (role, ...texts) => ({
    timestamp: '2026-10-04T12:00:00.000Z',
    type: 'response_item',
    payload: { type: 'message', role, content: texts.map((text) => ({ type: role === 'assistant' ? 'output_text' : 'input_text', text })) },
  })
  writeFileSync(file, [
    msg('user', '<user_shell_command>\n<command>ls</command>\n<result>a.txt</result>\n</user_shell_command>'),
    msg('user', '<turn_aborted>\nThe user interrupted.\n</turn_aborted>'),
    msg('user', '<environment_context>\n  <cwd>/x</cwd>\n</environment_context>', 'Why is a <div> wrong inside a <p>?'),
    msg('user', '<b>bold</b> is deprecated, right?'),
    msg('assistant', '<proposed_plan>\nUse a span.\n</proposed_plan>'),
  ].map((o) => JSON.stringify(o)).join('\n'))
  const turns = parse(file)
  assert.deepEqual(turns.map((t) => t.content), ['Why is a <div> wrong inside a <p>?', '<b>bold</b> is deprecated, right?', '<proposed_plan>\nUse a span.\n</proposed_plan>'])
  assert.equal(new Set(turns.map((t) => t.uuid)).size, turns.length, 'lines sharing a timestamp still need distinct markers')
})

test('Codex capture sends each turn exactly once across captures', async () => {
  const transcript = join(work, 'codex.jsonl')
  const firstTurn = rollout.findIndex((l) => JSON.parse(l).payload?.type === 'task_complete') + 1
  const input = { session_id: 'codex', turn_id: 't', transcript_path: transcript, cwd: work, hook_event_name: 'Stop', stop_hook_active: false }
  await withServer(() => ({ id: 'm' }), async (baseUrl, calls) => {
    const env = { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl }
    writeFileSync(transcript, rollout.slice(0, firstTurn).join('\n') + '\n')
    await run('capture.js', input, env)
    writeFileSync(transcript, rollout.join('\n') + '\n') // the resumed turn is appended
    await run('capture.js', input, env)
    await run('capture.js', input, env)
    const sent = calls.filter((c) => c.path === '/v1/memories').map((c) => c.body)
    assert.equal(sent.length, 2, 'a capture with nothing new sends nothing')
    assert.deepEqual(sent.map((b) => b.messages.map((m) => [m.role, m.content])), [CODEX_TURNS.slice(0, 2), CODEX_TURNS.slice(2)])
    assert.equal(sent[0].occurred_at, Math.floor(Date.parse('2026-10-04T11:59:06.506Z') / 1000))
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
      const p = spawn('node', [join(HOOKS, hook)], { env: envFor({ GITLOOM_API_KEY: 'k' }), stdio: ['pipe', 'pipe', 'pipe'] })
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

const MIGRATED = [
  { type: 'user', uuid: 'u1', timestamp: '2026-09-14T10:00:00Z', message: { role: 'user', content: 'I bought a camera.' } },
  { type: 'assistant', uuid: 'a1', timestamp: '2026-09-14T10:00:01Z', message: { role: 'assistant', content: 'Nice.' } },
  { type: 'user', uuid: 'u2', timestamp: '2026-09-15T10:00:00Z', message: { role: 'user', content: 'And a 35mm lens.' } },
  { type: 'assistant', uuid: 'a2', timestamp: '2026-09-15T10:00:01Z', message: { role: 'assistant', content: 'Good call.' } },
]

/** A capture against a home whose old state already saw the first exchange. */
async function captureAfterUpgrade(session, env) {
  const transcript = join(work, `${session}.jsonl`)
  writeFileSync(transcript, MIGRATED.map((o) => JSON.stringify(o)).join('\n'))
  return withServer(() => ({ id: 'm' }), async (baseUrl, calls) => {
    const r = await run('capture.js', { session_id: session, cwd: work, transcript_path: transcript }, { GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl, ...env })
    const sent = calls.find((c) => c.path === '/v1/memories')?.body
    return { ...r, sent: sent?.messages.map((m) => m.content) }
  })
}

function legacyHome(session, extra = {}) {
  const home = mkdtempSync(join(work, 'home-'))
  writeJsonFile(join(home, '.gitloom', 'sessions', session, 'captured.json'), { uuid: 'a1' })
  for (const [name, body] of Object.entries(extra)) writeFileSync(join(home, '.gitloom', name), body)
  return home
}

test('state lives in the platform state directory, never under ~/.gitloom', async () => {
  const cases = [
    [{}, 'linux', '/home/u', '/home/u/.local/state/gitloom/sessions'],
    [{ XDG_STATE_HOME: '/xdg' }, 'linux', '/home/u', '/xdg/gitloom/sessions'],
    [{ XDG_STATE_HOME: 'relative' }, 'linux', '/home/u', '/home/u/.local/state/gitloom/sessions'],
    [{}, 'darwin', '/Users/u', '/Users/u/Library/Application Support/gitloom/sessions'],
    [{ XDG_STATE_HOME: '/xdg' }, 'darwin', '/Users/u', '/xdg/gitloom/sessions'],
    [{ LOCALAPPDATA: 'D:\\Local' }, 'win32', 'C:\\Users\\u', 'D:\\Local\\gitloom\\sessions'],
    [{}, 'win32', 'C:\\Users\\u', 'C:\\Users\\u\\AppData\\Local\\gitloom\\sessions'],
  ]
  for (const [env, platform, home, want] of cases) {
    assert.equal(defaultStateRoot(env, platform, home), want, `${platform} ${JSON.stringify(env)}`)
  }

  const home = mkdtempSync(join(work, 'home-'))
  const r = await captureAfterUpgrade('fresh', { HOME: home, GITLOOM_STATE_DIR: undefined })
  assert.equal(r.sent.length, 4)
  assert.ok(existsSync(join(defaultStateRoot({}, process.platform, home), 'fresh', 'captured.json')))
  assert.equal(existsSync(join(home, '.gitloom')), false, 'a fresh install must not create ~/.gitloom')
})

test('old state moves out of ~/.gitloom, so a session is not captured twice', async () => {
  const home = legacyHome('mig')
  const r = await captureAfterUpgrade('mig', { HOME: home, GITLOOM_STATE_DIR: undefined })
  assert.deepEqual(r.sent, ['And a 35mm lens.', 'Good call.'], 'the capture offset must survive the move')
  assert.equal(readJsonFile(join(defaultStateRoot({}, process.platform, home), 'mig', 'captured.json')).uuid, 'a2')
  assert.equal(existsSync(join(home, '.gitloom')), false, 'an emptied ~/.gitloom goes too')
})

test('a ~/.gitloom holding anything else is left in place', async () => {
  const home = legacyHome('keep', { 'notes.md': 'not the plugin\'s' })
  const memory = { path: 'facts/a.md', content: 'Bought a Sony A7III.' }
  writeJsonFile(join(home, '.gitloom', 'sessions', 'keep', 'recalled.json'), [hash(memory.path + memory.content)])
  await withServer(() => ({ memories: [{ ...memory, matched: ['lexical'] }] }), async (baseUrl) => {
    const r = await run('recall.js', { session_id: 'keep', cwd: work, user_prompt: 'what camera did I buy' }, { HOME: home, GITLOOM_STATE_DIR: undefined, GITLOOM_API_KEY: 'k', GITLOOM_BASE_URL: baseUrl })
    assert.equal(r.json.hookSpecificOutput, undefined, 'what was injected before the move stays injected')
  })
  assert.equal(readFileSync(join(home, '.gitloom', 'notes.md'), 'utf8'), "not the plugin's")
  assert.equal(existsSync(join(home, '.gitloom', 'sessions')), false)
  assert.ok(existsSync(join(defaultStateRoot({}, process.platform, home), 'keep', 'recalled.json')))
})

test('GITLOOM_STATE_DIR leaves ~/.gitloom alone', async () => {
  const home = legacyHome('pinned')
  const dir = join(work, 'pinned-state')
  const r = await captureAfterUpgrade('pinned', { HOME: home, GITLOOM_STATE_DIR: dir })
  assert.equal(r.sent.length, 4, 'an explicit state dir starts from what it holds')
  assert.equal(readJsonFile(join(home, '.gitloom', 'sessions', 'pinned', 'captured.json')).uuid, 'a1')
  assert.equal(readJsonFile(join(dir, 'pinned', 'captured.json')).uuid, 'a2')
  assert.equal(existsSync(defaultStateRoot({}, process.platform, home)), false)
})

test('a move that fails keeps using the old state and still answers', async () => {
  const home = legacyHome('stuck')
  const notADir = join(home, 'file')
  writeFileSync(notADir, '')
  const r = await captureAfterUpgrade('stuck', { HOME: home, GITLOOM_STATE_DIR: undefined, XDG_STATE_HOME: notADir })
  assert.equal(r.code, 0)
  assert.deepEqual(r.sent, ['And a 35mm lens.', 'Good call.'])
  assert.equal(readJsonFile(join(home, '.gitloom', 'sessions', 'stuck', 'captured.json')).uuid, 'a2')
})

test('across devices the old state is copied, then removed', () => {
  const home = legacyHome('xdev')
  const root = join(home, 'state', 'gitloom', 'sessions')
  const from = join(home, '.gitloom', 'sessions')
  const rename = fs.renameSync
  fs.renameSync = (a, b) => {
    if (a === from) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
    return rename(a, b)
  }
  try {
    migrateLegacyState(home, root)
  } finally {
    fs.renameSync = rename
  }
  assert.equal(readJsonFile(join(root, 'xdev', 'captured.json')).uuid, 'a1')
  assert.deepEqual(readdirSync(dirname(root)), ['sessions'], 'no half-copied directory is left behind')
  assert.equal(existsSync(join(home, '.gitloom')), false)
})
