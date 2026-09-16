# GitLoom plugins

[GitLoom](https://gitloom.cloud) as a plugin, for the agent harnesses that have
one. Memory is markdown in a real git repository, so every memory carries its
history and what changed it.

| harness | plugin | install |
|---|---|---|
| Claude Code | [`plugins/claude-code`](plugins/claude-code) | `/plugin marketplace add GitLoomHQ/gitloom-plugins` then `/plugin install gitloom@gitloom` |
| Codex / ChatGPT | [`plugins/codex`](plugins/codex) | `codex plugin marketplace add GitLoomHQ/gitloom-plugins` then `codex plugin add gitloom@gitloom` |

Both wrap the same hosted MCP server, [`@gitloomhq/mcp`](https://www.npmjs.com/package/@gitloomhq/mcp),
and carry the same four skills.

## What you get

Three tools, from the MCP server:

- **`recall_memory`** — what is already known about this user
- **`save_memory`** — one durable fact
- **`find_skill`** — a procedure they taught you earlier

And four skills, each for something the tools deliberately do not cover:

- **`setup`** — verify the key, the namespace, and that a write reaches a read
- **`save-session`** — hand a whole conversation to extraction, which finds
  several memories at once and reconciles them against what is stored, rather
  than calling `save_memory` four times
- **`teach`** — the vocabulary and skills APIs: teach the namespace that `k8s`
  and `kubernetes` are one word, and store a procedure so it is followed rather
  than reinvented
- **`deep-recall`** — retrieval with a date window, a relevance floor, or a
  model-written answer, for when a plain recall was not enough

## Configuration

One environment variable, the same one the SDKs and the `gitloom` CLI read:

```bash
export GITLOOM_API_KEY=gl_live_...   # create one at https://app.gitloom.cloud
export GITLOOM_NAMESPACE=...         # optional; defaults to "default"
export GITLOOM_BASE_URL=...          # optional; overrides the API host
```

Export it in the shell that launches the agent. With no key, Claude Code loads
the four skills and starts no tools — run `/gitloom:setup`, which diagnoses
exactly that.

## Local memory instead

These plugins talk to a hosted namespace. For a memory that never leaves your
machine, the [CLI](https://docs.gitloom.cloud/documentation/content/cli) serves
MCP against a git repository you own, with no account and no network on the
read path:

```bash
gitloom init ~/memory
gitloom install claude-code --write
```

`gitloom install <host> --cloud` writes the hosted server's config directly,
without a plugin. The plugins are the better path when you want the skills too,
or would rather not install a CLI.

## Developing

`skills/` is the source. Both harnesses read the same `skills/<name>/SKILL.md`
layout but cannot share a directory, because every path in a plugin manifest
must stay under its own plugin root — so each plugin gets a copy:

```bash
scripts/sync-skills.sh            # copy skills/ into both plugins
scripts/sync-skills.sh --check    # what CI runs
claude plugin validate ./plugins/claude-code --strict
claude --plugin-dir ./plugins/claude-code
```

For Codex, add this repository as a local marketplace and install from it:

```bash
codex plugin marketplace add .
codex plugin add gitloom@gitloom
codex mcp list                    # the plugin's server should appear, enabled
```

### Two things the harnesses do not share

- **Claude Code substitutes `${VAR}` in `.mcp.json`, but an *unset* variable
  passes through as the literal `${VAR}`** rather than as empty. A server that
  checks whether its key is present then starts with a key of `"${VAR}"` and
  fails every call with a 401 that reads like a bad key. Always write
  `${VAR:-}`.
- **Codex drops an MCP server whose `command` is not a bare executable.**
  `${PLUGIN_ROOT}/server.sh` is silently omitted from the plugin — no error, the
  server simply never appears in `codex mcp list`. Interpolation that works in
  `command` for Claude Code does not work there.

## Licence

MIT.
