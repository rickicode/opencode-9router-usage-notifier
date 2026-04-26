#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDefaultConfig, getHomeDirectory, getOpencodeDir } from "./quick-setup.js";

const PACKAGE_NAME = "opencode-9router-usage";
const CONFIG_FILENAME = "opencode.json";

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

  return {
    configPath: setupResult.configPath,
    configCreated: setupResult.created,
    opencodeConfigPath,
    pluginRegistered: added,
    packageName: PACKAGE_NAME,
  };
}

async function main() {
  const result = await installFromPackage();

  if (result.configCreated) {
    console.log(`[9router-usage] Created config: ${result.configPath}`);
  } else {
    console.log(`[9router-usage] Config already exists: ${result.configPath}`);
  }

  if (result.pluginRegistered) {
    console.log(`[9router-usage] Added plugin package to ${result.opencodeConfigPath}`);
  } else {
    console.log(`[9router-usage] Plugin package already present in ${result.opencodeConfigPath}`);
  }

  console.log(`[9router-usage] OpenCode will install/load plugin package: ${result.packageName}`);
}

main().catch((error) => {
  console.error(`[9router-usage] Install failed: ${error?.message || error}`);
  process.exit(1);
});
