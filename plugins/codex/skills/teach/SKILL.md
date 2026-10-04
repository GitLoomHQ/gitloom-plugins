---
name: teach
description: Use when the user wants GitLoom to learn their vocabulary or a procedure — an abbreviation, a domain term, a project codename, a checklist, a runbook, "this is how we do X here". Covers the vocabulary and skills APIs, which the memory tools do not expose.
---

# Teach the namespace its own words and its own procedures

Two things a namespace holds besides memories, both written through the API
rather than the memory tools.

## Vocabulary: so a search for one word finds another

Retrieval matches the words that were written. If a memory says "kubernetes" and
the question says "k8s", the lexical arm misses it. A learned term fixes that in
one place for every future query, in both directions, and the definition comes
back on the retrieval as `defined` so the model reading it knows what the word
means.

Teach a term when the user uses an abbreviation, an internal codename, or a word
their industry uses differently from everyone else.

```bash
curl -fsS -X POST "${GITLOOM_BASE_URL:-https://api.gitloom.cloud}/v1/vocab" \
  -H "Authorization: Bearer $GITLOOM_API_KEY" -H "content-type: application/json" \
  -d '{"namespace":"default","terms":[
    {"term":"kubernetes","aliases":["k8s","kube"],"definition":"Container orchestration."},
    {"term":"Northstar","aliases":["NS","the northstar project"],"definition":"The Q4 billing rewrite."}
  ]}'
```

`term` is the canonical form; `aliases` are every other way it gets written.
Reading them back, resolving one, and forgetting one:

```bash
curl -fsS -G "${GITLOOM_BASE_URL:-https://api.gitloom.cloud}/v1/vocab" \
  -H "Authorization: Bearer $GITLOOM_API_KEY" \
  --data-urlencode "namespace=${GITLOOM_NAMESPACE:-default}"
curl -fsS -G "${GITLOOM_BASE_URL:-https://api.gitloom.cloud}/v1/vocab" \
  -H "Authorization: Bearer $GITLOOM_API_KEY" \
  --data-urlencode "namespace=${GITLOOM_NAMESPACE:-default}" --data-urlencode "word=k8s"
curl -fsS -G -X DELETE "${GITLOOM_BASE_URL:-https://api.gitloom.cloud}/v1/vocab" \
  -H "Authorization: Bearer $GITLOOM_API_KEY" \
  --data-urlencode "namespace=${GITLOOM_NAMESPACE:-default}" --data-urlencode "term=Northstar"
```

A lookup for an unknown word answers `{"found": false}` — that is not an error.
Forgetting a term that was never learned is skipped rather than failing the
batch.

## Skills: so a procedure is followed rather than reinvented

A skill is an ordinary memory under the `skills/` tier, so `find_skill` reaches
it and so does a recall filtered to `tiers=skills`. Store one when the user
describes how something is done in their world — a release checklist, an
escalation path, the order operations have to happen in.

```bash
curl -fsS -X POST "${GITLOOM_BASE_URL:-https://api.gitloom.cloud}/v1/skills" \
  -H "Authorization: Bearer $GITLOOM_API_KEY" -H "content-type: application/json" \
  -d '{"namespace":"default","skills":[{
    "name":"Deploy to production",
    "topic":"ops",
    "description":"Ship a release.",
    "content":"## Steps\n1. Tag the release.\n2. `make deploy ENV=prod`\n3. Watch the canary for ten minutes.",
    "triggers":["how do I ship a release","deploy to prod","cut a release"]
  }]}'
```

`content` is markdown and its `##` headings become separately matchable
sections. `topic` files it at `skills/<topic>/<slug>.md`; the response `paths`
say where each one landed.

**Write `triggers` as the question, not the topic.** They become the skill's
retrieval cues, so "how do I ship a release" finds it and "deployment" mostly
does not. Left empty they fall back to the name and description, which is
usually worse than three real phrasings.

Both routes answer `202` — asynchronous, like every write. A batch is capped;
`413 too_many_terms` or `413 too_many_skills` means split it.
