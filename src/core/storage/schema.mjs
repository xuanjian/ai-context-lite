import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DEVFLOW_SCHEMA_VERSION } from "../contracts/devflow-types.mjs";
import { resolveInside, toPath } from "../paths.mjs";
import { migrations } from "./migrations/index.mjs";

export { DEVFLOW_SCHEMA_VERSION };

export const REQUIRED_TABLES = [
  "schema_version",
  "projects",
  "capabilities",
  "scene_templates",
  "skills",
  "rules",
  "project_skill_mounts",
  "project_rule_mounts",
  "scene_template_capabilities",
  "scene_template_project_hints",
  "scene_template_skill_hints",
  "scene_template_rule_hints",
  "worksets",
  "workset_projects",
  "workset_capabilities",
  "workset_skills",
  "workset_rules",
  "tasks",
  "task_gates",
  "task_events",
  "runtime_state",
  "graph_edges",
  "config",
  "task_documents"
];

export function defaultDbPath(rootDir = process.cwd()) {
  return resolveInside(toPath(rootDir), "data/devflow.db");
}

export function openDevFlowDatabase({ rootDir = process.cwd(), dbPath = defaultDbPath(rootDir) } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  return db;
}

export function initializeSchema(db) {
  ensureMigrationTable(db);
  const applied = new Set(db.prepare("SELECT version FROM schema_version").all().map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const tx = db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
        migration.version,
        new Date().toISOString()
      );
    });
    tx();
  }
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}
