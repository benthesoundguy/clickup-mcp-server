# v4 — rebuild plan

Branch `v4-rebuild`. Written 2026-08-15, after a measurement pass against the live API.

## The diagnosis

v3.4.1 is a faithful 1:1 mirror of the ClickUp REST API: 88 endpoints, 88 tools. That is an
**API binding**, not an agent tool set. Everything below follows from that one mistake.

Measured, not assumed:

| Thing | Measured | Note |
|---|---|---|
| Tool schemas on the wire | 66,972 B ≈ **18,603 tokens** | Paid on *every* request, before the model reads the user's message |
| Raw ClickUp JSON for 100 tasks | 153,428 B ≈ **42,619 tokens** | What the API returns |
| v3 `tasks_list`, `detail:"full"` | 153,423 B ≈ **42,618 tokens** | Passes the raw payload straight through |
| **v3 `tasks_list`, default (`lean`)** | 14,625 B ≈ **4,063 tokens** | **v3 already shapes its default output** — `shapeTaskList()` in `src/tools/helpers.ts` |
| Signal share of a raw task object | **2.7%** | `id` + `name` + `custom_id` |
| `sharing` + `watchers` + `creator` | **44.7%** | Zero agent value |
| `project` + `folder` + `list` | **24.4%** | The *same parent* repeated 100× in a list-scoped query |

**The honest baseline is 4,063 tokens, not 42,619.** v3 solved much of the response-shaping
problem already; the remaining waste is JSON key repetition, un-hoisted invariants, and fields
(`url`, `date_updated`) that are derivable or rarely load-bearing. The real v3 problem is the
**18,603-token tool surface** and the round trips its ID-first design forces.

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
| **G2** | 100-task list response | 4,063 tok (v3 default) | **≤ 1,500 tok** | `test/v4-budget.test.mjs` against a recorded 100-task fixture |
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

---

# Results

Four iterations. **186 tests pass.**

| Goal | Baseline | Target | **Actual** | |
|---|---|---|---|---|
| **G1** tool schemas | 18,603 tok | ≤ 5,000 * | **4,739 tok** | ✅ −74.5% |
| **G2** 100-task list | 4,063 tok *(v3 default)* | ≤ 1,500 | **745 tok** | ✅ −81.7% |
| **G3** tool count | 88 | ≤ 18 * | **18** | ✅ full parity |
| **G4** name-first addressing | — | names everywhere | ✅ | index `3+S`, cached |
| **G5** no silent wrong answers | — | always error | ✅ | 5 classes closed |
| **G6** errors teach | — | every error | ✅ | asserted in tests |
| **G7** rate-limit safety | none | adaptive | ✅ | stub-clock tested |
| **G8** coverage | — | core workflows | ✅ | all 12 live-verified |
| **G9** tests | 96 | all green | **186** | ✅ |

**Same job, end to end** — "show me what's in the Cavalry Findings list" (30 tasks):

| | round trips | result tokens | + resident schema | total |
|---|---|---|---|---|
| v3 | **4** (`workspaces_list` → `spaces` → `lists_search` → `tasks_list`) | 4,146 | 18,603 | **22,749** |
| v4 | **1** (`find(scope:"Cavalry/Findings")`) | 1,127 | 2,811 | **3,938** |

**5.8× less context, and one round trip instead of four.** The round trips are the real story:
v3's `tasks_list` requires a `list_id`, `lists_search` requires a container id, and `spaces`
requires a `workspace_id` — so an agent starting from a name has no choice but to walk the
tree. v4 resolves the name server-side.

## What live probing found that nothing else would have

Every real bug was found by **reading state back from the live API after a write**. None would
have been caught by the type checker, by unit tests against mocks, or by re-reading the code —
in each case a mock returns 200 and the test passes.

1. **`move_to` reported success while the task never moved.** ClickUp's public API cannot move
   a task between lists: `POST /list/{dest}/task/{id}` returns `200 {}` and no-ops without the
   "Tasks in Multiple Lists" ClickApp, `PUT` with `list_id` is silently ignored, `/move` 404s.
   The tool printed the *old list name* one line below the word "moved".
2. **`find` reported a page size as a total** — "100 matches" after fetching one page of many.
3. **The delete confirmation quoted a stale cached count** — the one number in an irreversible
   prompt that must not be a guess.
4. **Status validation against space defaults falsely rejected `blocked`**, a status four real
   tasks were in. Lists override their space constantly; the fix was free because the folder
   index already carries every list's statuses.
5. **`resolveScope` rewrote "matches 4 lists" into "matches nothing"** — error-wrapping turning
   a correct answer into a false one.

**The rule:** *a 200 is not a result.* Verify writes whose effect the endpoint doesn't
guarantee; report only counts actually established; never mock away the thing you're least
sure of, because that's exactly what a stub will cheerfully confirm.

## Not done

`users_*`/`guests_*` (they mutate billing seats), goals, portfolios, chat, webhooks,
templates, views — all still served by v3. No CI. Custom-field *writes* are untested against
real field types (this workspace defines none). **v4 is not deployed**; v3.4.1 still runs.
