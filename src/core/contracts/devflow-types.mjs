export const DEVFLOW_SCHEMA_VERSION = 5;

export const ROUTE_MODES = ["none", "resume", "light", "full"];

export const ENTITY_TYPES = ["project", "sceneTemplate", "capability", "skill", "rule", "task", "workset"];

export const QUERY_RESULT_TYPES = ["route", "current", "skills", "rules", "graph"];

export const COMMAND_RESULT_STATUSES = ["ok", "noop", "error"];

export const GRAPH_EDGE_RELATIONS = [
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
];

export const REPOSITORY_METHODS = [
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
];

export function assertGraphEdgeRelation(relation) {
  if (!GRAPH_EDGE_RELATIONS.includes(relation)) {
    throw new Error(`unsupported graph edge relation: ${relation}`);
  }
  return relation;
}

export const SERVICE_METHODS = [
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
];

export function normalizeSceneTemplate(input = {}) {
  return {
    id: input.id,
    templateType: "scene-template",
    name: input.name || input.id,
    summary: input.summary || "",
    capabilityIds: input.capabilityIds || [],
    projectHints: input.projectHints || [],
    skillHints: input.skillHints || [],
    ruleHints: input.ruleHints || [],
    sourcePath: input.sourcePath || input.source?.path
  };
}

export function normalizeWorkset(input = {}) {
  return {
    id: input.id,
    taskId: input.taskId,
    sourceText: input.sourceText || "",
    confidence: input.confidence || "unknown",
    reason: input.reason || "",
    sceneTemplateId: input.sceneTemplateId,
    capabilities: input.capabilities || [],
    projects: input.projects || [],
    skills: input.skills || [],
    rules: input.rules || []
  };
}

export function normalizeQueryRouteResult(input = {}) {
  return {
    type: "route",
    mode: ROUTE_MODES.includes(input.mode) ? input.mode : "none",
    sceneTemplate: input.sceneTemplate ? {
      ...normalizeSceneTemplate(input.sceneTemplate),
      confidence: input.sceneTemplate.confidence || "unknown",
      reason: input.sceneTemplate.reason || ""
    } : null,
    workset: input.workset ? normalizeWorkset(input.workset) : null,
    skills: input.skills || [],
    rules: input.rules || [],
    readPaths: input.readPaths || [],
    nextAction: input.nextAction || "",
    candidates: input.candidates || [],
    historyHints: input.historyHints || [],
    clarify: input.clarify || [],
    refinementHint: input.refinementHint || "",
    inference: input.inference || {}
  };
}

export function normalizeCommandResult(input = {}) {
  return {
    status: COMMAND_RESULT_STATUSES.includes(input.status) ? input.status : "ok",
    action: input.action || "",
    entityType: ENTITY_TYPES.includes(input.entityType) ? input.entityType : undefined,
    entityId: input.entityId,
    message: input.message || "",
    paths: input.paths || [],
    warnings: input.warnings || []
  };
}
