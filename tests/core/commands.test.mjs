import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDevFlowService } from "../../src/core/services/devflow-service.mjs";

test("startTask writes task state and reports handoff path without JSON task path", async () => {
  const repository = createFakeRepository();
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-command-"));
  const service = createDevFlowService({ rootDir, repository });

  const result = await service.startTask({
    title: "Implement query service",
    projectIds: ["demo-project"],
    templateId: "demo-scene",
    gate: "G3",
    level: "L2",
    note: "Worker 3 handoff."
  });

  assert.equal(result.status, "ok");
  assert.equal(result.action, "startTask");
  assert.equal(result.entityType, "task");
  assert.equal(result.entityId, "implement-query-service");
  assert.ok(result.paths.includes("runtime/tasks/implement-query-service/handoff.md"));
  assert.equal(result.paths.includes("runtime/tasks/implement-query-service.json"), false);
  assert.equal(fs.existsSync(path.join(rootDir, "runtime/tasks/implement-query-service/handoff.md")), true);
  assert.equal(repository.writes.tasks.length, 1);
  assert.equal(repository.writes.tasks[0].id, "implement-query-service");
  assert.equal(repository.writes.tasks[0].workset.sceneTemplateId, "demo-scene");
  assert.deepEqual(repository.writes.runtime.at(-1), {
    activeTaskId: "implement-query-service",
    activeTaskPath: "",
    activeWorksetId: "workset-implement-query-service",
    activeProjectIds: ["demo-project"],
    activeSceneTemplateId: "demo-scene",
    currentGate: "G3"
  });
});

test("updateTask writes a merged task and preserves command result shape", async () => {
  const repository = createFakeRepository();
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-command-"));
  const service = createDevFlowService({ rootDir, repository });

  const result = await service.updateTask({
    taskId: "demo-task",
    gate: "G4",
    note: "Implemented service.",
    recoveryPoint: "Run focused tests."
  });

  assert.equal(result.status, "ok");
  assert.equal(result.action, "updateTask");
  assert.equal(result.entityId, "demo-task");
  assert.equal(repository.writes.tasks.at(-1).gate, "G4");
  assert.equal(repository.writes.tasks.at(-1).recoveryPoint, "Run focused tests.");
  assert.deepEqual(repository.writes.tasks.at(-1).notes, ["Existing note.", "Implemented service."]);
});

test("finishTask marks the task complete through repository writes", async () => {
  const repository = createFakeRepository();
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-command-"));
  const service = createDevFlowService({ rootDir, repository });

  const result = await service.finishTask({ taskId: "demo-task", note: "Verified." });

  assert.equal(result.status, "ok");
  assert.equal(result.action, "finishTask");
  assert.equal(repository.writes.tasks.at(-1).status, "finished");
  assert.equal(repository.writes.tasks.at(-1).gate, "G7");
  assert.equal(repository.writes.tasks.at(-1).currentGate, "G7");
  assert.equal(repository.writes.tasks.at(-1).finishedNote, "Verified.");
  assert.deepEqual(repository.writes.runtime.at(-1), {
    activeTaskId: "",
    activeTaskPath: "",
    activeWorksetId: "",
    activeProjectIds: [],
    activeSceneTemplateId: "",
    currentGate: ""
  });
});

test("finishTask does not clear a different active task when finishing an older task", async () => {
  const repository = createFakeRepository({ activeTaskId: "other-task" });
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-command-"));
  const service = createDevFlowService({ rootDir, repository });

  const result = await service.finishTask({ taskId: "demo-task", note: "Old task done." });

  assert.equal(result.status, "ok");
  assert.equal(repository.writes.tasks.at(-1).status, "finished");
  assert.equal(repository.writes.runtime.length, 0);
});

test("deleteTask removes the task from the repository and clears active runtime state only for active task", async () => {
  const repository = createFakeRepository();
  const service = createDevFlowService({ rootDir: "/repo/devflow", repository });

  const result = await service.deleteTask({ taskId: "demo-task" });

  assert.equal(result.status, "ok");
  assert.equal(result.action, "deleteTask");
  assert.equal(result.entityId, "demo-task");
  assert.deepEqual(repository.writes.deletedTasks, ["demo-task"]);
  assert.deepEqual(repository.writes.runtime.at(-1), {
    activeTaskId: "",
    activeTaskPath: "",
    activeWorksetId: "",
    activeProjectIds: [],
    activeSceneTemplateId: "",
    currentGate: ""
  });
});

test("addProject and addSceneTemplate are thin repository command wrappers", async () => {
  const repository = createFakeRepository();
  const service = createDevFlowService({ rootDir: "/repo/devflow", repository });

  const projectResult = await service.addProject({
    projectPath: "../demo",
    projectId: "new-demo",
    name: "New Demo",
    technologyFamilyId: "workflow"
  });
  const templateResult = await service.addSceneTemplate({
    templateId: "new-template",
    name: "New Template",
    summary: "New template summary.",
    capabilityIds: ["routing"],
    projectHints: [{ id: "new-demo" }]
  });

  assert.equal(projectResult.status, "ok");
  assert.equal(projectResult.action, "addProject");
  assert.equal(projectResult.entityId, "new-demo");
  assert.deepEqual(projectResult.paths, []);
  assert.equal(repository.writes.projects.at(-1).path, "../demo");

  assert.equal(templateResult.status, "ok");
  assert.equal(templateResult.action, "addSceneTemplate");
  assert.equal(templateResult.entityId, "new-template");
  assert.deepEqual(templateResult.paths, []);
  assert.equal(repository.writes.sceneTemplates.at(-1).templateType, "scene-template");
});

function createFakeRepository({ activeTaskId = "demo-task" } = {}) {
  const task = {
    id: "demo-task",
    title: "Demo task",
    gate: "G3",
    status: "active",
    notes: ["Existing note."],
    workset: {
      id: "workset-demo-task",
      taskId: "demo-task",
      sceneTemplateId: "demo-scene",
      projects: [{ id: "demo-project", role: "primary" }],
      skills: [],
      rules: []
    }
  };
  const writes = {
    projects: [],
    sceneTemplates: [],
    tasks: [],
    deletedTasks: [],
    runtime: []
  };

  return {
    writes,
    async listProjects() {
      return [{ id: "demo-project", name: "Demo Project" }];
    },
    async getProject(projectId) {
      return projectId === "demo-project" ? { id: "demo-project", name: "Demo Project" } : null;
    },
    async listSceneTemplates() {
      return [{ id: "demo-scene", templateType: "scene-template", name: "Demo Scene" }];
    },
    async getSceneTemplate(templateId) {
      return templateId === "demo-scene" ? { id: "demo-scene", templateType: "scene-template", name: "Demo Scene" } : null;
    },
    async listSkills() {
      return [];
    },
    async listRules() {
      return [];
    },
    async listTasks() {
      return [task];
    },
    async getTask(taskId) {
      return taskId === task.id ? task : null;
    },
    async getActiveTask() {
      return activeTaskId === task.id ? task : null;
    },
    async getWorkset(worksetId) {
      return worksetId === task.workset.id ? task.workset : null;
    },
    async listGraphEdges() {
      return [];
    },
    async writeProject(project) {
      writes.projects.push(project);
      return project;
    },
    async writeSceneTemplate(sceneTemplate) {
      writes.sceneTemplates.push(sceneTemplate);
      return sceneTemplate;
    },
    async writeTask(nextTask) {
      writes.tasks.push(nextTask);
      return nextTask;
    },
    async deleteTask(taskId) {
      writes.deletedTasks.push(taskId);
      return null;
    },
    async setRuntimeState(state) {
      writes.runtime.push(state);
      return state;
    }
  };
}
