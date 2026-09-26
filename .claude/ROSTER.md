# Agent roster

Rules set by Ben, 2026-09-26. These govern every subagent spawned while working on this repo.

## Slot budget

**4 slots in use at any one time.** A slot is consumed only while an agent is running.

| Model  | Slots |
|--------|-------|
| Haiku  | 1     |
| Sonnet | 2     |
| Opus   | 4     |

- Effort: **medium** by default. Never above **high**.
- Opus consumes the whole budget — reserve it for work nothing smaller can do, and say why.
- `general-purpose` / `claude` agents inherit the parent model (Opus). Don't use them; spawn a
  hired profile below, or pass an explicit `model`.

## Hiring

Treat bringing an agent on as hiring: a specific, recurring job, written down here before first use.

- Simple single long-running task, or many short simple tasks → **Haiku**
- Complex task that recurs → **Sonnet**

Each hire gets a definition in `.claude/agents/<name>.md` (model + effort in frontmatter) and a row
below.

## Staff

| Name | Model | Slots | Effort | Job |
|------|-------|-------|--------|-----|
| `clickup-clerk` | Haiku | 1 | medium | Read-only ClickUp lookups: read tasks, docs, comments; return tight summaries with IDs. Never writes. |
| `mcp-verifier` | Sonnet | 2 | medium | Build, test, and adversarially review changes to this repo before they're pushed; reproduce reported ClickUp API behaviour. |

Typical loadouts that fit: verifier + 2 clerks · 4 clerks · one Opus alone.

## Log

- 2026-09-26 — Before these rules existed, one `general-purpose` agent (inherited Opus, 4 slots) was
  launched to summarize the ClickUp MCP design docs. Allowed to finish; its job is `clickup-clerk`
  work going forward.
