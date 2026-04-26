# OpenCode Usage UI Render Design

## Scope
- Make 9router usage status appear reliably in the normal interactive OpenCode UI.
- Preserve current data source, provider gating, external JSON config, and `last24h` default behavior.
- Keep the message end-of-turn and autopilot-style in visibility.

## Non-Goals
- Reintroducing success toast notifications.
- Reworking backend usage aggregation again.
- Building a separate full TUI plugin unless server-plugin APIs prove insufficient.

## Problem Statement
The plugin currently computes correct usage data, but success rendering relies on `console.log(...)` and `experimental.text.complete`. Those paths appear in CLI/log output but are not reliable in the normal interactive OpenCode UI. Autopilot uses a more native visible-text insertion path, so the usage notifier should move to an equivalent UI-native mechanism.

## Chosen Approach
Adopt a single primary success-rendering path that injects a visible status block through a normal OpenCode-rendered output path instead of relying on console logging or experimental text mutation. Keep `session.idle` only as supporting signal/state coordination if needed, but not as the visible rendering mechanism.

## Alternatives Considered

### Option A — Move success rendering to a UI-native output path
- **Pros:** Closest to autopilot behavior, least conceptual overhead, preserves server-plugin structure.
- **Cons:** Requires careful hook timing to keep the block visible at end-of-turn and avoid duplicates.
- **Decision:** Chosen.

### Option B — Publish TUI events from the server plugin
- **Pros:** Could align with explicit TUI event APIs.
- **Cons:** Less proven for append-style message visibility in the normal interactive conversation flow.
- **Decision:** Rejected because reliability is unclear.

### Option C — Split into server + TUI plugin modules
- **Pros:** Maximum control over UI placement.
- **Cons:** Larger blast radius and more maintenance burden than needed.
- **Decision:** Rejected as overkill.

## Architecture

### Data Flow
1. Capture provider/model metadata from existing chat hooks.
2. When a turn is eligible for notification, fetch `/api/plugin/usage-summary?period=<configured period>`.
3. Normalize the summary payload using existing compatibility mapping.
4. Render one autopilot-style text block through the interactive UI-native output path.
5. Record notification state only after successful visible emission.

### Rendering Rules
- Exactly one success block per eligible turn.
- Visible only for sessions attributed to allowed providers.
- Default period remains `last24h` unless overridden by external config.
- Error path may remain separate from success rendering; success no longer depends on toast or console output.

### State Rules
- Keep per-session dedupe.
- Keep fail-closed provider gating.
- Do not let fallback paths consume the success slot before visible rendering succeeds.
- Any fallback path must not create duplicate visible output.

## Interfaces / Contracts

### Config
Continue reading `~/.config/opencode/9router-usage.json` with current fields:
- `baseURL`
- `period`
- `enabled`
- `toast`
- `minNotifyIntervalMs`
- `requestTimeoutMs`
- `allowedProviders`

### Backend Contract
Continue consuming:
```json
{
  "ok": true,
  "period": "last24h",
  "generatedAt": "...",
  "summary": {
    "requests": 909,
    "promptTokens": 47949925,
    "completionTokens": 410066,
    "cost": 125.6525
  }
}
```
and legacy-compatible aliases already supported by the plugin.

### UI Contract
The success output should remain a concise, multi-line status block equivalent in meaning to:
- period label
- provider/model label
- estimated cost
- input tokens
- output tokens
- total requests

## Error Handling
- If provider attribution is missing or not allowed, emit nothing.
- If usage fetch fails, do not emit a misleading success block.
- Preserve error dedupe behavior for error reporting, but keep it separate from success rendering.
- If the new UI-native path proves unavailable for a specific run mode, keep a non-duplicating fallback strategy only if it does not regress interactive UI behavior.

## Testing Strategy
- Update plugin tests to assert the new visible rendering path instead of `console.log`/`experimental.text.complete` success behavior.
- Add regression coverage for:
  - one visible status block per turn
  - no output for non-allowed providers
  - no output for missing provider attribution
  - idle/fallback signal arriving before visible render path
  - fetch failure not consuming later visible success emission
- Run real OpenCode verification in interactive-compatible mode after syncing the installed plugin copy.

## Rollout Notes
- Update both repo and installed plugin copies after implementation.
- Update README to describe where the usage block appears in OpenCode UI.
- Refresh `project-map.md` after implementation because current map is stale and still describes toast-based success behavior and old response fields.

## Failure-Mode Check

### Critical: visible block renders at the wrong time
If the chosen hook injects text before the assistant finishes, the UX no longer matches the requirement. The implementation must verify end-of-turn timing in real runtime output.

### Critical: duplicate visible blocks from multiple hooks
If both the main path and fallback path render, the UI becomes noisy. Shared dedupe state must gate all success paths.

### Minor: run-mode differences remain between CLI and interactive UI
This is acceptable only if the interactive UI is fixed and CLI output stays non-broken. CLI/log exact formatting parity is not a primary goal.
