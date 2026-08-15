# Deployment Brief — ClickUp MCP Server v3.3.2

> Evidence transcripts below were captured on 3.3.0. Since then 3.3.1 changed
> only the `prepare` script and a transitive dependency version, and 3.3.2 only
> `deploy/` docs and the setup script. Runtime behaviour, tool surface, and the
> env contract are identical.

Answers to the deployment questionnaire, with evidence. Target: Ubuntu 24.04
Minimal / aarch64 / Oracle A1, behind Cloudflare Tunnel at
`api.groveunited.com/mcp` with Cloudflare Access service-token auth at the edge.

---

## Transport — answered first

**The server speaks streamable HTTP.** Not stdio-only. No transport rewrite.

`src/index.ts` imports `StreamableHTTPServerTransport` from
`@modelcontextprotocol/sdk` and serves it over Node's `http` module in
**stateless** mode (a fresh `McpServer` + transport per request, no session
state). stdio remains the default for local hosts; HTTP is selected by
`MCP_TRANSPORT=http` or by setting `MCP_HTTP_PORT`.

SSE is not used as a separate transport — streamable HTTP responds with
`content-type: text/event-stream` on tool calls, which is the current MCP spec's
mechanism.

**Four of the seven requirements were not met by 3.2.0 and were fixed for this
deployment.** They are called out under each item below rather than quietly
patched.

---

## Requirements

### 1. HTTP transport, configurable host/port, default `127.0.0.1:8000`, no TTY

**Met — required a fix.** 3.2.0 called `httpServer.listen(port, cb)` with **no
host argument**, so it bound `0.0.0.0` — every interface. On a VM with a public
IP that publishes the server directly, bypassing the tunnel. There was also no
port default; HTTP mode only engaged if `MCP_HTTP_PORT` was set.

Now `MCP_HTTP_HOST` (default `127.0.0.1`) and `MCP_HTTP_PORT` (default `8000`),
with `MCP_TRANSPORT=http` to select the transport without pinning a port.
Verified with `ss`, not assumed:

```
State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process
LISTEN 0      511        127.0.0.1:8000      0.0.0.0:*    users:(("node",pid=2655,fd=18))
```

No TTY: started with `< /dev/null` and no controlling terminal throughout.

### 2. ARM64

**Met, with no caveats.** Dependencies are `@modelcontextprotocol/sdk` and
`zod`, both pure JavaScript. `npm ci` runs with **zero native builds**; there is
no node-gyp step that can fail on aarch64.

```
uname -m : aarch64
PRETTY_NAME="Ubuntu 24.04.4 LTS"
dpkg arch: arm64
node     : v22.11.0 (arm64/linux)
npm ci: OK (no native builds required)
native binaries found: 0        # find node_modules -name '*.node' -o -name binding.gyp
tsc build: OK
```

**Nothing x86-only to flag.**

### 3. Bearer token auth in the app

**Met.** Rejects any request to `/mcp` without a valid token, compared with
`crypto.timingSafeEqual`. Transcripts in the Evidence section.

One change for this deployment: 3.2.0 also accepted the token in the URL path
(`/mcp/<token>`), which exists because claude.ai's connector UI has no
custom-header field. URLs land in proxy and CDN access logs in a way headers do
not, so **strict mode accepts the `Authorization` header only**. Re-enable with
`MCP_ALLOW_TOKEN_IN_PATH=1` if the claude.ai connector is ever pointed here
directly.

### 4. All secrets from environment variables

**Met — required a fix, and this one is subtle.**

Two problems existed in 3.2.0:

- If `MCP_AUTH_TOKEN` was unset, the server **generated a token and wrote it to
  `.mcp-auth-token`** in the working directory. Convenient on a laptop; on a
  server it means starting with a credential nobody configured.
- The ClickUp client's `.env`-file lookup **deliberately outranks
  `process.env`**, because Claude Desktop rewrites its own config from memory on
  quit and kept reverting a rotated token. That precedence is correct on a
  laptop and backwards on a server: a stray `.env` in `WorkingDirectory` would
  silently outrank `EnvironmentFile`, and a credential rotation would appear to
  succeed while the old token stayed in use.

**`MCP_STRICT_ENV=1`** resolves both: `.env` lookup disabled, no token ever
generated or persisted, and the process exits `1` with an actionable message if
a required secret is missing.

### 5. Unauthenticated `/health` returning 200

**Met — added.** 3.2.0 served `/healthz` and `/`; `/health` was not a route.
All three now respond. No auth, no ClickUp API call, no workspace data.

### 6. Foreground, logs to stdout, clean SIGTERM

**Met — required a fix.** All logging went to **stderr**, because in stdio mode
stdout is the JSON-RPC channel and anything written there corrupts the protocol.
HTTP mode has no such constraint, so it now logs to stdout; stdio mode still
uses stderr, where it must.

SIGTERM previously called `httpServer.close()` alone, which waits on idle
keepalive sockets and can stall until `TimeoutStopSec`. It now also calls
`closeAllConnections()` and hard-exits after 5s if a request hangs.

### 7. Restart-safe, no local state

**Met under strict mode.** The only disk write anywhere in `src/` is the
auth-token file, which strict mode never creates. Confirmed after a full run:

```
.mcp-auth-token created? no
```

**No tool writes to local disk.** Attachment upload streams through memory to
ClickUp (25 MB cap) and never touches the filesystem. The server reads `.env`
only outside strict mode.

---

## Environment variables

**Required:**

| Variable | Value |
|---|---|
| `CLICKUP_API_TOKEN` | ClickUp personal API token (`pk_…`) |
| `MCP_AUTH_TOKEN` | Bearer token, min 16 chars. `openssl rand -hex 24` |

**Required for this deployment posture:**

| Variable | Value |
|---|---|
| `MCP_TRANSPORT` | `http` |
| `MCP_STRICT_ENV` | `1` |
| `MCP_HTTP_HOST` | `127.0.0.1` |
| `MCP_HTTP_PORT` | `8000` |

**Optional:** `MCP_ALLOW_TOKEN_IN_PATH=1` (re-enable URL-path token),
`MCP_NO_ENV_FILE=1` (implied by strict mode), `WEBHOOK_*` (separate receiver
process, not needed here).

### Run command

```bash
CLICKUP_API_TOKEN=… MCP_AUTH_TOKEN=… \
MCP_TRANSPORT=http MCP_STRICT_ENV=1 \
MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_PORT=8000 \
node build/index.js
```

Build from source first:

```bash
git clone --branch v3.3.2 --depth 1 \
  https://github.com/benthesoundguy/clickup-mcp-server.git clickup-mcp
cd clickup-mcp
npm ci             # installs devDeps; `prepare` builds automatically
npm run build      # optional — `prepare` already ran tsc
npm prune --omit=dev
```

Clone the **tag**, not `main` — a service should not silently move version on
redeploy.

`npm ci --omit=dev` alone is *not* enough: it skips `tsc`, so `build/` is never
produced. Install full, build, then prune. (Before 3.3.1 that command failed
outright with `tsc: command not found`; it now exits cleanly but still leaves no
build output, so the order above matters.)

### On `npm audit`

A full `npm ci` reports ~10 vulnerabilities. **Nine are devDependencies**
(eslint 8 and its `glob`/`rimraf`/`inflight` chain) and are removed by
`npm prune --omit=dev`. Audit what you deploy:

```bash
npm audit --omit=dev     # → found 0 vulnerabilities  (as of 3.3.1)

```

`deploy/clickup-mcp.service` is a ready systemd unit — it passes
`systemd-analyze verify` clean, reads secrets from `/etc/clickup-mcp/env`
(deliberately outside `WorkingDirectory`, see §4), and runs with
`ProtectSystem=strict` and no writable paths.

---

## Evidence

### Startup log (stdout, strict mode, no TTY, port defaulted)

```
[ClickUp MCP] v3.3.0 listening on http://127.0.0.1:8000 (streamable HTTP, stateless, bearer auth)
[ClickUp MCP] build 2026-08-15T03:41:33.633Z · process started 2026-08-15T03:41:33.669Z · node v22.11.0 · arm64/linux
[ClickUp MCP] strict env mode: ON (env-only secrets, no local state)
[ClickUp MCP] ready
--- stderr (expect empty) ---
--- end stderr ---
```

### Rejected: no bearer token

```
$ curl -i -X POST http://127.0.0.1:8000/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

HTTP/1.1 401 Unauthorized
{"error":"unauthorized"}
```

Wrong token → `HTTP 401`. Token in URL path under strict mode → `HTTP 401`.

### Accepted: real tool call

```
$ curl -i -X POST http://127.0.0.1:8000/mcp \
    -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"server_info","arguments":{}}}'

HTTP/1.1 200 OK
data: {"result":{"content":[{"type":"text","text":"{\"name\":\"clickup-mcp-server\",\"version\":\"3.3.0\",\"build\":\"build 2026-08-15T03:41:33.633Z · process started 2026-08-15T03:41:33.668Z\",\"transport\":\"http\",\"node\":\"v22.11.0\",\"arch\":\"arm64/linux\"}"}]},"jsonrpc":"2.0","id":1}
```

### Accepted: real ClickUp API call end-to-end

```
$ curl -X POST … -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"workspaces_list","arguments":{}}}'

data: {"result":{"content":[{"type":"text","text":"[{\"id\":\"90141017660\",\"name\":\"Grove United\",\"color\":\"#40BC86\",…"}]},"jsonrpc":"2.0","id":2}
```

### Health probe, unauthenticated

```
$ curl -i http://127.0.0.1:8000/health

HTTP/1.1 200 OK
{"ok":true,"name":"clickup-mcp-server","version":"3.3.0","build":"build 2026-08-15T03:41:33.633Z · …"}
```

### SIGTERM

```
[ClickUp MCP] SIGTERM received, shutting down
[ClickUp MCP] closed cleanly
exited on SIGTERM
```

### Strict-mode refusals (exit codes matter for `Restart=on-failure`)

```
no MCP_AUTH_TOKEN    -> exit 1
[FATAL] MCP_STRICT_ENV=1 requires MCP_AUTH_TOKEN to be set in the environment.
no CLICKUP_API_TOKEN -> exit 1
[FATAL] MCP_STRICT_ENV=1 requires CLICKUP_API_TOKEN to be set in the environment.
```

---

## Tool list — 88 registered (148 operations)

Count returned by `tools/list` over authenticated HTTP: **88**.

The gap between 88 and 148 is 14 consolidated multi-action tools (`views`,
`docs`, `statuses`, `channels`, `webhooks`, `custom_fields_values`, …) that
dispatch on an `action` parameter.

```
attachments channels channels_members channels_messages checklists_create
checklists_delete checklists_items_create checklists_items_delete
checklists_items_update checklists_update comments_delete comments_replies_create
comments_replies_list comments_update custom_fields custom_fields_values
dependencies docs folders_create folders_delete folders_update goals_create
goals_delete goals_get goals_key_results_create goals_key_results_delete
goals_key_results_update goals_list goals_update groups guests_attach
guests_detach guests_get guests_invite guests_remove guests_update
lists_comments_create lists_comments_list lists_create
lists_create_from_template_in_folder lists_create_from_template_in_space
lists_create_in_space lists_delete lists_get lists_list_in_space
lists_members_list lists_search lists_update project_intelligence
reminders_create server_info spaces statuses tags tags_assign tags_unassign
tasks_comments_create tasks_comments_list tasks_create tasks_create_bulk
tasks_delete tasks_get tasks_link tasks_list tasks_members_list tasks_move
tasks_move_bulk tasks_unlink tasks_update tasks_update_bulk templates
time_entries_list time_entry_create time_entry_delete time_entry_update
time_tracking_current time_tracking_start time_tracking_stop users_invite
users_list users_remove users_update views views_comments_create
views_comments_list webhooks workspaces_list workspaces_seats_get
```

**Note for a shared/remote deployment:** `users_*` and `guests_*` mutate real
workspace membership and can affect billing seats. Nothing in the server gates
them. If this endpoint is reachable by more than one agent, consider a tool
allowlist at the proxy.

---

## Footprint

| | |
|---|---|
| Production packages (transitive) | **96** |
| `node_modules` (prod only) | **26 MB** |
| `build/` | **896 KB** |
| Node 22 runtime | 110 MB |
| **Idle RSS** | **~98 MB** |
| Native/compiled deps | **0** |

Idle RSS is higher than a minimal Node service (~40–50 MB baseline); the delta
is 88 tools' zod schemas constructed at startup. Comfortable on 12 GB. The unit
sets `MemoryMax=1G` as a runaway ceiling.

---

## Operational notes

**Concurrency.** Stateless HTTP builds a fresh `McpServer` per request, so
there is no cross-request session state and restarts are transparent to clients.

**Rate limits.** ClickUp allows ~100 requests/minute per token. That budget is
per *token*, not per client — several agents sharing this endpoint share one
budget. The client retries 429s with backoff honoring `Retry-After`, capped at
15s.

**Known gap.** No compare-and-swap on read-modify-write paths (statuses, view
update). Two clients mutating the same list's statuses concurrently can lose an
update, silently. A single-agent deployment won't hit this; a multi-agent one
might.

**Debugging.** Call `server_info` first — it reports the build stamp, so a
"the fix didn't work" report can be checked against what is actually running.
The stamp is also on `/health`.
