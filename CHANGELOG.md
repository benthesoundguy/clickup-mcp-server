# Changelog

## 3.0.0 — 2026-07-31

Full renovation. Every registered operation now maps to a live, verified
ClickUp endpoint or an honestly-labeled local computation. **85 tools /
144 operations**, all exercised by a live smoke suite (97 steps green).

### Security
- **Webhook receiver auth bypass fixed** — with `WEBHOOK_SECRET` set, a
  request *without* an `X-Signature` header previously skipped validation
  entirely; it is now a 401.
- HMAC-SHA256 verification now runs over the **raw request body bytes**
  (ClickUp signs the exact bytes it sends; verifying a re-serialized
  object produced false results).
- Resources layer removed: 44 `console.log` calls were writing into the
  stdio JSON-RPC stream (corrupting the protocol), and 12 hardcoded
  example resources pointed at a stranger's private workspace. Every
  resource duplicated an existing tool.

### Reliability
- New HTTP core on native fetch (axios dropped): one lazy shared client,
  30s timeout, retry with exponential backoff on 429/502/503/504
  honoring `Retry-After`, plus transient-500 retry for idempotent methods
  only (never POST). Errors normalized with status + ClickUp ECODE.
- A missing `CLICKUP_API_TOKEN` no longer kills the process at import
  time — the server starts and returns an actionable tool error.
- Bulk operations (task create/update, custom-field bulk set) never
  throw mid-loop; they return `{results, succeeded, failed,
  stopped_early}` with 150ms pacing between writes.

### Correctness (paths fixed, verified live)
- **Chat rebuilt on the v3 API** — all previous chat paths were dead.
  Channels, DMs, messages, replies, reactions, members, followers.
  Reactions use colon-free shortcodes (`+1`, `heart`).
- Time entry create/update/delete: documented plural `/time_entries` paths.
- Groups: `GET /group?team_id=`, `PUT/DELETE /group/{id}`; member
  add/remove support added.
- Task templates: `/team/{id}/taskTemplate` (paged).
- Users list: derived from the workspace object (`GET /team`) — there is
  no list-users endpoint.
- Docs: create rebuilt on `POST /workspaces/{id}/docs` with typed parent;
  page create/update on workspace-scoped routes; docs search is a local
  name filter over the v3 listing (no search endpoint exists).
- Goal key results: documented body (`steps_start`/`steps_end`/`owners`).
- View update: read-modify-write (the API expects the full view object).
- List statuses: verified live; requires exactly one `open`-type status —
  `type` now supported and documented.

### Removed (verified dead against the live API, 2026-07-31)
- Dependency analytics endpoints (update/delete-by-id, conflicts,
  resolve, timeline, workspace list/stats/export/import, bulk) — graph
  analysis lives on locally in `project_intelligence`.
- Reminders list/update (the API is create-only; `reminders_create` kept).
- Workspace search (`POST /team/{id}/search`).
- View duplicate and sharing.
- Custom field definition update/delete (create is real and kept).
- List/folder item template listing.
- Doc update / doc page delete (no such API operations).
- Chat unread counts, mark-read, channel stats, message search.

### Project intelligence
- All reports fetch **every** task page (cap 3,000 tasks); capped results
  carry `data_complete: false` with a warning instead of silently
  reporting numbers from the first 100 tasks.
- Closed/in-progress classification driven by the list's status **type**
  metadata — custom workflows ("Shipped 🚀") are counted correctly.
- Computations extracted as pure, fixture-tested functions. Fixed: sprint
  recommendation sorted urgent-last; bottlenecks counted finished tasks
  as stuck; workload overload threshold fired on zero average.

### Responses
- Compact JSON everywhere (no pretty-print token waste).
- `tasks_list` / `view_tasks` return a lean field set by default
  (<20% the bytes of raw) with `detail:"full"` and `fields:[...]` opt-ins,
  and auto-paginate with a completeness flag.
- Binary-safe attachment upload (real multipart FormData; the old
  hand-rolled encoding corrupted binary files).

### Testing
- 51 unit tests (HTTP core, HMAC/webhooks, shaping, bulk contract,
  project-intelligence fixtures) — `npm test`.
- 97-step live smoke suite (`npm run smoke`) that walks CRUD per domain
  in a self-cleaning sandbox against a real workspace.

### Housekeeping
- `.gitignore` added; `node_modules/` (5,480 files) and `build/` untracked.
- Fork metadata fixed (repository/author/homepage); upstream copyright
  restored in LICENSE alongside the fork's.
- GitHub-based install; false "no rate limits" claim removed.

---

## 2.0.0 and earlier

See the upstream project: https://github.com/nsxdavid/clickup-mcp-server
