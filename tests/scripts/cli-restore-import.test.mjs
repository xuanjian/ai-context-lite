import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "../..");
const cliPath = path.join(repoRoot, "scripts/devflow-cli.mjs");
const fixtureRoot = path.join(repoRoot, "tests/core/fixtures/basic-ai-context");

function copyFixture(prefix = "devflow-cli-restore-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

function writeJson(root, relativePath, value) {
  const targetPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(root, relativePath, value) {
  const targetPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, value, "utf8");
}

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function initHistoryWithRemovedConfig(root) {
  runGit(root, ["init"]);
  runGit(root, ["config", "user.email", "devflow-test@example.com"]);
  runGit(root, ["config", "user.name", "DevFlow Test"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "historical config"]);
  fs.rmSync(path.join(root, "config/projects"), { recursive: true, force: true });
  fs.rmSync(path.join(root, "config/scenes"), { recursive: true, force: true });
  fs.rmSync(path.join(root, "config/skills"), { recursive: true, force: true });
  fs.rmSync(path.join(root, "config/rules"), { recursive: true, force: true });
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-m", "reset public template"]);
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

function readTable(root, table) {
  const db = new Database(path.join(root, "data/devflow.db"));
  try {
    return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  } finally {
    db.close();
  }
}

test("restore-from-git restores historical config into SQLite relation tables and supports dry-run", () => {
  const root = copyFixture("devflow-cli-restore-git-");
  initHistoryWithRemovedConfig(root);

  const dryRun = parseJson(runCli(root, ["restore-from-git", "--ref", "HEAD^", "--dry-run"]));
  assert.equal(dryRun.status, "noop");
  assert.equal(dryRun.action, "restore-from-git");
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.sourceCounts.projects, 1);
  assert.equal(dryRun.sourceCounts.sceneTemplates, 1);
  assert.equal(dryRun.sourceCounts.skills, 1);
  assert.equal(dryRun.sourceCounts.rules, 1);
  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), false);

  const restored = parseJson(runCli(root, ["restore-from-git", "--ref", "HEAD^"]));
  assert.equal(restored.status, "ok");
  assert.equal(restored.imported.projects, 1);
  assert.equal(restored.imported.sceneTemplates, 1);
  assert.equal(restored.imported.projectSkillMounts, 1);
  assert.equal(restored.imported.projectRuleMounts, 1);
  assert.equal(restored.imported.sceneTemplateSkillHints, 1);
  assert.equal(restored.imported.sceneTemplateRuleHints, 1);
  assert.equal(restored.imported.graphEdges > 0, true);

  const skills = parseJson(runCli(root, ["query", "skills", "--project", "demo-project"]));
  assert.deepEqual(skills.skills.map((skill) => skill.id), ["demo-skill"]);
  const rules = parseJson(runCli(root, ["query", "rules", "--template", "demo-scene"]));
  assert.deepEqual(rules.rules.map((rule) => rule.id), ["demo-rule"]);
});

test("import-tasks imports directory handoffs, task documents, runtime current, and missing scene report", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-cli-import-tasks-"));
  writeJson(root, "config/entry.json", { version: 1, tools: [] });
  writeJson(root, "runtime/current.json", {
    version: 1,
    activeTaskId: "new-task",
    activeWorksetId: "workset-new-task",
    activeSceneIds: ["missing-scene"],
    currentGate: "G2",
    recentTaskIds: ["new-task"]
  });
  writeText(root, "runtime/tasks/new-task/handoff.md", `# New Header Task
Task: new-task
Workset: workset-new-task
Scene Template: missing-scene
Recovery: resume from new header
Updated: 2026-05-28T01:02:03.000Z

Touches demo-project and Demo Project.
`);
  writeText(root, "runtime/tasks/new-task/G1/artifacts.md", "- gate evidence\n");
  writeText(root, "runtime/tasks/new-task/codex-tasks/T-001.md", "# Subtask\n");
  writeText(root, "runtime/tasks/legacy-task/handoff.md", `# Legacy Task

## Task State

- id: legacy-task
- status: active
- level: L3
- currentGate: G4
- recoveryPoint: resume from legacy block

## Workset

- id: workset-legacy-task
- sceneTemplateId: demo-scene
- confidence: legacy
- reason: Migrated from retired task JSON.

### Projects

- demo-project: primary
`);
  writeText(root, "runtime/tasks/legacy-task/G4/artifacts.md", "- legacy gate\n");

  const dryRun = parseJson(runCli(root, ["import-tasks", "--dry-run"]));
  assert.equal(dryRun.status, "noop");
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.sourceCounts.tasks, 2);
  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), false);

  const imported = parseJson(runCli(root, ["import-tasks"]));
  assert.equal(imported.status, "ok");
  assert.equal(imported.imported.tasks, 2);
  assert.equal(imported.imported.taskDocuments, 8);
  assert.deepEqual(imported.missingScenes.map((scene) => scene.id), ["demo-scene", "missing-scene"]);
  assert.equal(imported.missingScenes.find((scene) => scene.id === "demo-scene").suggestedProjectHints[0].id, "demo-project");

  const current = parseJson(runCli(root, ["query", "current"]));
  assert.equal(current.task.id, "new-task");
  assert.equal(current.recoveryPoint, "resume from new header");
  assert.equal(current.workset.id, "workset-new-task");
  assert.equal(current.workset.sceneTemplateId, "missing-scene");

  const tasks = readTable(root, "tasks");
  assert.deepEqual(tasks.map((row) => row.id).sort(), ["legacy-task", "new-task"]);
  const docs = readTable(root, "task_documents").map((row) => JSON.parse(row.raw_json));
  assert.equal(docs.some((doc) => doc.kind === "handoff" && doc.path === "runtime/tasks/new-task/handoff.md"), true);
  assert.equal(docs.some((doc) => doc.kind === "gate" && doc.path === "runtime/tasks/new-task/G1"), true);
  assert.equal(docs.some((doc) => doc.kind === "artifact" && doc.path === "runtime/tasks/new-task/G1/artifacts.md"), true);
  assert.equal(docs.some((doc) => doc.kind === "artifact" && doc.path === "runtime/tasks/new-task/codex-tasks"), true);
  assert.equal(docs.some((doc) => doc.kind === "artifact" && doc.path === "runtime/tasks/new-task/codex-tasks/T-001.md"), true);
});
