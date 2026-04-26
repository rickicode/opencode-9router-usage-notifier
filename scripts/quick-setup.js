#!/usr/bin/env node
import { mkdir, writeFile, access, copyFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_FILENAME = "9routerplus-usage.json";
const LEGACY_CONFIG_FILENAME = "9router-usage.json";

export const defaultConfig = {
  baseURL: "http://localhost:20128",
  period: "today",
  enabled: true,
  toast: true,
  successDisplay: "toast",
  minNotifyIntervalMs: 1500,
  requestTimeoutMs: 3500,
  allowedProviders: ["9routerplus"],
};

export function getHomeDirectory(env = process.env) {
  return env.HOME || env.USERPROFILE || null;
}

export function getOpencodeDir(home = getHomeDirectory()) {
  if (!home) return null;
  return path.join(home, ".config", "opencode");
}

export function getConfigPath(home = getHomeDirectory()) {
  const opencodeDir = getOpencodeDir(home);
  if (!opencodeDir) return null;
  return path.join(opencodeDir, CONFIG_FILENAME);
}

export function getLegacyConfigPath(home = getHomeDirectory()) {
  const opencodeDir = getOpencodeDir(home);
  if (!opencodeDir) return null;
  return path.join(opencodeDir, LEGACY_CONFIG_FILENAME);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDefaultConfig(home = getHomeDirectory()) {
  if (!home) {
    throw new Error("Cannot determine HOME directory");
  }

  const opencodeDir = getOpencodeDir(home);
  const configPath = getConfigPath(home);
  const legacyConfigPath = getLegacyConfigPath(home);
  await mkdir(opencodeDir, { recursive: true });

  if (await exists(configPath)) {
    return { created: false, migrated: false, configPath };
  }

  if (await exists(legacyConfigPath)) {
    await copyFile(legacyConfigPath, configPath);
    return { created: true, migrated: true, configPath };
  }

  await writeFile(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf8");
  return { created: true, migrated: false, configPath };
}

async function main() {
  const result = await ensureDefaultConfig();

  if (!result.created) {
    console.log(`[9routerplus-usage] Config already exists: ${result.configPath}`);
    console.log("[9routerplus-usage] Skip overwrite. Delete file first if you want to recreate.");
    return;
  }

  if (result.migrated) {
    console.log(`[9routerplus-usage] Migrated config to: ${result.configPath}`);
    return;
  }

  console.log(`[9routerplus-usage] Created config: ${result.configPath}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
  main().catch((error) => {
    console.error(`[9routerplus-usage] Setup failed: ${error?.message || error}`);
    process.exit(1);
  });
}
