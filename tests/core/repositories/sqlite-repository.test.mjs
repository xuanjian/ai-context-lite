import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonRepository } from "../../../src/core/repositories/json-repository.mjs";
import { createSqliteRepository } from "../../../src/core/repositories/sqlite-repository.mjs";
import { createDevFlowService } from "../../../src/core/services/devflow-service.mjs";
import { seedSqliteFromJsonFixture } from "../../helpers/sqlite-fixtures.mjs";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "../../..");
const basicFixtureRoot = path.join(repoRoot, "tests/core/fixtures/basic-ai-context");
const missingDocFixtureRoot = path.join(repoRoot, "tests/core/fixtures/missing-doc-ai-context");

function copyFixture(sourceRoot, prefix = "devflow-sqlite-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(sourceRoot, root, { recursive: true });
  return root;
}

test("snapshot import creates data/devflow.db and sqlite repository matches JSON repository", async () => {
  const root = copyFixture(basicFixtureRoot);
  const result = await seedSqliteFromJsonFixture(root);

  assert.deepEqual(result.sanityChecks.projects, { expected: 1, actual: 1 });
  assert.deepEqual(result.sanityChecks.tasks, { expected: 2, actual: 2 });
  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), true);

  const jsonRepository = createJsonRepository({ rootDir: root });
  const sqliteRepository = createSqliteRepository({ rootDir: root });

  assert.deepEqual(await sqliteRepository.listProjects(), await jsonRepository.listProjects());
  assert.deepEqual(await sqliteRepository.listSceneTemplates(), await jsonRepository.listSceneTemplates());
  assert.deepEqual(await sqliteRepository.listSkills(), await jsonRepository.listSkills());
  assert.deepEqual(await sqliteRepository.listRules(), await jsonRepository.listRules());
  assert.deepEqual(await sqliteRepository.getActiveTask(), await jsonRepository.getActiveTask());
  assert.deepEqual(await sqliteRepository.getWorkset("demo-task"), await jsonRepository.getWorkset("demo-task"));
  assert.deepEqual(await sqliteRepository.getWorkset("other-task"), await jsonRepository.getWorkset("other-task"));
  assert.deepEqual(await sqliteRepository.listGraphEdges(), await jsonRepository.listGraphEdges());

  const service = createDevFlowService({ rootDir: root, backend: "sqlite" });
  const route = await service.queryRoute({ text: "demo task" });
  assert.equal(route.workset.projects[0].id, "demo-project");
});

test("sqlite backend supports service task commands without changing public calls", async () => {
  const root = copyFixture(basicFixtureRoot, "devflow-sqlite-service-");
  await seedSqliteFromJsonFixture(root);
  const service = createDevFlowService({ rootDir: root, backend: "sqlite" });

  const start = await service.startTask({
    title: "SQLite task",
    projectIds: ["demo-project"],
    templateId: "demo-scene",
    gate: "G3",
    note: "sqlite backend"
  });
  const update = await service.updateTask({ taskId: "sqlite-task", gate: "G4", note: "progress" });
  const finish = await service.finishTask({ taskId: "sqlite-task", note: "verified" });
  const current = await service.queryCurrent();

  assert.equal(start.status, "ok");
  assert.equal(update.status, "ok");
  assert.equal(finish.status, "ok");
  assert.equal(current.task, null);
});

test("sqlite deleteTask removes task rows and workset relations without deleting handoff markdown", async () => {
  const root = copyFixture(basicFixtureRoot, "devflow-sqlite-delete-task-");
  await seedSqliteFromJsonFixture(root);
  const service = createDevFlowService({ rootDir: root, backend: "sqlite" });
  const repository = createSqliteRepository({ rootDir: root });
  await repository.writeTaskDocument("demo-task", {
    kind: "artifact",
    path: "runtime/tasks/demo-task/G4/demo.md"
  });

  const result = await service.deleteTask({ taskId: "demo-task" });

  assert.equal(result.status, "ok");
  assert.equal(fs.existsSync(path.join(root, "runtime/tasks/demo-task/handoff.md")), true);
  assert.equal(await repository.getTask("demo-task"), null);
  assert.equal(await repository.getWorkset("demo-task"), null);
  assert.deepEqual(await repository.listTaskDocuments("demo-task"), []);
  assert.equal((await service.queryCurrent()).task, null);
});

test("sqlite runtime state writes stay in SQLite and do not create compatibility current.json", async () => {
  const root = copyFixture(basicFixtureRoot, "devflow-sqlite-current-");
  await seedSqliteFromJsonFixture(root);
  fs.rmSync(path.join(root, "runtime/current.json"), { force: true });
  const service = createDevFlowService({ rootDir: root, backend: "sqlite" });

  await service.startTask({
    title: "SQLite current pointer",
    projectIds: ["demo-project"],
    templateId: "new-scene",
    gate: "G3"
  });

  assert.equal(fs.existsSync(path.join(root, "runtime/current.json")), false);
  const current = await service.queryCurrent();
  assert.equal(current.task.id, "sqlite-current-pointer");
  assert.equal(current.workset.id, "workset-sqlite-current-pointer");
});

test("snapshot import preserves records and reports missing source path warnings", async () => {
  const root = copyFixture(missingDocFixtureRoot, "devflow-sqlite-missing-");
  const result = await seedSqliteFromJsonFixture(root);
  const repository = createSqliteRepository({ rootDir: root });

  assert.equal(result.snapshot.warnings.some((warning) => warning.code === "missing_source_path" && warning.path === "docs/repos/missing.md"), true);
  assert.equal((await repository.getProject("demo-project")).id, "demo-project");
});
