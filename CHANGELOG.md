# Changelog

## 4.3.0 — 2026-08-15

A ground-up rewrite. 88 tools that mirrored ClickUp's REST API become 18 organised around jobs,
addressed by name rather than ID, with capability profiles that make the server safe to hand to
an untrusted agent. The 3.x line is unchanged and still shipped — see *Breaking* below.

Not yet run in production. Five adversarial red-team rounds, 320 tests, zero days of real use.

### Breaking

- **The default entry point is now 4.x.** `main`, the `clickup-mcp-server` bin, and `npm start`
  all point at `build/v4/index.js`. 3.x remains available as `clickup-mcp-server-v3` /
  `npm run start:v3` / `build/index.js`, and the reference systemd unit in `deploy/` is
  deliberately still pinned to it: a running service must not change major version because a
  package default moved underneath it.
- **Every tool name changed.** This is a rewrite, not a rename — anything holding hard-coded
  tool names needs updating. README has the full mapping; it is mostly many-to-one
  (`workspaces_list` + `spaces` + `lists_search` → `tree`, and so on).
- **`MCP_PROFILE` defaults to `core`, not `full`.** `full` grants membership administration
  (billable seats, real people's access) and webhooks (workspace data sent off-site). A default
  nobody changes has to be the safe one. Set `MCP_PROFILE=full` explicitly to restore 3.x
  behaviour.
- **Dropped:** `project_intelligence` (the eight local analysis reports), `reminders_create`,
  and status *management* — `meta` reads statuses but cannot create, rename, or reorder them.
  Run 3.x if you need these.

### Added

- **Capability profiles** — `read` · `agent` · `core` · `full`, selected with `MCP_PROFILE`.
  Enforced in three layers, only the third of which is a security boundary: an allowlist checked
  on every outgoing request, including uploads. A mistagged tool, a refactor, or an endpoint
  added next year cannot widen a profile. The test suite proves it by calling `core`-only
  handlers directly with an `agent` context and asserting nothing reaches the wire.
- **`agent` profile** — append-only. It can create tasks, comments, chat messages, checklist
  items and time logs, but cannot alter or delete anything that already exists. Attaching a tag,
  setting a custom field and adding a dependency are all excluded because they mutate an
  existing task; creating a webhook is excluded because append-only and safe are not the same
  property.
- **Name-first addressing** — `find(scope: "Cavalry/Findings", assignee: "me", due: "overdue")`.
  The workspace index costs `3 + S` API calls, is cached for five minutes, and serves list
  statuses for free.
- **`CLICKUP_ATTACH_ROOT`** — confines `attach` to one directory, checked against the file's
  real path after resolving `..` and every symlink. Required for `attach` under `agent`.
- **`whoami`** now reports the running version and build stamp, restoring what 3.x's
  `server_info` did: an MCP host holds the process it spawned, so "the fix didn't work" is
  usually an old process still running.
- `GET /health` reports the active profile, the tool count that profile actually exposes, and
  the attachment root.

### Fixed

Six classes of confidently-wrong answer, all found by reading state back from the live API
after a write — none would have been caught by a mock, which cheerfully returns 200:

- **`move_to` reported success while the task never moved.** ClickUp cannot move tasks between
  lists: three endpoints return 200 and no-op. Now verified by read-back, and it fails loudly.
- **`find` reported a page size as a total** — "100 matches" after one page of many. Now
  `100+ matches` with an explicit coverage warning.
- **A stale cached count in a delete confirmation** — the one number in an irreversible prompt
  that must not be a guess. Now a live read.
- **Status validation against space defaults falsely rejected valid statuses.** Lists override
  their space constantly; statuses now come per-list from the folder index.
- **Ambiguity was reported as absence** — "Findings" matching four lists came back as "matches
  nothing". Ambiguity is now an error naming all four.
- **Dependency direction was inverted.** ClickUp returns `type: 1` for both directions; the
  direction lives in `task_id` vs `depends_on`.

### Security

- **`attach` could read any local file under the `agent` profile.** Absolute paths, `..`
  traversal and symlinks all resolved, so `../.env` yielded the ClickUp API token — which grants
  full write access regardless of profile, making every other restriction decorative. The root
  cause is worth stating plainly: the write policy inspects outbound URLs, and a local file read
  has no URL, so the guarantee never covered that resource at all. Fixed with a second chokepoint
  (`core/localfile.ts`) that every local read passes through.
- **Encoded path separators could smuggle a denied path past the append allowlist.**
  `POST /list/1%2Ftask%2Fvictim/task` reads as three segments locally and possibly five at the
  origin. Now refused; deny rules are also tested against the decoded form. A follow-up round
  found the filter peeled only one layer — `%252F` passed where `%2F` was caught — so it now
  decodes to a fixpoint and fails closed on malformed encoding.
- **`parseDate` accepted any number as an epoch**, so `-5` became a 1969 due date and an
  over-long value became the year 5138, both rendering as success. Bounded to 2000–2100.

### Performance

Measured against 3.4.1 through a real `tools/list`:

| | 3.4.1 | 4.3.0 |
|---|---|---|
| Tool schemas, paid on every request | 88 tools, ~18,600 tok | 18 tools, 4,748 tok (`full`) · 2,236 (`read`) |
| One 100-task list | 4,063 tok | 736 tok |
| Round trips to list a named list | 4 | 1 |

The 100-task figure compares against 3.x's already-shaped default, not the raw API. Measuring
against raw would show −98%, but that is 3.x's opt-in `detail:"full"` mode, not what it returns.

## 3.4.1 — 2026-08-15

Fixes from a red-team round against the 3.4.0 auth layer. The round found no
bypass — 39/39 signature-matrix cases, 500/500 byte-mutants, and every hostile
JWKS response were rejected, and all nine cells of the credential matrix held.
These are the two real defects it did find.

### Fixed
- **Log/audit forgery from an unauthenticated caller (Medium).** `alg` and `kid`
  are read from the JWT header *before* the signature is checked, so they are
  fully attacker-controlled, and they reached the log unsanitised. A newline
  inside them let anyone who could reach the origin write arbitrary audit
  lines — including forged `authorized via bearer` and
  `authorized via access-user (admin@…)` successes. Reproduced: one request,
  two forged authorization records.

  Fixed at the chokepoint rather than the call sites: `log()` now escapes all
  C0/C1 control characters plus U+2028/U+2029 to `\xNN`. Every log line this
  server writes is one line by construction, so anything else came from
  interpolated data. `alg` and `kid` are additionally length-bounded at source.

  Worth noting how this was missed: the identity claim (`email`/`common_name`)
  *was* flagged and considered low-severity because it is admin-sourced and
  post-signature. The header fields sit earlier in the same function, need no
  valid signature at all, and were not considered. Sanitising per-call-site
  would have fixed the vector that was thought of and left the ones that
  weren't — hence the chokepoint.
- **`Authorization: bearer <token>` was rejected (Low).** RFC 7235 makes the
  auth-scheme case-insensitive; the check matched `Bearer ` literally. It failed
  closed, so this was never a security hole — but a client using the lowercase
  form would have looked like it was presenting a bad credential. Now matched
  case-insensitively, with one-or-more spaces or tabs allowed as the separator.
  The credential itself is still compared exactly, length-checked and in
  constant time.

### Not changed
- **Float `exp` is accepted.** RFC 7519 NumericDate permits a fractional value.
  Not a bypass.
- **`/health` reports the build stamp unauthenticated.** Deliberate — it is how
  version skew gets diagnosed, and it exposes nothing else.
- **A valid bearer still waits out the 5s JWKS timeout** when a JWT is present
  and the JWKS is hanging. Bounded and rare (a hanging JWKS means Access itself
  is degraded), and evaluating bearer first would cost the Access identity in
  the audit log. A circuit breaker is the fix if this ever matters.

## 3.4.0 — 2026-08-15

Third authentication mode: Cloudflare Access JWT validation.

### Added
- **`Cf-Access-Jwt-Assertion` validation.** Access signs a JWT onto every
  request it forwards; the origin now verifies it. RS256 signature against the
  team's JWKS (`https://<team>/cdn-cgi/access/certs`, cached 10 min), plus
  `exp`, `nbf`, `iss`, and that `aud` contains the configured application tag.
  New vars: `CF_ACCESS_TEAM_DOMAIN` (bare team name, hostname, or URL) and
  `CF_ACCESS_AUD`. Both must be set or the header is not trusted at all.
- **Both Access flows validate through one path.** A browser/OAuth login carries
  `email`; a service token carries `common_name`. Either satisfies the check and
  the resolved identity is logged, so requests are attributable.
- **Bearer auth is unchanged and still works.** A request is authorized by a
  valid Access JWT *or* a valid bearer token, so header-capable agents (n8n,
  Claude Code, curl) need no changes.
- `WWW-Authenticate` on 401s carrying RFC 9728 `resource_metadata`, and
  `MCP_PUBLIC_URL` to pin the origin used to build that hint.

### Security properties
- **Fails closed.** The only path returning success runs through a verified
  signature. An unreachable JWKS, an unknown `kid`, or any claim failure denies;
  a fetch failure can serve a cached key set but never skips verification.
- **`alg` is pinned to RS256.** `alg: none` and HS256-with-the-public-key
  confusion are both rejected — the token does not get to choose how it is
  verified. Covered by tests, not just by intent.
- The JWKS URL is derived from configuration only, never from the token.
- Unknown-`kid` refreshes are rate-limited so forged kids cannot be used to make
  the origin hammer Cloudflare.
- An invalid JWT never authenticates, but does not veto a caller holding a valid
  bearer token — Access injects the header on every forwarded request, so a
  clock or key-rotation blip would otherwise lock out clients presenting a
  second, valid credential.

### Note on OAuth discovery
The origin does **not** need to serve `/.well-known/oauth-*`. With Managed OAuth
enabled, Access acts as the authorization server and serves discovery at the
edge. See `deploy/DEPLOY.md` §5 for the caveat about which clients can actually
complete that flow.

## 3.3.2 — 2026-08-15

Deploy tooling only. No runtime changes.

### Fixed
- **`deploy/setup-vps.sh` would have produced a broken install.** It predated
  3.3.0 and contradicted the shipped systemd unit at four points: it used port
  8809 where the unit uses 8000, wrote secrets to `$INSTALL_DIR/.env` — the one
  location `MCP_STRICT_ENV` exists to stop the server trusting — cloned `main`
  rather than a tag, and carried an `--ignore-scripts` + `npm install typescript
  --no-save` + `npx tsc` dance that was a workaround for the `prepare` bug fixed
  in 3.3.1. Rewritten: pins a tag, builds via the normal `npm ci` +
  `npm prune --omit=dev` path, writes `/etc/clickup-mcp/env` as root `0600`,
  runs `systemd-analyze verify`, and health-checks `/health`. Idempotent, and
  non-interactive when `CLICKUP_API_TOKEN` is already in the environment.
- `deploy/DEPLOY.md` rewritten for the same reasons: port, `/healthz` → `/health`,
  secret location, tag pinning, and an update path that no longer assumes
  `typescript` is installed (it is pruned).

### Added
- **DEPLOY.md now documents that Cloudflare Access and the claude.ai connector
  cannot coexist on one hostname.** claude.ai's connector cannot send
  `CF-Access-Client-Id` / `CF-Access-Client-Secret`, so a service-token policy
  blocks it outright. The fix is two hostnames on the same tunnel — one behind
  Access for header-auth clients, one bypassed for the connector — with the
  app's bearer check still running on both.

## 3.3.1 — 2026-08-15

Both fixes came out of a real install on the target host rather than a test
environment.

### Fixed
- **`npm ci --omit=dev` failed outright.** The `prepare` lifecycle script ran
  `npm run build` unconditionally, but npm runs `prepare` on production-only
  installs too — where `tsc` isn't present. The result was
  `sh: tsc: command not found`, npm code 127, and no `build/` directory: a
  perfectly reasonable production install command, broken. `prepare` now runs
  `scripts/prepare.mjs`, which builds when the toolchain is present (the
  `npm install <git-url>` case, where npm does install devDependencies for
  exactly this) and skips with an explanatory message when it isn't.
- **Transitive `hono` advisory.** `hono@4.12.33` arrives under
  `@modelcontextprotocol/sdk` → `@hono/node-server`, which
  `StreamableHTTPServerTransport` imports at top level, so it is genuinely
  loaded. Updated to `4.13.2`; production audit is now clean.

  The four advisories are in `hono/cors`, `hono/jsx`, `hono/proxy` and
  `hono/language` — none of which anything outside the SDK's `examples/`
  directory imports, so the vulnerable paths were never reachable here. Updated
  anyway: "not currently exploitable" is a worse property to depend on than
  "not present," particularly for a process being exposed to the internet.

### Note on `npm audit`
A full `npm ci` reports ~10 vulnerabilities; 9 are in devDependencies (eslint 8,
which is EOL, and its `glob`/`rimraf`/`inflight` chain) and never ship. Audit
the tree you actually deploy: `npm audit --omit=dev`.

## 3.3.0 — 2026-08-15

Deployment hardening for running as an unattended systemd service. No tool
behaviour changes; the surface is still 88 tools / 148 operations.

### Added
- **`MCP_STRICT_ENV=1`** — the posture for a server deployment. Secrets must
  come from the environment: the `.env`-file lookup is disabled, no auth token
  is ever generated or persisted, and the process exits `1` with an actionable
  message if `MCP_AUTH_TOKEN` or `CLICKUP_API_TOKEN` is missing. The file lookup
  deliberately outranks `process.env` (a desktop host rewrites its own config,
  so the file has to win there) — which is exactly backwards on a server, where
  a stray `.env` would silently outrank the systemd unit.
- **Configurable bind address.** `MCP_HTTP_HOST` (default `127.0.0.1`) and
  `MCP_HTTP_PORT` (default `8000`). Previously the listener took no host
  argument at all and bound every interface — behind a tunnel on a host with a
  public IP, that exposed the server directly. `MCP_TRANSPORT=http` selects HTTP
  without having to set a port.
- **`GET /health`** alongside the existing `/healthz` and `/`.
- **Strict mode refuses the URL-path token form** (`/mcp/<token>`), which exists
  because claude.ai's connector UI has no custom-header field, but puts the
  credential somewhere proxy and CDN access logs keep. Re-enable with
  `MCP_ALLOW_TOKEN_IN_PATH=1`.

### Fixed
- **`server_info` reported `transport: "stdio"` while serving HTTP.** It keyed
  off `MCP_HTTP_PORT` rather than the resolved transport, so any HTTP deployment
  using the default port misreported itself — a wrong answer from the one tool
  whose entire job is telling you what is running.
- HTTP mode logs to **stdout** (systemd's expectation) instead of stderr. stdio
  mode still logs to stderr, where it must: stdout is the JSON-RPC channel.
- **SIGTERM shutdown no longer stalls.** `httpServer.close()` alone waits on idle
  keepalive sockets; shutdown now drops them via `closeAllConnections()` and
  hard-exits after 5s if a request hangs.
- `deploy/clickup-mcp.service`: `StartLimitIntervalSec`/`StartLimitBurst` were
  under `[Service]`, where systemd silently ignores them — so the restart
  rate-limit never applied and a missing secret would have hot-looped. Moved to
  `[Unit]`; unit now passes `systemd-analyze verify` clean. Secrets moved out of
  `WorkingDirectory` to `/etc/clickup-mcp/env`, and the hardening block extended
  (no writable paths, `SystemCallFilter`, `RestrictAddressFamilies`, `MemoryMax`).

### Verified on target
Ubuntu 24.04.4 LTS / `aarch64` / Node 22.11.0: `npm ci` needs no native build
(0 `.node` binaries in the tree), 96 production packages, 26 MB `node_modules`,
~98 MB idle RSS, and zero disk writes under strict mode. 72 unit tests pass
(4 new, covering strict-mode refusals and path-token rejection).

## 3.2.0 — 2026-08-14

Fixes from round 3 of adversarial testing. Round 3 verified 5/5 of the 3.0.x
fixes and 6/6 of the 3.1.0 fixes still working, then found these.

### Fixed
- **Goal key results could be created but never changed.** `update` and
  `delete` 404'd on ids that provably existed: those routes live at
  `/key_result/{id}`, not nested under the goal — even though `create` *is*
  nested. Also exposed `steps_current` and `note`, so progress can be recorded.
- **Two of three attachment actions were dead.** There is no
  `GET /task/{id}/attachment` route (405) — `list` now reads attachments off
  the task object. Attach-by-URL sent JSON to a multipart-only endpoint
  (`ATTCH_045`), and a URL inside a multipart field is refused (`ATTCH_039`),
  so the URL is now fetched server-side and the bytes uploaded (25MB cap).
- **`labels` custom fields were uncreatable.** `drop_down` options want
  `{name}`, `labels` want `{label}` (`FIELD_146`). Now keyed per type.
- **Stringified numbers made documented inputs unreachable.** MCP clients
  routinely send numbers as strings on union-typed fields, and
  `Date.parse("1786745000000")` is `NaN` — so a Unix-ms date was rejected at
  top level while the identical value worked inside `tasks_create_bulk`.
  `coerceDate` now accepts epoch strings (seconds or ms). Same class on
  `views.type`, where zod rejected `"2"` before the resolver could map it;
  unknown type strings now error with the list of valid ones.
- **Status rename/delete silently reassigned tasks.** ClickUp moves every task
  in that status to the list's default open status with no warning. Both
  actions now count the affected tasks first and return an explicit `warning`
  plus `tasks_reassigned`.
- **Blank error bodies.** ClickUp's v3 API reports errors under `message`,
  which the extraction chain never read — every v3 error surfaced as a bare
  `error (400) on POST /x:`. Added `message`, plus a per-status fallback so an
  empty body can never produce an unactionable error again.

## 3.1.0 — 2026-08-14

Fixes from the round-1/round-2 defect table (45 rows), plus a diagnostic for a
recurring operational problem.

### Added
- **`server_info`** — reports the running build's timestamp. MCP hosts spawn
  their own server process at session start and hold it, so a rebuild never
  reaches an already-running session. Version skew had caused several phantom
  "the fix didn't work" reports; this makes it visible. Build stamp also
  appears on `/healthz`.
- `statuses` gained `replace_all`, `status_type`, and `new_name`.

### Fixed
- **`statuses` rewritten.** Every action was a read-modify-write with no
  precondition check: `delete` on a name that wasn't present removed nothing
  and reported success; name matching was case-sensitive while ClickUp stores
  names lower-cased; and `reorder` was a destructive replace-all that deleted
  any status omitted from the array. `reorder` is now a true permutation-only
  reorder, `replace_all` is the honestly-named destructive path, `create`
  supports status types and rejects duplicates, and `delete` refuses to remove
  the list's only `open` status.
- `tasks_move_bulk` reported "Moved 2 of 2 tasks" when the same task was listed
  twice; duplicates are now rejected up front.
- `time_entry_update` / `_delete` reported success for entries that never
  existed (ClickUp answers `200 {"data":null}`); now surfaced as not-found.
- `project_intelligence health` inlined every task object, burying its own
  aggregates on a 150-task list. Capped at 25 with
  `tasks_included`/`tasks_truncated`; aggregates still cover everything.
- `docs pages_update` returned a bare `{}` on the one operation where a mistake
  is unrecoverable; now echoes page id, mode, and resulting content length.
- `tasks_update` gained `parent`, so re-parenting is possible at all.
- `tasks_list` `page` is now `int().min(0)` (was 500-ing on `-1`).
- `tags` `name` / `tag_name` descriptions disambiguated.

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
