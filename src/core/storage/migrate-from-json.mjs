import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { normalizeCommandResult } from "../contracts/devflow-types.mjs";
import { ENTRY_CONFIG_KEY } from "../defaults/entry.mjs";
import { GATES_CONFIG_KEY } from "../defaults/gates.mjs";
import { PROFILE_CONFIG_KEY } from "../defaults/profile.mjs";
import { createJsonRepository } from "../repositories/json-repository.mjs";
import { resolveInside, toPath } from "../paths.mjs";
import { defaultDbPath, initializeSchema, openDevFlowDatabase } from "./schema.mjs";

const CONFIG_JSON_SOURCES = [
  { key: ENTRY_CONFIG_KEY, path: "config/entry.json" },
  { key: PROFILE_CONFIG_KEY, path: "config/profile.json" },
  { key: GATES_CONFIG_KEY, path: "config/tasks/gates.json" }
];

const TABLES_TO_CLEAR = [
  "task_documents",
  "config",
  "graph_edges",
  "runtime_state",
  "task_events",
  "task_gates",
  "tasks",
  "workset_rules",
  "workset_skills",
  "workset_capabilities",
  "workset_projects",
  "worksets",
  "scene_template_rule_hints",
  "scene_template_skill_hints",
  "scene_template_project_hints",
  "scene_template_capabilities",
  "project_rule_mounts",
  "project_skill_mounts",
  "rules",
  "skills",
  "scene_templates",
  "capabilities",
  "projects"
];

export async function migrateDevFlowFromJson({
  rootDir = process.cwd(),
  dbPath = defaultDbPath(rootDir),
  dryRun = false,
  keepJson = false
} = {}) {
  const rootPath = toPath(rootDir);
  const resolvedDbPath = toPath(dbPath);
  if (!dryRun) assertCleanGitWorktree(rootPath);

  const snapshot = await collectJsonMigrationSnapshot({ rootDir: rootPath, dbPath: resolvedDbPath });
  if (dryRun) {
    return migrationResult({
      status: "noop",
      message: "Dry run only. SQLite and JSON files were not changed.",
      snapshot,
      dryRun: true,
      keepJson
    });
  }

  const db = openDevFlowDatabase({ rootDir: snapshot.rootPath, dbPath: snapshot.dbPath });
  let sanityChecks;
  try {
    initializeSchema(db);
    sanityChecks = applyMigrationSnapshot(db, snapshot);
  } finally {
    db.close();
  }

  const deletedJsonPaths = keepJson ? [] : deleteJsonFiles(snapshot.rootPath, snapshot.sourceJsonPaths);
  return migrationResult({
    status: "ok",
    message: keepJson
      ? "JSON data migrated into SQLite. JSON files were kept."
      : "JSON data migrated into SQLite. JSON files were removed.",
    snapshot,
    dryRun: false,
    keepJson,
    sanityChecks,
    deletedJsonPaths
  });
}

export async function collectJsonMigrationSnapshot({ rootDir = process.cwd(), dbPath = defaultDbPath(rootDir) } = {}) {
  const rootPath = toPath(rootDir);
  const repository = createJsonRepository({ rootDir: rootPath });
  const warnings = [];

  const configRecords = CONFIG_JSON_SOURCES
    .map((source) => {
      const data = readJson(rootPath, source.path, undefined);
      return data === undefined ? null : { ...source, data };
    })
    .filter(Boolean);

  const [
    projects,
    sceneTemplates,
    skills,
    rules,
    tasks,
    graphEdges
  ] = await Promise.all([
    repository.listProjects(),
    repository.listSceneTemplates(),
    repository.listSkills(),
    repository.listRules(),
    repository.listTasks(),
    repository.listGraphEdges()
  ]);

  const runtimeState = readJson(rootPath, "runtime/current.json", null);
  const taskDocuments = collectTaskDocuments(rootPath, tasks);
  const sourceJsonPaths = collectKnownSourceJsonPaths(rootPath);
  const discoveredJsonPaths = discoverJsonFiles(rootPath);
  const unknownJsonPaths = discoveredJsonPaths.filter((relativePath) => !sourceJsonPaths.includes(relativePath));
  if (unknownJsonPaths.length) {
    throw new Error(`unmapped JSON source path(s): ${unknownJsonPaths.join(", ")}`);
  }

  return {
    rootPath,
    dbPath: toPath(dbPath),
    configRecords,
    projects,
    sceneTemplates,
    skills,
    rules,
    tasks,
    taskDocuments,
    runtimeState,
    graphEdges,
    sourceJsonPaths,
    warnings,
    sourceCounts: {
      config: configRecords.length,
      projects: projects.length,
      sceneTemplates: sceneTemplates.length,
      skills: skills.length,
      rules: rules.length,
      tasks: tasks.length,
      taskDocuments: taskDocuments.length,
      runtimeState: runtimeState ? 1 : 0,
      graphEdges: graphEdges.length
    }
  };
}

export function applyMigrationSnapshot(db, snapshot) {
  const writeAll = db.transaction(() => {
    clearTables(db);
    insertConfigRecords(db, snapshot.configRecords || []);
    insertProjects(db, snapshot.rootPath, snapshot.projects || [], snapshot.warnings || []);
    insertSceneTemplates(db, snapshot.rootPath, snapshot.sceneTemplates || [], snapshot.warnings || []);
    insertSkills(db, snapshot.rootPath, snapshot.skills || [], snapshot.warnings || []);
    insertRules(db, snapshot.rootPath, snapshot.rules || [], snapshot.warnings || []);
    insertTasks(db, snapshot.tasks || []);
    insertTaskDocuments(db, snapshot.taskDocuments || []);
    if (snapshot.runtimeState) insertRuntimeState(db, snapshot.runtimeState);
    insertGraphEdges(db, snapshot.graphEdges || []);
  });
  writeAll();
  return assertRowCountSanity(db, snapshot.sourceCounts || {});
}

function collectKnownSourceJsonPaths(rootPath) {
  const paths = [];
  const addIfExists = (relativePath) => {
    if (relativePath && fs.existsSync(resolveInside(rootPath, relativePath))) {
      paths.push(relativePath);
    }
  };

  for (const source of CONFIG_JSON_SOURCES) addIfExists(source.path);

  const projectIndex = readJson(rootPath, "config/projects/index.json", { projects: [] });
  addIfExists("config/projects/index.json");
  for (const item of projectIndex.projects || []) addIfExists(item.path || `config/projects/${item.id}.json`);

  const sceneIndex = readJson(rootPath, "config/scenes/index.json", { scenes: [] });
  addIfExists("config/scenes/index.json");
  for (const item of sceneIndex.scenes || []) addIfExists(item.path || `config/scenes/${item.id}.json`);

  addIfExists("config/skills/skills.json");
  addIfExists("config/rules/rules.json");
  addIfExists("runtime/current.json");

  for (const relativePath of discoverJsonFiles(rootPath)) {
    if (/^runtime\/tasks\/[^/]+\.json$/.test(relativePath)) addIfExists(relativePath);
  }

  return [...new Set(paths)].sort();
}

function discoverJsonFiles(rootPath) {
  const result = [];
  for (const rootName of ["config", "runtime"]) {
    const startPath = resolveInside(rootPath, rootName);
    if (!fs.existsSync(startPath)) continue;
    walkJsonFiles(rootPath, startPath, result);
  }
  return result.sort();
}

function walkJsonFiles(rootPath, currentPath, result) {
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      walkJsonFiles(rootPath, entryPath, result);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      result.push(toRelativePath(rootPath, entryPath));
    }
  }
}

function collectTaskDocuments(rootPath, tasks) {
  return tasks.flatMap((task) => {
    const handoffPath = `runtime/tasks/${task.id}/handoff.md`;
    if (!fs.existsSync(resolveInside(rootPath, handoffPath))) return [];
    return [{
      taskId: task.id,
      kind: "handoff",
      path: handoffPath
    }];
  });
}

function assertCleanGitWorktree(rootPath) {
  let status;
  try {
    status = execFileSync("git", ["status", "--porcelain"], {
      cwd: rootPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`git working tree check failed: ${detail}`);
  }
  if (status.trim()) {
    throw new Error(`git working tree must be clean before devflow migrate from-json:\n${status.trim()}`);
  }
}

function clearTables(db) {
  for (const table of TABLES_TO_CLEAR) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
}

function insertConfigRecords(db, configRecords) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO config (key, raw_json, updated_at)
    VALUES (?, ?, ?)
  `);
  const updatedAt = new Date().toISOString();
  for (const record of configRecords) {
    insert.run(record.key, stringify(record.data), updatedAt);
  }
}

function insertProjects(db, rootPath, projects, warnings) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, technology_family_id, source_path, doc_path, products, domains, role, components, raw_json)
    VALUES (@id, @name, @technologyFamilyId, @sourcePath, @docPath, @products, @domains, @role, @components, @rawJson)
  `);
  for (const project of projects) {
    const normalized = normalizeProjectMetadata(project);
    insert.run({
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
    warnMissingSourcePath(rootPath, warnings, "project", normalized.id, normalized.doc?.path);
    for (const skill of normalized.skills || []) insertRef(db, "project_skill_mounts", "project_id", normalized.id, "skill_id", skill.id, skill);
    for (const rule of normalized.rules || []) insertRef(db, "project_rule_mounts", "project_id", normalized.id, "rule_id", rule.id, rule);
  }
}

function insertSceneTemplates(db, rootPath, sceneTemplates, warnings) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO scene_templates (id, name, summary, source_path, raw_json)
    VALUES (@id, @name, @summary, @sourcePath, @rawJson)
  `);
  const insertCapability = db.prepare("INSERT OR REPLACE INTO capabilities (id, raw_json) VALUES (?, ?)");
  for (const sceneTemplate of sceneTemplates) {
    insert.run({
      id: sceneTemplate.id,
      name: sceneTemplate.name || sceneTemplate.id,
      summary: sceneTemplate.summary || "",
      sourcePath: sceneTemplate.sourcePath || "",
      rawJson: stringify(sceneTemplate)
    });
    warnMissingSourcePath(rootPath, warnings, "sceneTemplate", sceneTemplate.id, sceneTemplate.sourcePath);
    for (const capabilityId of sceneTemplate.capabilityIds || []) {
      insertCapability.run(capabilityId, stringify({ id: capabilityId }));
      insertRef(db, "scene_template_capabilities", "scene_template_id", sceneTemplate.id, "capability_id", capabilityId, { id: capabilityId });
    }
    for (const project of sceneTemplate.projectHints || []) insertRef(db, "scene_template_project_hints", "scene_template_id", sceneTemplate.id, "project_id", project.id, project);
    for (const skill of sceneTemplate.skillHints || []) insertRef(db, "scene_template_skill_hints", "scene_template_id", sceneTemplate.id, "skill_id", skill.id, skill);
    for (const rule of sceneTemplate.ruleHints || []) insertRef(db, "scene_template_rule_hints", "scene_template_id", sceneTemplate.id, "rule_id", rule.id, rule);
  }
}

function insertSkills(db, rootPath, skills, warnings) {
  const insert = db.prepare("INSERT OR REPLACE INTO skills (id, name, source_path, raw_json) VALUES (@id, @name, @sourcePath, @rawJson)");
  for (const skill of skills) {
    insert.run({
      id: skill.id,
      name: skill.name || skill.id,
      sourcePath: skill.sourcePath || "",
      rawJson: stringify(skill)
    });
    warnMissingSourcePath(rootPath, warnings, "skill", skill.id, skill.sourcePath);
  }
}

function insertRules(db, rootPath, rules, warnings) {
  const insert = db.prepare("INSERT OR REPLACE INTO rules (id, name, source_path, raw_json) VALUES (@id, @name, @sourcePath, @rawJson)");
  for (const rule of rules) {
    insert.run({
      id: rule.id,
      name: rule.name || rule.id,
      sourcePath: rule.sourcePath || "",
      rawJson: stringify(rule)
    });
    warnMissingSourcePath(rootPath, warnings, "rule", rule.id, rule.sourcePath);
  }
}

function insertTasks(db, tasks) {
  const insertTask = db.prepare(`
    INSERT OR REPLACE INTO tasks (id, title, status, current_gate, workset_id, raw_json)
    VALUES (@id, @title, @status, @currentGate, @worksetId, @rawJson)
  `);
  const insertWorkset = db.prepare(`
    INSERT OR REPLACE INTO worksets (id, task_id, scene_template_id, confidence, reason, raw_json)
    VALUES (@id, @taskId, @sceneTemplateId, @confidence, @reason, @rawJson)
  `);
  const insertCapability = db.prepare("INSERT OR REPLACE INTO capabilities (id, raw_json) VALUES (?, ?)");
  const insertGate = db.prepare("INSERT OR REPLACE INTO task_gates (task_id, gate_id, status, raw_json) VALUES (?, ?, ?, ?)");
  const insertEvent = db.prepare("INSERT INTO task_events (task_id, event_type, raw_json) VALUES (?, ?, ?)");

  for (const task of tasks) {
    const workset = task.workset;
    insertTask.run({
      id: task.id,
      title: task.title || task.id,
      status: task.status || "",
      currentGate: task.currentGate || "",
      worksetId: workset?.id || "",
      rawJson: stringify(task)
    });
    for (const gate of task.gates || []) insertGate.run(task.id, gate.id, gate.status || "", stringify(gate));
    for (const note of task.notes || []) insertEvent.run(task.id, "note", stringify(note));
    for (const artifact of task.artifacts || []) insertEvent.run(task.id, "artifact", stringify(artifact));
    for (const blocker of task.blockers || []) insertEvent.run(task.id, "blocker", stringify(blocker));
    if (!workset) continue;
    insertWorkset.run({
      id: workset.id,
      taskId: workset.taskId || task.id,
      sceneTemplateId: workset.sceneTemplateId || "",
      confidence: workset.confidence || "",
      reason: workset.reason || "",
      rawJson: stringify(workset)
    });
    for (const capability of workset.capabilities || []) {
      insertCapability.run(capability.id, stringify(capability));
      insertRef(db, "workset_capabilities", "workset_id", workset.id, "capability_id", capability.id, capability);
    }
    for (const project of workset.projects || []) insertRef(db, "workset_projects", "workset_id", workset.id, "project_id", project.id, project);
    for (const skill of workset.skills || []) insertRef(db, "workset_skills", "workset_id", workset.id, "skill_id", skill.id, skill);
    for (const rule of workset.rules || []) insertRef(db, "workset_rules", "workset_id", workset.id, "rule_id", rule.id, rule);
  }
}

function insertTaskDocuments(db, taskDocuments) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO task_documents (task_id, kind, path, raw_json)
    VALUES (@taskId, @kind, @path, @rawJson)
  `);
  for (const doc of taskDocuments) {
    insert.run({
      taskId: doc.taskId,
      kind: doc.kind,
      path: doc.path,
      rawJson: stringify(doc)
    });
  }
}

function insertRuntimeState(db, current) {
  db.prepare("INSERT OR REPLACE INTO runtime_state (key, raw_json) VALUES (?, ?)").run("current", stringify(current));
}

function insertGraphEdges(db, edges) {
  const insert = db.prepare("INSERT OR REPLACE INTO graph_edges (from_id, to_id, relation, raw_json) VALUES (?, ?, ?, ?)");
  for (const edge of edges) {
    insert.run(edge.from, edge.to, edge.relation, stringify(edge));
  }
}

function insertRef(db, table, leftColumn, leftValue, rightColumn, rightValue, rawValue) {
  if (!leftValue || !rightValue) return;
  db.prepare(`INSERT OR REPLACE INTO ${table} (${leftColumn}, ${rightColumn}, raw_json) VALUES (?, ?, ?)`).run(
    leftValue,
    rightValue,
    stringify(rawValue)
  );
}

function warnMissingSourcePath(rootPath, warnings, ownerType, ownerId, sourcePath) {
  if (!sourcePath) return;
  const exists = fs.existsSync(resolveInside(rootPath, sourcePath));
  if (!exists) {
    warnings.push({
      code: "missing_source_path",
      ownerType,
      ownerId,
      path: sourcePath
    });
  }
}

function assertRowCountSanity(db, sourceCounts) {
  const checks = {
    projects: {
      expected: sourceCounts.projects,
      actual: countRows(db, "projects")
    },
    tasks: {
      expected: sourceCounts.tasks,
      actual: countRows(db, "tasks")
    }
  };
  const failures = Object.entries(checks)
    .filter(([, check]) => check.expected !== check.actual)
    .map(([table, check]) => `${table}: expected ${check.expected}, got ${check.actual}`);
  if (failures.length) {
    throw new Error(`SQLite row-count sanity check failed: ${failures.join("; ")}`);
  }
  return checks;
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function deleteJsonFiles(rootPath, sourceJsonPaths) {
  const deleted = [];
  for (const relativePath of sourceJsonPaths) {
    fs.rmSync(resolveInside(rootPath, relativePath), { force: true });
    deleted.push(relativePath);
  }
  return deleted;
}

function migrationResult({
  status,
  message,
  snapshot,
  dryRun,
  keepJson,
  sanityChecks = {},
  deletedJsonPaths = []
}) {
  return {
    ...normalizeCommandResult({
      status,
      action: "migrate from-json",
      message,
      paths: [toRelativePath(snapshot.rootPath, snapshot.dbPath)],
      warnings: snapshot.warnings
    }),
    dryRun,
    keptJson: Boolean(keepJson),
    sourceCounts: snapshot.sourceCounts,
    sanityChecks,
    willWrite: [toRelativePath(snapshot.rootPath, snapshot.dbPath)],
    willDelete: keepJson ? [] : snapshot.sourceJsonPaths,
    deletedJsonPaths
  };
}

function readJson(rootPath, relativePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(resolveInside(rootPath, relativePath), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function toRelativePath(rootPath, absolutePath) {
  return path.relative(rootPath, absolutePath).split(path.sep).join("/");
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
