import test from "node:test";
import assert from "node:assert/strict";
import { createJsonRepository } from "../../../src/core/repositories/json-repository.mjs";

const fixtureRoot = new URL("../fixtures/basic-ai-context/", import.meta.url);

const JSON_IMPORT_METHODS = [
  "listProjects",
  "getProject",
  "listSceneTemplates",
  "getSceneTemplate",
  "listSkills",
  "listRules",
  "listTasks",
  "getTask",
  "getActiveTask",
  "getWorkset",
  "listGraphEdges"
];

test("json repository is a read-only migration importer", () => {
  const repository = createJsonRepository({ rootDir: fixtureRoot });

  assert.deepEqual(Object.keys(repository).sort(), [...JSON_IMPORT_METHODS].sort());
  assert.equal(repository.writeProject, undefined);
  assert.equal(repository.writeSceneTemplate, undefined);
  assert.equal(repository.writeTask, undefined);
  assert.equal(repository.setRuntimeState, undefined);
});

test("listSceneTemplates returns normalized scene templates", async () => {
  const repository = createJsonRepository({ rootDir: fixtureRoot });

  const sceneTemplates = await repository.listSceneTemplates();
  const demoScene = sceneTemplates.find((sceneTemplate) => sceneTemplate.id === "demo-scene");

  assert.ok(demoScene);
  assert.equal(demoScene.templateType, "scene-template");
  assert.equal(demoScene.name, "Demo Scene");
  assert.equal(demoScene.sourcePath, "docs/scenes/demo-scene.md");
  assert.deepEqual(demoScene.projectHints, [{ id: "demo-project", role: "primary" }]);
});

test("getActiveTask returns the active normalized task", async () => {
  const repository = createJsonRepository({ rootDir: fixtureRoot });

  const activeTask = await repository.getActiveTask();

  assert.equal(activeTask.id, "demo-task");
  assert.equal(activeTask.workset.id, "workset-demo-task");
  assert.equal(activeTask.workset.taskId, "demo-task");
  assert.deepEqual(activeTask.workset.projects, [{ id: "demo-project", role: "primary" }]);
});

test("getWorkset returns an explicit task workset by task id", async () => {
  const repository = createJsonRepository({ rootDir: fixtureRoot });

  const workset = await repository.getWorkset("demo-task");

  assert.equal(workset.id, "workset-demo-task");
  assert.equal(workset.taskId, "demo-task");
  assert.deepEqual(workset.projects, [{ id: "demo-project", role: "primary" }]);
  assert.deepEqual(workset.skills, [{ id: "demo-skill" }]);
  assert.deepEqual(workset.rules, [{ id: "demo-rule" }]);
});

test("getWorkset derives fallback workset from legacy task projectIds and sceneIds", async () => {
  const repository = createJsonRepository({ rootDir: fixtureRoot });

  const workset = await repository.getWorkset("other-task");

  assert.equal(workset.id, "workset-other-task");
  assert.equal(workset.taskId, "other-task");
  assert.equal(workset.confidence, "legacy");
  assert.equal(workset.sceneTemplateId, "demo-scene");
  assert.deepEqual(workset.projects, [{ id: "demo-project", role: "primary" }]);
  assert.deepEqual(workset.capabilities, [{ id: "task-routing", role: "primary" }]);
  assert.deepEqual(workset.skills, [{ id: "demo-skill" }]);
  assert.deepEqual(workset.rules, [{ id: "demo-rule" }]);
});
