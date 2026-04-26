// 9Router Usage Notifier Plugin for OpenCode
import { readFile } from "node:fs/promises";
import path from "node:path";

const VALID_PERIODS = new Set(["today", "last24h", "7d"]);
const EXTERNAL_CONFIG_FILENAME = "9router-usage.json";
function formatMetric(label, value) {
  return `${label} ${value}`;
}

function normalizePeriod(value) {
  return VALID_PERIODS.has(value) ? value : "today";
}

function normalizeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function normalizeSummary(raw = {}) {
  return {
    totalRequests: normalizeNumber(raw.totalRequests ?? raw.requests),
    totalInputTokens: normalizeNumber(raw.totalInputTokens ?? raw.promptTokens),
    totalOutputTokens: normalizeNumber(raw.totalOutputTokens ?? raw.completionTokens),
    estimatedCost: normalizeNumber(raw.estimatedCost ?? raw.cost),
  };
}

function normalizeAllowedProviders(value) {
  if (!Array.isArray(value)) return ["9router"];
  const result = value
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);
  return result.length > 0 ? result : ["9router"];
}

function normalizeSuccessDisplay(value) {
  const normalized = String(value || "inline").trim().toLowerCase();
  if (["inline", "toast", "both"].includes(normalized)) return normalized;
  return "inline";
}

function shouldRenderInline(successDisplay) {
  return successDisplay === "inline" || successDisplay === "both";
}

function shouldShowSuccessToast(successDisplay) {
  return successDisplay === "toast" || successDisplay === "both";
}

function matchesAllowedProvider(modelMeta, allowedProviders) {
  const providerID = String(modelMeta?.providerID || "").trim().toLowerCase();
  const modelID = String(modelMeta?.modelID || "").trim().toLowerCase();
  if (!providerID && !modelID) return false;

  return allowedProviders.some((name) => {
    const allowedName = String(name).trim().toLowerCase();
    return providerID === allowedName || modelID === allowedName || modelID.startsWith(`${allowedName}/`);
  });
}

function getExternalConfigPath() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return null;
  return path.join(home, ".config", "opencode", EXTERNAL_CONFIG_FILENAME);
}

async function loadExternalConfig() {
  const configPath = getExternalConfigPath();
  if (!configPath) return {};

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function formatCurrencyCompact(value) {
  return `$${Math.round(value)}`;
}

function formatTokenCount(value) {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

function formatRequestCount(value) {
  return String(Math.round(value));
}

function formatPeriodLabel(period) {
  return period.toUpperCase();
}

function formatHeaderLine(period, summary) {
  return [
    `9ROUTER ${formatPeriodLabel(period)}`,
    formatMetric("REQ", formatRequestCount(summary.totalRequests)),
  ].join(" · ");
}

function formatToastTitle(period, summary) {
  return [`9ROUTER ${formatPeriodLabel(period)}`, formatCurrencyCompact(summary.estimatedCost)].join(" · ");
}

function formatDetailLine(summary) {
  return [
    formatCurrencyCompact(summary.estimatedCost),
    formatMetric("IN", formatTokenCount(summary.totalInputTokens)),
    formatMetric("OUT", formatTokenCount(summary.totalOutputTokens)),
  ].join(" · ");
}

function formatToastMessage(summary) {
  return [formatMetric("TOTAL REQUEST", formatRequestCount(summary.totalRequests)), [formatMetric("IN", formatTokenCount(summary.totalInputTokens)), formatMetric("OUT", formatTokenCount(summary.totalOutputTokens))].join(" · ")].join("\n");
}

function formatPlainUsageLine(period, summary) {
  return [formatHeaderLine(period, summary), formatDetailLine(summary)].join(" · ");
}

function shouldUseBadge(outputText = "") {
  return typeof outputText === "string" && outputText.length > 0;
}

function buildUsageBlock(period, summary) {
  const line = [formatHeaderLine(period, summary), formatDetailLine(summary)].join(" · ");
  const border = "─".repeat(line.length);
  return ["", "", border, line, border, ""].join("\n");
}

function formatUsageMessage(data, outputText = "") {
  const { period, summary } = data;
  return buildUsageBlock(period, summary, shouldUseBadge(outputText));
}

export const NineRouterUsagePlugin = async (ctx, options = {}) => {
  const externalConfig = await loadExternalConfig();
  const config = {
    baseURL: "http://localhost:20128",
    period: "today",
    enabled: true,
    toast: true,
    successDisplay: "toast",
    minNotifyIntervalMs: 1500,
    requestTimeoutMs: 3500,
    allowedProviders: ["9router"],
    ...externalConfig,
    ...options,
  };

  config.period = normalizePeriod(config.period);
  config.allowedProviders = normalizeAllowedProviders(config.allowedProviders);
  config.successDisplay = normalizeSuccessDisplay(config.successDisplay);
  const toastEnabled = config.toast !== false;

  const lastNotifiedAtBySession = new Map();
  let lastErrorKey = null;
  const sessionModelById = new Map();
  const pendingIdleFallbackBySession = new Map();

  function getAllowedModelMeta(sessionID) {
    if (!sessionID) return null;

    const modelMeta = sessionModelById.get(sessionID);
    if (!matchesAllowedProvider(modelMeta, config.allowedProviders)) return null;

    return modelMeta;
  }

  function canNotifySession(sessionID) {
    const modelMeta = getAllowedModelMeta(sessionID);
    if (!modelMeta) return null;

    const now = Date.now();
    const last = lastNotifiedAtBySession.get(sessionID) || 0;
    if (now - last < config.minNotifyIntervalMs) return null;

    return modelMeta;
  }

  function markSessionNotified(sessionID) {
    if (!sessionID) return;
    lastNotifiedAtBySession.set(sessionID, Date.now());
  }

  function clearPendingIdleFallback(sessionID) {
    const pending = pendingIdleFallbackBySession.get(sessionID);
    if (!pending) return;

    clearTimeout(pending.timer);
    pendingIdleFallbackBySession.delete(sessionID);
  }

  async function fetchUsageSummary() {
    if (!config.enabled) return { ok: false, kind: "disabled" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const url = `${config.baseURL}/api/plugin/usage-summary?period=${config.period}`;
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        return {
          ok: false,
          kind: "error",
          errorKey: `status:${response.status}`,
          errorMessage: `API returned ${response.status}`,
        };
      }

      const data = await response.json();
      if (!data?.ok || !data?.summary) {
        const apiError = data?.error || "Invalid response";
        return {
          ok: false,
          kind: "error",
          errorKey: `payload:${apiError}`,
          errorMessage: `API error: ${apiError}`,
        };
      }

      return {
        ok: true,
        period: data.period || config.period,
        summary: normalizeSummary(data.summary),
      };
    } catch (error) {
      const message = error?.name === "AbortError" ? "Request timed out" : error?.message || "Unknown runtime error";
      return {
        ok: false,
        kind: "error",
        errorKey: `runtime:${message}`,
        errorMessage: `Request failed: ${message}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function logToastFailure(error) {
    await ctx.client?.app?.log?.({
      body: {
        service: "opencode-9router-usage",
        level: "warn",
        message: "Failed to show TUI toast",
        extra: {
          error: error instanceof Error ? error.message : String(error),
        },
      },
    }).catch(() => {});
  }

  async function showToast(body) {
    if (!toastEnabled) return;

    try {
      await ctx.client?.tui?.showToast?.({ body });
    } catch (error) {
      await logToastFailure(error);
    }
  }

  async function showErrorToastOnce(errorKey, errorMessage) {
    if (!toastEnabled) return;
    if (!errorKey || errorKey === lastErrorKey) return;

    lastErrorKey = errorKey;
    await showToast({
      title: "9Router Usage Error",
      message: errorMessage,
      variant: "error",
      duration: 5000,
    });
  }

  async function showSuccessToast(data) {
    if (!shouldShowSuccessToast(config.successDisplay)) return;

    await showToast({
      title: formatToastTitle(data.period, data.summary),
      message: formatToastMessage(data.summary),
      variant: "info",
      duration: 5000,
    });
  }

  function applySuccessOutput(data, output) {
    if (!shouldRenderInline(config.successDisplay)) return;
    output.text = `${output.text}${formatUsageMessage(data, output.text)}`;
  }

  async function handleSuccess(sessionID, data, output) {
    lastErrorKey = null;
    markSessionNotified(sessionID);
    await showSuccessToast(data);
    if (output) applySuccessOutput(data, output);
  }

  async function handleSummaryResult(sessionID, data, output) {
    if (!data?.ok) {
      if (data?.kind === "error") {
        await showErrorToastOnce(data.errorKey, data.errorMessage);
      }
      return false;
    }

    await handleSuccess(sessionID, data, output);
    return true;
  }

  function createInlineOutput() {
    return { text: "" };
  }

  function shouldPrintIdleFallback() {
    return !shouldShowSuccessToast(config.successDisplay) && !shouldRenderInline(config.successDisplay);
  }

  function printIdleFallback(output) {
    if (!output?.text) return;
    console.log(output.text);
  }

  function createIdleFallbackOutput() {
    if (shouldRenderInline(config.successDisplay)) return createInlineOutput();
    return shouldPrintIdleFallback() ? createInlineOutput() : null;
  }

  async function handleIdleFallbackSuccess(sessionID, data) {
    const output = createIdleFallbackOutput();
    const handled = await handleSummaryResult(sessionID, data, output);
    if (!handled) return;
    if (shouldPrintIdleFallback()) {
      printIdleFallback(output);
    }
  }

  async function handleTextCompleteSuccess(sessionID, data, output) {
    await handleSummaryResult(sessionID, data, output);
  }

  function shouldSkipTextOutput() {
    return !shouldRenderInline(config.successDisplay);
  }

  function cloneOutput(output) {
    return { text: output.text };
  }

  function applyClonedOutput(source, target) {
    target.text = source.text;
  }

  async function handleTextComplete(sessionID, data, output) {
    if (shouldSkipTextOutput()) {
      await handleSummaryResult(sessionID, data, null);
      return;
    }

    const nextOutput = cloneOutput(output);
    const handled = await handleSummaryResult(sessionID, data, nextOutput);
    if (!handled) return;
    applyClonedOutput(nextOutput, output);
  }


  return {
    name: "opencode-9router-usage",

    "chat.message": async (input) => {
      const providerID = input?.model?.providerID;
      const modelID = input?.model?.modelID;
      if (!providerID) return;
      sessionModelById.set(input.sessionID, { providerID, modelID });
    },

    "chat.params": async (input) => {
      const providerID = input?.model?.providerID || input?.provider?.info?.id;
      const modelID = input?.model?.id;
      if (!providerID && !modelID) return;
      sessionModelById.set(input.sessionID, { providerID, modelID });
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
        await handleIdleFallbackSuccess(sessionID, data);
      }, 25);

      pendingIdleFallbackBySession.set(sessionID, { timer });
    },

    "experimental.text.complete": async (input, output) => {
      const sessionID = input?.sessionID;
      const modelMeta = canNotifySession(sessionID);
      if (!modelMeta) return;

      clearPendingIdleFallback(sessionID);

      const data = await fetchUsageSummary();
      await handleTextComplete(sessionID, data, output);
    },
  };
};

export default NineRouterUsagePlugin;
