---
name: setup
description: Use when the user asks to set up, configure, connect, or check GitLoom, or when a GitLoom tool call has just failed with an authentication, namespace, or connection error. Verifies the key, picks a namespace, and proves a write and a read both work.
disable-model-invocation: false
---

# Connect GitLoom and prove it works

GitLoom fails quietly when it is misconfigured: a missing key makes every tool
call error, and a namespace that does not exist returns an empty recall that
looks exactly like a namespace holding nothing. Run these four checks in order
and stop at the first one that fails — each later step assumes the earlier ones
passed.

All of this uses one environment variable, `GITLOOM_API_KEY`, which is the same
one the SDKs and the `gitloom` CLI read. `GITLOOM_BASE_URL` overrides the host
and `GITLOOM_NAMESPACE` the default namespace; neither is usually needed.

## 1. Is a key present?

```bash
test -n "$GITLOOM_API_KEY" && echo "key present: ${GITLOOM_API_KEY%%_*}_..." || echo "GITLOOM_API_KEY is not set"
```

If it is not set, tell the user to create a key at https://app.gitloom.cloud and
export it in the shell that launches this agent. Do not print the key itself.
Keys are shown once at creation and only their hash is stored, so a lost key has
to be revoked and replaced rather than recovered.

## 2. Does the key work?

```bash
curl -fsS "${GITLOOM_BASE_URL:-https://api.gitloom.cloud}/v1/whoami" \
  -H "Authorization: Bearer $GITLOOM_API_KEY"
```

A `403` means the key is wrong or revoked; the memory tools report the same as
an `(unauthorized)` failure. An unset or blank key stops the MCP server from
starting at all. A `200` reports the account and whether the key is `live` or
`test`.

## 3. Does the namespace exist?

One namespace is one memory. Creating it is idempotent, so this is safe to run
against a namespace that already exists.

```bash
NS="${GITLOOM_NAMESPACE:-default}"
curl -fsS -X POST "${GITLOOM_BASE_URL:-https://api.gitloom.cloud}/v1/namespaces" \
  -H "Authorization: Bearer $GITLOOM_API_KEY" -H "content-type: application/json" \
  -d "{\"namespace\":\"$NS\"}"
```

If the user is storing memory per end-user rather than for themselves, say so
now: the namespace is the isolation boundary, and one namespace per user of
*their* product is the usual shape. Set `GITLOOM_NAMESPACE` to pick a different
default.

## 4. Does a write reach a read?

Writes are asynchronous. `POST /v1/memories` answers `202` before the memory
exists, and there is no endpoint to poll, so a recall immediately afterwards
returning nothing is expected rather than a failure. Save a fact, wait, then
look for it:

```bash
curl -fsS -X POST "${GITLOOM_BASE_URL:-https://api.gitloom.cloud}/v1/memories" \
  -H "Authorization: Bearer $GITLOOM_API_KEY" -H "content-type: application/json" \
  -d "{\"namespace\":\"${GITLOOM_NAMESPACE:-default}\",\"session_id\":\"gitloom-plugin-setup\",
    \"occurred_at\":\"$(date +%F)\",\"tags\":[\"gitloom-setup\"],\"messages\":[
    {\"role\":\"user\",\"content\":\"Remember that I am testing the GitLoom plugin setup.\"},
    {\"role\":\"assistant\",\"content\":\"Noted.\"}]}"
```

Wait about thirty seconds, then:

```bash
curl -fsS -G "${GITLOOM_BASE_URL:-https://api.gitloom.cloud}/v1/retrieve" \
  -H "Authorization: Bearer $GITLOOM_API_KEY" \
  --data-urlencode "q=what am I testing" \
  --data-urlencode "namespace=${GITLOOM_NAMESPACE:-default}"
```

A non-empty `memories` array means the whole loop works. If it is still empty
after a minute, report that ingestion has not caught up rather than declaring
the setup broken — and check `filtered_out`, which counts memories that matched
an arm but fell below the relevance floor.

## Then hand back to the tools

Once this passes, the `recall_memory`, `save_memory` and `find_skill` tools are
the normal way to use GitLoom. These curl calls exist to diagnose, not to be the
daily interface.
