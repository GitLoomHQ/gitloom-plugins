# GitLoom for Codex

Long-term memory backed by a real git repository.

```bash
codex plugin marketplace add GitLoomHQ/gitloom-plugins
codex plugin add gitloom@gitloom
```

Codex asks you to trust a plugin's hooks before it runs them. Review and trust
them with `/hooks` inside Codex; until you do, the memory tools work but nothing
runs automatically.

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

## What runs automatically

The tools above are there when the model reaches for them. These four hooks mean
it usually does not have to.

| hook | when | what it does |
|---|---|---|
| recall | you send a message | retrieves what bears on it and puts it in context |
| capture | the turn ends | hands the new turns to ingestion |
| approve | a memory tool is called | lets read-only ones run without a prompt |
| session-start | a session opens | names the namespace in use |

Recall is the one that changes how this feels. It searches with your message
itself rather than waiting for the model to spend a tool call, so memory
participates in every substantive message. It skips anything under twelve
characters or starting `/`, `!`, `#`; drops a memory matched only through the
relation graph, because that is context rather than evidence; and never injects
a memory twice in one session. Four-second cap, and a failure means no memory
this time rather than an error you have to deal with.

Capture sends the turns, not a summary — GitLoom's ingestion does its own
extraction and reconciliation, so the conversation is the shape it wants. It
sends only what is new since the last turn it captured.

Anything you wrap in `<private>…</private>` is removed before anything is sent.

To turn any of them off, remove its entry from `hooks/hooks.json` in the
installed plugin, or disable the plugin.

## Checking the install

```bash
codex plugin list      # gitloom@gitloom → installed, enabled
codex mcp list         # a "gitloom" row, status enabled
```

A missing row in `codex mcp list` means Codex rejected the server config rather
than that it failed to start.
