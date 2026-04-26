import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { installFromPackage } from "./scripts/install-cli.js";

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

test("installFromPackage creates config and registers package plugin", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "9routerplus-install-"));

  const result = await installFromPackage(home);
  const pluginConfig = await readJson(result.configPath);
  const opencodeConfig = await readJson(result.opencodeConfigPath);

  assert.equal(result.configCreated, true);
  assert.equal(result.configMigrated, false);
  assert.equal(result.pluginRegistered, true);
  assert.equal(pluginConfig.baseURL, "http://localhost:20128");
  assert.equal(pluginConfig.usageDisplay, "toast");
  assert.deepEqual(pluginConfig.allowedProviders, ["9routerplus"]);
  assert.deepEqual(opencodeConfig.plugin, ["opencode-9routerplus-usage"]);
});

test("installFromPackage preserves existing config and avoids duplicate plugin entries", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "9routerplus-install-existing-"));
  const opencodeDir = path.join(home, ".config", "opencode");
  await mkdir(opencodeDir, { recursive: true });

  await writeFile(
    path.join(opencodeDir, "9routerplus-usage.json"),
    `${JSON.stringify({ baseURL: "http://example.test", period: "7d", usageDisplay: "both" }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(opencodeDir, "opencode.json"),
    `${JSON.stringify({ plugin: ["opencode-9routerplus-usage", "other-plugin"] }, null, 2)}\n`,
    "utf8",
  );

  const result = await installFromPackage(home);
  const pluginConfig = await readJson(result.configPath);
  const opencodeConfig = await readJson(result.opencodeConfigPath);

  assert.equal(result.configCreated, false);
  assert.equal(result.pluginRegistered, false);
  assert.equal(pluginConfig.baseURL, "http://example.test");
  assert.equal(pluginConfig.usageDisplay, "both");
  assert.deepEqual(opencodeConfig.plugin, ["opencode-9routerplus-usage", "other-plugin"]);
});
