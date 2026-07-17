# ClickUp MCP Server

<p align="center">
  <img src="assets/images/clickupserverlogo.png" width="256" alt="ClickUp MCP Server Logo" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/clickup-mcp-server"><img src="https://img.shields.io/npm/v/clickup-mcp-server.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen" alt="Node.js Version"></a>
  <a href="https://github.com/modelcontextprotocol/typescript-sdk"><img src="https://img.shields.io/badge/MCP%20SDK-1.6.1-orange" alt="MCP SDK"></a>
</p>

A Model Context Protocol (MCP) server providing AI assistants with comprehensive ClickUp integration. **87 registered tools covering the equivalent of 173 granular operations.**

## Why consolidated tools?

Most MCP servers register one tool per API endpoint. This fork uses **18 consolidated multi-action tools** that accept an `action` parameter to pack 3–12 related operations into a single registration. The LLM picks `action: "list" | "create" | "set_filters"` instead of scanning a dozen separate tool names.

The result is **87 tools** covering what would be **173 separate operations** — each consolidated tool averaging 6 operations per registration.

### By the numbers

| | This fork |
|---|---|
| Registered tools | **87** |
| Equivalent granular operations | **173** |
| Registrations saved by consolidation | **86** (49.7%) |
| Consolidated tools | 18 covering 104 operations |
| Standard tools | 69 |

## Features

- **Full ClickUp API surface** — tasks, lists, docs, chat, goals, webhooks, guests, time tracking, dependencies, custom fields, views, and more
- **18 consolidated multi-action tools** covering 104 operations — each handles 3–12 actions under one registration
- **Consistent `domain_verb` naming** — `tasks_create`, `lists_search`, `docs_get`. No `clickup_` prefix, no scattered `verb_noun` conventions
- **Project intelligence** — 8 built-in analysis reports computed from live data (health score, velocity, bottlenecks, workload, risk, sprint readiness, dependency chains, time reports)
- **Webhook receiver** — standalone HTTP server with HMAC-256 validation for real-time event processing
- **No rate limits** — personal API key auth, no daily cap
- **MIT licensed** — all source included, no premium tiers

## Quick Start

```bash
npm install clickup-mcp-server
```

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "clickup": {
      "command": "npx",
      "args": ["-y", "clickup-mcp-server"],
      "env": {
        "CLICKUP_API_TOKEN": "YOUR_API_TOKEN"
      }
    }
  }
}
```

Get your API token from **ClickUp Settings → Apps → API Token**.

## Tools

### Standard tools (one operation each)

| Domain | Tools |
|---|---|
| **Tasks** | `tasks_list`, `tasks_get`, `tasks_create`, `tasks_update`, `tasks_delete`, `tasks_link`, `tasks_unlink`, `tasks_members_list`, `tasks_create_bulk`, `tasks_update_bulk` |
| **Lists** | `lists_search`, `lists_create`, `lists_get`, `lists_update`, `lists_delete`, `lists_create_in_space`, `lists_create_from_template_in_folder`, `lists_create_from_template_in_space`, `lists_members_list`, `lists_list_in_space` |
| **Comments** | `tasks_comments_list`, `tasks_comments_create`, `lists_comments_list`, `lists_comments_create`, `views_comments_list`, `views_comments_create`, `comments_update`, `comments_delete`, `comments_replies_list`, `comments_replies_create` |
| **Checklists** | `checklists_create`, `checklists_update`, `checklists_delete`, `checklists_items_create`, `checklists_items_update`, `checklists_items_delete` |
| **Time** | `time_entries_list`, `time_entry_create`, `time_entry_update`, `time_entry_delete`, `time_tracking_start`, `time_tracking_stop`, `time_tracking_current` |
| **Folders** | `folders_create`, `folders_update`, `folders_delete` |
| **Goals** | `goals_list`, `goals_create`, `goals_get`, `goals_update`, `goals_delete`, `goals_key_results_create`, `goals_key_results_update`, `goals_key_results_delete` |
| **Guests** | `guests_invite`, `guests_get`, `guests_update`, `guests_remove`, `guests_attach`, `guests_detach` |
| **Users** | `users_list`, `users_invite`, `users_update`, `users_remove` |
| **Other** | `workspaces_list`, `workspaces_seats_get`, `workspace_search`, `tags_assign`, `tags_unassign` |

### Consolidated tools (multi-action via `action` param)

| Tool | Actions |
|---|---|
| `views` | list, create, get, update, delete, set_filters, set_grouping, set_sorting, set_settings, duplicate, sharing, view_tasks |
| `channels_messages` | list, send, update, delete, replies_list, replies_create, reactions_list, reactions_create, reactions_delete, tagged_users, unread, search |
| `channels` | list, get, create, update, delete, dm, search, stats, mark_read |
| `dependencies` | create, get, update, delete, graph, conflicts, resolve, bulk, timeline |
| `docs` | get, list, create, update, search, pages_list, pages_create, pages_update, pages_delete |
| `project_intelligence` | health, bottlenecks, velocity, dependencies, sprint, workload, risk, time_report |
| `statuses` | list, create, update, delete, reorder |
| `webhooks` | list, create, update, delete, process |
| `channels_members` | list, followers, add, remove |
| `custom_fields` | list, create, update, delete |
| `custom_fields_values` | get, set, remove, bulk_set |
| `dependencies_workspace` | list, stats, export, import |
| `groups` | list, create, update, delete |
| `tags` | list, create, update, delete |
| `attachments` | list, create by URL, upload |
| `reminders` | list, create, update |
| `templates` | task, list, folder (via `scope_type`) |
| `spaces` | list, get |

## Project Intelligence

The `project_intelligence` tool computes structured metrics from live ClickUp data in a single call per report:

- **health** — status distribution, health score (0–100), letter grade, blocked/overdue/stale rates
- **bottlenecks** — per-status dwell time, stalled tasks, top bottleneck identification
- **velocity** — completion rate over 7/14/30 days, projection to done, confidence from sample size
- **dependencies** — transitive chain analysis, critical path, circular dependency detection
- **sprint** — ready/blocked/in-progress split, capacity score, recommended scope
- **workload** — per-assignee counts with status breakdown, overload flags, unassigned tasks
- **risk** — per-task score (0–100) combining blocked + overdue + stale + priority, with distribution
- **time_report** — aggregated hours per person, per task, per day

Every report handles edge cases: empty lists, missing dates, unassigned tasks, zero completions.

## Webhook Receiver (optional)

Process ClickUp webhook events without external infrastructure:

```bash
WEBHOOK_PORT=3001 WEBHOOK_SECRET=your_secret npx clickup-mcp-receiver
```

- HMAC-SHA256 signature validation (constant-time compare, different-length buffer safe)
- Structured event parsing — extracts type, object, operation, changes, user, and timestamp
- Optional forwarding to any callback URL for pipeline integration
- Pure Node.js `http` module — zero extra dependencies

## Development

```bash
git clone https://github.com/benthesoundguy/clickup-mcp-server
cd clickup-mcp-server
npm install
npm run build
```

## License

MIT — see [LICENSE](LICENSE).
