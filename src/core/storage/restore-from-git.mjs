import { execFileSync } from "node:child_process";
import path from "node:path";
import { normalizeCommandResult } from "../contracts/devflow-types.mjs";
import { resolveInside, toPath, toPosixPath } from "../paths.mjs";
import { defaultDbPath, initializeSchema, openDevFlowDatabase } from "./schema.mjs";

export const DEFAULT_RESTORE_REF = "8b67fdd^";

export async function restoreDevFlowFromGit({
  rootDir = process.cwd(),
  dbPath = defaultDbPath(rootDir),
  ref = DEFAULT_RESTORE_REF,
  dryRun = false
} = {}) {
  const snapshot = collectGitConfigSnapshot({ rootDir, dbPath, ref });
  if (dryRun) {
    return restoreResult({
      status: "noop",
      message: "Dry run only. SQLite was not changed.",
      snapshot,
      dryRun: true,
      imported: emptyImportedCounts(snapshot)
    });
  }

  const db = openDevFlowDatabase({ rootDir: snapshot.rootPath, dbPath: snapshot.dbPath });
  let imported;
  try {
    initializeSchema(db);
    imported = applyGitConfigSnapshot(db, snapshot);
  } finally {
    db.close();
  }

  return restoreResult({
    status: "ok",
    message: "Historical DevFlow config restored into SQLite.",
    snapshot,
    dryRun: false,
    imported
  });
}

export function collectGitConfigSnapshot({
  rootDir = process.cwd(),
  dbPath = defaultDbPath(rootDir),
  ref = DEFAULT_RESTORE_REF
} = {}) {
  const rootPath = toPath(rootDir);
  const projects = readIndexedRecords(rootPath, ref, "config/projects/index.json", "projects");
  const sceneTemplates = readIndexedRecords(rootPath, ref, "config/scenes/index.json", "scenes")
    .map((sceneTemplate) => ({
      ...sceneTemplate,
      templateType: sceneTemplate.templateType || "scene-template",
      sourcePath: sceneTemplate.sourcePath || sceneTemplate.source?.path || ""
    }));
  const skills = readCatalog(rootPath, ref, "config/skills/skills.json", "skills");
  const rules = readCatalog(rootPath, ref, "config/rules/rules.json", "rules");
  const graphEdges = buildGraphEdges({ projects, sceneTemplates, rules });

  return {
    rootPath,
    dbPath: toPath(dbPath),
    ref,
    projects,
    sceneTemplates,
    skills,
    rules,
    graphEdges,
    sourceCounts: {
      projects: projects.length,
      sceneTemplates: sceneTemplates.length,
      skills: skills.length,
      rules: rules.length,
      graphEdges: graphEdges.length
    }
  };
}

export function applyGitConfigSnapshot(db, snapshot) {
  const counts = {
    projects: snapshot.projects.length,
    sceneTemplates: snapshot.sceneTemplates.length,
    skills: snapshot.skills.length,
    rules: snapshot.rules.length,
    projectSkillMounts: countProjectRefs(snapshot.projects, "skills"),
    projectRuleMounts: countProjectRefs(snapshot.projects, "rules"),
    sceneTemplateCapabilities: countSceneCapabilities(snapshot.sceneTemplates),
    sceneTemplateProjectHints: countSceneRefs(snapshot.sceneTemplates, "projectHints", "projects"),
    sceneTemplateSkillHints: countSceneRefs(snapshot.sceneTemplates, "skillHints"),
    sceneTemplateRuleHints: countSceneRefs(snapshot.sceneTemplates, "ruleHints", "rules"),
    graphEdges: snapshot.graphEdges.length
  };

  const tx = db.transaction(() => {
    clearImportedGraphEdges(db, snapshot);
    for (const project of snapshot.projects) upsertProject(db, project);
    for (const sceneTemplate of snapshot.sceneTemplates) upsertSceneTemplate(db, sceneTemplate);
    for (const skill of snapshot.skills) upsertSkill(db, skill);
    for (const rule of snapshot.rules) upsertRule(db, rule);
    for (const edge of snapshot.graphEdges) upsertGraphEdge(db, edge);
  });
  tx();
  return counts;
}

function readIndexedRecords(rootPath, ref, indexPath, key) {
  const index = readGitJson(rootPath, ref, indexPath);
  return (index[key] || []).map((item) => {
    const recordPath = item.path || path.posix.join(path.posix.dirname(indexPath), `${item.id}.json`);
    const detail = readGitJson(rootPath, ref, recordPath);
    return {
      ...item,
      ...detail,
      sourcePath: detail.sourcePath || detail.source?.path || item.sourcePath || recordPath
    };
  });
}

function readCatalog(rootPath, ref, catalogPath, key) {
  try {
    const catalog = readGitJson(rootPath, ref, catalogPath);
    return catalog[key] || [];
  } catch (error) {
    if (isGitPathMissing(error)) return [];
    throw error;
  }
}

function readGitJson(rootPath, ref, relativePath) {
  try {
    const raw = execFileSync("git", ["show", `${ref}:${relativePath}`], {
      cwd: rootPath,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });
    return JSON.parse(raw);
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`failed to read ${relativePath} from ${ref}: ${detail}`);
  }
}

function isGitPathMissing(error) {
  return /exists on disk, but not in|path .* does not exist|exists on disk but not in/i.test(error.message);
}

function upsertProject(db, project) {
  const normalized = normalizeProjectMetadata(project);
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
}

function upsertSceneTemplate(db, sceneTemplate) {
  db.prepare(`
    INSERT OR REPLACE INTO scene_templates (id, name, summary, source_path, raw_json)
    VALUES (@id, @name, @summary, @sourcePath, @rawJson)
  `).run({
    id: sceneTemplate.id,
    name: sceneTemplate.name || sceneTemplate.id,
    summary: sceneTemplate.summary || "",
    sourcePath: sceneTemplate.sourcePath || sceneTemplate.source?.path || "",
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
  for (const project of firstNonEmptyArray(sceneTemplate.projectHints, sceneTemplate.projects)) {
    insertRef(db, "scene_template_project_hints", "scene_template_id", sceneTemplate.id, "project_id", project.id, project);
  }
  for (const skill of sceneTemplate.skillHints || []) {
    insertRef(db, "scene_template_skill_hints", "scene_template_id", sceneTemplate.id, "skill_id", skill.id, skill);
  }
  for (const rule of firstNonEmptyArray(sceneTemplate.ruleHints, sceneTemplate.rules)) {
    insertRef(db, "scene_template_rule_hints", "scene_template_id", sceneTemplate.id, "rule_id", rule.id, rule);
  }
}

function upsertSkill(db, skill) {
  db.prepare("INSERT OR REPLACE INTO skills (id, name, source_path, raw_json) VALUES (@id, @name, @sourcePath, @rawJson)").run({
    id: skill.id,
    name: skill.name || skill.id,
    sourcePath: skill.sourcePath || "",
    rawJson: stringify(skill)
  });
}

function upsertRule(db, rule) {
  db.prepare("INSERT OR REPLACE INTO rules (id, name, source_path, raw_json) VALUES (@id, @name, @sourcePath, @rawJson)").run({
    id: rule.id,
    name: rule.name || rule.id,
    sourcePath: rule.sourcePath || "",
    rawJson: stringify(rule)
  });
}

function upsertGraphEdge(db, edge) {
  db.prepare("INSERT OR REPLACE INTO graph_edges (from_id, to_id, relation, raw_json) VALUES (?, ?, ?, ?)").run(
    edge.from,
    edge.to,
    edge.relation,
    stringify(edge)
  );
}

function insertRef(db, table, leftColumn, leftValue, rightColumn, rightValue, rawValue) {
  if (!leftValue || !rightValue) return;
  db.prepare(`INSERT OR REPLACE INTO ${table} (${leftColumn}, ${rightColumn}, raw_json) VALUES (?, ?, ?)`).run(
    leftValue,
    rightValue,
    stringify(rawValue)
  );
}

function clearImportedGraphEdges(db, snapshot) {
  const ids = [
    ...snapshot.projects.map((project) => `project:${project.id}`),
    ...snapshot.sceneTemplates.map((sceneTemplate) => `sceneTemplate:${sceneTemplate.id}`),
    ...snapshot.skills.map((skill) => `skill:${skill.id}`),
    ...snapshot.rules.map((rule) => `rule:${rule.id}`)
  ];
  const remove = db.prepare("DELETE FROM graph_edges WHERE from_id = ? OR to_id = ?");
  for (const id of ids) remove.run(id, id);
}

function buildGraphEdges({ projects, sceneTemplates, rules }) {
  const edges = [];
  const addEdge = (from, to, relation) => {
    if (!from || !to || edges.some((edge) => edge.from === from && edge.to === to && edge.relation === relation)) return;
    edges.push({ from, to, relation });
  };

  for (const project of projects) {
    for (const scene of project.scenes || []) addEdge(`project:${project.id}`, `sceneTemplate:${scene.id}`, "uses-scene-template");
    for (const skill of project.skills || []) addEdge(`project:${project.id}`, `skill:${skill.id}`, "uses-skill");
    for (const rule of project.rules || []) addEdge(`project:${project.id}`, `rule:${rule.id}`, "uses-rule");
  }
  for (const sceneTemplate of sceneTemplates) {
    for (const project of firstNonEmptyArray(sceneTemplate.projectHints, sceneTemplate.projects)) addEdge(`sceneTemplate:${sceneTemplate.id}`, `project:${project.id}`, "hints-project");
    for (const skill of sceneTemplate.skillHints || []) addEdge(`sceneTemplate:${sceneTemplate.id}`, `skill:${skill.id}`, "hints-skill");
    for (const rule of firstNonEmptyArray(sceneTemplate.ruleHints, sceneTemplate.rules)) addEdge(`sceneTemplate:${sceneTemplate.id}`, `rule:${rule.id}`, "hints-rule");
  }
  for (const rule of rules) {
    for (const projectId of rule.projectIds || []) addEdge(`rule:${rule.id}`, `project:${projectId}`, "applies-project");
    for (const sceneId of rule.sceneIds || []) addEdge(`rule:${rule.id}`, `sceneTemplate:${sceneId}`, "applies-scene-template");
  }
  return edges;
}

function firstNonEmptyArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length) || [];
}

function countProjectRefs(projects, key) {
  return projects.reduce((count, project) => count + (project[key] || []).filter((item) => item?.id).length, 0);
}

function countSceneCapabilities(sceneTemplates) {
  return sceneTemplates.reduce((count, sceneTemplate) => count + (sceneTemplate.capabilityIds || []).length, 0);
}

function countSceneRefs(sceneTemplates, primaryKey, fallbackKey) {
  return sceneTemplates.reduce((count, sceneTemplate) => {
    const refs = fallbackKey ? firstNonEmptyArray(sceneTemplate[primaryKey], sceneTemplate[fallbackKey]) : (sceneTemplate[primaryKey] || []);
    return count + refs.filter((item) => item?.id).length;
  }, 0);
}

function emptyImportedCounts(snapshot) {
  return {
    projects: snapshot.projects.length,
    sceneTemplates: snapshot.sceneTemplates.length,
    skills: snapshot.skills.length,
    rules: snapshot.rules.length,
    graphEdges: snapshot.graphEdges.length
  };
}

function restoreResult({ status, message, snapshot, dryRun, imported }) {
  return {
    ...normalizeCommandResult({
      status,
      action: "restore-from-git",
      message,
      paths: [toRelativePath(snapshot.rootPath, snapshot.dbPath)],
      warnings: []
    }),
    dryRun,
    ref: snapshot.ref,
    dbPath: toRelativePath(snapshot.rootPath, snapshot.dbPath),
    sourceCounts: snapshot.sourceCounts,
    imported,
    willWrite: dryRun ? [toRelativePath(snapshot.rootPath, snapshot.dbPath)] : []
  };
}

function toRelativePath(rootPath, absolutePath) {
  return toPosixPath(path.relative(rootPath, resolveInside(rootPath, path.relative(rootPath, absolutePath))));
}

function stringify(value) {
  return JSON.stringify(value ?? null);
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
