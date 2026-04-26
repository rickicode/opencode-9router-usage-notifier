#!/usr/bin/env node
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const home = process.env.HOME || process.env.USERPROFILE;

if (!home) {
  console.error("[9router-usage] Cannot determine HOME directory");
  process.exit(1);
}

const opencodeDir = path.join(home, ".config", "opencode");
const configPath = path.join(opencodeDir, "9router-usage.json");

const defaultConfig = {
  baseURL: "http://localhost:20128",
  period: "today",
  enabled: true,
  toast: true,
  minNotifyIntervalMs: 1500,
  requestTimeoutMs: 3500,
  allowedProviders: ["9router"],
};

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(opencodeDir, { recursive: true });

  if (await exists(configPath)) {
    console.log(`[9router-usage] Config already exists: ${configPath}`);
    console.log("[9router-usage] Skip overwrite. Delete file first if you want to recreate.");
    return;
  }

  await writeFile(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf8");
  console.log(`[9router-usage] Created config: ${configPath}`);
}

main().catch((error) => {
  console.error(`[9router-usage] Setup failed: ${error?.message || error}`);
  process.exit(1);
});
