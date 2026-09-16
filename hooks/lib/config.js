const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const path = require('node:path')

const DEFAULT_BASE_URL = 'https://api.gitloom.cloud'

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return ''
  }
}

// Two clones of one repository must agree on a namespace without coordinating,
// and two unrelated repositories that happen to share a name must not collide.
// The normalized remote is the only identity that satisfies both.
function normalizeRemote(url) {
  const raw = url.trim()
  if (!raw) return ''
  let s
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      s = `${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ''}/${u.pathname.replace(/^\/+/, '')}`
    } catch {
      s = raw
    }
  } else {
    const scp = raw.match(/^(?:[^@/]+@)?([^:]+):(.+)$/)
    s = scp ? `${scp[1].toLowerCase()}/${scp[2]}` : `file:${path.resolve(raw)}`
  }
  return s.replace(/[?#].*$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
}

function sha(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12)
}

// A GitLoom namespace is [a-z0-9-], at most 64 characters, and the API rejects
// anything else outright.
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'repo'
}

/** The repository this session is in, or null outside one. */
function project(cwd) {
  const root = git(cwd, ['rev-parse', '--show-toplevel'])
  if (!root) return null
  const remote = normalizeRemote(git(cwd, ['remote', 'get-url', 'origin']))
  const name = remote ? remote.slice(Math.max(remote.lastIndexOf('/'), remote.lastIndexOf(':')) + 1) : path.basename(root)
  return { root, name, identity: sha(remote || `path:${root}`), hasRemote: Boolean(remote) }
}

function author(cwd) {
  const name = git(cwd, ['config', 'user.name'])
  const email = git(cwd, ['config', 'user.email'])
  return name || email ? { name: name || email, email: email || '' } : null
}

/**
 * Everything a hook needs, or null when GitLoom is not configured — which is
 * not an error. A hook with no key does nothing and says nothing.
 */
function load(cwd) {
  const apiKey = process.env.GITLOOM_API_KEY
  if (!apiKey) return null

  const proj = project(cwd)
  const namespace =
    process.env.GITLOOM_NAMESPACE || (proj ? `repo-${slug(proj.name)}-${proj.identity}` : 'default')

  return {
    apiKey,
    namespace,
    baseUrl: (process.env.GITLOOM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    project: proj,
    author: author(cwd),
    scoped: !process.env.GITLOOM_NAMESPACE && Boolean(proj),
  }
}

module.exports = { load, project, author, normalizeRemote, slug, sha, DEFAULT_BASE_URL }
