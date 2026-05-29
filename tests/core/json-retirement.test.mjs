import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDevFlowService } from "../../src/core/services/devflow-service.mjs";
import { seedSqliteFromJsonFixture } from "../helpers/sqlite-fixtures.mjs";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "../..");
const fixtureRoot = path.join(repoRoot, "tests/core/fixtures/basic-ai-context");

function copyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-json-retirement-"));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

test("default service refuses implicit JSON rebuild when SQLite is missing", async () => {
  const root = copyFixture();
  const service = createDevFlowService({ rootDir: root });

  await assert.rejects(() => service.startTask({
    title: "No JSON Task",
    projectIds: ["demo-project"],
    templateId: "demo-scene",
    gate: "G2",
    note: "sqlite main path"
  }), /devflow migrate from-json/);
  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), false);
});

test("default service uses seeded SQLite and does not create normal-path JSON for new tasks", async () => {
  const root = copyFixture();
  await seedSqliteFromJsonFixture(root);
  const service = createDevFlowService({ rootDir: root });

  const start = await service.startTask({
    title: "No JSON Task",
    projectIds: ["demo-project"],
    templateId: "demo-scene",
    gate: "G2",
    note: "sqlite main path"
  });
  const current = await service.queryCurrent();

  assert.equal(start.status, "ok");
  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), true);
  assert.equal(fs.existsSync(path.join(root, "runtime/tasks/no-json-task.json")), false);
  assert.equal(fs.existsSync(path.join(root, "runtime/current.json")), true);
  assert.equal(fs.existsSync(path.join(root, "runtime/tasks/no-json-task/handoff.md")), true);
  assert.deepEqual(start.paths, ["runtime/tasks/no-json-task/handoff.md"]);
  assert.equal(current.task.id, "no-json-task");
  assert.equal(current.workset.id, "workset-no-json-task");
});

test("default add commands write SQLite records without creating project or scene JSON", async () => {
  const root = copyFixture();
  await seedSqliteFromJsonFixture(root);
  const service = createDevFlowService({ rootDir: root });

  const project = await service.addProject({
    projectPath: "/tmp/no-json-project",
    projectId: "no-json-project",
    name: "No JSON Project",
    technologyFamilyId: "workflow"
  });
  const template = await service.addSceneTemplate({
    templateId: "no-json-template",
    name: "No JSON Template",
    summary: "Template stored in SQLite.",
    capabilityIds: ["routing"],
    projectHints: [{ id: "no-json-project" }]
  });

  assert.equal(project.status, "ok");
  assert.equal(template.status, "ok");
  assert.deepEqual(project.paths, []);
  assert.deepEqual(template.paths, []);
  assert.equal(fs.existsSync(path.join(root, "config/projects/no-json-project.json")), false);
  assert.equal(fs.existsSync(path.join(root, "config/scenes/no-json-template.json")), false);

  const route = await service.queryRoute({ text: "no json template" });
  assert.equal(route.sceneTemplate.id, "no-json-template");
  assert.equal(route.workset.projects[0].id, "no-json-project");
});

test("fresh install without JSON bootstraps default SQLite records", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-json-retirement-fresh-"));
  const service = createDevFlowService({ rootDir: root });

  const route = await service.queryRoute({ text: "devflow" });

  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), true);
  assert.equal(fs.existsSync(path.join(root, "config/entry.json")), false);
  assert.equal(route.workset.projects[0].id, "devflow");
});
