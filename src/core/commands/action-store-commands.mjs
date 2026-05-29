import { assertGraphEdgeRelation, normalizeCommandResult } from "../contracts/devflow-types.mjs";
import { createSqliteRepository } from "../repositories/sqlite-repository.mjs";
import { ensureSqliteDatabase } from "../storage/sqlite-bootstrap.mjs";
import { scanRelations as scanRelationsCommand } from "./relation-scan-command.mjs";
import { deleteTask as deleteTaskCommand, finishTask as finishTaskCommand } from "./task-commands.mjs";

export async function createActionCommandService({ rootDir }) {
  await ensureSqliteDatabase({ rootDir });
  const repository = createSqliteRepository({ rootDir });
  return {
    listProjects: () => repository.listProjects(),
    getProject: (projectId) => repository.getProject(projectId),
    listSceneTemplates: () => repository.listSceneTemplates(),
    getSceneTemplate: (sceneTemplateId) => repository.getSceneTemplate(sceneTemplateId),
    listSkills: () => repository.listSkills(),
    listRules: () => repository.listRules(),
    listTasks: () => repository.listTasks(),
    getTask: (taskId) => repository.getTask(taskId),
    getActiveTask: () => repository.getActiveTask(),
    getConfig: (key) => repository.getConfig(key),
    getProfile: () => repository.getProfile(),
    writeProject: (project) => writeProject(repository, project),
    setProjectProducts: (input) => setProjectProducts(repository, input),
    setProjectDomains: (input) => setProjectDomains(repository, input),
    setProjectRole: (input) => setProjectRole(repository, input),
    setProjectComponents: (input) => setProjectComponents(repository, input),
    addRelation: (input) => addRelation(repository, input),
    scanRelations: (input) => scanRelationsCommand(repository, { rootDir, ...input }),
    writeSceneTemplate: (sceneTemplate) => writeSceneTemplate(repository, sceneTemplate),
    writeSkill: (skill) => writeSkill(repository, skill),
    writeRule: (rule) => writeRule(repository, rule),
    writeTask: (task) => writeTask(repository, task),
    finishTask: (input) => finishTaskCommand(repository, { rootDir, ...input }),
    deleteTask: (input) => deleteTaskCommand(repository, { rootDir, ...input }),
    setRuntimeState: (runtimeState) => setRuntimeState(repository, runtimeState),
    setConfig: (key, value) => setConfig(repository, key, value),
    deleteProject: (projectId) => deleteProject(repository, projectId),
    deleteSceneTemplate: (sceneTemplateId) => deleteSceneTemplate(repository, sceneTemplateId),
    deleteSkill: (skillId) => deleteSkill(repository, skillId),
    deleteRule: (ruleId) => deleteRule(repository, ruleId)
  };
}

async function writeProject(repository, project) {
  await repository.writeProject(project);
  return commandResult("writeProject", "project", project.id);
}

async function setProjectProducts(repository, { projectId, products = [], dryRun = false } = {}) {
  const project = await requireProject(repository, projectId);
  const after = { ...project, products: normalizeStringList(products) };
  if (dryRun) return previewResult("setProjectProducts", projectId, project, after);
  if (sameJson(project.products || [], after.products)) return noopResult("setProjectProducts", "project", projectId, "No project product changes.");
  await repository.setProjectProducts(projectId, after.products);
  return commandResult("setProjectProducts", "project", projectId);
}

async function setProjectDomains(repository, { projectId, domains = [], dryRun = false } = {}) {
  const project = await requireProject(repository, projectId);
  const after = { ...project, domains: normalizeStringList(domains) };
  if (dryRun) return previewResult("setProjectDomains", projectId, project, after);
  if (sameJson(project.domains || [], after.domains)) return noopResult("setProjectDomains", "project", projectId, "No project domain changes.");
  await repository.setProjectDomains(projectId, after.domains);
  return commandResult("setProjectDomains", "project", projectId);
}

async function setProjectRole(repository, { projectId, role = "", dryRun = false } = {}) {
  const project = await requireProject(repository, projectId);
  const after = { ...project, role: normalizeString(role) };
  if (dryRun) return previewResult("setProjectRole", projectId, project, after);
  if ((project.role || "") === after.role) return noopResult("setProjectRole", "project", projectId, "No project role changes.");
  await repository.setProjectRole(projectId, after.role);
  return commandResult("setProjectRole", "project", projectId);
}

async function setProjectComponents(repository, { projectId, components = [], dryRun = false } = {}) {
  const project = await requireProject(repository, projectId);
  const after = { ...project, components: normalizeComponents(components) };
  if (dryRun) return previewResult("setProjectComponents", projectId, project, after);
  if (sameJson(project.components || [], after.components)) return noopResult("setProjectComponents", "project", projectId, "No project component changes.");
  await repository.setProjectComponents(projectId, after.components);
  return commandResult("setProjectComponents", "project", projectId);
}

async function addRelation(repository, { fromId, toId, type, remove = false, dryRun = false } = {}) {
  const from = await requireProjectNode(repository, fromId);
  const to = await requireProjectNode(repository, toId);
  const edge = { from: from.nodeId, to: to.nodeId, relation: assertGraphEdgeRelation(normalizeString(type)) };
  const existing = (await repository.listGraphEdges())
    .some((item) => item.from === edge.from && item.to === edge.to && item.relation === edge.relation);

  if (dryRun) {
    return {
      ...normalizeCommandResult({
        status: "noop",
        action: remove ? "deleteGraphEdge" : "upsertGraphEdge",
        message: "Dry run only. SQLite was not changed.",
        paths: ["data/devflow.db"]
      }),
      edge,
      willWrite: !remove && !existing,
      willRemove: remove && existing
    };
  }

  if (remove) {
    if (!existing) return noopResult("deleteGraphEdge", undefined, undefined, "No relation changes.");
    await repository.deleteGraphEdge(edge);
    return commandResult("deleteGraphEdge");
  }
  if (existing) return noopResult("upsertGraphEdge", undefined, undefined, "No relation changes.");
  await repository.upsertGraphEdge(edge);
  return commandResult("upsertGraphEdge");
}

async function writeSceneTemplate(repository, sceneTemplate) {
  await repository.writeSceneTemplate(sceneTemplate);
  return commandResult("writeSceneTemplate", "sceneTemplate", sceneTemplate.id);
}

async function writeSkill(repository, skill) {
  await repository.writeSkill(skill);
  return commandResult("writeSkill", "skill", skill.id);
}

async function writeRule(repository, rule) {
  await repository.writeRule(rule);
  return commandResult("writeRule", "rule", rule.id);
}

async function writeTask(repository, task) {
  await repository.writeTask(task);
  return commandResult("writeTask", "task", task.id);
}

async function setRuntimeState(repository, runtimeState) {
  await repository.setRuntimeState(runtimeState);
  return commandResult("setRuntimeState");
}

async function setConfig(repository, key, value) {
  await repository.setConfig(key, value);
  return commandResult("setConfig");
}

async function deleteProject(repository, projectId) {
  await repository.deleteProject(projectId);
  return commandResult("deleteProject", "project", projectId);
}

async function deleteSceneTemplate(repository, sceneTemplateId) {
  await repository.deleteSceneTemplate(sceneTemplateId);
  return commandResult("deleteSceneTemplate", "sceneTemplate", sceneTemplateId);
}

async function deleteSkill(repository, skillId) {
  await repository.deleteSkill(skillId);
  return commandResult("deleteSkill", "skill", skillId);
}

async function deleteRule(repository, ruleId) {
  await repository.deleteRule(ruleId);
  return commandResult("deleteRule", "rule", ruleId);
}

function commandResult(action, entityType, entityId) {
  return normalizeCommandResult({
    status: "ok",
    action,
    entityType,
    entityId,
    message: entityId ? `${action} ${entityId}` : `${action} complete.`,
    paths: ["data/devflow.db"]
  });
}

function noopResult(action, entityType, entityId, message) {
  return normalizeCommandResult({
    status: "noop",
    action,
    entityType,
    entityId,
    message,
    paths: ["data/devflow.db"]
  });
}

function previewResult(action, projectId, before, after) {
  return {
    ...normalizeCommandResult({
      status: "noop",
      action,
      entityType: "project",
      entityId: projectId,
      message: "Dry run only. SQLite was not changed.",
      paths: ["data/devflow.db"]
    }),
    before: pickProjectMetadata(before),
    after: pickProjectMetadata(after),
    willWrite: !sameJson(pickProjectMetadata(before), pickProjectMetadata(after))
  };
}

async function requireProject(repository, projectId) {
  if (!projectId) throw new Error("projectId is required");
  const project = await repository.getProject(projectId);
  if (!project) throw new Error(`unknown projectId: ${projectId}`);
  return project;
}

async function requireProjectNode(repository, id) {
  const value = normalizeString(id);
  const projectId = value.startsWith("project:") ? value.slice("project:".length) : value;
  await requireProject(repository, projectId);
  return { projectId, nodeId: `project:${projectId}` };
}

function pickProjectMetadata(project) {
  return {
    products: project.products || [],
    domains: project.domains || [],
    role: project.role || "",
    components: project.components || []
  };
}

function normalizeComponents(values) {
  const components = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const component = {
      name: normalizeString(value?.name),
      purpose: normalizeString(value?.purpose),
      path: normalizeString(value?.path)
    };
    if (!component.name || !component.path) continue;
    const key = `${component.name}\0${component.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    components.push(component);
  }
  return components;
}

function normalizeStringList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value))
    .filter(Boolean))];
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
