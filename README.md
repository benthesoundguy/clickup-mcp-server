# ClickUp MCP Server

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node.js Version"></a>
  <a href="https://github.com/modelcontextprotocol/typescript-sdk"><img src="https://img.shields.io/badge/MCP%20SDK-1.x-orange" alt="MCP SDK"></a>
</p>

A Model Context Protocol (MCP) server giving AI assistants a verified, honest ClickUp integration: **88 tools covering 148 operations — every one of which maps to a live ClickUp endpoint (or a clearly-labeled local computation), and is exercised by 68 unit tests plus a 108-step live test suite.**

This is a heavily renovated fork of [nsxdavid/clickup-mcp-server](https://github.com/nsxdavid/clickup-mcp-server). Current version **3.2.0** — see [CHANGELOG.md](CHANGELOG.md) for the full history.

Much of what's here was found by pointing an adversarial agent at a throwaway workspace and telling it to break things. Three rounds of that produced ~50 defects; the ones that were ours are fixed, and the ones that are ClickUp's are documented below rather than hidden.

## Why this fork

- **Verified surface** — every endpoint was probed against the real API; ~30 fabricated or dead operations from earlier versions were removed or rebuilt. What's registered, works.
- **No silent wrong answers** — writes that reported success while doing nothing (or something else) were the single most common defect class found. Destructive and ambiguous operations now verify by readback and say what actually happened.
- **LLM-shaped responses** — task lists return a lean field set by default (roughly 5× smaller than raw API payloads), with `detail:"full"` and `fields:[...]` opt-ins. Compact JSON everywhere.
- **Rate-limit aware** — automatic retry with backoff on 429s honoring `Retry-After`; serial bulk writes are paced. ClickUp allows ~100 requests/minute per token on most plans.
- **Project intelligence** — 8 analysis reports (health score, bottlenecks, velocity, dependency graph, sprint readiness, workload, risk, time) computed locally over *complete* task data, with custom-status-aware classification and an explicit flag when data was truncated.
- **Consolidated tools** — multi-action tools (`views`, `docs`, `channels`, …) pack related operations behind one registration, keeping the tool list small enough for models to navigate.
- **Chat on the v3 API** — channels, DMs, messages, replies, reactions, members.
- **Secure webhook receiver** — standalone zero-dependency listener with raw-body HMAC-SHA256 validation (missing signature = rejected).

## Quick Start

Distributed via GitHub (not npm):

```bash
git clone https://github.com/benthesoundguy/clickup-mcp-server
cd clickup-mcp-server
npm install
npm run build
```

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "clickup": {
      "command": "node",
      "args": ["/path/to/clickup-mcp-server/build/index.js"],
      "env": {
        "CLICKUP_API_TOKEN": "YOUR_API_TOKEN"
      }
    }
  }
}
```

Get your API token from **ClickUp Settings → Apps → API Token**.

### Remote mode (Claude web + mobile)

The server also speaks **streamable HTTP** for claude.ai custom connectors —
which sync to the Claude mobile app. Set two env vars and it switches transports:

```bash
MCP_HTTP_PORT=8809 MCP_AUTH_TOKEN=$(openssl rand -hex 24) CLICKUP_API_TOKEN=... node build/index.js
```

Every request must present the auth token (`Authorization: Bearer <token>`, or
in the path: `/mcp/<token>` — the form claude.ai's connector UI needs).
`GET /healthz` is an unauthenticated health probe.

See [deploy/DEPLOY.md](deploy/DEPLOY.md) for the full recipe: VPS setup script,
hardened systemd unit, Cloudflare Tunnel, and connecting it to Claude.

## Tools (88 registered / 148 operations)

### Single-operation tools

| Domain | Tools |
|---|---|
| **Workspaces** | `workspaces_list`, `workspaces_seats_get` |
| **Tasks** | `tasks_list`, `tasks_get`, `tasks_create`, `tasks_update`, `tasks_delete`, `tasks_move`, `tasks_move_bulk`, `tasks_link`, `tasks_unlink`, `tasks_members_list`, `tasks_create_bulk`, `tasks_update_bulk` |
| **Lists** | `lists_search`, `lists_create`, `lists_get`, `lists_update`, `lists_delete`, `lists_create_in_space`, `lists_create_from_template_in_folder`, `lists_create_from_template_in_space`, `lists_members_list`, `lists_list_in_space` |
| **Folders** | `folders_create`, `folders_update`, `folders_delete` |
| **Spaces** | `spaces` |
| **Comments** | `tasks_comments_list`, `tasks_comments_create`, `lists_comments_list`, `lists_comments_create`, `views_comments_list`, `views_comments_create`, `comments_update`, `comments_delete`, `comments_replies_list`, `comments_replies_create` |
| **Checklists** | `checklists_create`, `checklists_update`, `checklists_delete`, `checklists_items_create`, `checklists_items_update`, `checklists_items_delete` |
| **Time** | `time_entries_list`, `time_entry_create`, `time_entry_update`, `time_entry_delete`, `time_tracking_start`, `time_tracking_stop`, `time_tracking_current` |
| **Goals** | `goals_list`, `goals_create`, `goals_get`, `goals_update`, `goals_delete`, `goals_key_results_create`, `goals_key_results_update`, `goals_key_results_delete` |
| **Guests** | `guests_invite`, `guests_get`, `guests_update`, `guests_remove`, `guests_attach`, `guests_detach` |
| **Users** | `users_list`, `users_invite`, `users_update`, `users_remove` |
| **Tags** | `tags_assign`, `tags_unassign` |
| **Other** | `templates`, `reminders_create`, `server_info` |

### Consolidated multi-action tools

| Tool | Actions |
|---|---|
| `views` | list, create, get, update, delete, set_filters, set_grouping, set_sorting, set_settings, view_tasks |
| `channels_messages` | list, send, update, delete, replies_list, replies_create, reactions_list, reactions_create, reactions_delete, tagged_users |
| `project_intelligence` | health, bottlenecks, velocity, dependencies, sprint, workload, risk, time_report |
| `docs` | get, list, create, search, pages_list, pages_create, pages_update |
| `channels` | list, get, create, update, delete, dm |
| `statuses` | list, create, update, delete, reorder, replace_all |
| `webhooks` | list, create, update, delete, process |
| `custom_fields_values` | get, set, remove, bulk_set |
| `groups` | list, create, update, delete |
| `tags` | list, create, update, delete |
| `attachments` | list, create (by URL), upload |
| `dependencies` | create, get, delete |
| `custom_fields` | list, create |
| `channels_members` | list, followers |

### Moving vs linking tasks

`tasks_move` performs a **true home-list move** (ClickUp's v3 endpoint); `tasks_move_bulk` does up to 50 at once with rate-limit pacing — the "empty the inbox" operation. `tasks_link` / `tasks_unlink` are the *tasks-in-multiple-lists* feature: they add a task to an **additional** list without changing its home. Link-then-unlink is not a move, and `tasks_unlink` refuses to remove a task from its home list.

### Known API limitations (not bugs — the API genuinely lacks these)

- **Reminders** are create-only; they cannot be listed, updated, or deleted.
- **Custom field definitions** can be listed and created, not edited or deleted.
- **Docs** cannot be renamed/deleted and pages cannot be deleted; edit content via `pages_update`.
- **Users** cannot be listed directly; members are read from the workspace object.
- Chat reactions accept colon-free emoji shortcodes (`+1`, `heart`), not names like `thumbsup` or literal emoji.
- **Renaming or deleting a status reassigns its tasks.** ClickUp silently moves every task in that status to the list's default open status. The `statuses` tool counts them first and returns an explicit `warning` with `tasks_reassigned`, but the reassignment itself cannot be prevented.
- Statuses have no per-status endpoint — the whole array is replaced on every change. `reorder` only reorders; `replace_all` is the destructive path and reports what it removed.
- Status and tag names are stored lower-cased; all matching here is case-insensitive.
- A task added to a second list via `tasks_link` does not appear in that list's `tasks_list` results.
- Date custom fields require Unix milliseconds; `YYYY-MM-DD` is rejected by ClickUp for those (task `due_date`/`start_date` accept both, converted here).
- Attachments have no list endpoint; `attachments list` reads them off the task object. Attach-by-URL is fetched server-side and uploaded, since ClickUp's endpoint is multipart-only (25MB cap).

## Project Intelligence

`project_intelligence` computes structured analytics locally from live data — one call per report:

- **health** — status distribution, health score (0–100), letter grade, blocked/overdue/stale rates
- **bottlenecks** — per-status dwell time, stalled tasks, top bottleneck
- **velocity** — completions over 7/14/30 days, projection to done, confidence
- **dependencies** — chain analysis, top blockers, circular dependency detection
- **sprint** — ready/blocked/in-progress split, capacity score, recommended scope
- **workload** — per-assignee load with status breakdown, overload flags, unassigned count
- **risk** — per-task score combining overdue + blocked + stale + priority drivers
- **time_report** — hours per person, per task, per day

Reports fetch **all** task pages (up to 3,000 tasks) and classify statuses by the list's own status *types*, so custom workflows ("Shipped 🚀") are counted correctly. If the page cap is hit, the report says so (`data_complete: false`) instead of silently reporting partial numbers. `health` caps its inline task dump at 25 (`tasks_included` / `tasks_truncated`) while the aggregates still cover every task.

## Webhook Receiver (optional)

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
git clone https://github.com/benthesoundguy/clickup-mcp-server
cd clickup-mcp-server
npm install
npm run build
npm test          # 68 unit tests (mocked HTTP — no token needed)
npm run smoke     # 108-step live CRUD walk (needs CLICKUP_API_TOKEN; creates
                  # and deletes its own sandbox in your workspace)
```

### Debugging a fix that "didn't work"

Call `server_info`. It reports the running build's timestamp. MCP hosts spawn
their own server process at session start and hold it, so a rebuild does not
reach an already-running session — if the build stamp predates your change,
restart the host app. This accounted for several phantom bug reports before
the tool existed.

## License

MIT — see [LICENSE](LICENSE). Fork of [nsxdavid/clickup-mcp-server](https://github.com/nsxdavid/clickup-mcp-server) by David Whatley.
