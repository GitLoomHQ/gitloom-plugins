---
name: save-session
description: Use when the user asks to save, store, remember, or capture this conversation, session, or everything discussed — anything plural rather than one fact. Submits the conversation for extraction, which finds several memories at once and reconciles them against what is already stored. The save_memory tool is for a single fact; this is for a whole exchange.
---

# Hand a whole conversation to memory

`save_memory` stores one sentence you wrote yourself. This is the other path:
you submit the **conversation** and a model on GitLoom's side extracts the
atomic facts from it, writes the retrieval cues, links relations between
entities, and reconciles anything that restates a memory already stored. Use it
when a session produced several things worth keeping, or when you would
otherwise call `save_memory` three or four times in a row.

It is not a transcript dump. Everything sent is stored or extracted from, so
send the turns that carry durable information and leave out the rest.

## What to send

Include a turn when it states something that will still be true, or still worth
knowing, months from now: a preference, a decision and its reason, a possession,
a commitment, a relationship, a constraint they work under.

Leave out:

- anything you inferred rather than were told
- the mechanics of this session — files you read, commands you ran, what you
  were asked to do next
- secrets, keys, and credentials, which do not become less sensitive for being
  in a memory
- small talk

Rewrite nothing. The extractor reads the user's own words, and a turn you have
already summarized gives it less to work with, not more.

## Sending it

`occurred_at` is when the conversation *happened*, not now — it dates the
memories, so getting it wrong misfiles them in time. It takes a date
(`"2026-09-16"`), RFC 3339 with an offset, epoch seconds as a number, or a
datetime without an offset, read in `timezone` (an IANA zone). `date` is its
deprecated old name. `tags` go on every memory drawn from the conversation: at
most 32, each up to 64 characters of letters, digits, spaces and
`- _ . : / # @`, lowercased on arrival. `session_id` is your own id for the
exchange; identical bodies within five minutes are deduplicated, so a retry is
safe.

```bash
curl -fsS -X POST "${GITLOOM_BASE_URL:-https://api.gitloom.cloud}/v1/memories" \
  -H "Authorization: Bearer $GITLOOM_API_KEY" \
  -H "content-type: application/json" \
  -d @- <<'JSON'
{
  "namespace": "default",
  "session_id": "chat-2026-09-16-a",
  "occurred_at": "2026-09-16T18:40:00",
  "timezone": "Asia/Kolkata",
  "tags": ["purchase", "camera-gear"],
  "messages": [
    {"role": "user", "content": "I finally bought the Sony A7III today — 142k at Fotocentre in Bengaluru."},
    {"role": "assistant", "content": "Nice pick, that pairs well with your 28-70."}
  ]
}
JSON
```

Substitute `GITLOOM_NAMESPACE` for `"default"` if it is set.

## What comes back

`202` and a queue message id. The memory does not exist yet and the id is not a
memory id — no endpoint accepts it back. Tell the user their conversation was
accepted, not that it was saved, and that a recall will find it shortly.

A tag, time or zone the API cannot read is refused with `400` and
`invalid_tag`, `invalid_date` or `invalid_timezone` before anything is queued;
the `message` names the field. Fix it and send again.

The request is bounded at 200 turns, 200,000 characters and 256 KB. Past any of
those it is refused with `413 too_many_turns`, `413 session_too_long` or
`413 payload_too_large`; split the conversation and send it in batches.
