import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(testFile), "../..");

async function importDefaultModule(relativePath) {
  const result = await import(relativePath).catch((error) => ({ importError: error }));
  assert.ifError(result.importError);
  return result;
}

test("DEFAULT_ENTRY matches config/entry.json", async () => {
  const { DEFAULT_ENTRY, ENTRY_CONFIG_KEY } = await importDefaultModule("../../src/core/defaults/entry.mjs");
  const onDisk = JSON.parse(fs.readFileSync(path.join(rootDir, "config/entry.json"), "utf8"));

  assert.equal(ENTRY_CONFIG_KEY, "entry");
  assert.deepEqual(DEFAULT_ENTRY, onDisk);
});

test("DEFAULT_ENTRY routes agents through query commands instead of JSON indexes", async () => {
  const { DEFAULT_ENTRY } = await importDefaultModule("../../src/core/defaults/entry.mjs");
  const routingText = JSON.stringify({
    purpose: DEFAULT_ENTRY.purpose,
    defaultBehavior: DEFAULT_ENTRY.defaultBehavior,
    defaultReadOrder: DEFAULT_ENTRY.defaultReadOrder,
    routingDecision: DEFAULT_ENTRY.routingDecision,
    sourceReadPolicy: DEFAULT_ENTRY.sourceReadPolicy
  });

  assert.match(routingText, /devflow query route/);
  assert.match(routingText, /devflow query current/);
  assert.match(routingText, /devflow query skills/);
  assert.match(routingText, /devflow query rules/);
  assert.doesNotMatch(routingText, /config\/(?:entry\.json|projects\/index\.json|projects\/<project-id>\.json|scenes\/index\.json|scenes\/<scene-id>\.json|skills\/skills\.json|rules\/rules\.json)|runtime\/current\.json/);
});

test("DEFAULT_PROFILE matches config/profile.json", async () => {
  const { DEFAULT_PROFILE, PROFILE_CONFIG_KEY } = await importDefaultModule("../../src/core/defaults/profile.mjs");
  const onDisk = JSON.parse(fs.readFileSync(path.join(rootDir, "config/profile.json"), "utf8"));

  assert.equal(PROFILE_CONFIG_KEY, "profile");
  assert.deepEqual(DEFAULT_PROFILE, onDisk);
});

test("DEFAULT_GATES matches config/tasks/gates.json", async () => {
  const { DEFAULT_GATES, GATES_CONFIG_KEY } = await importDefaultModule("../../src/core/defaults/gates.mjs");
  const onDisk = JSON.parse(fs.readFileSync(path.join(rootDir, "config/tasks/gates.json"), "utf8"));

  assert.equal(GATES_CONFIG_KEY, "gates");
  assert.deepEqual(DEFAULT_GATES, onDisk);
});

test("DEFAULT_CURRENT is an empty fresh-install runtime pointer", async () => {
  const { DEFAULT_CURRENT, CURRENT_RUNTIME_KEY } = await importDefaultModule("../../src/core/defaults/current.mjs");

  assert.equal(CURRENT_RUNTIME_KEY, "current");
  assert.deepEqual(DEFAULT_CURRENT, {
    version: 1,
    activeTaskId: "",
    activeTaskPath: "",
    activeWorksetId: "",
    activeProjectIds: [],
    activeSceneTemplateId: "",
    activeSceneIds: [],
    currentGate: "",
    recentTaskIds: []
  });
});
