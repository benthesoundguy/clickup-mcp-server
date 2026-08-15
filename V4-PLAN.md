# v4 — rebuild plan

Branch `v4-rebuild`. Written 2026-08-15, after a measurement pass against the live API.

## The diagnosis

v3.4.1 is a faithful 1:1 mirror of the ClickUp REST API: 88 endpoints, 88 tools. That is an
**API binding**, not an agent tool set. Everything below follows from that one mistake.

Measured, not assumed:

| Thing | Measured | Note |
|---|---|---|
| Tool schemas on the wire | 66,972 B ≈ **18,603 tokens** | Paid on *every* request, before the model reads the user's message |
| One `tasks_list` on a 100-task list | 153,428 B ≈ **42,619 tokens** | |
| Same data, shaped to what an agent can act on | 2,937 B ≈ **816 tokens** | **98.1% smaller** |
| Signal share of a raw task object | **2.7%** | `id` + `name` + `custom_id` |
| `sharing` + `watchers` + `creator` | **44.7%** | Zero agent value |
| `project` + `folder` + `list` | **24.4%** | The *same parent* repeated 100× in a list-scoped query |

A single "show me my tasks" turn costs **~61,000 tokens** before Claude writes a word.

### Four API facts that shape the design

1. **`GET /team/{id}/task` is a universal query primitive.** It filters by `space_ids[]`,
   `list_ids[]`, `statuses[]`, `assignees[]`, dates. One endpoint serves list-tasks,
   space-tasks, workspace-tasks and filtered-tasks. Collapses many tools into one.
2. **Full workspace index costs `2 + S` calls** (S = spaces): one undocumented
   `GET /team/{id}/folder` (returns folders *with lists embedded*), one `GET /team/{id}/space`,
   one `GET /space/{id}/list` per space for folderless lists. Measured: **5 calls → 61 lists**.
   The naive documented walk is ~19 calls for the same workspace.
3. **`limit` is ignored.** Every page is exactly 100. Trimming is entirely the server's job.
4. **HTTP status codes lie, `ECODE` doesn't.** A nonexistent *task* returns
   `401 {"err":"Team not authorized","ECODE":"OAUTH_027"}` — not 404. An agent reads
   "not authorized" and reports a permissions problem when the real cause was a typo'd ID.

### The worst failure mode found

```
GET /team/90141017660/task?assignees[]=99999999   →   200 {"tasks":[],"last_page":true}
```

A **bogus assignee filter returns a confident empty result.** Ask "what's assigned to Sam?"
with an unresolvable name and the honest answer is "I couldn't find Sam"; the API's answer is
"Sam has no work." A wrong answer delivered confidently is worse than an error, and this is
the class of bug the whole v4 design is organised against.

Related: a bad `order_by` returns **HTTP 500**. Invalid enums must be caught client-side.

## Goals (SMART)

Measured on the same fixtures as the table above, verified by tests in `test/`.

| # | Goal | Baseline | Target | How it's verified |
|---|---|---|---|---|
| **G1** | Tool schema surface | 18,603 tok | **≤ 4,000 tok** | `test/budget.test.mjs` fails the build if exceeded |
| **G2** | 100-task list response | 42,619 tok | **≤ 1,500 tok** | `test/budget.test.mjs` against a recorded 100-task fixture |
| **G3** | Tool count | 88 | **≤ 14**, each a job a person would name | Reviewed, asserted in budget test |
| **G4** | Name-first addressing | IDs everywhere | Every scope/assignee/status/tag arg accepts a **human name**; ≤ 3 API calls warm | Integration tests drive tools with names only |
| **G5** | No silent wrong answers | see above | An unresolvable filter **always errors**, never returns `[]` | Dedicated test class |
| **G6** | Errors teach | `"Team not authorized"` | Every error = what failed + why + **what to do**, incl. valid alternatives | Test asserts every error path carries a suggestion |
| **G7** | Rate-limit safety | none | Adaptive from `x-ratelimit-*`; never burst past budget; 429 → backoff+retry | Unit tests with a stub clock |
| **G8** | Coverage of real work | — | find / read / create / update / move / comment / time / structure / custom fields | Integration suite |
| **G9** | Tests | 96 (v3) | All green, incl. every goal above | `npm test` |

Explicit **non-goals**: 1:1 API parity, admin surface (`users_*`, `guests_*` — they mutate real
membership and billing seats), goals/portfolios, chat channels. v3 keeps working for those.

## Design

### Principle: tools are jobs, not endpoints

The resolver is where workflow-bundling happens. `schedule_event`-style consolidation for
ClickUp means: *the agent never performs an ID lookup as a separate step.* Every tool takes
names, resolves internally, and the multi-call plumbing disappears from the transcript.

### Tool surface (target 12)

| Tool | Job | Replaces (v3) |
|---|---|---|
| `find` | Query tasks anywhere, any filter, compact table | `tasks_list`, `lists_search`, `project_intelligence`, most of `views` |
| `task` | One task in full, optional comments/subtasks | `tasks_get` |
| `create` | Create task(s) — array = bulk | `tasks_create`, `tasks_create_bulk` |
| `update` | Update/move/assign/close task(s) — array = bulk | `tasks_update`, `tasks_update_bulk`, `tasks_move*`, `tasks_delete` |
| `comment` | Read/add comments | 6 comment tools |
| `tree` | Workspace structure, compact | `spaces`, `folders_*`, `lists_list_in_space`, `lists_get` |
| `lists` | Create/update/delete lists and folders | 8 list/folder tools |
| `time` | Start/stop/log/report time | 7 time tools |
| `fields` | Inspect + set custom fields | `custom_fields`, `custom_fields_values` |
| `meta` | **What values are legal here** — statuses, tags, members, priorities | `statuses`, `tags`, `*_members_list` |
| `docs` | Read/search/create docs | `docs` |
| `whoami` | Identity, health, cache + rate-limit state | `server_info` |

`meta` exists specifically to kill G5: before guessing a status string, the agent can ask what
this list actually accepts.

### Modules

```
src/v4/
  core/http.ts      fetch + rate-limit governor (reads x-ratelimit-*) + retry/backoff
  core/errors.ts    ECODE → actionable message; every error carries a fix
  core/cache.ts     TTL cache, disk-backed, keyed sha256(token)[:16] + workspace id, 0600
  core/resolve.ts   name/path → id; ambiguity is an error listing the candidates
  core/format.ts    table + detail renderers; the only place raw API JSON is allowed to die
  tools/*.ts        the 12
  server.ts         MCP wiring
```

### Key decisions

- **D1 — Output is text, not JSON.** TSV beat shaped JSON by a further 46% (keys aren't
  repeated per row). Detail views use `key: value` blocks. JSON is never returned raw.
- **D2 — Invariants are hoisted.** A list-scoped query prints the list once in a header, not
  on every row. That alone is 24.4% of the raw payload.
- **D3 — Cheap by default, `detail` to expand.** Opt-in expansion, never opt-out trimming;
  a default nobody changes has to be the cheap one.
- **D4 — Resolution is lazy.** An ID costs 0 calls. A qualified path costs 2–3 at any
  workspace size. Only a *bare ambiguous name* needs the full index.
- **D5 — Ambiguity and non-resolution are errors**, listing valid candidates. Never a guess,
  never an empty result. (G5, G6.)
- **D6 — Stale-tolerant reads, fresh-verified writes.** Cached IDs are fine for a query; a
  write re-verifies the target before mutating.
- **D7 — Client-side enum validation**, because the API answers bad enums with HTTP 500.

## Method

Wonder → discovery → build → red-team → repeat. Iteration 1 is core + `find`/`task`/`create`/
`update`/`tree`/`meta`/`whoami`; iteration 2 the rest; iteration 3+ is adversarial testing
driving the changes. Findings land in the ClickUp "ClickUp MCP v5" list as they come up.
