import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_GATES } from "../../src/core/defaults/gates.mjs";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "../..");
const cliPath = path.join(repoRoot, "scripts/devflow-cli.mjs");
const fixtureRoot = path.join(repoRoot, "tests/core/fixtures/basic-ai-context");

function copyFixture(prefix = "devflow-cli-migrate-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  const gatesPath = path.join(root, "config/tasks/gates.json");
  fs.mkdirSync(path.dirname(gatesPath), { recursive: true });
  fs.writeFileSync(gatesPath, `${JSON.stringify(DEFAULT_GATES, null, 2)}\n`, "utf8");
  return root;
}

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initCleanGit(root) {
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "devflow-test@example.com"]);
  runGit(root, ["config", "user.name", "DevFlow Test"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "fixture"]);
}

function runCli(rootDir, args) {
  return spawnSync(process.execPath, [cliPath, "--root", rootDir, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf8"
  });
}

function parseJson(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("migrate from-json --dry-run prints a preview without requiring git", () => {
  const root = copyFixture("devflow-cli-migrate-dry-run-");
  const json = parseJson(runCli(root, ["migrate", "from-json", "--dry-run"]));

  assert.equal(json.status, "noop");
  assert.equal(json.action, "migrate from-json");
  assert.equal(json.dryRun, true);
  assert.equal(json.sourceCounts.projects, 1);
  assert.equal(json.sourceCounts.tasks, 2);
  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), false);
});

test("migrate from-json deletes JSON by default and SQLite queries still work afterward", () => {
  const root = copyFixture("devflow-cli-migrate-delete-");
  initCleanGit(root);

  const migrated = parseJson(runCli(root, ["migrate", "from-json"]));
  assert.equal(migrated.status, "ok");
  assert.equal(migrated.deletedJsonPaths.includes("config/entry.json"), true);
  assert.equal(fs.existsSync(path.join(root, "config/entry.json")), false);

  const current = parseJson(runCli(root, ["query", "current"]));
  assert.equal(current.type, "current");
  assert.equal(current.task.id, "demo-task");
  assert.equal(current.workset.id, "workset-demo-task");
});
