# GitLoom for Codex

Long-term memory backed by a real git repository.

```bash
codex plugin marketplace add GitLoomHQ/gitloom-plugins
codex plugin add gitloom@gitloom
```

Export a key — the same variable the GitLoom SDKs and CLI read — in the shell
you launch Codex from:

```bash
export GITLOOM_API_KEY=gl_live_...   # create one at https://app.gitloom.cloud
```

The plugin deliberately sets no `env` in `mcp.json`, so the server reads the
variable from the environment Codex passes it. If tool calls fail on
authentication, confirm the variable is exported in that shell and run the
`setup` skill, which diagnoses the key, the namespace, and the write-to-read
round trip in order.

## What it adds

Three tools, from [`@gitloomhq/mcp`](https://www.npmjs.com/package/@gitloomhq/mcp):
`recall_memory`, `save_memory`, `find_skill`.

Four skills — `setup`, `save-session`, `teach`, `deep-recall` — for the things
those tools do not cover: conversation-level ingestion, the vocabulary and
skills APIs, and retrieval with a date window, a relevance floor or a
model-written answer.

## Checking the install

```bash
codex plugin list      # gitloom@gitloom → installed, enabled
codex mcp list         # a "gitloom" row, status enabled
```

A missing row in `codex mcp list` means Codex rejected the server config rather
than that it failed to start.
