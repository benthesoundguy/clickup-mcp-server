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

A Model Context Protocol (MCP) server providing AI assistants with comprehensive ClickUp integration. Covers the full ClickUp API surface across **87 tools** with consistent `domain_verb` naming — no scattered `verb_noun` conventions.

## Why this fork?

The standard ClickUp MCP servers register one tool per API endpoint — 176+ tools, most doing one thing. This fork uses **consolidated multi-action tools**: 18 tools use an `action` param to cover **104 distinct operations**. That's **86 fewer registrations** than the equivalent granular approach, meaning the LLM has fewer tools to scan while preserving every capability.

Each consolidated tool handles 3–12 related operations under a single registration. The LLM picks `action: "list" | "create" | "set_filters"` instead of hunting across `clickup_list_views`, `clickup_create_view`, `clickup_set_view_filters` and so on.

## Features

- **87 tools** across 24 domains — every ClickUp v2 API surface plus docs v3
- **18 consolidated multi-action tools** covering 104 operations — 86 fewer registrations than equivalent granular tools
- **Consistent naming** — all tools follow `domain_verb` (`tasks_create`, `lists_search`, `docs_get`) for alphabetical grouping and LLM discoverability
- **Project intelligence** — 8 built-in analysis reports: health, bottlenecks, velocity, dependencies, sprint, workload, risk, time tracking
- **Webhook receiver** — standalone HTTP listener with HMAC-SHA256 validation for real-time event processing
- **No rate limits** — personal API key auth, no daily cap
- **MIT licensed** — no markup, no paid tiers

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

| Domain | Tools | Capacity |
|---|---|---|
| **Tasks** | `tasks_list`, `tasks_get`, `tasks_create`, `tasks_update`, `tasks_delete`, `tasks_link`, `tasks_unlink`, `tasks_members_list`, `tasks_create_bulk`, `tasks_update_bulk` | Full CRUD + bulk (50/batch) |
| **Lists** | `lists_search`, `lists_create`, `lists_get`, `lists_update`, `lists_delete`, `lists_create_in_space`, `lists_create_from_template_in_folder`, `lists_create_from_template_in_space`, `lists_members_list`, `lists_list_in_space`, `lists_comments_list`, `lists_comments_create` | Full lifecycle + templates |
| **Folders** | `folders_create`, `folders_update`, `folders_delete` | CRUD |
| **Spaces** | `spaces` *(2 actions)* | List, get |
| **Docs** | `docs` *(9 actions)* | Get, list, create, update, search, pages CRUD |
| **Chat** | `channels` *(9 actions)*, `channels_members` *(4 actions)*, `channels_messages` *(12 actions)* | Full team chat lifecycle |
| **Comments** | 8 tools across task, list, and view scopes — create, list, update, delete, threaded replies | Multi-scope + threads |
| **Checklists** | `checklists_create`, `checklists_update`, `checklists_delete`, `checklists_items_create`, `checklists_items_update`, `checklists_items_delete` | Full CRUD |
| **Custom Fields** | `custom_fields` *(4 actions)* → definitions. `custom_fields_values` *(4 actions)* → values on tasks | Definition lifecycle + value get/set/remove/bulk |
| **Views** | `views` *(12 actions)* | CRUD + filters, grouping, sorting, settings, duplicate, sharing, view tasks |
| **Dependencies** | `dependencies` *(9 actions)*, `dependencies_workspace` *(4 actions)* | Task deps + workspace graph/timeline/export |
| **Time Tracking** | 7 tools covering entries + live timer | Full lifecycle + stopwatch |
| **Tags** | `tags` *(4 actions)*, `tags_assign`, `tags_unassign` | CRUD + assignment |
| **Statuses** | `statuses` *(5 actions)* | List, create, update, delete, reorder |
| **Webhooks** | `webhooks` *(5 actions)* | CRUD + event payload processing |
| **Goals** | 8 tools covering goals and key results | Full lifecycle |
| **Attachments** | `attachments` *(3 actions)* | List, create by URL, upload |
| **Reminders** | `reminders` *(3 actions)* | List, create, update |
| **Guests** | 6 tools — invite, get, update, remove, attach, detach | Full lifecycle |
| **Users** | 4 tools — list, invite, update, remove | User management |
| **Groups** | `groups` *(4 actions)* | List, create, update, delete |
| **Templates** | `templates` *(3 actions)* | Task, list, folder scopes |
| **Workspaces** | `workspaces_list`, `workspaces_seats_get` | List workspaces, seat usage |
| **Search** | `workspace_search` | Cross-workspace full-text search |
| **Project Intelligence** | `project_intelligence` *(8 reports)* | **See below** |

### Consolidated tools (action breakdown)

| Tool | Actions |
|---|---|
| `spaces` | list, get |
| `docs` | get, list, create, update, search, pages_list, pages_create, pages_update, pages_delete |
| `channels` | list, get, create, update, delete, dm, search, stats, mark_read |
| `channels_members` | list, followers, add, remove |
| `channels_messages` | list, send, update, delete, replies_list, replies_create, reactions_list, reactions_create, reactions_delete, tagged_users, unread, search |
| `custom_fields` | list, create, update, delete |
| `custom_fields_values` | get, set, remove, bulk_set |
| `views` | list, create, get, update, delete, set_filters, set_grouping, set_sorting, set_settings, duplicate, sharing, view_tasks |
| `dependencies` | create, get, update, delete, graph, conflicts, resolve, bulk, timeline |
| `dependencies_workspace` | list, stats, export, import |
| `tags` | list, create, update, delete |
| `statuses` | list, create, update, delete, reorder |
| `webhooks` | list, create, update, delete, process |
| `groups` | list, create, update, delete |
| `templates` | task, list, folder (via scope_type) |
| `attachments` | list, create by URL, upload |
| `reminders` | list, create, update |
| `project_intelligence` | health, bottlenecks, velocity, dependencies, sprint, workload, risk, time_report |

## Project Intelligence

The `project_intelligence` tool computes structured metrics from live ClickUp data in a single call:

- **health** — status distribution, health score (0–100), letter grade, blocked/overdue/stale rates
- **bottlenecks** — per-status dwell time, stalled tasks, top bottleneck identification
- **velocity** — completion rate over 7/14/30 days, projection to done, confidence level from sample size
- **dependencies** — transitive chain analysis, critical path, circular dependency detection
- **sprint** — ready/blocked/in-progress split, capacity score, recommended scope
- **workload** — per-assignee counts with status breakdown, overload flags, unassigned tasks
- **risk** — per-task score (0–100) combining blocked + overdue + stale + priority, with distribution
- **time_report** — aggregated hours per person, per task, per day from time entries

Every report handles edge cases: empty lists, missing dates, unassigned tasks, stale data, zero completions.

## Webhook Receiver (optional)

Process ClickUp webhook events without external infrastructure:

```bash
WEBHOOK_PORT=3001 WEBHOOK_SECRET=your_secret npx clickup-mcp-receiver
```

- HMAC-SHA256 signature validation (constant-time compare)
- Structured event parsing (type, object, changes, user, timestamp)
- Optional forwarding to a callback URL for pipeline integration
- Pure Node.js — zero extra dependencies

## Development

```bash
git clone https://github.com/benthesoundguy/clickup-mcp-server
cd clickup-mcp-server
npm install
npm run build
```

## License

MIT — see [LICENSE](LICENSE).
