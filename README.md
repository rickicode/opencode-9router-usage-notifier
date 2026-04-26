# 9Router Usage Notifier

OpenCode plugin that displays 9routerplus usage statistics after each completed assistant turn.

## Features

- Shows usage stats after every AI response
- Displays: estimated cost, input/output tokens, total requests
- Configurable period: `today`, `last24h`, or `7d` (defaults to `today`)
- Success display mode supports `inline`, `toast`, or `both` and defaults to `toast`
- TUI toast notification is used for success by default and for error paths when enabled

## Installation

Primary install flow:

```bash
npx opencode-9routerplus-usage
```

What the installer does:

- creates `~/.config/opencode/9routerplus-usage.json` if missing
- adds `opencode-9routerplus-usage` to `~/.config/opencode/opencode.json`
- relies on OpenCode's npm plugin support so the plugin is installed/loaded from the package entry directly

Manual fallback:

```bash
npm install -g opencode-9routerplus-usage
opencode-9routerplus-usage
```

If you prefer to edit OpenCode config yourself, add this plugin entry:

```json
{
  "plugin": ["opencode-9routerplus-usage"]
}
```

Then create the plugin config file with:

```bash
npm run setup
```

when working from this repo locally.

## Configuration

1) Ensure plugin is listed in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "@spoons-and-mirrors/subtask2@latest",
    "opencode-agent-skills",
    "@tarquinen/opencode-dcp@latest",
    "opencode-9routerplus-usage"
  ]
}
```

The `npx opencode-9routerplus-usage` command can add this automatically.

2) Create plugin config file next to `opencode.json`:

Path: `~/.config/opencode/9routerplus-usage.json`

```json
{
  "baseURL": "http://localhost:20128",
  "period": "today",
  "enabled": true,
  "toast": true,
  "successDisplay": "toast",
  "minNotifyIntervalMs": 1500,
  "requestTimeoutMs": 3500,
  "allowedProviders": ["9routerplus"]
}
```

Minimal (recommended to start):

```json
{
  "baseURL": "http://localhost:20128",
  "period": "today",
  "successDisplay": "toast",
  "allowedProviders": ["9routerplus"]
}
```

Quick setup command (auto-create config file):

```bash
npm run setup
```

### Options

- `baseURL` - 9routerplus server URL (default: `http://localhost:20128`)
- `period` - Time period: `today`, `last24h`, or `7d` (default: `today`)
- `enabled` - Enable/disable plugin (default: `true`)
- `toast` - Enable/disable TUI toast notifications (default: `true`)
- `successDisplay` - Success presentation mode: `inline`, `toast`, or `both` (default: `toast`)
- `minNotifyIntervalMs` - De-duplicate end-of-turn status emission across supported completion hooks per session (default: `1500`)
- `requestTimeoutMs` - API request timeout in ms (default: `3500`)
- `allowedProviders` - Show usage when active provider matches, or when the model id is namespaced under an allowed provider such as `9router/...` (default: `["9router"]`)

### Behavior

- Plugin reads model/provider from OpenCode session metadata.
- Success status appears when provider attribution matches `allowedProviders`, or when the model id itself is namespaced under an allowed provider.
- End-of-turn success output is de-duplicated across `session.idle` and `experimental.text.complete`.
- Success mode `toast` is the default; `inline` and `both` reuse the same fetched summary data.
- API/runtime errors are shown as toast and de-duplicated (shown once per error key until recovery).

## Usage

Once installed and configured, the plugin shows a success toast after each eligible assistant completion by default. If you switch `successDisplay` to `inline` or `both`, the inline status block looks like this:

```text
────────────────────────────────────────────────────
9ROUTERPLUS TODAY · REQ 1023 · $155 · IN 155M · OUT 150K
────────────────────────────────────────────────────
```

Default success toast content:

```text
Title: 9ROUTERPLUS TODAY · $155
Message: TOTAL REQUEST 1023
IN 155M · OUT 150K
```

## Requirements

- OpenCode with plugin support
- 9routerplus running with `/api/plugin/usage-summary` endpoint
