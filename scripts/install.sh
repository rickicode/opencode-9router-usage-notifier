#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${9ROUTER_USAGE_REPO_URL:-https://github.com/rickicode/opencode-9router-usage-notifier.git}"
PLUGIN_DIR="${HOME}/.config/opencode/plugins/9router-usage-notifier"
OPENCODE_CONFIG="${HOME}/.config/opencode/opencode.json"
PLUGIN_ENTRY="~/.config/opencode/plugins/9router-usage-notifier"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[9router-usage] Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

need_cmd git
need_cmd node
need_cmd npm

mkdir -p "${HOME}/.config/opencode/plugins"

if [ -d "$PLUGIN_DIR/.git" ]; then
  printf '[9router-usage] Updating existing plugin at %s\n' "$PLUGIN_DIR"
  git -C "$PLUGIN_DIR" pull --ff-only
elif [ -e "$PLUGIN_DIR" ]; then
  printf '[9router-usage] Refusing to overwrite existing path: %s\n' "$PLUGIN_DIR" >&2
  printf '[9router-usage] Remove or rename it first, then rerun the installer.\n' >&2
  exit 1
else
  printf '[9router-usage] Cloning plugin into %s\n' "$PLUGIN_DIR"
  git clone "$REPO_URL" "$PLUGIN_DIR"
fi

printf '[9router-usage] Installing npm dependencies\n'
npm install --prefix "$PLUGIN_DIR"

printf '[9router-usage] Ensuring default config exists\n'
npm run --prefix "$PLUGIN_DIR" setup

printf '\n[9router-usage] Installation complete.\n'
printf '[9router-usage] Make sure your OpenCode plugin list contains:\n'
printf '  "%s"\n' "$PLUGIN_ENTRY"

if [ -f "$OPENCODE_CONFIG" ]; then
  if grep -Fq "$PLUGIN_ENTRY" "$OPENCODE_CONFIG"; then
    printf '[9router-usage] Plugin entry already present in %s\n' "$OPENCODE_CONFIG"
  else
    printf '[9router-usage] Add the plugin entry to %s if it is not there yet.\n' "$OPENCODE_CONFIG"
  fi
else
  printf '[9router-usage] Create %s and add the plugin entry if OpenCode has not generated it yet.\n' "$OPENCODE_CONFIG"
fi
