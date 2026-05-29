import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runChecks } from "../../src/core/checks.mjs";
import { seedSqliteFromJsonFixture } from "../helpers/sqlite-fixtures.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));

async function copyFixture(name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "devflow-checks-"));
  await fs.cp(path.join(testDir, "fixtures", name), root, { recursive: true });
  await seedSqliteFromJsonFixture(root);
  return root;
}

test("runChecks reports profile, optional panel app, and project docs as structured checks", async () => {
  const rootDir = await copyFixture("basic-ai-context");
  try {
    const result = await runChecks({ rootDir, runCommands: false });

    assert.ok(result.checks.find((check) => check.id === "panel_app_resolved" && check.status === "pass"));
    assert.ok(result.checks.find((check) => check.id === "profile_json" && check.status === "pass"));
    assert.ok(result.checks.find((check) => check.id === "person_profile_doc" && check.status === "pass"));
    assert.ok(result.checks.find((check) => check.id === "project_docs" && check.status === "pass"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("runChecks treats missing legacy profile JSON as SQLite default state", async () => {
  const rootDir = await copyFixture("missing-profile-ai-context");
  try {
    const result = await runChecks({ rootDir, runCommands: false });

    assert.ok(result.checks.find((check) => check.id === "profile_json" && check.status === "pass"));
    assert.ok(result.checks.find((check) => check.id === "person_profile_doc" && check.status === "pass"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("runChecks reports active task, graph references, script commands, skill links, and project entry drift", async () => {
  const rootDir = await copyFixture("basic-ai-context");
  try {
    const result = await runChecks({ rootDir, runCommands: false });
    const ids = new Set(result.checks.map((check) => check.id));

    assert.equal(ids.has("active_task_path"), true);
    assert.equal(ids.has("graph_references"), true);
    assert.equal(ids.has("install_command"), true);
    assert.equal(ids.has("install_check_command"), true);
    assert.equal(ids.has("install_validate_command"), true);
    assert.equal(ids.has("openspec_cli"), true);
    assert.equal(ids.has("ai_context_skill_links"), true);
    assert.equal(ids.has("project_entry_sync_drift"), true);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("runChecks reports missing OpenSpec as a warning", async () => {
  const rootDir = await copyFixture("basic-ai-context");
  const originalPath = process.env.PATH;
  process.env.PATH = `/bin${path.delimiter}/usr/bin`;
  try {
    const result = await runChecks({ rootDir, runCommands: false });
    const openspec = result.checks.find((check) => check.id === "openspec_cli");

    assert.equal(openspec.status, "warning");
    assert.match(openspec.message, /OpenSpec CLI missing/);
  } finally {
    process.env.PATH = originalPath;
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("runChecks reads SQLite when legacy config and runtime JSON are absent", async () => {
  const rootDir = await copyFixture("basic-ai-context");
  try {
    await fs.rm(path.join(rootDir, "config"), { recursive: true, force: true });
    await fs.rm(path.join(rootDir, "runtime"), { recursive: true, force: true });

    const result = await runChecks({ rootDir, runCommands: false });

    assert.ok(result.checks.find((check) => check.id === "profile_json" && check.status === "pass"));
    assert.ok(result.checks.find((check) => check.id === "projects_index" && check.status === "pass"));
    assert.ok(result.checks.find((check) => check.id === "runtime_current" && check.status === "pass"));
    assert.ok(result.checks.find((check) => check.id === "active_task_path" && check.status === "pass"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("runChecks reports a clear migration error when legacy JSON exists without SQLite", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "devflow-checks-legacy-"));
  try {
    await fs.cp(path.join(testDir, "fixtures", "basic-ai-context"), rootDir, { recursive: true });

    const result = await runChecks({ rootDir, runCommands: false });
    const storageCheck = result.checks.find((check) => check.id === "sqlite_database");

    assert.equal(storageCheck.status, "fail");
    assert.match(storageCheck.message, /devflow migrate from-json/);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
