# Project Map
_Generated: 2026-04-25 16:11 | Staleness: timestamps_

## Directory Structure
.git/ — git repository metadata
.logs/ — plugin runtime logs (subtask2.log shows plugin initialization)

## Key Files
None yet — repository is empty scaffold awaiting plugin implementation.

## Critical Constraints
- Target platform: OpenCode plugin system using `@opencode-ai/plugin` SDK v1.14.24
- Plugin must export async function returning object with: name, tool (optional), config (optional), lifecycle hooks
- Lifecycle hooks: `command.execute.before`, `command.execute.after`, etc.
- Tools registered via `tool()` from SDK with description, args schema, execute function
- Commands registered via `config` callback modifying `opencodeConfig.command`
- Plugin will fetch `GET /api/plugin/usage-summary?period=today|last24h|7d` from 9router-plus backend
- Backend endpoint returns: `{ ok, period, generatedAt, summary: { totalRequests, totalInputTokens, totalOutputTokens, estimatedCost } }`
- Notification trigger: after AI completion/stop event
- Display: terminal output + toast notification (if OpenCode supports)

## Hot Files
None yet — no implementation files exist.
