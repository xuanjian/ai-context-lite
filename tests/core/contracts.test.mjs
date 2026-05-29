import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  COMMAND_RESULT_STATUSES,
  DEVFLOW_SCHEMA_VERSION,
  ENTITY_TYPES,
  GRAPH_EDGE_RELATIONS,
  QUERY_RESULT_TYPES,
  REPOSITORY_METHODS,
  ROUTE_MODES,
  SERVICE_METHODS,
  normalizeQueryRouteResult,
  normalizeSceneTemplate,
  normalizeWorkset
} from "../../src/core/contracts/devflow-types.mjs";

const fixtureRoot = new URL("./fixtures/basic-ai-context/", import.meta.url);

test("locks route modes, entity types, query result types, and public method names", () => {
  assert.deepEqual(ROUTE_MODES, ["none", "resume", "light", "full"]);
  assert.deepEqual(ENTITY_TYPES, ["project", "sceneTemplate", "capability", "skill", "rule", "task", "workset"]);
  assert.deepEqual(QUERY_RESULT_TYPES, ["route", "current", "skills", "rules", "graph"]);
  assert.deepEqual(COMMAND_RESULT_STATUSES, ["ok", "noop", "error"]);
  assert.deepEqual(GRAPH_EDGE_RELATIONS, [
    "uses-scene-template",
    "uses-skill",
    "uses-rule",
    "hints-project",
    "hints-skill",
    "hints-rule",
    "applies-project",
    "applies-scene-template",
    "workset-project",
    "workset-scene-template",
    "chain",
    "depends-on",
    "calls"
  ]);
  assert.deepEqual(REPOSITORY_METHODS, [
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
    "listGraphEdges",
    "getConfig",
    "setConfig",
    "getEntry",
    "getProfile",
    "getGates",
    "listTaskDocuments",
    "writeTaskDocument",
    "setProjectProducts",
    "setProjectDomains",
    "setProjectRole",
    "setProjectComponents",
    "upsertGraphEdge",
    "deleteGraphEdge",
    "writeProject",
    "writeSceneTemplate",
    "writeTask",
    "deleteTask",
    "setRuntimeState"
  ]);
  assert.deepEqual(SERVICE_METHODS, [
    "queryRoute",
    "queryCurrent",
    "querySkills",
    "queryRules",
    "buildGraph",
    "buildContextGraph",
    "getNodeDetails",
    "runChecks",
    "runAction",
    "startTask",
    "updateTask",
    "finishTask",
    "deleteTask",
    "addProject",
    "addSceneTemplate"
  ]);
});

test("normalizes scene templates with the scene-template marker", () => {
  const sceneTemplate = normalizeSceneTemplate({
    id: "demo-scene",
    name: "Demo Scene",
    summary: "Demo summary",
    capabilityIds: ["task-routing"],
    projectHints: [{ id: "demo-project", role: "primary" }],
    skillHints: [{ id: "demo-skill" }],
    ruleHints: [{ id: "demo-rule" }],
    source: { path: "docs/scenes/demo-scene.md" }
  });

  assert.equal(DEVFLOW_SCHEMA_VERSION, 5);
  assert.deepEqual(sceneTemplate, {
    id: "demo-scene",
    templateType: "scene-template",
    name: "Demo Scene",
    summary: "Demo summary",
    capabilityIds: ["task-routing"],
    projectHints: [{ id: "demo-project", role: "primary" }],
    skillHints: [{ id: "demo-skill" }],
    ruleHints: [{ id: "demo-rule" }],
    sourcePath: "docs/scenes/demo-scene.md"
  });
});

test("normalizes worksets as the task runtime unit", () => {
  const workset = normalizeWorkset({
    id: "workset-demo-task",
    taskId: "demo-task",
    sourceText: "修 demo",
    confidence: "medium",
    reason: "Matched demo metadata.",
    sceneTemplateId: "demo-scene",
    capabilities: [{ id: "task-routing" }],
    projects: [{ id: "demo-project", role: "primary" }],
    skills: [{ id: "demo-skill" }],
    rules: [{ id: "demo-rule" }]
  });

  assert.deepEqual(workset, {
    id: "workset-demo-task",
    taskId: "demo-task",
    sourceText: "修 demo",
    confidence: "medium",
    reason: "Matched demo metadata.",
    sceneTemplateId: "demo-scene",
    capabilities: [{ id: "task-routing" }],
    projects: [{ id: "demo-project", role: "primary" }],
    skills: [{ id: "demo-skill" }],
    rules: [{ id: "demo-rule" }]
  });
});

test("normalizes query route results with sceneTemplate, workset, readPaths, and nextAction", () => {
  const result = normalizeQueryRouteResult({
    mode: "light",
    sceneTemplate: {
      id: "demo-scene",
      confidence: "medium",
      reason: "Matched template keywords."
    },
    workset: {
      id: "workset-demo-task",
      taskId: "demo-task",
      projects: [{ id: "demo-project" }]
    },
    readPaths: ["config/projects/demo-project.json"],
    nextAction: "Inspect selected project context."
  });

  assert.deepEqual(result, {
    type: "route",
    mode: "light",
    sceneTemplate: {
      id: "demo-scene",
      templateType: "scene-template",
      name: "demo-scene",
      summary: "",
      capabilityIds: [],
      projectHints: [],
      skillHints: [],
      ruleHints: [],
      sourcePath: undefined,
      confidence: "medium",
      reason: "Matched template keywords."
    },
    workset: {
      id: "workset-demo-task",
      taskId: "demo-task",
      sourceText: "",
      confidence: "unknown",
      reason: "",
      sceneTemplateId: undefined,
      capabilities: [],
      projects: [{ id: "demo-project" }],
      skills: [],
      rules: []
    },
    skills: [],
    rules: [],
    readPaths: ["config/projects/demo-project.json"],
    nextAction: "Inspect selected project context.",
    candidates: [],
    historyHints: [],
    clarify: [],
    refinementHint: "",
    inference: {}
  });
});

test("basic fixtures expose scene template and workset shapes for downstream tasks", async () => {
  const scene = await readFixtureJson("config/scenes/demo-scene.json");
  const current = await readFixtureJson("runtime/current.json");
  const task = await readFixtureJson("runtime/tasks/demo-task.json");

  assert.equal(scene.templateType, "scene-template");
  assert.equal(current.activeTaskId, "demo-task");
  assert.equal(current.activeWorksetId, "workset-demo-task");
  assert.equal(task.workset.id, "workset-demo-task");
  assert.equal(task.workset.taskId, "demo-task");
  assert.equal(task.workset.sceneTemplateId, "demo-scene");
  assert.deepEqual(task.workset.capabilities, [{ id: "task-routing", role: "primary" }]);
  assert.deepEqual(task.workset.projects, [{ id: "demo-project", role: "primary" }]);
  assert.deepEqual(task.workset.skills, [{ id: "demo-skill" }]);
  assert.deepEqual(task.workset.rules, [{ id: "demo-rule" }]);
  assert.equal(task.workset.confidence, "high");
  assert.match(task.workset.reason, /demo project/i);
});

async function readFixtureJson(relativePath) {
  const raw = await fs.readFile(path.join(fixtureRoot.pathname, relativePath), "utf8");
  return JSON.parse(raw);
}
