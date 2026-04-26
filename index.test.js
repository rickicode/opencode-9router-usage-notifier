import test from "node:test";
import assert from "node:assert/strict";

import { NineRouterUsagePlugin } from "./index.js";

function createFetchMock(handler) {
  const calls = [];
  const mock = async (input, init) => {
    calls.push({ input, init });
    return handler(input, init);
  };
  mock.calls = calls;
  return mock;
}

test("shows success toast by default without adding inline output", async () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;

  process.env.HOME = "/tmp/9routerplus-plugin-tests-no-config";

  const fetchMock = createFetchMock(async (input) => {
    const url = String(input);
    if (url.includes("/api/plugin/usage-summary?period=today")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            period: "today",
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
  const toastCalls = [];

  try {
    const plugin = await NineRouterUsagePlugin({
      serverUrl: "http://localhost:4096",
      directory: "/workspaces/plugin-9router-plus",
      client: {
        tui: {
          showToast: async (payload) => {
            toastCalls.push(payload);
          },
        },
      },
    });

    await plugin["chat.params"](
      {
        sessionID: "session-1",
        agent: "test",
        model: { id: "sonnet", providerID: "9routerplus" },
        provider: { info: { id: "9routerplus" } },
        message: {},
      },
      {},
    );

    const output = { text: "Assistant answer" };
    await plugin["experimental.text.complete"](
      { sessionID: "session-1", messageID: "m1", partID: "p1" },
      output,
    );

    assert.equal(fetchMock.calls.length, 1);
    assert.equal(output.text, "Assistant answer");
    assert.equal(toastCalls.length, 1);
    assert.equal(toastCalls[0].body.title, "9ROUTERPLUS TODAY · $0");
    assert.equal(toastCalls[0].body.message, "TOTAL REQUEST 12\nIN 1K · OUT 567");
  } finally {
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
  }
});


test("uses today as the default period for success toast summaries", async () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;

  process.env.HOME = "/tmp/9routerplus-plugin-tests-no-config";

  const fetchMock = createFetchMock(async (input) => {
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          period: "today",
          summary: {
            totalRequests: 1,
            totalInputTokens: 10,
            totalOutputTokens: 20,
            estimatedCost: 0.01,
          },
        };
      },
    };
  });

  global.fetch = fetchMock;
  const toastCalls = [];

  try {
    const plugin = await NineRouterUsagePlugin({
      serverUrl: "http://localhost:4096",
      directory: "/workspaces/plugin-9router-plus",
      client: {
        tui: {
          showToast: async (payload) => {
            toastCalls.push(payload);
          },
        },
      },
    });

    await plugin["chat.params"](
      {
        sessionID: "session-2",
        agent: "test",
        model: { id: "sonnet", providerID: "9routerplus" },
        provider: { info: { id: "9routerplus" } },
        message: {},
      },
      {},
    );

    const output = { text: "Done" };
    await plugin["experimental.text.complete"](
      { sessionID: "session-2", messageID: "m2", partID: "p2" },
      output,
    );

    assert.equal(fetchMock.calls.length, 1);
    assert.match(String(fetchMock.calls[0].input), /period=today/);
    assert.equal(toastCalls[0].body.title, "9ROUTERPLUS TODAY · $0");
    assert.equal(toastCalls[0].body.message, "TOTAL REQUEST 1\nIN 10 · OUT 20");
  } finally {
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
  }
});


test("prefers completed text as the success path even if session.idle fires first", async () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;

  process.env.HOME = "/tmp/9routerplus-plugin-tests-no-config";

  const fetchMock = createFetchMock(async (input) => {
    const url = String(input);
    if (url.includes("/api/plugin/usage-summary?period=today")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            period: "today",
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

  const originalConsoleLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));
  const toastCalls = [];

  try {
    const plugin = await NineRouterUsagePlugin({
      serverUrl: "http://localhost:4096",
      directory: "/workspaces/plugin-9router-plus",
      client: {
        tui: {
          showToast: async (payload) => {
            toastCalls.push(payload);
          },
        },
      },
    });

    await plugin["chat.params"](
      {
        sessionID: "session-dedupe",
        agent: "test",
        model: { id: "sonnet", providerID: "9routerplus" },
        provider: { info: { id: "9routerplus" } },
        message: {},
      },
      {},
    );

    await plugin.event({
      event: { type: "session.idle", properties: { sessionID: "session-dedupe" } },
    });

    const output = { text: "Assistant answer" };
    await plugin["experimental.text.complete"](
      { sessionID: "session-dedupe", messageID: "m3", partID: "p3" },
      output,
    );

    assert.equal(fetchMock.calls.length, 1);
    assert.equal(toastCalls.length, 1);
    assert.equal(logs.filter((line) => line.includes("9ROUTERPLUS TODAY")).length, 0);
    assert.equal(output.text, "Assistant answer");
  } finally {
    console.log = originalConsoleLog;
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
  }
});


test("does not consume debounce state on failed idle fallback before completed text succeeds", async () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;

  process.env.HOME = "/tmp/9routerplus-plugin-tests-no-config";

  let summaryRequestCount = 0;
  const fetchMock = createFetchMock(async (input) => {
    const url = String(input);
    if (url.includes("/api/plugin/usage-summary?period=today")) {
      summaryRequestCount += 1;

      if (summaryRequestCount === 1) {
        return {
          ok: false,
          status: 500,
        };
      }

      return {
        ok: true,
        async json() {
          return {
            ok: true,
            period: "today",
            summary: {
              totalRequests: 4,
              totalInputTokens: 40,
              totalOutputTokens: 50,
              estimatedCost: 0.04,
            },
          };
        },
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });

  global.fetch = fetchMock;

  const originalConsoleLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));

  const toastCalls = [];

  try {
    const plugin = await NineRouterUsagePlugin({
      serverUrl: "http://localhost:4096",
      directory: "/workspaces/plugin-9router-plus",
      client: {
        tui: {
          showToast: async (payload) => {
            toastCalls.push(payload);
          },
        },
      },
    });

    await plugin["chat.params"](
      {
        sessionID: "session-failed-idle",
        agent: "test",
        model: { id: "sonnet", providerID: "9routerplus" },
        provider: { info: { id: "9routerplus" } },
        message: {},
      },
      {},
    );

    await plugin.event({
      event: { type: "session.idle", properties: { sessionID: "session-failed-idle" } },
    });

    await new Promise((resolve) => setTimeout(resolve, 40));

    const output = { text: "Assistant answer" };
    await plugin["experimental.text.complete"](
      { sessionID: "session-failed-idle", messageID: "m6", partID: "p6" },
      output,
    );

    assert.equal(summaryRequestCount, 2);
    assert.equal(toastCalls.length, 2);
    assert.equal(logs.filter((line) => line.includes("9ROUTERPLUS TODAY")).length, 0);
    assert.equal(output.text, "Assistant answer");
  } finally {
    console.log = originalConsoleLog;
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
  }
});


test("does not emit success status when provider is not allowed", async () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;

  process.env.HOME = "/tmp/9routerplus-plugin-tests-no-config";

  const fetchMock = createFetchMock(async (input) => {
    throw new Error(`Unexpected fetch: ${String(input)}`);
  });

  global.fetch = fetchMock;

  const originalConsoleLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));

  try {
    const plugin = await NineRouterUsagePlugin(
      {
        serverUrl: "http://localhost:4096",
        directory: "/workspaces/plugin-9router-plus",
      },
      { allowedProviders: ["9routerplus"] },
    );

    await plugin["chat.params"](
      {
        sessionID: "session-other-provider",
        agent: "test",
        model: { id: "sonnet", providerID: "openai" },
        provider: { info: { id: "openai" } },
        message: {},
      },
      {},
    );

    await plugin.event({
      event: { type: "session.idle", properties: { sessionID: "session-other-provider" } },
    });

    const output = { text: "Assistant answer" };
    await plugin["experimental.text.complete"](
      { sessionID: "session-other-provider", messageID: "m4", partID: "p4" },
      output,
    );

    assert.equal(fetchMock.calls.length, 0);
    assert.deepEqual(logs, []);
    assert.equal(output.text, "Assistant answer");
  } finally {
    console.log = originalConsoleLog;
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
  }
});


test("shows usage when model id is namespaced under allowed provider", async () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;

  process.env.HOME = "/tmp/9routerplus-plugin-tests-no-config";

  const fetchMock = createFetchMock(async (input) => {
    const url = String(input);
    if (url.includes("/api/plugin/usage-summary?period=today")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            period: "today",
            summary: {
              totalRequests: 3,
              totalInputTokens: 300,
              totalOutputTokens: 150,
              estimatedCost: 0.03,
            },
          };
        },
      };
    }

    throw new Error(`Unexpected fetch: ${String(input)}`);
  });

  global.fetch = fetchMock;
  const toastCalls = [];

  try {
    const plugin = await NineRouterUsagePlugin({
      serverUrl: "http://localhost:4096",
      directory: "/workspaces/plugin-9router-plus",
      client: {
        tui: {
          showToast: async (payload) => {
            toastCalls.push(payload);
          },
        },
      },
    });

    await plugin["chat.params"](
      {
        sessionID: "session-namespaced-model",
        agent: "test",
        model: { id: "9routerplus/cx/gpt-5.3-codex" },
        provider: { info: { id: "openrouter" } },
        message: {},
      },
      {},
    );

    const output = { text: "Assistant answer" };
    await plugin["experimental.text.complete"](
      { sessionID: "session-namespaced-model", messageID: "m5", partID: "p5" },
      output,
    );

    assert.equal(fetchMock.calls.length, 1);
    assert.equal(toastCalls.length, 1);
    assert.equal(toastCalls[0].body.title, "9ROUTERPLUS TODAY · $0");
    assert.equal(toastCalls[0].body.message, "TOTAL REQUEST 3\nIN 300 · OUT 150");
    assert.equal(output.text, "Assistant answer");
    assert.doesNotMatch(toastCalls[0].body.message, /openrouter\/9router\/cx\/gpt-5\.3-codex/);
  } finally {
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
  }
});


test("does not emit success status when provider attribution is missing", async () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;

  process.env.HOME = "/tmp/9routerplus-plugin-tests-no-config";

  const fetchMock = createFetchMock(async (input) => {
    throw new Error(`Unexpected fetch: ${String(input)}`);
  });

  global.fetch = fetchMock;

  const originalConsoleLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));

  try {
    const plugin = await NineRouterUsagePlugin({
      serverUrl: "http://localhost:4096",
      directory: "/workspaces/plugin-9router-plus",
    });

    await plugin.event({
      event: { type: "session.idle", properties: { sessionID: "session-missing-provider" } },
    });

    const output = { text: "Assistant answer" };
    await plugin["experimental.text.complete"](
      { sessionID: "session-missing-provider", messageID: "m5", partID: "p5" },
      output,
    );

    assert.equal(fetchMock.calls.length, 0);
    assert.deepEqual(logs, []);
    assert.equal(output.text, "Assistant answer");
  } finally {
    console.log = originalConsoleLog;
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
  }
});


test("shows success via toast only without adding inline output and still uses one summary request", async () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;

  process.env.HOME = "/tmp/9routerplus-plugin-tests-no-config";

  const fetchMock = createFetchMock(async (input) => {
    const url = String(input);
    if (url.includes("/api/plugin/usage-summary?period=today")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            period: "today",
            summary: {
              totalRequests: 9,
              totalInputTokens: 900,
              totalOutputTokens: 450,
              estimatedCost: 0.12,
            },
          };
        },
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });

  global.fetch = fetchMock;

  const toastCalls = [];

  try {
    const plugin = await NineRouterUsagePlugin(
      {
        serverUrl: "http://localhost:4096",
        directory: "/workspaces/plugin-9router-plus",
        client: {
          tui: {
            showToast: async (payload) => {
              toastCalls.push(payload);
            },
          },
        },
      },
      { successDisplay: "toast" },
    );

    await plugin["chat.params"](
      {
        sessionID: "session-toast-only",
        agent: "test",
        model: { id: "sonnet", providerID: "9routerplus" },
        provider: { info: { id: "9routerplus" } },
        message: {},
      },
      {},
    );

    const output = { text: "Assistant answer" };
    await plugin["experimental.text.complete"](
      { sessionID: "session-toast-only", messageID: "m7", partID: "p7" },
      output,
    );

    assert.equal(fetchMock.calls.length, 1);
    assert.equal(toastCalls.length, 1);
    assert.equal(output.text, "Assistant answer");
    assert.equal(toastCalls[0].body.title, "9ROUTERPLUS TODAY · $0");
    assert.equal(toastCalls[0].body.message, "TOTAL REQUEST 9\nIN 900 · OUT 450");
  } finally {
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
  }
});

test("shows success via both inline output and toast from the same summary request", async () => {
  const originalFetch = global.fetch;
  const originalHome = process.env.HOME;

  process.env.HOME = "/tmp/9routerplus-plugin-tests-no-config";

  const fetchMock = createFetchMock(async (input) => {
    const url = String(input);
    if (url.includes("/api/plugin/usage-summary?period=today")) {
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            period: "today",
            summary: {
              totalRequests: 5,
              totalInputTokens: 1500,
              totalOutputTokens: 750,
              estimatedCost: 1.4,
            },
          };
        },
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });

  global.fetch = fetchMock;

  const toastCalls = [];

  try {
    const plugin = await NineRouterUsagePlugin(
      {
        serverUrl: "http://localhost:4096",
        directory: "/workspaces/plugin-9router-plus",
        client: {
          tui: {
            showToast: async (payload) => {
              toastCalls.push(payload);
            },
          },
        },
      },
      { successDisplay: "both" },
    );

    await plugin["chat.params"](
      {
        sessionID: "session-both",
        agent: "test",
        model: { id: "sonnet", providerID: "9routerplus" },
        provider: { info: { id: "9routerplus" } },
        message: {},
      },
      {},
    );

    const output = { text: "Assistant answer" };
    await plugin["experimental.text.complete"](
      { sessionID: "session-both", messageID: "m8", partID: "p8" },
      output,
    );

    assert.equal(fetchMock.calls.length, 1);
    assert.equal(toastCalls.length, 1);
    assert.match(output.text, /9ROUTERPLUS TODAY · REQ 5 · \$1 · IN 2K · OUT 750/);
  } finally {
    global.fetch = originalFetch;
    process.env.HOME = originalHome;
  }
});