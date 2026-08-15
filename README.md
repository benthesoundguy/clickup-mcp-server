# ClickUp MCP Server

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node.js Version"></a>
  <a href="https://github.com/modelcontextprotocol/typescript-sdk"><img src="https://img.shields.io/badge/MCP%20SDK-1.x-orange" alt="MCP SDK"></a>
</p>

A Model Context Protocol server for ClickUp, built around two ideas:

**Everything takes human names.** `find(scope: "Cavalry/Findings", assignee: "me", due: "overdue")` — no IDs, no walking the tree to discover them. Names that don't resolve raise an error listing the valid options, because a confidently empty result is worse than a failure.

**You choose what it can do.** Four capability profiles, enforced on every outgoing request. Hand an unattended agent the `agent` profile and it can create tasks and comments but cannot alter or delete anything that already exists.

18 tools, 320 tests. Version **4.3.0** — see [CHANGELOG.md](CHANGELOG.md). A heavily renovated fork of [nsxdavid/clickup-mcp-server](https://github.com/nsxdavid/clickup-mcp-server).

> **Status:** 4.x is new. It has been through five adversarial red-team rounds but has not yet run in production. The previous 3.x line is still shipped in this repo and still what the reference deployment runs — see [Running 3.x](#running-3x).

## Quick start

Get a token from **ClickUp → Settings → Apps → API Token** (it starts with `pk_`). The workspace is discovered automatically — there is nothing else to configure.

**No install:**

```json
{
  "mcpServers": {
    "clickup": {
      "command": "npx",
      "args": ["-y", "github:benthesoundguy/clickup-mcp-server"],
      "env": { "CLICKUP_API_TOKEN": "pk_your_token_here" }
    }
  }
}
```

**Or from a clone**, which is what you want if you plan to change anything:

```bash
git clone https://github.com/benthesoundguy/clickup-mcp-server
cd clickup-mcp-server
npm install          # builds automatically
npm run check        # verifies the token and connects — do this before wiring up a client
```

```json
{
  "mcpServers": {
    "clickup": {
      "command": "node",
      "args": ["/absolute/path/to/clickup-mcp-server/build/v4/index.js"],
      "env": { "CLICKUP_API_TOKEN": "pk_your_token_here" }
    }
  }
}
```

### Where that block goes

The shape above works as-is in **Claude Desktop**, **Claude Code**, **Cursor**, **Cline**, and **Windsurf** — they all use the `mcpServers` key. Two clients differ:

- **VS Code** (`.vscode/mcp.json`) uses `servers` instead of `mcpServers`. Same inner shape. Copying a Cursor config unchanged is the most common setup mistake.
- **Zed** (`settings.json`) uses `context_servers`, and nests the command:
  ```json
  { "context_servers": { "clickup": { "command": { "path": "node", "args": ["/path/to/build/v4/index.js"] } } } }
  ```

**Claude Code** can skip the file entirely:

```bash
claude mcp add clickup --env CLICKUP_API_TOKEN=pk_... -- npx -y github:benthesoundguy/clickup-mcp-server
```

### Putting the token in a file instead

If you would rather not paste a token into a client config — desktop apps rewrite those files and can persist a stale copy — put it in a `.env` next to the install and omit the `env` block entirely:

```bash
echo 'CLICKUP_API_TOKEN=pk_your_token_here' > .env
```

The server looks in `<cwd>/.env`, `<install>/.env`, and `<install>/../.env`, in that order, and says which one it used at startup. The token from the file **outranks** the environment, so rotating it in one place actually takes effect. Every other setting works the other way round — an explicit value in your client config always wins, so a stray `.env` can never widen `MCP_PROFILE`. Set `MCP_STRICT_ENV=1` on a server to switch the whole lookup off.

### When it doesn't work

```bash
npm run check          # from a clone
node build/v4/index.js --check
```

This prints every input the server resolved — which `.env` it found and what it applied, whether the token is present and the right shape, the active profile and tool count, the Node version and build stamp — and then actually connects to ClickUp and reports who you are and your rate budget. It never prints the token, so the output is safe to paste into an issue.

If the token is missing, the server does **not** die silently in stdio mode. It starts, registers its tools, and every call answers with what's wrong and how to fix it, so the problem shows up in your conversation rather than in a log file you have to go find. (In HTTP mode it still exits `1` — an unattended deployment should fail loudly.)

## Capability profiles

One binary, four profiles, selected with `MCP_PROFILE`. Install once and add a client entry per profile, enabling whichever a given agent should have.

| `MCP_PROFILE` | tools | schema cost | What it can do |
|---|---|---|---|
| `read` | 11 | 2,236 tok | Observe only. **No write of any kind can leave the process.** |
| `agent` | 12 | 2,635 tok | Read, plus **append**: create tasks, comments, chat messages, checklist items, time logs. Cannot alter or delete anything existing. |
| `core` *(default)* | 16 | 4,129 tok | Everything a normal user does. No membership, guest, or webhook administration. |
| `full` | 18 | 4,748 tok | Unrestricted, including membership and webhooks. |

Schema cost is what the tool definitions consume in the model's context on **every** request, before any work happens. For comparison, 3.x costs ~18,600 tokens for 88 tools.

**`agent` is the interesting one.** It can add but never alter or destroy, so the worst an unattended agent can do is create clutter you can delete. That guarantee is enforced in three layers, and only the third is a security boundary:

1. **Tool filtering** — which tools appear at all *(context cost + tool selection)*
2. **Action filtering** — which actions a tool advertises *(context cost + honesty)*
3. **Write policy** — an allowlist checked on every outgoing request, including uploads ← **the guarantee**

Layers 1 and 2 depend on every tool being tagged correctly by every future contributor. Layer 3 does not: it inspects the actual request on its way out, so a mistagged tool, a refactor, or an endpoint added next year cannot widen a profile. The test suite proves this by calling `core`-only handlers *directly* with an `agent` context — bypassing layers 1 and 2 entirely — and asserting nothing reaches the wire.

Things that look additive but are excluded from `agent` on purpose: attaching a tag, setting a custom field, and adding a dependency all mutate an *existing* task; creating a webhook starts streaming your data to an external endpoint. **Append-only and safe are not the same property.**

### Why the default is `core` and not `full`

`full` grants membership administration — inviting a user consumes a billable seat, removing one changes a real person's access — plus webhooks, which send workspace data off-site. None of that is what a first connection is for, and a default nobody changes has to be the safe one. Ask for administration by name when you want it; until you do, the refusal tells you exactly how.

### Attachments and the filesystem

`attach` reads a file from the machine the server runs on. That is a resource the write policy cannot see — it inspects URLs, and a file read has no URL — so it is governed separately by `CLICKUP_ATTACH_ROOT`:

- **Set** → reads are confined to that directory. Containment is checked against the file's *real* path, after resolving `..` and every symlink.
- **Unset** → `core` and `full` may read any file the process can. Under `agent`, **`attach` is not offered at all** (12 tools instead of 13), because there is no safe default root: the working directory is usually the project directory, which is where `.env` lives.

A misconfigured root is fatal at startup rather than ignored — a boundary that silently isn't there is worse than none.

## Tools

| Tool | Min profile | Job |
|---|---|---|
| `find` | read | Query tasks anywhere. Scope, status, assignee, tags, due date — all by name. |
| `task` | read | One task in full, optionally with comments and subtasks. |
| `tree` | read | Workspace structure, printing the exact paths other tools accept. |
| `meta` | read | What values are legal here — statuses a list accepts, tags in a space, assignable people. |
| `whoami` | read | Identity, workspace, rate-limit budget, server health. |
| `docs` | read | Search ClickUp Docs, or read one. |
| `comment` | read | Read a task's comment thread, or post to it. |
| `time` | read | `start` · `stop` · `current` · `log` · `report` |
| `fields` | read | Inspect a list's custom fields, or set one by name. |
| `chat` | read | `channels` · `read` · `post` · `members` |
| `checklist` | read | `list` · `add` · `add_item` · `rename` · `remove` · `check` · `uncheck` |
| `create` | agent | Create one or more tasks — pass an array for bulk. |
| `attach` | agent | Upload a local file to a task (max 25MB). See above. |
| `update` | core | Update, move, assign, close, or delete — pass several IDs for bulk. |
| `lists` | core | `create` · `rename` · `delete` for lists and folders. Deletes need `confirm: true`. |
| `goals` | core | `list` · `get` · `create` · `update` · `delete`, including key results. |
| `people` | full | Members, guests, seats, groups, invitations, admin rights. |
| `webhooks` | full | `list` · `create` · `delete` |

Tools narrow rather than vanish where it makes sense: under `read`, `comment` shows only its reading arguments and `checklist` advertises only `list`, so the schema tells the truth about what this connection can do instead of advertising actions that would be refused.

## The rule everything follows

**Never return a confident wrong answer.** ClickUp makes this easy to get wrong, because it answers bad input with cheerful nonsense:

| Request | ClickUp says | Which reads as |
|---|---|---|
| `?assignees[]=99999999` | `200 {"tasks":[]}` | "Sam has no work" — there is no Sam |
| `?query=anything` | `200` + unfiltered results | a filtered search that wasn't |
| `POST /list/{dest}/task/{id}` | `200 {}` | "moved" — it didn't move |
| `PUT /task/{id}` with `list_id` | `200` | "moved" — silently ignored |
| `GET /task/{bad-id}` | `401 Team not authorized` | a permissions problem — it's a typo |
| `?order_by=bogus` | `500` | an outage — it's a bad enum |

So this server resolves names and **raises on ambiguity** ("Findings" matching four lists is an error naming all four, never a coin flip); **raises rather than returning empty** when a filter value doesn't resolve; **validates enums client-side** against what the list actually accepts; **verifies writes it cannot trust** by reading the object back; and **never overstates a count** — a query that stopped paging reports `100+ matches`, and any client-side filter reports how much it actually scanned.

Errors say what failed, why, and what to do next, with the valid options listed.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `CLICKUP_API_TOKEN` | — | **Required.** ClickUp personal API token. |
| `MCP_PROFILE` | `core` | `read` · `agent` · `core` · `full`. Invalid values are fatal, never silently downgraded. |
| `CLICKUP_ATTACH_ROOT` | unset | Absolute directory that `attach` may read from. Required for `attach` under `agent`. |
| `CLICKUP_WORKSPACE_ID` | discovered | Only needed if the token can see several workspaces and you want a specific one. |
| `MCP_TRANSPORT` | `stdio` | Set to `http` for streamable HTTP. |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address. Loopback by default — put a proxy or tunnel in front rather than binding `0.0.0.0`. |
| `MCP_HTTP_PORT` | `8000` | Also selects HTTP mode if set. |
| `MCP_AUTH_TOKEN` | generated | Bearer token, min 16 chars. Without it the server generates one and persists it to `.mcp-auth-token` (0600). |
| `MCP_STRICT_ENV` | off | **Set to `1` for servers** — see below. |
| `MCP_ALLOW_TOKEN_IN_PATH` | off in strict | Re-enables the `/mcp/<token>` URL form under strict mode. |
| `MCP_NO_ENV_FILE` | off | Disables the `.env` file lookup (implied by strict mode). |
| `CF_ACCESS_TEAM_DOMAIN` | — | Cloudflare Access team. Enables Access JWT validation. |
| `CF_ACCESS_AUD` | — | Access application AUD tag. Required alongside the team domain — neither alone enables anything. |
| `MCP_PUBLIC_URL` | derived | Public origin used in the `WWW-Authenticate` discovery hint. |

## Remote mode (Claude web + mobile)

The server speaks **streamable HTTP** for claude.ai custom connectors, which sync to the Claude mobile app:

```bash
MCP_TRANSPORT=http MCP_AUTH_TOKEN=$(openssl rand -hex 24) \
MCP_PROFILE=core CLICKUP_API_TOKEN=... node build/v4/index.js
```

Every request must present the auth token (`Authorization: Bearer <token>`, or in the path as `/mcp/<token>` — the form claude.ai's connector UI needs). `GET /health` is an unauthenticated probe that reports the version, active profile, tool count, and attachment root.

### Cloudflare Access (optional third auth mode)

Set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` and the server validates the `Cf-Access-Jwt-Assertion` header Access puts on every request it forwards: RS256 against the team JWKS, plus `exp`, `iss`, and `aud`. Both Access flows validate through one path — a browser login carries `email`, a service token carries `common_name`.

This is defence in depth. A request reaching the origin *without* passing through Access — a tunnel misconfiguration, a second ingress, something on the host's network — cannot impersonate an Access-authenticated caller. It fails closed: `alg` is pinned to RS256 (so `alg: none` and HS256 confusion are rejected), an unreachable JWKS denies rather than bypasses, and the JWKS URL comes from configuration, never from the token.

**Bearer auth keeps working.** A request is authorized by a valid Access JWT *or* a valid bearer token, so header-capable agents need no changes.

The origin does **not** serve `/.well-known/oauth-*` — with Managed OAuth enabled, Access is the authorization server and serves discovery at the edge.

### Strict mode (`MCP_STRICT_ENV=1`)

The posture for an unattended deployment. Secrets must come from the environment, the server never invents or persists a credential, and it exits `1` with an actionable message rather than starting misconfigured. It also refuses the URL-path token form, which lands the credential in proxy access logs.

This matters because the `.env`-file lookup deliberately outranks `process.env` — a desktop host rewrites its own config file from memory on quit, so the file has to win there. On a server that precedence is backwards: a stray `.env` in the working directory would silently outrank the systemd unit. Strict mode turns the lookup off.

See [deploy/DEPLOY.md](deploy/DEPLOY.md) for the full recipe: VPS setup script, hardened systemd unit, Cloudflare Tunnel, and connecting it to Claude.

## Upgrading from 3.x

The tool names are entirely different — 4.x is a rewrite, not a rename. Anything holding hard-coded 3.x tool names (saved prompts, agent instructions, scripts) needs updating.

The mapping is mostly many-to-one:

| 3.x | 4.x |
|---|---|
| `workspaces_list`, `spaces`, `lists_search`, `lists_list_in_space` | `tree` |
| `tasks_list` | `find` |
| `tasks_get` | `task` |
| `tasks_create`, `tasks_create_bulk` | `create` |
| `tasks_update`, `tasks_delete`, `tasks_move`, `tasks_link`, `tags_assign`, `dependencies` | `update` |
| `lists_create`, `lists_update`, `lists_delete`, `folders_*` | `lists` |
| `statuses list`, `tags list`, `custom_fields list` | `meta` |
| `users_*`, `guests_*`, `groups`, `workspaces_seats_get` | `people` |
| `time_*` | `time` |
| `*_comments_*`, `comments_*` | `comment` |
| `checklists_*` | `checklist` |
| `channels*` | `chat` |

**Not carried over:** `project_intelligence` (the eight local analysis reports) and `reminders_create`. Status *management* — creating, renaming, reordering statuses — is also absent; `meta` reads statuses but does not change them. If you need any of these, run 3.x.

### Running 3.x

3.x is still built and shipped from this repo:

```bash
npm run start:v3       # via the package script
node build/index.js    # the 3.x entry point directly
```

Point an MCP client at `build/index.js` instead of `build/v4/index.js` to keep using it.

The reference systemd unit in `deploy/` is deliberately still pinned to 3.x, because a running service should not change major version because a package default moved underneath it. Migrate it by pointing `ExecStart` at `build/v4/index.js` and setting `MCP_PROFILE` explicitly.

## Known ClickUp API limitations

Not bugs here — the API genuinely lacks these, and this server reports the limit rather than faking around it.

- **Tasks cannot be moved between lists.** `POST /list/{dest}/task/{id}` returns `200 {}` and does nothing without the "Tasks in Multiple Lists" ClickApp; `PUT` with `list_id` is silently ignored; `/move` 404s. `update`'s move path reads the task back and fails loudly rather than reporting a move that didn't happen.
- **Attachments have no list endpoint** — `task` reads them off the task object. Uploads are multipart-only, capped at 25MB.
- **Docs** cannot be renamed or deleted, and pages cannot be deleted.
- **Custom field definitions** can be listed and created, not edited or deleted.
- **Date custom fields require Unix milliseconds**; `YYYY-MM-DD` is rejected by ClickUp for those. Task `due_date`/`start_date` accept both and are converted here.
- **Status and tag names are stored lower-cased**; matching here is case-insensitive throughout.
- **Lists override their space's statuses constantly**, so "what statuses are valid" is a per-list question. `meta` answers it per list.
- ClickUp answers an invalid enum with **HTTP 500**, so enums are validated client-side before sending.
- The rate limit is roughly **100 requests/minute per token**, shared across everything using it. `whoami` reports the live budget; the server paces itself against the `x-ratelimit-*` headers.

## Webhook receiver (optional)

Process ClickUp webhook events without external infrastructure:

```bash
WEBHOOK_PORT=3001 WEBHOOK_SECRET=your_secret node build/webhook-receiver/index.js
```

- HMAC-SHA256 validation over the raw request body; when a secret is configured, unsigned requests are rejected
- Structured event parsing — type, object, operation, changes, user, timestamp
- Optional forwarding to a callback URL (`WEBHOOK_FORWARD_URL`)
- Pure Node.js `http`, zero extra dependencies

## Development

```bash
npm install
npm run build
npm test          # 320 tests, mocked HTTP — no token needed
npm run smoke     # live CRUD walk (needs CLICKUP_API_TOKEN; creates and
                  # deletes its own sandbox in your workspace)
```

Architecture notes for 4.x live in [src/v4/README.md](src/v4/README.md); the design rationale and measurements are in [V4-PLAN.md](V4-PLAN.md).

### Debugging a fix that "didn't work"

Call `whoami`. It reports the running build's version and stamp. MCP hosts spawn their own server process at session start and hold it, so a rebuild does not reach an already-running session — if the stamp predates your change, restart the host app. This accounted for several phantom bug reports before the tool existed.

## License

MIT — see [LICENSE](LICENSE). Fork of [nsxdavid/clickup-mcp-server](https://github.com/nsxdavid/clickup-mcp-server) by David Whatley.
