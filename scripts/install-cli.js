#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDefaultConfig, getHomeDirectory, getOpencodeDir } from "./quick-setup.js";

const PACKAGE_NAME = "opencode-9routerplus-usage";
const CONFIG_FILENAME = "opencode.json";
const LOG_PREFIX = "[9routerplus-usage]";

function getOpencodeConfigPath(home = getHomeDirectory()) {
  const opencodeDir = getOpencodeDir(home);
  if (!opencodeDir) return null;
  return path.join(opencodeDir, CONFIG_FILENAME);
}

async function loadConfig(configPath) {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { $schema: "https://opencode.ai/config.json" };
    }
    throw error;
  }
}

function ensurePluginEntry(config) {
  const plugin = Array.isArray(config.plugin) ? [...config.plugin] : [];
  const hasEntry = plugin.includes(PACKAGE_NAME);
  if (!hasEntry) plugin.push(PACKAGE_NAME);
  return {
    config: {
      ...config,
      plugin,
    },
    added: !hasEntry,
  };
}

export async function installFromPackage(home = getHomeDirectory()) {
  if (!home) {
    throw new Error("Cannot determine HOME directory");
  }

  const opencodeDir = getOpencodeDir(home);
  const opencodeConfigPath = getOpencodeConfigPath(home);
  await mkdir(opencodeDir, { recursive: true });

  const setupResult = await ensureDefaultConfig(home);
  const config = await loadConfig(opencodeConfigPath);
  const { config: nextConfig, added } = ensurePluginEntry(config);
  await writeFile(opencodeConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  const installedUsageConfig = await loadConfig(setupResult.configPath);

  return {
    configPath: setupResult.configPath,
    configCreated: setupResult.created,
    configMigrated: setupResult.migrated,
    installedUsageConfig,
    opencodeConfigPath,
    pluginRegistered: added,
    packageName: PACKAGE_NAME,
  };
}

function formatUsageConfigStatus(config) {
  return JSON.stringify(config, null, 2);
}

function printUsageConfigStatus(configPath, config) {
  console.log(`${LOG_PREFIX} Installed usage config: ${configPath}`);
  console.log(formatUsageConfigStatus(config));
}

function getConfigActionLabel(result) {
  return result.configMigrated ? "Migrated config" : "Created config";
}

function printInstallSummary(result) {
  if (result.configCreated) {
    console.log(`${LOG_PREFIX} ${getConfigActionLabel(result)}: ${result.configPath}`);
  } else {
    console.log(`${LOG_PREFIX} Config already exists: ${result.configPath}`);
  }

  if (result.pluginRegistered) {
    console.log(`${LOG_PREFIX} Added plugin package to ${result.opencodeConfigPath}`);
  } else {
    console.log(`${LOG_PREFIX} Plugin package already present in ${result.opencodeConfigPath}`);
  }

  console.log(`${LOG_PREFIX} OpenCode will install/load plugin package: ${result.packageName}`);
  console.log(`${LOG_PREFIX} If 9routerplus is not at http://localhost:20128, update baseURL in ${result.configPath}`);
  console.log(`${LOG_PREFIX} If your OpenCode provider name is 9router or your model namespace is not 9routerplus, update allowedProviders in ${result.configPath} to match the real provider/model name.`);
  printUsageConfigStatus(result.configPath, result.installedUsageConfig);
}

export { formatUsageConfigStatus, printUsageConfigStatus, printInstallSummary };

async function main() {
  const result = await installFromPackage();
  printInstallSummary(result);
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} Install failed: ${error?.message || error}`);
  process.exit(1);
});
