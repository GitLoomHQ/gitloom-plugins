# GitLoom for Claude Code

Long-term memory backed by a real git repository.

```
/plugin marketplace add GitLoomHQ/gitloom-plugins
/plugin install gitloom@gitloom
```

Then export a key — the same variable the GitLoom SDKs and CLI read — in the
shell you launch Claude Code from:

```bash
export GITLOOM_API_KEY=gl_live_...   # create one at https://app.gitloom.cloud
```

`GITLOOM_NAMESPACE` picks a namespace other than `default`, and
`GITLOOM_BASE_URL` overrides the API host. Neither is usually needed.

## What it adds

Three tools, from [`@gitloomhq/mcp`](https://www.npmjs.com/package/@gitloomhq/mcp):
`recall_memory`, `save_memory`, `find_skill`.

Four skills for the things those tools do not cover:

| skill | for |
|---|---|
| `/gitloom:setup` | verify the key, the namespace, and that a write reaches a read |
| `/gitloom:save-session` | hand a whole conversation to extraction instead of saving facts one at a time |
| `/gitloom:teach` | the vocabulary and skills APIs |
| `/gitloom:deep-recall` | a date window, a relevance floor, or a model-written answer |

Skills are also model-invoked: Claude reaches for them when a task matches,
without you naming them.

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

## If no tools appear

With `GITLOOM_API_KEY` unset the server refuses to start, so you get the four
skills and no tools. That is deliberate — a server that started without a key
would fail every call with a 401 that reads like a bad key. Run
`/gitloom:setup`, which checks for exactly this, and `/plugin` → **Errors** for
the server's own message.
