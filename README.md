# ClickUp MCP Server

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node.js Version"></a>
  <a href="https://github.com/modelcontextprotocol/typescript-sdk"><img src="https://img.shields.io/badge/MCP%20SDK-1.x-orange" alt="MCP SDK"></a>
</p>

A Model Context Protocol (MCP) server giving AI assistants a verified, honest ClickUp integration: **85 tools covering 144 operations — every one of which maps to a live ClickUp endpoint (or a clearly-labeled local computation) and is exercised by a 97-step live test suite.**

This is a heavily renovated fork of [nsxdavid/clickup-mcp-server](https://github.com/nsxdavid/clickup-mcp-server). See [CHANGELOG.md](CHANGELOG.md) for everything that changed in 3.0.0.

## Why this fork

- **Verified surface** — every endpoint was probed against the real API; ~30 fabricated or dead operations from earlier versions were removed or rebuilt. What's registered, works.
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

## Tools (85 registered / 144 operations)

### Single-operation tools

| Domain | Tools |
|---|---|
| **Workspaces** | `workspaces_list`, `workspaces_seats_get` |
| **Tasks** | `tasks_list`, `tasks_get`, `tasks_create`, `tasks_update`, `tasks_delete`, `tasks_link`, `tasks_unlink`, `tasks_members_list`, `tasks_create_bulk`, `tasks_update_bulk` |
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
| **Other** | `templates`, `reminders_create` |

### Consolidated multi-action tools

| Tool | Actions |
|---|---|
| `views` | list, create, get, update, delete, set_filters, set_grouping, set_sorting, set_settings, view_tasks |
| `channels_messages` | list, send, update, delete, replies_list, replies_create, reactions_list, reactions_create, reactions_delete, tagged_users |
| `project_intelligence` | health, bottlenecks, velocity, dependencies, sprint, workload, risk, time_report |
| `docs` | get, list, create, search, pages_list, pages_create, pages_update |
| `channels` | list, get, create, update, delete, dm |
| `statuses` | list, create, update, delete, reorder |
| `webhooks` | list, create, update, delete, process |
| `custom_fields_values` | get, set, remove, bulk_set |
| `groups` | list, create, update, delete |
| `tags` | list, create, update, delete |
| `attachments` | list, create (by URL), upload |
| `dependencies` | create, get, delete |
| `custom_fields` | list, create |
| `channels_members` | list, followers |

### Known API limitations (not bugs — the API genuinely lacks these)

- **Reminders** are create-only; they cannot be listed, updated, or deleted.
- **Custom field definitions** can be listed and created, not edited or deleted.
- **Docs** cannot be renamed/deleted and pages cannot be deleted; edit content via `pages_update`.
- **Users** cannot be listed directly; members are read from the workspace object.
- Chat reactions accept colon-free emoji shortcodes (`+1`, `heart`), not names like `thumbsup` or literal emoji.

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

Reports fetch **all** task pages (up to 3,000 tasks) and classify statuses by the list's own status *types*, so custom workflows ("Shipped 🚀") are counted correctly. If the page cap is hit, the report says so (`data_complete: false`) instead of silently reporting partial numbers.

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
npm test          # 51 unit tests (mocked HTTP — no token needed)
npm run smoke     # 97-step live CRUD walk (needs CLICKUP_API_TOKEN; creates
                  # and deletes its own sandbox in your workspace)
```

## License

MIT — see [LICENSE](LICENSE). Fork of [nsxdavid/clickup-mcp-server](https://github.com/nsxdavid/clickup-mcp-server) by David Whatley.
