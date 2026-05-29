import fs from "node:fs";
import path from "node:path";
import { normalizeCommandResult } from "../contracts/devflow-types.mjs";
import { resolveInside, toPath, toPosixPath } from "../paths.mjs";
import { defaultDbPath, initializeSchema, openDevFlowDatabase } from "./schema.mjs";

const TASKS_DIR = "runtime/tasks";
const GATE_DIR_PATTERN = /^G\d+$/;

export async function importTaskDirectories({
  rootDir = process.cwd(),
  dbPath = defaultDbPath(rootDir),
  dryRun = false
} = {}) {
  const snapshot = collectTaskDirectorySnapshot({ rootDir, dbPath });
  if (dryRun) {
    return importTasksResult({
      status: "noop",
      message: "Dry run only. SQLite and runtime task markdown were not changed.",
      snapshot,
      dryRun: true,
      imported: emptyImportedCounts(snapshot),
      missingScenes: []
    });
  }

  const db = openDevFlowDatabase({ rootDir: snapshot.rootPath, dbPath: snapshot.dbPath });
  let imported;
  let missingScenes;
  try {
    initializeSchema(db);
    imported = applyTaskDirectorySnapshot(db, snapshot);
    missingScenes = scanMissingSceneTemplates(db, snapshot);
  } finally {
    db.close();
  }

  return importTasksResult({
    status: "ok",
    message: "Runtime task directories imported into SQLite.",
    snapshot,
    dryRun: false,
    imported,
    missingScenes
  });
}

export function collectTaskDirectorySnapshot({
  rootDir = process.cwd(),
  dbPath = defaultDbPath(rootDir)
} = {}) {
  const rootPath = toPath(rootDir);
  const tasksRoot = resolveInside(rootPath, TASKS_DIR);
  const warnings = [];
  const runtimeState = readJson(rootPath, "runtime/current.json", null);
  const taskEntries = fs.existsSync(tasksRoot)
    ? fs.readdirSync(tasksRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const taskRecords = taskEntries.map((entry) => collectTaskRecord(rootPath, entry.name, runtimeState, warnings));
  const taskDocuments = taskRecords.flatMap((record) => record.documents);

  return {
    rootPath,
    dbPath: toPath(dbPath),
    runtimeState,
    tasks: taskRecords.map((record) => record.task),
    worksets: taskRecords.map((record) => record.workset),
    taskDocuments,
    handoffTexts: Object.fromEntries(taskRecords.map((record) => [record.task.id, record.handoffText])),
    warnings,
    sourceCounts: {
      tasks: taskRecords.length,
      worksets: taskRecords.length,
      taskDocuments: taskDocuments.length,
      runtimeState: runtimeState ? 1 : 0
    }
  };
}

export function applyTaskDirectorySnapshot(db, snapshot) {
  const tx = db.transaction(() => {
    for (let index = 0; index < snapshot.tasks.length; index += 1) {
      upsertTask(db, snapshot.tasks[index], snapshot.worksets[index]);
    }
    for (const task of snapshot.tasks) {
      db.prepare("DELETE FROM task_documents WHERE task_id = ?").run(task.id);
    }
    insertTaskDocuments(db, snapshot.taskDocuments);
    if (snapshot.runtimeState) {
      db.prepare("INSERT OR REPLACE INTO runtime_state (key, raw_json) VALUES (?, ?)").run("current", stringify(snapshot.runtimeState));
    }
  });
  tx();
  return {
    tasks: snapshot.tasks.length,
    worksets: snapshot.worksets.length,
    taskDocuments: snapshot.taskDocuments.length,
    runtimeState: snapshot.runtimeState ? 1 : 0
  };
}

export function scanMissingSceneTemplates(db, snapshot) {
  const existingSceneIds = new Set(db.prepare("SELECT id FROM scene_templates").all().map((row) => row.id));
  const existingProjects = db.prepare("SELECT raw_json FROM projects ORDER BY rowid").all().map((row) => JSON.parse(row.raw_json));
  const missingById = new Map();
  const worksetRows = db.prepare("SELECT id, task_id, scene_template_id, raw_json FROM worksets ORDER BY rowid").all();
  const taskRows = db.prepare("SELECT id, raw_json FROM tasks ORDER BY rowid").all();

  for (const row of worksetRows) {
    addMissingReference(missingById, existingSceneIds, row.scene_template_id, {
      taskId: row.task_id || "",
      worksetId: row.id,
      source: "worksets.scene_template_id"
    });
  }

  for (const row of taskRows) {
    const task = JSON.parse(row.raw_json);
    for (const sceneId of collectTaskSceneIds(task)) {
      addMissingReference(missingById, existingSceneIds, sceneId, {
        taskId: row.id,
        worksetId: task.workset?.id || task.worksetId || "",
        source: "tasks.raw_json"
      });
    }
  }

  return [...missingById.values()]
    .map((scene) => ({
      ...scene,
      referencedBy: uniqueReferences(scene.referencedBy),
      suggestedProjectHints: inferProjectHintsForScene(scene, snapshot, existingProjects)
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function collectTaskRecord(rootPath, taskIdFromDirectory, runtimeState, warnings) {
  const taskDir = path.posix.join(TASKS_DIR, taskIdFromDirectory);
  const handoffPath = path.posix.join(taskDir, "handoff.md");
  const absoluteHandoffPath = resolveInside(rootPath, handoffPath);
  const handoffText = fs.existsSync(absoluteHandoffPath) ? fs.readFileSync(absoluteHandoffPath, "utf8") : "";
  if (!handoffText) {
    warnings.push({ code: "missing_handoff", taskId: taskIdFromDirectory, path: handoffPath });
  }

  const parsed = parseHandoff(handoffText);
  const taskId = parsed.taskId || taskIdFromDirectory;
  if (!parsed.taskId) {
    warnings.push({ code: "missing_task_id", taskId, default: taskIdFromDirectory, path: handoffPath });
  }
  const worksetId = parsed.worksetId || `workset-${taskId}`;
  if (!parsed.worksetId) {
    warnings.push({ code: "missing_workset_id", taskId, default: worksetId, path: handoffPath });
  }

  const gateIds = collectGateIds(rootPath, taskDir);
  const currentGate = parsed.currentGate || defaultCurrentGate(taskId, runtimeState, gateIds);
  if (!parsed.currentGate && currentGate) {
    warnings.push({ code: "missing_current_gate", taskId, default: currentGate, path: handoffPath });
  }

  const recoveryPoint = parsed.recoveryPoint || parsed.bodySummary || "";
  if (!parsed.recoveryPoint && recoveryPoint) {
    warnings.push({ code: "missing_recovery_defaulted_from_body", taskId, path: handoffPath });
  }

  const updatedAt = parsed.updatedAt || "";
  if (!updatedAt) {
    warnings.push({ code: "missing_updated_at", taskId, path: handoffPath });
  }

  const sceneTemplateId = parsed.sceneTemplateId || "";
  const workset = {
    id: worksetId,
    taskId,
    sceneTemplateId,
    confidence: parsed.worksetConfidence || "imported",
    reason: parsed.worksetReason || "Imported from runtime task directory handoff.",
    projects: parsed.projects,
    capabilities: parsed.capabilities,
    skills: parsed.skills,
    rules: parsed.rules
  };
  const sceneIds = sceneTemplateId ? [sceneTemplateId] : [];
  const task = {
    id: taskId,
    title: parsed.title || taskId,
    status: parsed.status || "active",
    currentGate,
    taskLevel: parsed.level || "",
    level: parsed.level || "",
    recoveryPoint,
    updatedAt,
    worksetId,
    sceneIds,
    sceneTemplateIds: sceneIds,
    sourcePath: handoffPath,
    workset
  };

  return {
    task,
    workset,
    documents: collectTaskDocuments(rootPath, taskDir, taskId, Boolean(handoffText)),
    handoffText
  };
}

function parseHandoff(text) {
  const result = {
    title: "",
    taskId: "",
    worksetId: "",
    sceneTemplateId: "",
    recoveryPoint: "",
    updatedAt: "",
    status: "",
    level: "",
    currentGate: "",
    worksetConfidence: "",
    worksetReason: "",
    projects: [],
    capabilities: [],
    skills: [],
    rules: [],
    bodySummary: ""
  };
  const lines = String(text || "").split(/\r?\n/);
  let section = "";
  let metadataBlockEnded = false;
  const bodyCandidates = [];

  for (const line of lines) {
    const titleMatch = line.match(/^#\s+(.+?)\s*$/);
    if (titleMatch && !result.title) {
      result.title = titleMatch[1].trim();
      continue;
    }

    const headingMatch = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      section = normalizeSectionName(headingMatch[2]);
      metadataBlockEnded = true;
      continue;
    }

    const headerMatch = line.match(/^(Task|Workset|Scene Template|Recovery|Updated):\s*(.*)$/);
    if (headerMatch) {
      setHeaderValue(result, headerMatch[1], headerMatch[2].trim());
      continue;
    }

    const taskStateMatch = section === "task state" ? line.match(/^-\s*([A-Za-z][A-Za-z0-9]*):\s*(.*)$/) : null;
    if (taskStateMatch) {
      setTaskStateValue(result, taskStateMatch[1], taskStateMatch[2].trim());
      continue;
    }

    const worksetMatch = section === "workset" ? line.match(/^-\s*([A-Za-z][A-Za-z0-9]*):\s*(.*)$/) : null;
    if (worksetMatch) {
      setWorksetValue(result, worksetMatch[1], worksetMatch[2].trim());
      continue;
    }

    if (["projects", "capabilities", "skills", "rules"].includes(section)) {
      const ref = parseListRef(line);
      if (ref) result[section].push(ref);
      continue;
    }

    const trimmed = line.trim();
    if (metadataBlockEnded && trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("- ")) {
      bodyCandidates.push(trimmed);
    } else if (!metadataBlockEnded && trimmed && !/^(Task|Workset|Scene Template|Recovery|Updated):/.test(trimmed)) {
      bodyCandidates.push(trimmed);
    }
  }

  result.bodySummary = bodyCandidates[0] || "";
  return result;
}

function setHeaderValue(result, key, value) {
  if (key === "Task") result.taskId = value;
  if (key === "Workset") result.worksetId = value;
  if (key === "Scene Template") result.sceneTemplateId = value;
  if (key === "Recovery") result.recoveryPoint = value;
  if (key === "Updated") result.updatedAt = value;
}

function setTaskStateValue(result, key, value) {
  const normalized = key.toLowerCase();
  if (normalized === "id") result.taskId = value;
  if (normalized === "status") result.status = value;
  if (normalized === "level") result.level = value;
  if (normalized === "currentgate") result.currentGate = value;
  if (normalized === "recoverypoint") result.recoveryPoint = value;
}

function setWorksetValue(result, key, value) {
  const normalized = key.toLowerCase();
  if (normalized === "id") result.worksetId = value;
  if (normalized === "scenetemplateid") result.sceneTemplateId = value;
  if (normalized === "confidence") result.worksetConfidence = value;
  if (normalized === "reason") result.worksetReason = value;
}

function parseListRef(line) {
  const match = line.match(/^-\s+(.+?)(?::\s*(.*))?$/);
  if (!match) return null;
  const id = match[1].trim();
  if (!id || id.toLowerCase() === "none") return null;
  const value = { id };
  const suffix = (match[2] || "").trim();
  if (suffix) value.role = suffix;
  return value;
}

function normalizeSectionName(value) {
  return String(value || "").trim().toLowerCase();
}

function defaultCurrentGate(taskId, runtimeState, gateIds) {
  if (runtimeState?.activeTaskId === taskId && runtimeState.currentGate) return runtimeState.currentGate;
  return gateIds.at(-1) || "";
}

function collectGateIds(rootPath, taskDir) {
  const absoluteTaskDir = resolveInside(rootPath, taskDir);
  if (!fs.existsSync(absoluteTaskDir)) return [];
  return fs.readdirSync(absoluteTaskDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && GATE_DIR_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareGateIds);
}

function compareGateIds(left, right) {
  return Number(left.slice(1)) - Number(right.slice(1));
}

function collectTaskDocuments(rootPath, taskDir, taskId, hasHandoff) {
  const docs = [];
  const addDoc = (kind, relativePath) => {
    const doc = { taskId, kind, path: relativePath };
    if (!docs.some((existing) => existing.kind === kind && existing.path === relativePath)) docs.push(doc);
  };
  if (hasHandoff) addDoc("handoff", path.posix.join(taskDir, "handoff.md"));

  const absoluteTaskDir = resolveInside(rootPath, taskDir);
  if (!fs.existsSync(absoluteTaskDir)) return docs;

  for (const entry of fs.readdirSync(absoluteTaskDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.posix.join(taskDir, entry.name);
    if (entry.isDirectory() && GATE_DIR_PATTERN.test(entry.name)) {
      addDoc("gate", relativePath);
      for (const markdownPath of walkMarkdownFiles(resolveInside(rootPath, relativePath))) {
        addDoc("artifact", toRelativePath(rootPath, markdownPath));
      }
    } else if (entry.isDirectory() && entry.name === "codex-tasks") {
      addDoc("artifact", relativePath);
      for (const markdownPath of walkMarkdownFiles(resolveInside(rootPath, relativePath))) {
        addDoc("artifact", toRelativePath(rootPath, markdownPath));
      }
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "handoff.md") {
      addDoc("artifact", relativePath);
    }
  }
  return docs;
}

function walkMarkdownFiles(startPath) {
  const result = [];
  if (!fs.existsSync(startPath)) return result;
  for (const entry of fs.readdirSync(startPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(startPath, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(entryPath);
    }
  }
  return result;
}

function upsertTask(db, task, workset) {
  db.prepare(`
    INSERT OR REPLACE INTO tasks (id, title, status, current_gate, workset_id, raw_json)
    VALUES (@id, @title, @status, @currentGate, @worksetId, @rawJson)
  `).run({
    id: task.id,
    title: task.title || task.id,
    status: task.status || "",
    currentGate: task.currentGate || "",
    worksetId: workset?.id || "",
    rawJson: stringify({ ...task, workset })
  });
  upsertWorkset(db, workset);
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

function insertRef(db, table, leftColumn, leftValue, rightColumn, rightValue, rawValue) {
  if (!leftValue || !rightValue) return;
  db.prepare(`INSERT OR REPLACE INTO ${table} (${leftColumn}, ${rightColumn}, raw_json) VALUES (?, ?, ?)`).run(
    leftValue,
    rightValue,
    stringify(rawValue)
  );
}

function collectTaskSceneIds(task) {
  return [
    task.sceneTemplateId,
    ...(task.sceneTemplateIds || []),
    ...(task.sceneIds || []),
    task.workset?.sceneTemplateId
  ].filter(Boolean);
}

function addMissingReference(missingById, existingSceneIds, sceneId, reference) {
  if (!sceneId || existingSceneIds.has(sceneId)) return;
  const record = missingById.get(sceneId) || { id: sceneId, referencedBy: [] };
  record.referencedBy.push(reference);
  missingById.set(sceneId, record);
}

function uniqueReferences(references) {
  const seen = new Set();
  return references.filter((reference) => {
    const key = `${reference.taskId}|${reference.worksetId}|${reference.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferProjectHintsForScene(scene, snapshot, existingProjects) {
  const hints = new Map();
  for (const reference of scene.referencedBy) {
    const task = snapshot.tasks.find((candidate) => candidate.id === reference.taskId);
    for (const project of task?.workset?.projects || []) {
      if (project.id) hints.set(project.id, { id: project.id, role: project.role || "primary", source: "handoff-projects" });
    }
    const text = normalizeText(snapshot.handoffTexts[reference.taskId] || "");
    for (const project of existingProjects) {
      const id = project.id || "";
      const name = project.name || "";
      if ((id && text.includes(normalizeText(id))) || (name && text.includes(normalizeText(name)))) {
        hints.set(id, { id, role: "primary", source: "handoff-text-match" });
      }
    }
  }
  return [...hints.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function emptyImportedCounts(snapshot) {
  return {
    tasks: snapshot.tasks.length,
    worksets: snapshot.worksets.length,
    taskDocuments: snapshot.taskDocuments.length,
    runtimeState: snapshot.runtimeState ? 1 : 0
  };
}

function importTasksResult({ status, message, snapshot, dryRun, imported, missingScenes }) {
  return {
    ...normalizeCommandResult({
      status,
      action: "import-tasks",
      message,
      paths: [toRelativePath(snapshot.rootPath, snapshot.dbPath)],
      warnings: snapshot.warnings
    }),
    dryRun,
    dbPath: toRelativePath(snapshot.rootPath, snapshot.dbPath),
    sourceCounts: snapshot.sourceCounts,
    imported,
    missingScenes,
    willWrite: dryRun ? [toRelativePath(snapshot.rootPath, snapshot.dbPath)] : []
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
  return toPosixPath(path.relative(rootPath, absolutePath));
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function stringify(value) {
  return JSON.stringify(value ?? null);
}
