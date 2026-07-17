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

A Model Context Protocol (MCP) server providing AI assistants with comprehensive ClickUp integration. Covers the full ClickUp API surface across **87 consolidated tools** with consistent `domain_verb` naming.

## Features

- **87 tools** across 22 domains — tasks, lists, docs, chat, goals, webhooks, guests, time tracking, dependencies, and more
- **Consolidated multi-action tools** — 12 tools use action params to replace what would be 104 separate registrations, saving ~50% token budget
- **Consistent naming** — all tools follow `domain_verb` convention (`tasks_create`, `lists_search`, `docs_get`) for LLM discoverability
- **Project intelligence layer** — built-in analysis reports (health, bottlenecks, velocity, dependencies, sprint, workload, risk, time tracking)
- **Webhook receiver** — optional HTTP event listener with HMAC validation for real-time ClickUp event processing
- **No rate limit** — personal API key auth, no daily request cap
- **Zero markup** — MIT licensed, fully open source

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

## Tools by Domain

| Domain | Tool | Actions |
|---|---|---|
| **Workspaces** | `workspaces_list`, `workspaces_seats_get` | List workspaces, seat info |
| **Tasks** | `tasks_list`, `tasks_get`, `tasks_create`, `tasks_update`, `tasks_delete`, `tasks_link`, `tasks_unlink`, `tasks_members_list`, `tasks_create_bulk`, `tasks_update_bulk` | Full CRUD + bulk operations |
| **Lists** | `lists_search`, `lists_create`, `lists_get`, `lists_update`, `lists_delete`, `lists_create_in_space`, `lists_list_in_space`, `lists_create_from_template_*`, `lists_members_list`, `lists_comments_list`, `lists_comments_create` | Full lifecycle |
| **Folders** | `folders_create`, `folders_update`, `folders_delete` | CRUD |
| **Spaces** | `spaces` | Consolidated: list, get |
| **Docs** | `docs` | Consolidated: get, list, create, update, search, pages CRUD |
| **Chat** | `channels`, `channels_members`, `channels_messages` | 3 consolidated: channel mgmt, members, messages with replies/reactions |
| **Goals** | `goals_list`, `goals_create`, `goals_get`, `goals_update`, `goals_delete`, `goals_key_results_*` | Full CRUD + key results |
| **Time Tracking** | `time_entries_list`, `time_entry_create`, `time_entry_update`, `time_entry_delete`, `time_tracking_start`, `time_tracking_stop`, `time_tracking_current` | Full lifecycle + timer |
| **Dependencies** | `dependencies`, `dependencies_workspace` | 2 consolidated: task deps + workspace analysis |
| **Comments** | `tasks_comments_*`, `views_comments_*`, `lists_comments_*`, `comments_*` | Multi-scope comments + threaded replies |
| **Checklists** | `checklists_create`, `checklists_update`, `checklists_delete`, `checklists_items_*` | Full CRUD |
| **Custom Fields** | `custom_fields`, `custom_fields_values` | 2 consolidated: definitions + values |
| **Views** | `views` | Consolidated: CRUD + filters, grouping, sorting, settings, duplicate, sharing |
| **Tags** | `tags`, `tags_assign`, `tags_unassign` | Consolidated CRUD + task tagging |
| **Webhooks** | `webhooks` | Consolidated: CRUD + event processing |
| **Guests** | `guests_invite`, `guests_get`, `guests_update`, `guests_remove`, `guests_attach`, `guests_detach` | Full lifecycle |
| **Users** | `users_list`, `users_invite`, `users_update`, `users_remove` | User management |
| **Groups** | `groups` | Consolidated: list, create, update, delete |
| **Templates** | `templates` | Consolidated: task, list, folder templates |
| **Attachments** | `attachments` | Consolidated: list, create by URL, upload |
| **Reminders** | `reminders` | Consolidated: list, create, update |
| **Statuses** | `statuses` | Consolidated: list, create, update, delete, reorder |
| **Project Intelligence** | `project_intelligence` | Consolidated: health, bottlenecks, velocity, dependencies, sprint, workload, risk, time_report |

## Project Intelligence

The `project_intelligence` tool provides 8 analysis reports that compute metrics from ClickUp data:

- **health** — status distribution, health score (0-100), letter grade, blocked/overdue/stale rates
- **bottlenecks** — per-status dwell time, stalled tasks, top bottleneck detection
- **velocity** — completion rate over 7/14/30 days, projection to done, confidence level
- **dependencies** — transitive dependency chain analysis, critical path, circular dep detection
- **sprint** — readiness assessment, capacity score, recommended sprint scope
- **workload** — per-assignee task distribution, overload detection, unassigned tasks
- **risk** — per-task risk scoring (0-100), high/medium/low distribution, top risk drivers
- **time_report** — aggregated time tracking per person, per task, per day

## Webhook Receiver (Optional)

The repo includes a standalone webhook receiver for processing ClickUp webhook events:

```bash
WEBHOOK_PORT=3001 WEBHOOK_SECRET=your_secret npx clickup-mcp-receiver
```

Features: HMAC-SHA256 signature validation, event logging, optional forwarding to a callback URL.

## Development

```bash
git clone https://github.com/benthesoundguy/clickup-mcp-server
cd clickup-mcp-server
npm install
npm run build
```

## License

MIT
