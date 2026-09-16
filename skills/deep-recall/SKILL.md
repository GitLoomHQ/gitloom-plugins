---
name: deep-recall
description: Use only after recall_memory has already returned nothing useful, or when the question needs something that tool cannot express — a date window, a relevance floor, a tag, or a written answer instead of evidence. Not the first thing to reach for; recall_memory is.
---

# When a plain recall was not enough

`recall_memory` is the right tool for almost every question and should stay the
first thing you call. It exposes a query, tiers and paths. The retrieve API
underneath exposes more, and this skill is for the cases where that difference
decides the answer.

Reach for it when:

- `recall_memory` came back empty and you want to know whether the namespace
  holds nothing, or the relevance floor dropped everything
- the question is bounded in time — "what did I decide in August"
- the question needs a written answer over many memories rather than the
  memories themselves — "which of my trips had the longest flight"

## The whole query

```bash
curl -fsS -G "${GITLOOM_BASE_URL:-https://api.gitloom.cloud}/v1/retrieve" \
  -H "Authorization: Bearer $GITLOOM_API_KEY" \
  --data-urlencode "q=what camera did I buy" \
  --data-urlencode "namespace=${GITLOOM_NAMESPACE:-default}" \
  --data-urlencode "tiers=facts" \
  --data-urlencode "paths=facts/camera-gear" \
  --data-urlencode "tags=purchase" \
  --data-urlencode "since=2026-01-01" \
  --data-urlencode "min_score=0.3" \
  --data-urlencode "limit=8"
```

`tiers` are `facts`, `incidents`, `rules`, `skills`. `tags_all` requires every
tag where `tags` requires any. `since`/`until` bound the memory's `updated`.
`context=0` drops graph neighbours. `detail=full` adds revision history, the
last change as a diff, relation snippets and cues.

Every filter is applied **inside** each retrieval arm and to graph neighbours,
so `paths=facts/commitments` is a real boundary — nothing outside it can arrive
as a neighbour either.

## Reading the answer honestly

`score` is calibrated in `[0, 1]` and comparable across queries: a memory that
answers the question outright scores near 1 whatever else the namespace holds.
That is what makes `min_score` mean the same thing every time.

`matched` names the arms that produced each memory. **A memory matched only by
`graph` is context, not evidence** — it rode in beside a real match, and `via`
names what pulled it in. Do not answer a factual question from a `graph`-only
memory.

`candidates` with a large `filtered_out` and an empty `memories` is the
important case: retrieval found things and rejected them as irrelevant. That is
an abstention. Say the memory holds nothing that answers the question, rather
than reaching for the least-bad memory or widening the query until something
comes back.

## Letting a model answer instead

`mode=summary` has a fast model write one `answer` from the same retrieval;
`mode=agentic` lets a stronger model search the memory itself with tools and
return its `trace`.

```bash
curl -fsS -G ".../v1/retrieve" -H "Authorization: Bearer $GITLOOM_API_KEY" \
  --data-urlencode "q=which of my trips had the longest flight" \
  --data-urlencode "namespace=default" --data-urlencode "mode=agentic"
```

**Both meter as a chat rather than a read**, so they cost materially more than
the default path. Use them when synthesis across many memories is the actual
question, not to save yourself reading the `memories` array. An agentic run is
bounded near 24 seconds; `truncated: true` means it hit that budget before it
chose to stop, and its answer is partial.
