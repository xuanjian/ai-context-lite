import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSqliteRepository } from "../../../src/core/repositories/sqlite-repository.mjs";
import { DEFAULT_GATES } from "../../../src/core/defaults/gates.mjs";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "../../..");
const fixtureRoot = path.join(repoRoot, "tests/core/fixtures/basic-ai-context");

function copyFixture(prefix = "devflow-migrate-json-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  writeGatesFixture(root);
  return root;
}

function writeGatesFixture(root) {
  const gatesPath = path.join(root, "config/tasks/gates.json");
  fs.mkdirSync(path.dirname(gatesPath), { recursive: true });
  fs.writeFileSync(gatesPath, `${JSON.stringify(DEFAULT_GATES, null, 2)}\n`, "utf8");
}

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function initCleanGit(root) {
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "devflow-test@example.com"]);
  runGit(root, ["config", "user.name", "DevFlow Test"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "fixture"]);
}

test("migrateDevFlowFromJson dry-run previews JSON import without touching SQLite or files", async () => {
  const { migrateDevFlowFromJson } = await import("../../../src/core/storage/migrate-from-json.mjs");
  const root = copyFixture("devflow-migrate-dry-run-");

  const result = await migrateDevFlowFromJson({ rootDir: root, dryRun: true });

  assert.equal(result.status, "noop");
  assert.equal(result.action, "migrate from-json");
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.sourceCounts, {
    config: 3,
    projects: 1,
    sceneTemplates: 1,
    skills: 1,
    rules: 1,
    tasks: 2,
    taskDocuments: 1,
    runtimeState: 1,
    graphEdges: 12
  });
  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), false);
  assert.equal(fs.existsSync(path.join(root, "config/entry.json")), true);
  assert.equal(fs.existsSync(path.join(root, "runtime/tasks/demo-task.json")), true);
  assert.equal(result.willDelete.includes("runtime/tasks/demo-task/handoff.md"), false);
});

test("migrateDevFlowFromJson imports JSON into SQLite and keeps JSON with --keep-json", async () => {
  const { migrateDevFlowFromJson } = await import("../../../src/core/storage/migrate-from-json.mjs");
  const root = copyFixture("devflow-migrate-keep-json-");
  initCleanGit(root);

  const result = await migrateDevFlowFromJson({ rootDir: root, keepJson: true });
  const repository = createSqliteRepository({ rootDir: root });

  assert.equal(result.status, "ok");
  assert.equal(result.keptJson, true);
  assert.deepEqual(result.deletedJsonPaths, []);
  assert.equal(fs.existsSync(path.join(root, "config/entry.json")), true);
  assert.equal(fs.existsSync(path.join(root, "runtime/current.json")), true);
  assert.equal((await repository.getEntry()).name, "fixture entry");
  assert.equal((await repository.getProfile()).role, "Fixture engineer");
  assert.deepEqual(await repository.getGates(), DEFAULT_GATES);
  assert.equal((await repository.listProjects()).length, 1);
  assert.equal((await repository.listTasks()).length, 2);
  assert.deepEqual(await repository.listTaskDocuments("demo-task"), [
    {
      taskId: "demo-task",
      kind: "handoff",
      path: "runtime/tasks/demo-task/handoff.md"
    }
  ]);
});

test("applyMigrationSnapshot imports JSON into SQLite without a git worktree", async () => {
  const {
    applyMigrationSnapshot,
    collectJsonMigrationSnapshot
  } = await import("../../../src/core/storage/migrate-from-json.mjs");
  const { defaultDbPath, initializeSchema, openDevFlowDatabase } = await import("../../../src/core/storage/schema.mjs");
  const root = copyFixture("devflow-migrate-apply-snapshot-");
  const dbPath = defaultDbPath(root);
  const snapshot = await collectJsonMigrationSnapshot({ rootDir: root, dbPath });
  const db = openDevFlowDatabase({ rootDir: root, dbPath });
  let sanityChecks;
  try {
    initializeSchema(db);
    sanityChecks = applyMigrationSnapshot(db, snapshot);
  } finally {
    db.close();
  }
  const repository = createSqliteRepository({ rootDir: root });

  assert.deepEqual(sanityChecks.projects, { expected: 1, actual: 1 });
  assert.deepEqual(sanityChecks.tasks, { expected: 2, actual: 2 });
  assert.equal((await repository.getActiveTask()).id, "demo-task");
  assert.equal(fs.existsSync(path.join(root, "config/entry.json")), true);
});

test("migrateDevFlowFromJson deletes JSON after row-count sanity checks and preserves handoff markdown", async () => {
  const { migrateDevFlowFromJson } = await import("../../../src/core/storage/migrate-from-json.mjs");
  const root = copyFixture("devflow-migrate-delete-json-");
  initCleanGit(root);

  const result = await migrateDevFlowFromJson({ rootDir: root });
  const repository = createSqliteRepository({ rootDir: root });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.sanityChecks.projects, { expected: 1, actual: 1 });
  assert.deepEqual(result.sanityChecks.tasks, { expected: 2, actual: 2 });
  assert.equal(fs.existsSync(path.join(root, "config/entry.json")), false);
  assert.equal(fs.existsSync(path.join(root, "config/projects/index.json")), false);
  assert.equal(fs.existsSync(path.join(root, "runtime/current.json")), false);
  assert.equal(fs.existsSync(path.join(root, "runtime/tasks/demo-task.json")), false);
  assert.equal(fs.existsSync(path.join(root, "runtime/tasks/demo-task/handoff.md")), true);
  assert.equal((await repository.getActiveTask()).id, "demo-task");
});

test("migrateDevFlowFromJson refuses non-dry-run migration in a dirty git worktree", async () => {
  const { migrateDevFlowFromJson } = await import("../../../src/core/storage/migrate-from-json.mjs");
  const root = copyFixture("devflow-migrate-dirty-");
  initCleanGit(root);
  fs.writeFileSync(path.join(root, "config/entry.json"), "not json\n", "utf8");

  await assert.rejects(
    () => migrateDevFlowFromJson({ rootDir: root }),
    /git working tree must be clean/
  );
  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), false);
});
