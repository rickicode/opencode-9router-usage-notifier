# OpenCode Usage UI Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 9router usage block appear reliably in normal interactive OpenCode UI instead of only CLI/log output.
**Architecture:** Keep the plugin as a server plugin, preserve provider capture and backend fetch logic, and move success rendering onto a normal OpenCode-rendered output path. Use one success path with shared dedupe state, while keeping error reporting separate. Update tests to lock in interactive-UI-focused behavior and refresh docs to match the new render path.
**Tech Stack:** JavaScript, Node test runner, OpenCode plugin SDK (`@opencode-ai/plugin`), OpenCode SDK client APIs.
**Assumptions:**
- Assumes a server plugin can render reliably through a non-experimental output path — will **NOT** work if OpenCode only exposes interactive rendering to TUI plugins.
- Assumes current provider attribution from `chat.params` remains available — will **NOT** work if OpenCode stops emitting provider metadata for normal chat turns.
- Assumes `/api/plugin/usage-summary` remains the canonical data source — will **NOT** work if usage data must be computed client-side.

---

## File Structure

- Modify: `index.js` — replace success rendering path, keep fetch/gating/dedupe logic coherent, remove success `console.log` dependency.
- Modify: `index.test.js` — shift tests from experimental-text success assertions to interactive-render-path assertions and add regressions for dedupe/fallback behavior.
- Modify: `README.md` — document where the block appears and remove stale render-path wording.
- Modify: `project-map.md` — refresh stale constraints after implementation.

### Task 1: Move success rendering to a normal interactive UI path

**Files:**
- Modify: `index.js`
- Test: `index.test.js`

**Does NOT cover:**
- Does not add a separate TUI plugin module.
- Does not change backend aggregation or API response shape.
- Does not reintroduce success toasts.

- [ ] **Step 1: Write failing tests**

```js
test("renders usage status through the normal interactive output path", async () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;
  process.env.HOME = "/tmp/9router-plugin-tests-no-config";

  const fetchMock = createFetchMock(async (input) => {
    const url = String(input);
    if (url.includes("/api/plugin/usage-summary?period=last24h")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            period: "last24h",
            summary: {
              totalRequests: 12,
              totalInputTokens: 1234,
              totalOutputTokens: 567,
              estimatedCost: 0.4321,
            },
          };
        },
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  global.fetch = fetchMock;

  try {
    const plugin = await NineRouterUsagePlugin({
      serverUrl: "http://localhost:4096",
      directory: "/workspaces/plugin-9router-plus",
    });

    await plugin["chat.params"](
      {
        sessionID: "session-ui-1",
        agent: "test",
        model: { id: "sonnet", providerID: "9router" },
        provider: { info: { id: "9router" } },
        message: {},
      },
      {},
    );

    const output = { parts: [] };
    await plugin["command.execute.before"](
      { command: "noop", sessionID: "session-ui-1", arguments: "" },
      output,
    );

    assert.equal(Array.isArray(output.parts), true);
    assert.match(output.parts.map((part) => part.text || "").join("\n"), /9Router Usage \(last24h\)/);
  } finally {
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
  }
});

test("does not duplicate usage status when fallback signal also fires", async () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;
  process.env.HOME = "/tmp/9router-plugin-tests-no-config";

  let requestCount = 0;
  const fetchMock = createFetchMock(async (input) => {
    const url = String(input);
    if (url.includes("/api/plugin/usage-summary?period=last24h")) {
      requestCount += 1;
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            period: "last24h",
            summary: {
              totalRequests: 2,
              totalInputTokens: 20,
              totalOutputTokens: 30,
              estimatedCost: 0.02,
            },
          };
        },
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  global.fetch = fetchMock;

  try {
    const plugin = await NineRouterUsagePlugin({
      serverUrl: "http://localhost:4096",
      directory: "/workspaces/plugin-9router-plus",
    });

    await plugin["chat.params"](
      {
        sessionID: "session-ui-2",
        agent: "test",
        model: { id: "sonnet", providerID: "9router" },
        provider: { info: { id: "9router" } },
        message: {},
      },
      {},
    );

    await plugin.event({ event: { type: "session.idle", properties: { sessionID: "session-ui-2" } } });

    const output = { parts: [] };
    await plugin["command.execute.before"](
      { command: "noop", sessionID: "session-ui-2", arguments: "" },
      output,
    );

    assert.equal(requestCount, 1);
    assert.equal(output.parts.filter((part) => String(part.text || "").includes("9Router Usage")).length, 1);
  } finally {
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test index.test.js`
Expected: FAIL with `plugin.command.execute.before is not a function` or assertions failing because usage status is still emitted through `experimental.text.complete` / `console.log` instead of the normal interactive output path.

- [ ] **Step 3: Implement minimal change**

```js
function createUsageTextPart(text) {
  return { type: "text", text };
}

function buildUsageOutputParts(formatted) {
  return [createUsageTextPart(formatted)];
}

return {
  name: "9router-usage-notifier",

  "chat.message": async (input) => {
    const providerID = input?.model?.providerID;
    const modelID = input?.model?.modelID;
    if (!providerID) return;
    sessionModelById.set(input.sessionID, { providerID, modelID });
  },

  "chat.params": async (input) => {
    const providerID = input?.model?.providerID || input?.provider?.info?.id;
    const modelID = input?.model?.id;
    if (!providerID) return;
    sessionModelById.set(input.sessionID, { providerID, modelID });
  },

  "command.execute.before": async (input, output) => {
    const sessionID = input?.sessionID;
    const modelMeta = canNotifySession(sessionID);
    if (!modelMeta) return;

    clearPendingIdleFallback(sessionID);

    const data = await fetchUsageSummary();
    if (!data?.ok) {
      if (data?.kind === "error") {
        await showErrorToastOnce(data.errorKey, data.errorMessage);
      }
      return;
    }

    lastErrorKey = null;
    markSessionNotified(sessionID);
    output.parts.push(...buildUsageOutputParts(formatUsageMessage({ ...data, modelMeta })));
  },

  event: async ({ event }) => {
    if (event?.type !== "session.idle") return;
    const sessionID = event?.properties?.sessionID;
    const modelMeta = canNotifySession(sessionID);
    if (!modelMeta) return;

    clearPendingIdleFallback(sessionID);
    const timer = setTimeout(async () => {
      pendingIdleFallbackBySession.delete(sessionID);
      const fallbackModelMeta = canNotifySession(sessionID);
      if (!fallbackModelMeta) return;

      const data = await fetchUsageSummary();
      if (!data?.ok) {
        if (data?.kind === "error") {
          await showErrorToastOnce(data.errorKey, data.errorMessage);
        }
        return;
      }

      lastErrorKey = null;
      markSessionNotified(sessionID);
      // no console success output; fallback only preserves state coordination
    }, 25);

    pendingIdleFallbackBySession.set(sessionID, { timer });
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test index.test.js`
Expected: PASS with updated interactive-output tests and no success-path console rendering failures.

- [ ] **Step 5: Commit**

```bash
git add index.js index.test.js
git commit -m "fix opencode usage status rendering"
```

### Task 2: Update docs, installed copy expectations, and project memory

**Files:**
- Modify: `README.md`
- Modify: `project-map.md`

**Does NOT cover:**
- Does not change installation method or package identity.
- Does not alter backend documentation in `/workspaces/9router-plus`.

- [ ] **Step 1: Write failing test**

```js
test("README documents interactive UI status behavior and last24h default", async () => {
  const { readFile } = await import("node:fs/promises");
  const readme = await readFile(new URL("./README.md", import.meta.url), "utf8");

  assert.match(readme, /interactive OpenCode UI/i);
  assert.match(readme, /last24h/i);
  assert.doesNotMatch(readme, /success toast/i);
  assert.doesNotMatch(readme, /default period.*today/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test index.test.js`
Expected: FAIL because the new README assertion is not yet reflected in the current documentation.

- [ ] **Step 3: Implement minimal change**

```md
## Behavior

- For eligible 9router turns, the plugin shows a visible usage block in the normal interactive OpenCode UI.
- Default period is `last24h` unless overridden in `~/.config/opencode/9router-usage.json`.
- Success notifications do not use toast notifications.
- Error reporting may still use a deduplicated error toast when enabled.

## Display Location

The usage block is intended to appear in the normal OpenCode response flow, similar to other visible status text, instead of only CLI/log output.
```

```md
## Critical Constraints
- Target platform: OpenCode plugin system using `@opencode-ai/plugin` SDK v1.14.24.
- Current plugin repository is no longer an empty scaffold; `index.js`, `index.test.js`, `README.md`, and `scripts/quick-setup.js` are load-bearing files.
- Backend endpoint consumed by the plugin is `GET /api/plugin/usage-summary?period=today|last24h|7d` from 9router-plus.
- Success UX target is a visible autopilot-style block in normal interactive OpenCode UI, not success toast delivery.
- Provider gating is fail-closed to allowed providers only; default allowed provider is `9router`.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test index.test.js && node --check index.js`
Expected: PASS, with README assertion green and plugin source still syntactically valid.

- [ ] **Step 5: Commit**

```bash
git add README.md project-map.md index.test.js
git commit -m "docs: refresh usage ui behavior"
```

## Self-Review

### Spec coverage
- UI-native success rendering path: covered by Task 1.
- One visible block per turn / dedupe / fallback behavior: covered by Task 1 tests and implementation.
- Documentation + stale memory refresh: covered by Task 2.
- Installed-copy sync is intentionally not a coding task here; it should be performed after implementation verification.

### Placeholder scan
- No `TBD` / `TODO` placeholders remain.
- Each task includes exact files, commands, and concrete code snippets.

### Type consistency
- Plan consistently uses `command.execute.before`, `output.parts`, `formatUsageMessage`, `canNotifySession`, and `markSessionNotified`.
- No conflicting function names introduced across tasks.
