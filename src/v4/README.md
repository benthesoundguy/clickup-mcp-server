# ClickUp MCP v4

18 tools that take human names, on the branch `v4-rebuild`. Feature-complete against v3's 88.
v3 still lives in `src/` and is untouched.

## Capability profiles

One binary, four profiles, chosen with `MCP_PROFILE`. Install once; add a client entry per
profile and enable whichever a given agent should have.

| `MCP_PROFILE` | tools | schema | can |
|---|---|---|---|
| `read` | 11 | 2,228 tok | observe. **No write of any kind can leave the process.** |
| `agent` | 13 | 2,808 tok | observe + **append**: create tasks, comments, chat messages, checklist items, time logs, attachments |
| `core` | 16 | 4,121 tok | everything a normal user does — no membership or webhook administration |
| `full` (default) | 18 | 4,739 tok | unrestricted |

**`agent` is the interesting one**: it can *add* but cannot alter or delete anything that
already exists. Point an unattended agent at it and the worst it can do is create clutter.

That guarantee is enforced in three layers, and only the third is a security boundary:

1. **Tool filtering** — which tools appear (tokens + tool selection)
2. **Action filtering** — which actions a tool advertises (tokens + honesty)
3. **`core/policy.ts`** — an allowlist checked on every request, *including uploads*, before
   anything is sent. ← **the guarantee**

Layers 1 and 2 depend on every tool being tagged correctly forever. Layer 3 does not: it
inspects the outgoing request, so a mistagged tool or a new endpoint cannot widen a profile.
`test/v4-profiles.test.mjs` proves this by calling `core`-only handlers *directly* with an
`agent` context — bypassing layers 1 and 2 entirely — and asserting nothing reaches the wire.

Matching is segment-exact, never prefix-based, because ClickUp distinguishes
`POST /list/{id}/task` (create — allowed) from `POST /list/{id}/task/{id}` (**move** — not)
by one trailing segment.

Things that are additive but still excluded from `agent`, deliberately: attaching a tag,
setting a custom field and adding a dependency all mutate an *existing* task; creating a
webhook starts streaming your data to an external endpoint. Append-only and safe are not the
same property.

**Known rough edge:** under `read`, `comment(task, text)` silently degrades to reading rather
than announcing that posting is unavailable. It never posts and never claims to have — the
reply is plainly a comment listing — but it does not say why.

## Why

v3 mirrors the ClickUp REST API one endpoint per tool. Measured against the live API on
2026-08-15:

| | v3.4.1 | v4.0.0 | |
|---|---|---|---|
| Tool schemas, paid on **every** request | 66,972 B ≈ **18,603 tok** | 17,060 B ≈ **4,739 tok** | −74.5% |
| One 100-task list | 14,625 B ≈ **4,063 tok** | 2,683 B ≈ **745 tok** | −81.7% |
| Round trips to list a named list | **4** | **1** | |
| Tools | 88 | 18 | |

Coverage is now equivalent: all 88 v3 tools are either replaced by one of the 18 or folded in
as a parameter. Closing that gap cost **1,900 tokens** — v3 spends **7,609** on the same
functionality.

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
| `goals` | Goals and key results, by name. |
| `chat` | Read/post in ClickUp Chat channels. |
| `webhooks` | List, create, delete webhooks. |
| `attach` | Upload a file to a task. |
| `checklist` | Checklists and items inside a task. |
| `people` | Members, guests, seats, groups. Mutations need `confirm: true`. |

Folded in as parameters rather than tools: saved **views** (`find(view:)`), **dependencies**
and **links** (`update(waits_on/blocks/link_to)`), **tag assignment**
(`update(tags_add/tags_remove)`), and **list templates** (`lists(from_template:)`). Eleven v3
tools for 236 tokens.

`people` mutations consume billable seats and change real access, so every one of them
reports current seat usage and refuses without `confirm: true`.

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
| `MCP_PROFILE` | `read` \| `agent` \| `core` \| `full` (default). |
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

`npm test` — 275 tests, of which 96 are v3's. The v4 suite is offline: a stubbed fetch and a
stubbed clock, so it never spends the real rate budget.

- `v4-core.test.mjs` — resolver, errors, dates, text, formatting, rate governor
- `v4-tools.test.mjs` — tool behaviour, including a stub that reproduces the move endpoint's
  real lying behaviour
- `v4-budget.test.mjs` — **fails the build if the token budgets regress**
- `v4-http.test.mjs` — transport and auth end to end
- `v4-extended.test.mjs` — the long tail, including every membership-write confirmation gate
- `v4-profiles.test.mjs` — the capability boundary, including the bypass test

## Verification status

Everything except membership *writes* has been exercised against the live API. The
`people` write paths (invite / remove / set_admin / guest_*) are covered by stub tests only:
running them for real consumes billable seats and changes a person's access, which is not a
thing to do for a smoke test. They are the one part of this server that has never executed
against real ClickUp.
