import { assertGraphEdgeRelation, normalizeSceneTemplate, normalizeWorkset } from "../contracts/devflow-types.mjs";
import { DEFAULT_ENTRY, ENTRY_CONFIG_KEY } from "../defaults/entry.mjs";
import { DEFAULT_GATES, GATES_CONFIG_KEY } from "../defaults/gates.mjs";
import { DEFAULT_PROFILE, PROFILE_CONFIG_KEY } from "../defaults/profile.mjs";
import { assertRepositoryContract } from "./repository-contract.mjs";
import { defaultDbPath, initializeSchema, openDevFlowDatabase } from "../storage/schema.mjs";

export function createSqliteRepository({ rootDir = process.cwd(), dbPath = defaultDbPath(rootDir) } = {}) {
  const db = openDevFlowDatabase({ rootDir, dbPath });
  initializeSchema(db);

  const repository = {
    async listProjects() {
      return listRaw(db, "projects").map((project) => hydrateProject(db, project));
    },

    async getProject(projectId) {
      const project = getRaw(db, "projects", projectId);
      return project ? hydrateProject(db, project) : null;
    },

    async listSceneTemplates() {
      return listRaw(db, "scene_templates").map((sceneTemplate) => normalizeSceneTemplate(hydrateSceneTemplate(db, sceneTemplate)));
    },

    async getSceneTemplate(sceneTemplateId) {
      const sceneTemplate = getRaw(db, "scene_templates", sceneTemplateId);
      return sceneTemplate ? normalizeSceneTemplate(hydrateSceneTemplate(db, sceneTemplate)) : null;
    },

    async listSkills() {
      return listRaw(db, "skills");
    },

    async listRules() {
      return listRaw(db, "rules");
    },

    async listTasks() {
      return listRaw(db, "tasks").map((task) => hydrateTask(db, task)).map((task) => normalizeTask(task));
    },

    async getTask(taskId) {
      const task = getRaw(db, "tasks", taskId);
      return task ? normalizeTask(hydrateTask(db, task)) : null;
    },

    async getActiveTask() {
      const current = getRuntimeState(db);
      if (!current?.activeTaskId) return null;
      return repository.getTask(current.activeTaskId);
    },

    async getWorkset(worksetOrTaskId) {
      const workset = getHydratedWorkset(db, worksetOrTaskId)
        || getHydratedWorksetByTaskId(db, worksetOrTaskId);
      return workset ? normalizeWorkset(workset) : null;
    },

    async listSkillsForProject(projectId) {
      return listJoinedEntities(db, "skills", "project_skill_mounts", "skill_id", "project_id", projectId);
    },

    async listRulesForProject(projectId) {
      return listJoinedEntities(db, "rules", "project_rule_mounts", "rule_id", "project_id", projectId);
    },

    async listProjectsForSceneTemplate(sceneTemplateId) {
      return listJoinedProjectsForSceneTemplate(db, sceneTemplateId);
    },

    async listSkillsForSceneTemplate(sceneTemplateId) {
      return listJoinedEntities(db, "skills", "scene_template_skill_hints", "skill_id", "scene_template_id", sceneTemplateId);
    },

    async listRulesForSceneTemplate(sceneTemplateId) {
      return listJoinedEntities(db, "rules", "scene_template_rule_hints", "rule_id", "scene_template_id", sceneTemplateId);
    },

    async listCapabilitiesForSceneTemplate(sceneTemplateId) {
      return listRefs(db, "scene_template_capabilities", "scene_template_id", sceneTemplateId);
    },

    async listProjectsForWorkset(worksetId) {
      return listRefs(db, "workset_projects", "workset_id", worksetId);
    },

    async listSkillsForWorkset(worksetId) {
      return listRefs(db, "workset_skills", "workset_id", worksetId);
    },

    async listRulesForWorkset(worksetId) {
      return listRefs(db, "workset_rules", "workset_id", worksetId);
    },

    async listCapabilitiesForWorkset(worksetId) {
      return listRefs(db, "workset_capabilities", "workset_id", worksetId);
    },

    async listGraphEdges() {
      return listRaw(db, "graph_edges");
    },

    async listProjectGraphEdges(relations = []) {
      return listProjectGraphEdges(db, relations);
    },

    async getConfig(key) {
      const row = db.prepare("SELECT raw_json FROM config WHERE key = ?").get(key);
      return row ? parseRaw(row.raw_json) : null;
    },

    async setConfig(key, value) {
      db.prepare(`
        INSERT OR REPLACE INTO config (key, raw_json, updated_at)
        VALUES (?, ?, ?)
      `).run(key, stringify(value), new Date().toISOString());
      return value;
    },

    async getEntry() {
      return await repository.getConfig(ENTRY_CONFIG_KEY) ?? DEFAULT_ENTRY;
    },

    async getProfile() {
      return await repository.getConfig(PROFILE_CONFIG_KEY) ?? DEFAULT_PROFILE;
    },

    async getGates() {
      return await repository.getConfig(GATES_CONFIG_KEY) ?? DEFAULT_GATES;
    },

    async listTaskDocuments(taskId) {
      return db.prepare("SELECT raw_json FROM task_documents WHERE task_id = ? ORDER BY rowid")
        .all(taskId)
        .map((row) => parseRaw(row.raw_json));
    },

    async writeTaskDocument(taskId, doc) {
      if (!taskId || !doc?.kind || !doc?.path) {
        throw new TypeError("writeTaskDocument requires taskId, kind, path");
      }
      db.prepare(`
        INSERT OR REPLACE INTO task_documents (task_id, kind, path, raw_json)
        VALUES (?, ?, ?, ?)
      `).run(taskId, doc.kind, doc.path, stringify(doc));
      return doc;
    },

    async setProjectProducts(projectId, products) {
      return updateProjectMetadata(db, projectId, { products: normalizeStringList(products) });
    },

    async setProjectDomains(projectId, domains) {
      return updateProjectMetadata(db, projectId, { domains: normalizeStringList(domains) });
    },

    async setProjectRole(projectId, role) {
      return updateProjectMetadata(db, projectId, { role: normalizeString(role) });
    },

    async setProjectComponents(projectId, components) {
      return updateProjectMetadata(db, projectId, { components: normalizeComponents(components) });
    },

    async upsertGraphEdge(edge) {
      return upsertGraphEdge(db, edge);
    },

    async deleteGraphEdge(edge) {
      deleteGraphEdge(db, edge);
      return null;
    },

    async writeProject(project) {
      upsertProject(db, project);
      return repository.getProject(project.id);
    },

    async writeSceneTemplate(sceneTemplate) {
      const normalized = normalizeSceneTemplate(sceneTemplate);
      upsertSceneTemplate(db, normalized);
      return repository.getSceneTemplate(normalized.id);
    },

    async writeSkill(skill) {
      upsertSkill(db, skill);
      return getRaw(db, "skills", skill.id);
    },

    async writeRule(rule) {
      upsertRule(db, rule);
      return getRaw(db, "rules", rule.id);
    },

    async writeTask(task) {
      upsertTask(db, normalizeTask(task));
      return repository.getTask(task.id);
    },

    async deleteTask(taskId) {
      deleteTaskRecord(db, taskId);
      return null;
    },

    async deleteProject(projectId) {
      deleteEntity(db, "projects", projectId, [
        ["project_skill_mounts", "project_id = ?"],
        ["project_rule_mounts", "project_id = ?"],
        ["workset_projects", "project_id = ?"],
        ["scene_template_project_hints", "project_id = ?"]
      ]);
      return null;
    },

    async deleteSceneTemplate(sceneTemplateId) {
      deleteEntity(db, "scene_templates", sceneTemplateId, [
        ["scene_template_capabilities", "scene_template_id = ?"],
        ["scene_template_project_hints", "scene_template_id = ?"],
        ["scene_template_skill_hints", "scene_template_id = ?"],
        ["scene_template_rule_hints", "scene_template_id = ?"]
      ]);
      return null;
    },

    async deleteSkill(skillId) {
      deleteEntity(db, "skills", skillId, [
        ["project_skill_mounts", "skill_id = ?"],
        ["workset_skills", "skill_id = ?"],
        ["scene_template_skill_hints", "skill_id = ?"]
      ]);
      return null;
    },

    async deleteRule(ruleId) {
      deleteEntity(db, "rules", ruleId, [
        ["project_rule_mounts", "rule_id = ?"],
        ["workset_rules", "rule_id = ?"],
        ["scene_template_rule_hints", "rule_id = ?"]
      ]);
      return null;
    },

    async setRuntimeState(runtimeState) {
      const current = getRuntimeState(db) || {};
      const nextState = normalizeRuntimeState({ ...current, ...runtimeState });
      db.prepare("INSERT OR REPLACE INTO runtime_state (key, raw_json) VALUES (?, ?)").run("current", stringify(nextState));
      return nextState;
    }
  };

  return assertRepositoryContract(repository);
}

function listRaw(db, table) {
  return db.prepare(`SELECT raw_json FROM ${table} ORDER BY rowid`).all().map((row) => parseRaw(row.raw_json));
}

function getRaw(db, table, id) {
  const row = db.prepare(`SELECT raw_json FROM ${table} WHERE id = ?`).get(id);
  return row ? parseRaw(row.raw_json) : null;
}

function hydrateProject(db, project) {
  return {
    ...normalizeProjectMetadata(project),
    skills: listRefs(db, "project_skill_mounts", "project_id", project.id),
    rules: listRefs(db, "project_rule_mounts", "project_id", project.id)
  };
}

function hydrateSceneTemplate(db, sceneTemplate) {
  return {
    ...sceneTemplate,
    capabilityIds: listRefs(db, "scene_template_capabilities", "scene_template_id", sceneTemplate.id).map((capability) => capability.id).filter(Boolean),
    projectHints: listRefs(db, "scene_template_project_hints", "scene_template_id", sceneTemplate.id),
    skillHints: listRefs(db, "scene_template_skill_hints", "scene_template_id", sceneTemplate.id),
    ruleHints: listRefs(db, "scene_template_rule_hints", "scene_template_id", sceneTemplate.id)
  };
}

function hydrateTask(db, task) {
  const worksetId = task.workset?.id || task.worksetId || "";
  const workset = (worksetId ? getHydratedWorkset(db, worksetId) : null)
    || getHydratedWorksetByTaskId(db, task.id)
    || task.workset;
  return workset ? { ...task, workset } : task;
}

function getHydratedWorkset(db, worksetId) {
  const workset = getRaw(db, "worksets", worksetId);
  return workset ? hydrateWorkset(db, workset) : null;
}

function getHydratedWorksetByTaskId(db, taskId) {
  const row = db.prepare("SELECT raw_json FROM worksets WHERE task_id = ? ORDER BY rowid LIMIT 1").get(taskId);
  return row ? hydrateWorkset(db, parseRaw(row.raw_json)) : null;
}

function hydrateWorkset(db, workset) {
  return {
    ...workset,
    capabilities: listRefs(db, "workset_capabilities", "workset_id", workset.id),
    projects: listRefs(db, "workset_projects", "workset_id", workset.id),
    skills: listRefs(db, "workset_skills", "workset_id", workset.id),
    rules: listRefs(db, "workset_rules", "workset_id", workset.id)
  };
}

function listRefs(db, table, leftColumn, leftValue) {
  return db.prepare(`SELECT raw_json FROM ${table} WHERE ${leftColumn} = ? ORDER BY rowid`)
    .all(leftValue)
    .map((row) => parseRaw(row.raw_json));
}

function listJoinedEntities(db, entityTable, relationTable, entityIdColumn, leftColumn, leftValue) {
  return db.prepare(`
    SELECT e.raw_json
    FROM ${entityTable} e
    JOIN ${relationTable} r ON e.id = r.${entityIdColumn}
    WHERE r.${leftColumn} = ?
    ORDER BY e.rowid
  `).all(leftValue).map((row) => parseRaw(row.raw_json));
}

function listJoinedProjectsForSceneTemplate(db, sceneTemplateId) {
  return db.prepare(`
    SELECT p.raw_json AS project_json, h.raw_json AS hint_json
    FROM projects p
    JOIN scene_template_project_hints h ON p.id = h.project_id
    WHERE h.scene_template_id = ?
    ORDER BY h.rowid
  `).all(sceneTemplateId).map((row) => {
    const project = hydrateProject(db, parseRaw(row.project_json));
    const hint = parseRaw(row.hint_json);
    return hint?.role ? { ...project, role: hint.role } : project;
  });
}

function listProjectGraphEdges(db, relations = []) {
  const relationList = normalizeStringList(relations);
  const relationFilter = relationList.length
    ? `AND relation IN (${relationList.map(() => "?").join(", ")})`
    : "";
  return db.prepare(`
    SELECT from_id AS "from", to_id AS "to", relation
    FROM graph_edges
    WHERE from_id LIKE 'project:%'
      AND to_id LIKE 'project:%'
      ${relationFilter}
    ORDER BY from_id, to_id, relation
  `).all(...relationList);
}

function getRuntimeState(db) {
  const row = db.prepare("SELECT raw_json FROM runtime_state WHERE key = ?").get("current");
  return row ? parseRaw(row.raw_json) : null;
}

function normalizeTask(task) {
  if (!task) return task;
  const workset = task.workset ? normalizeWorkset(task.workset) : null;
  const sceneTemplateId = task.sceneTemplateId || task.sceneTemplateIds?.[0] || task.sceneIds?.[0] || workset?.sceneTemplateId || "";
  const projectIds = task.projectIds?.length
    ? task.projectIds
    : (workset?.projects || []).map((project) => project.id).filter(Boolean);
  const sceneIds = task.sceneIds?.length ? task.sceneIds : (sceneTemplateId ? [sceneTemplateId] : []);

  return {
    ...task,
    currentGate: task.currentGate || task.gate || "",
    taskLevel: task.taskLevel || task.level || "",
    level: task.level || task.taskLevel || "",
    projectIds,
    sceneIds,
    sceneTemplateIds: task.sceneTemplateIds?.length ? task.sceneTemplateIds : sceneIds,
    ...(workset ? { workset } : {})
  };
}

function upsertProject(db, project) {
  if (!project?.id) throw new TypeError("Cannot write project without an id");
  const current = getRaw(db, "projects", project.id);
  const normalized = normalizeProjectMetadata({
    ...project,
    products: Object.hasOwn(project, "products") ? project.products : current?.products,
    domains: Object.hasOwn(project, "domains") ? project.domains : current?.domains,
    role: Object.hasOwn(project, "role") ? project.role : current?.role,
    components: Object.hasOwn(project, "components") ? project.components : current?.components
  });
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, technology_family_id, source_path, doc_path, products, domains, role, components, raw_json)
      VALUES (@id, @name, @technologyFamilyId, @sourcePath, @docPath, @products, @domains, @role, @components, @rawJson)
    `).run({
      id: normalized.id,
      name: normalized.name || normalized.id,
      technologyFamilyId: normalized.technologyFamilyId || "",
      sourcePath: normalized.sourcePath || "",
      docPath: normalized.doc?.path || "",
      products: stringify(normalized.products),
      domains: stringify(normalized.domains),
      role: normalized.role,
      components: stringify(normalized.components),
      rawJson: stringify(normalized)
    });
    db.prepare("DELETE FROM project_skill_mounts WHERE project_id = ?").run(normalized.id);
    db.prepare("DELETE FROM project_rule_mounts WHERE project_id = ?").run(normalized.id);
    for (const skill of normalized.skills || []) insertRef(db, "project_skill_mounts", "project_id", normalized.id, "skill_id", skill.id, skill);
    for (const rule of normalized.rules || []) insertRef(db, "project_rule_mounts", "project_id", normalized.id, "rule_id", rule.id, rule);
  });
  tx();
}

function updateProjectMetadata(db, projectId, patch) {
  const current = getRaw(db, "projects", projectId);
  if (!current) throw new Error(`unknown projectId: ${projectId}`);
  const next = normalizeProjectMetadata({ ...current, ...patch });
  db.prepare(`
    UPDATE projects
    SET products = @products, domains = @domains, role = @role, components = @components, raw_json = @rawJson
    WHERE id = @id
  `).run({
    id: projectId,
    products: stringify(next.products),
    domains: stringify(next.domains),
    role: next.role,
    components: stringify(next.components),
    rawJson: stringify(next)
  });
  return next;
}

function upsertGraphEdge(db, edge) {
  const normalized = normalizeGraphEdge(edge);
  db.prepare(`
    INSERT OR REPLACE INTO graph_edges (from_id, to_id, relation, raw_json)
    VALUES (@from, @to, @relation, @rawJson)
  `).run({ ...normalized, rawJson: stringify(normalized) });
  return normalized;
}

function deleteGraphEdge(db, edge) {
  const normalized = normalizeGraphEdge(edge);
  db.prepare("DELETE FROM graph_edges WHERE from_id = ? AND to_id = ? AND relation = ?")
    .run(normalized.from, normalized.to, normalized.relation);
}

function normalizeGraphEdge(edge = {}) {
  const from = normalizeString(edge.from || edge.fromId);
  const to = normalizeString(edge.to || edge.toId);
  const relation = assertGraphEdgeRelation(normalizeString(edge.relation || edge.type));
  if (!from || !to) throw new TypeError("graph edge requires from and to");
  return { from, to, relation };
}

function upsertSceneTemplate(db, sceneTemplate) {
  if (!sceneTemplate?.id) throw new TypeError("Cannot write sceneTemplate without an id");
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT OR REPLACE INTO scene_templates (id, name, summary, source_path, raw_json)
      VALUES (@id, @name, @summary, @sourcePath, @rawJson)
    `).run({
      id: sceneTemplate.id,
      name: sceneTemplate.name || sceneTemplate.id,
      summary: sceneTemplate.summary || "",
      sourcePath: sceneTemplate.sourcePath || "",
      rawJson: stringify(sceneTemplate)
    });
    db.prepare("DELETE FROM scene_template_capabilities WHERE scene_template_id = ?").run(sceneTemplate.id);
    db.prepare("DELETE FROM scene_template_project_hints WHERE scene_template_id = ?").run(sceneTemplate.id);
    db.prepare("DELETE FROM scene_template_skill_hints WHERE scene_template_id = ?").run(sceneTemplate.id);
    db.prepare("DELETE FROM scene_template_rule_hints WHERE scene_template_id = ?").run(sceneTemplate.id);
    const insertCapability = db.prepare("INSERT OR REPLACE INTO capabilities (id, raw_json) VALUES (?, ?)");
    for (const capabilityId of sceneTemplate.capabilityIds || []) {
      insertCapability.run(capabilityId, stringify({ id: capabilityId }));
      insertRef(db, "scene_template_capabilities", "scene_template_id", sceneTemplate.id, "capability_id", capabilityId, { id: capabilityId });
    }
    for (const project of sceneTemplate.projectHints || []) insertRef(db, "scene_template_project_hints", "scene_template_id", sceneTemplate.id, "project_id", project.id, project);
    for (const skill of sceneTemplate.skillHints || []) insertRef(db, "scene_template_skill_hints", "scene_template_id", sceneTemplate.id, "skill_id", skill.id, skill);
    for (const rule of sceneTemplate.ruleHints || []) insertRef(db, "scene_template_rule_hints", "scene_template_id", sceneTemplate.id, "rule_id", rule.id, rule);
  });
  tx();
}

function upsertSkill(db, skill) {
  if (!skill?.id) throw new TypeError("Cannot write skill without an id");
  db.prepare("INSERT OR REPLACE INTO skills (id, name, source_path, raw_json) VALUES (@id, @name, @sourcePath, @rawJson)").run({
    id: skill.id,
    name: skill.name || skill.id,
    sourcePath: skill.sourcePath || "",
    rawJson: stringify(skill)
  });
}

function upsertRule(db, rule) {
  if (!rule?.id) throw new TypeError("Cannot write rule without an id");
  db.prepare("INSERT OR REPLACE INTO rules (id, name, source_path, raw_json) VALUES (@id, @name, @sourcePath, @rawJson)").run({
    id: rule.id,
    name: rule.name || rule.id,
    sourcePath: rule.sourcePath || "",
    rawJson: stringify(rule)
  });
}

function upsertTask(db, task) {
  if (!task?.id) throw new TypeError("Cannot write task without an id");
  const workset = task.workset ? normalizeWorkset(task.workset) : null;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT OR REPLACE INTO tasks (id, title, status, current_gate, workset_id, raw_json)
      VALUES (@id, @title, @status, @currentGate, @worksetId, @rawJson)
    `).run({
      id: task.id,
      title: task.title || task.id,
      status: task.status || "",
      currentGate: task.currentGate || task.gate || "",
      worksetId: workset?.id || "",
      rawJson: stringify(workset ? { ...task, workset } : task)
    });
    if (workset) upsertWorkset(db, workset);
  });
  tx();
}

function upsertWorkset(db, workset) {
  db.prepare(`
    INSERT OR REPLACE INTO worksets (id, task_id, scene_template_id, confidence, reason, raw_json)
    VALUES (@id, @taskId, @sceneTemplateId, @confidence, @reason, @rawJson)
  `).run({
    id: workset.id,
    taskId: workset.taskId || "",
    sceneTemplateId: workset.sceneTemplateId || "",
    confidence: workset.confidence || "",
    reason: workset.reason || "",
    rawJson: stringify(workset)
  });

  clearWorksetRefs(db, workset.id);
  for (const capability of workset.capabilities || []) insertRef(db, "workset_capabilities", "workset_id", workset.id, "capability_id", capability.id, capability);
  for (const project of workset.projects || []) insertRef(db, "workset_projects", "workset_id", workset.id, "project_id", project.id, project);
  for (const skill of workset.skills || []) insertRef(db, "workset_skills", "workset_id", workset.id, "skill_id", skill.id, skill);
  for (const rule of workset.rules || []) insertRef(db, "workset_rules", "workset_id", workset.id, "rule_id", rule.id, rule);
}

function clearWorksetRefs(db, worksetId) {
  for (const table of ["workset_capabilities", "workset_projects", "workset_skills", "workset_rules"]) {
    db.prepare(`DELETE FROM ${table} WHERE workset_id = ?`).run(worksetId);
  }
}

function deleteTaskRecord(db, taskId) {
  if (!taskId) throw new TypeError("Cannot delete task without an id");
  const task = getRaw(db, "tasks", taskId);
  const worksetIds = new Set(
    db.prepare("SELECT id FROM worksets WHERE task_id = ?").all(taskId).map((row) => row.id)
  );
  if (task?.workset?.id) worksetIds.add(task.workset.id);
  if (task?.worksetId) worksetIds.add(task.worksetId);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM task_documents WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM task_gates WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM task_events WHERE task_id = ?").run(taskId);
    for (const worksetId of worksetIds) {
      clearWorksetRefs(db, worksetId);
      db.prepare("DELETE FROM worksets WHERE id = ?").run(worksetId);
    }
    db.prepare("DELETE FROM worksets WHERE task_id = ?").run(taskId);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
    db.prepare(`
      DELETE FROM graph_edges
      WHERE from_id = ?
         OR to_id = ?
         OR from_id LIKE ?
         OR to_id LIKE ?
    `).run(`task:${taskId}`, `task:${taskId}`, `gate:${taskId}:%`, `gate:${taskId}:%`);
  });
  tx();
}

function insertRef(db, table, leftColumn, leftValue, rightColumn, rightValue, rawValue) {
  if (!leftValue || !rightValue) return;
  db.prepare(`INSERT OR REPLACE INTO ${table} (${leftColumn}, ${rightColumn}, raw_json) VALUES (?, ?, ?)`).run(
    leftValue,
    rightValue,
    stringify(rawValue)
  );
}

function deleteEntity(db, table, id, relatedDeletes = []) {
  if (!id) throw new TypeError(`Cannot delete ${table} without an id`);
  const tx = db.transaction(() => {
    for (const [relatedTable, whereClause] of relatedDeletes) {
      db.prepare(`DELETE FROM ${relatedTable} WHERE ${whereClause}`).run(id);
    }
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    db.prepare("DELETE FROM graph_edges WHERE from_id LIKE ? OR to_id LIKE ?").run(`%:${id}`, `%:${id}`);
  });
  tx();
}

function normalizeProjectMetadata(project = {}) {
  return {
    ...project,
    products: normalizeStringList(project.products),
    domains: normalizeStringList(project.domains),
    role: normalizeString(project.role),
    components: normalizeComponents(project.components)
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

function parseRaw(value) {
  return JSON.parse(value);
}

function normalizeRuntimeState(runtimeState) {
  const nextState = { ...runtimeState };
  if (nextState.activeSceneTemplateId !== undefined) {
    nextState.activeSceneIds = nextState.activeSceneTemplateId ? [nextState.activeSceneTemplateId] : [];
  }
  if (nextState.activeTaskId) {
    const recentTaskIds = Array.isArray(nextState.recentTaskIds) ? nextState.recentTaskIds : [];
    nextState.recentTaskIds = [nextState.activeTaskId, ...recentTaskIds.filter((taskId) => taskId !== nextState.activeTaskId)];
  }
  return nextState;
}

function stringify(value) {
  return JSON.stringify(value ?? null);
}
