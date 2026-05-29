import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CURRENT } from "../defaults/current.mjs";
import { DEFAULT_DEVFLOW_PROJECT } from "../defaults/devflow-project.mjs";
import { DEFAULT_ENTRY, ENTRY_CONFIG_KEY } from "../defaults/entry.mjs";
import { DEFAULT_GATES, GATES_CONFIG_KEY } from "../defaults/gates.mjs";
import { DEFAULT_PROFILE, PROFILE_CONFIG_KEY } from "../defaults/profile.mjs";
import { resolveInside, toPath } from "../paths.mjs";
import { applyMigrationSnapshot } from "./migrate-from-json.mjs";
import { defaultDbPath, initializeSchema, openDevFlowDatabase } from "./schema.mjs";

const DEFAULT_DEVFLOW_SKILLS = [
  {
    id: "devflow",
    name: "DevFlow",
    description: "Use when entering, installing, validating, or modifying DevFlow, or when routing tasks through project/rule/skill state.",
    trigger: "Use when installing DevFlow, checking configuration, routing a new task, updating indexes, or advancing task state.",
    sourcePath: "bundles/skills/devflow/SKILL.md",
    tags: ["devflow", "workflow"],
    whenToLoad: "Load when the current request explicitly needs DevFlow data or DevFlow maintenance.",
    sourceExists: true,
    sourceType: "file"
  },
  {
    id: "devflow-init",
    name: "devflow-init",
    description: "Use after installing DevFlow when the user needs first-time onboarding, personal AI preferences, project inventory, skill/rule mounting, or migration from scattered notes into DevFlow state.",
    trigger: "Use after install, first-time setup, onboarding, importing project inventory, creating profile, or turning messy notes into DevFlow configuration.",
    sourcePath: "bundles/skills/devflow-init/SKILL.md",
    tags: ["devflow", "onboarding", "workflow"],
    whenToLoad: "Load after install or when initializing profile, projects, skills, and rules from user-provided notes.",
    sourceExists: true,
    sourceType: "file"
  }
];

export async function ensureSqliteDatabase({ rootDir = process.cwd(), dbPath = defaultDbPath(rootDir) } = {}) {
  const rootPath = toPath(rootDir);
  const resolvedDbPath = toPath(dbPath);
  if (fs.existsSync(resolvedDbPath)) {
    return { status: "exists", dbPath: resolvedDbPath };
  }

  if (hasLegacyJsonSources(rootPath)) {
    throw new Error(
      "DevFlow SQLite database is missing, but legacy config/runtime JSON sources are still present. Run `devflow migrate from-json` explicitly before using this checkout; automatic JSON rebuild is disabled."
    );
  }

  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  const db = openDevFlowDatabase({ rootDir: rootPath, dbPath: resolvedDbPath });
  try {
    initializeSchema(db);
    applyMigrationSnapshot(db, buildDefaultSnapshot(rootPath, resolvedDbPath));
  } finally {
    db.close();
  }
  return { status: "created", dbPath: resolvedDbPath };
}

export function createDefaultSqliteDatabase({ rootDir = process.cwd(), dbPath = defaultDbPath(rootDir) } = {}) {
  const rootPath = toPath(rootDir);
  const resolvedDbPath = toPath(dbPath);
  if (fs.existsSync(resolvedDbPath)) {
    return { status: "exists", dbPath: resolvedDbPath };
  }

  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  const db = openDevFlowDatabase({ rootDir: rootPath, dbPath: resolvedDbPath });
  try {
    initializeSchema(db);
    applyMigrationSnapshot(db, buildDefaultSnapshot(rootPath, resolvedDbPath));
  } finally {
    db.close();
  }
  return { status: "created", dbPath: resolvedDbPath };
}

export function hasLegacyJsonSources(rootDir = process.cwd()) {
  const rootPath = toPath(rootDir);
  return ["config", "runtime"].some((relativeRoot) => hasJsonFile(resolveInside(rootPath, relativeRoot)));
}

function buildDefaultSnapshot(rootPath, dbPath) {
  return {
    rootPath,
    dbPath,
    configRecords: [
      { key: ENTRY_CONFIG_KEY, path: "defaults/entry", data: DEFAULT_ENTRY },
      { key: PROFILE_CONFIG_KEY, path: "defaults/profile", data: DEFAULT_PROFILE },
      { key: GATES_CONFIG_KEY, path: "defaults/gates", data: DEFAULT_GATES }
    ],
    projects: [DEFAULT_DEVFLOW_PROJECT],
    sceneTemplates: [],
    skills: DEFAULT_DEVFLOW_SKILLS,
    rules: [],
    tasks: [],
    taskDocuments: [],
    runtimeState: DEFAULT_CURRENT,
    graphEdges: [],
    sourceJsonPaths: [],
    warnings: [],
    sourceCounts: {
      config: 3,
      projects: 1,
      sceneTemplates: 0,
      skills: 2,
      rules: 0,
      tasks: 0,
      taskDocuments: 0,
      runtimeState: 1,
      graphEdges: 0
    }
  };
}

function hasJsonFile(startPath) {
  if (!fs.existsSync(startPath)) return false;
  const stat = fs.statSync(startPath);
  if (stat.isFile()) return startPath.endsWith(".json");
  if (!stat.isDirectory()) return false;
  for (const entry of fs.readdirSync(startPath, { withFileTypes: true })) {
    if (hasJsonFile(path.join(startPath, entry.name))) return true;
  }
  return false;
}
