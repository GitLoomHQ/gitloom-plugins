# Submitting these plugins

Both directories submit through a web form tied to an account, so the final
step is a human's. This file holds everything those forms ask for, and the
status of each prerequisite.

## Claude Code — ready

`claude plugin validate ./plugins/claude-code --strict` passes, which is the
same check the review pipeline runs. Submit through one of:

- **[platform.claude.com/plugins/submit](https://platform.claude.com/plugins/submit)** — for an individual author
- **[claude.ai/admin-settings/directory/submissions/plugins/new](https://claude.ai/admin-settings/directory/submissions/plugins/new)** — needs a Team or Enterprise organization with directory management access

Approved plugins are pinned to a commit SHA in
[`anthropics/claude-plugins-community`](https://github.com/anthropics/claude-plugins-community)
and CI bumps the pin as you push. The catalog syncs nightly, so there is a
delay between approval and the plugin being installable.

`claude-plugins-official` is curated by Anthropic at its own discretion. There
is no application, and the submission form does not add anything to it.

## Codex — blocked on a hosted MCP endpoint

The directory does not accept a local MCP server:

> Submit MCP servers through **With MCP** using a stable, public HTTPS
> endpoint. If your MCP server runs locally, deploy it to a public HTTPS URL.
> If you can't, reach out to your OpenAI contact for local MCP support.

This plugin runs `npx @gitloomhq/mcp` over stdio. Three ways forward:

1. **Serve MCP over HTTPS** at something like `mcp.gitloom.cloud`, speaking
   streamable-HTTP with per-account bearer auth, then change `mcp.json` to
   `{"type": "streamable-http", "url": ...}`. GitLoom already has the API
   Lambda and the key-auth model this would sit on.
2. **Submit skills-only** — drop `mcp.json` and ship the four skills, which the
   directory does accept. They call the REST API with `GITLOOM_API_KEY`
   directly, so the plugin still works; it just has no tools.
3. **Ask OpenAI for local MCP support**, which the doc invites.

Nothing about the plugin itself is blocking. The remaining prerequisites:

| requirement | status |
|---|---|
| `readOnlyHint`, `openWorldHint`, `destructiveHint` on every tool | done in `@gitloomhq/sdk` 0.9.2 |
| Listing name, descriptions, logo, category, website | in `plugin.json` |
| Privacy policy URL | **missing** — `gitloom.cloud/privacy` renders the marketing page, as does every other path |
| Terms of service URL | **missing**, same |
| Support URL | **missing** |
| Verified developer identity on OpenAI Platform | yours to do |
| Apps Management → Write permission | yours to do |
| Public MCP server URL + domain verification at `/.well-known/openai-apps-challenge` | blocked, see above |
| Demo credentials working without MFA, SMS, email confirmation or private network | **missing** — needs a demo account and a live key |
| Five positive and three negative test cases | below |
| Starter prompts | in `plugin.json` as `defaultPrompt` |

## Test cases

### Positive

1. **Recall across sessions.** Save "I shoot on a Sony A7III" in one session.
   In a new session ask "what camera do I own". Expect the A7III, drawn from
   `recall_memory` rather than the conversation.
2. **Save a durable fact.** Say "I moved to Pune last month." Expect one
   `save_memory` call. Expect no call for "that's interesting" a turn later.
3. **Find a taught procedure.** Store a skill with the `teach` skill, then ask
   "how do I ship a release". Expect `find_skill` before any answer, and the
   stored steps rather than invented ones.
4. **Vocabulary expansion.** Teach `kubernetes` with alias `k8s`. Save a memory
   written "kubernetes". Ask a question using "k8s". Expect the memory, and the
   definition on the response as `defined`.
5. **Whole-conversation ingestion.** After a session covering three or four
   durable facts, ask to save it. Expect the `save-session` skill and one
   `POST /v1/memories`, not four `save_memory` calls.

### Negative

1. **Abstention, not confabulation.** Ask about something never stored. Expect
   the agent to say the memory holds nothing relevant — `candidates` with a
   large `filtered_out` and empty `memories` is retrieval abstaining, not a
   miss to work around by widening the query.
2. **No key.** Unset `GITLOOM_API_KEY`. Expect the server to refuse to start
   and no tools to register, with the `setup` skill explaining it — not tools
   that register and then fail every call with a 401.
3. **Nothing inferred or sensitive is saved.** Mention an API key, and mention
   a guess about the user. Expect neither to reach `save_memory`.

## Release notes for the first submission

> First release. Long-term memory for an agent, stored as markdown in a git
> repository: recall what was learned in earlier sessions, save durable facts,
> and follow procedures the user has taught. Adds four skills covering
> conversation-level ingestion, the vocabulary and skills APIs, and retrieval
> filtered by date, directory or relevance.
