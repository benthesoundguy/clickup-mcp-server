# ClickUp MCP v4

12 tools that take human names, on the branch `v4-rebuild`. v3 (88 tools) still lives in
`src/` and is untouched.

## Why

v3 mirrors the ClickUp REST API one endpoint per tool. Measured against the live API on
2026-08-15:

| | v3.4.1 | v4.0.0 | |
|---|---|---|---|
| Tool schemas, paid on **every** request | 66,972 B ≈ **18,603 tok** | 10,120 B ≈ **2,811 tok** | −84.9% |
| One 100-task list | 14,625 B ≈ **4,063 tok** | 2,683 B ≈ **745 tok** | −81.7% |
| Round trips to list a named list | **4** | **1** | |
| Tools | 88 | 12 | |

Note the response baseline: **v3 already shapes `tasks_list` by default** (`shapeTaskList()`,
`detail: 'lean'`). Measuring against the *raw* API would show −98%, but that is v3's opt-in
`detail:"full"` mode, not what it actually returns. 4,063 → 745 is the honest number.

The bigger win is the tool surface and the round trips. v3's `tasks_list` requires a `list_id`,
`lists_search` requires a container id, `spaces` requires a `workspace_id` — an agent holding
only the name "Cavalry/Findings" must walk the tree to get anywhere. Same job end to end:
**22,749 tokens over 4 calls → 3,938 over 1.**

## The rule everything follows

**Never return a confident wrong answer.**

ClickUp makes this easy to get wrong, because it answers bad input with cheerful nonsense:

| Input | ClickUp says | Which reads as |
|---|---|---|
| `?assignees[]=99999999` | `200 {"tasks":[]}` | "Sam has no work" (there is no Sam) |
| `?query=anything` | `200` + unfiltered results | a filtered search that wasn't |
| `POST /list/{dest}/task/{id}` | `200 {}` | "moved" (it didn't move) |
| `PUT /task/{id}` `{list_id}` | `200` | "moved" (silently ignored) |
| `GET /task/{bad-id}` | `401 Team not authorized` | a permissions problem (it's a typo) |
| `?order_by=bogus` | `500` | an outage (it's a bad enum) |

So v4:

- **resolves names, and raises on ambiguity** — "Findings" matching four lists is an error
  naming all four, never a coin flip;
- **raises rather than returning empty** when a filter value doesn't resolve;
- **validates enums client-side** against what the list actually accepts;
- **verifies writes it can't trust** — `move_to` reads the task back and fails loudly if it
  didn't move;
- **never overstates a count** — a query that stopped paging reports `100+ matches`, and any
  client-side filter reports how much was actually scanned.

## Tools

| Tool | Job |
|---|---|
| `find` | Query tasks anywhere. Scope/status/assignee/tags/due, all by name. |
| `task` | One task in full, optional comments and subtasks. |
| `create` | Create task(s) — pass an array for bulk. |
| `update` | Update/move/assign/close/delete — pass several IDs for bulk. |
| `comment` | Read or post comments. |
| `tree` | Workspace structure with the exact paths other tools accept. |
| `lists` | Create/rename/delete lists and folders. Deletes need `confirm: true`. |
| `time` | start / stop / current / log / report. |
| `fields` | Inspect custom fields, or set one by name. |
| `meta` | **What values are legal here** — statuses, tags, members, priorities. |
| `docs` | Search or read ClickUp Docs. |
| `whoami` | Identity, rate budget, cache state. |

`meta` exists to kill the guess-a-status failure: ask what a list accepts instead of
discovering it via an empty result.

## Addressing

Nothing needs an ID.

```
find(scope: "Cavalry/Findings", assignee: ["me"], due: "overdue")
create(list: "Findings", tasks: [{ name: "Fix it", due: "next friday", priority: "high" }])
update(ids: ["86bben08h"], status: "complete")
```

Lists take a bare name, a `Space/Folder/List` path, or an ID. A bare name that matches once
resolves; matching several raises with all candidates; matching none raises with the nearest
matches ranked by similarity. IDs cost zero lookups.

## Running

```bash
CLICKUP_API_TOKEN=pk_… node build/v4/index.js
```

Stdio by default. For HTTP:

| Env var | Meaning |
|---|---|
| `CLICKUP_API_TOKEN` | **Required.** ClickUp personal token. |
| `MCP_TRANSPORT=http` / `MCP_HTTP_PORT` | Serve streamable HTTP (default `127.0.0.1:8000`). |
| `MCP_AUTH_TOKEN` | **Required in HTTP mode**, ≥16 chars. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Enable Cloudflare Access JWT validation. |
| `CLICKUP_WORKSPACE_ID` | Optional; discovered automatically. |
| `CLICKUP_API_BASE` | Point at a stub. Tests only. |

Auth is the v3 layer reused unchanged (`src/cf-access.ts`), which has been through four
adversarial review rounds: an Access JWT **or** a bearer token, RS256 pinned, failing closed,
and an invalid JWT never vetoes a valid bearer token.

## Cost model

- Workspace index: **`3 + S` calls** (S = spaces), cached 5 minutes, shared process-wide.
  The cheap path is the undocumented `GET /team/{id}/folder`, which returns every folder
  *with its lists embedded* — 6 calls for 61 lists here, against ~19 for the documented walk.
- Rate limiting is adaptive, driven by the live `x-ratelimit-*` headers, holding back a
  reserve because the ~100/min budget is **per token** and shared with every other client
  using it.
- `limit` is ignored by ClickUp; every page is exactly 100, so trimming is entirely
  server-side.

## Tests

`npm test` — 186 tests, of which 96 are v3's. The v4 suite is offline: a stubbed fetch and a
stubbed clock, so it never spends the real rate budget.

- `v4-core.test.mjs` — resolver, errors, dates, text, formatting, rate governor
- `v4-tools.test.mjs` — tool behaviour, including a stub that reproduces the move endpoint's
  real lying behaviour
- `v4-budget.test.mjs` — **fails the build if the token budgets regress**
- `v4-http.test.mjs` — transport and auth end to end

## Not covered

Deliberately out of scope, and still served by v3: `users_*` / `guests_*` (they mutate real
membership and billing seats), goals, portfolios, chat channels, webhooks, templates, views.
