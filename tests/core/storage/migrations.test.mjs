import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initializeSchema } from "../../../src/core/storage/schema.mjs";

test("fresh DB applies all migrations in order", () => {
  const db = new Database(":memory:");
  try {
    initializeSchema(db);

    const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
    assert.deepEqual(versions.map((row) => row.version), [1, 2, 3, 4, 5]);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    assert.equal(tables.includes("projects"), true);
    assert.equal(tables.includes("config"), true);
    assert.equal(tables.includes("task_documents"), true);
    const projectColumns = db.prepare("PRAGMA table_info(projects)").all().map((row) => row.name);
    assert.equal(projectColumns.includes("products"), true);
    assert.equal(projectColumns.includes("domains"), true);
    assert.equal(projectColumns.includes("role"), true);
    assert.equal(projectColumns.includes("components"), true);
  } finally {
    db.close();
  }
});

test("legacy DB at v1 incrementally applies later migrations and defaults project metadata", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version VALUES (1, '2026-05-01T00:00:00.000Z');
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, technology_family_id TEXT, source_path TEXT, doc_path TEXT, raw_json TEXT NOT NULL);
      INSERT INTO projects (id, name, technology_family_id, source_path, doc_path, raw_json)
      VALUES ('legacy-project', 'Legacy', 'frontend', '', '', '{"id":"legacy-project","name":"Legacy"}');
    `);

    initializeSchema(db);

    const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
    assert.deepEqual(versions.map((row) => row.version), [1, 2, 3, 4, 5]);
    const row = db.prepare("SELECT products, domains, role, components, raw_json FROM projects WHERE id = ?").get("legacy-project");
    assert.deepEqual(JSON.parse(row.products), []);
    assert.deepEqual(JSON.parse(row.domains), []);
    assert.equal(row.role, "");
    assert.deepEqual(JSON.parse(row.components), []);
    assert.deepEqual(JSON.parse(row.raw_json), {
      id: "legacy-project",
      name: "Legacy",
      products: [],
      domains: [],
      role: "",
      components: []
    });
  } finally {
    db.close();
  }
});

test("legacy DB at v4 adds project components without changing existing metadata", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_version VALUES (1, '2026-05-01T00:00:00.000Z');
      INSERT INTO schema_version VALUES (2, '2026-05-01T00:00:01.000Z');
      INSERT INTO schema_version VALUES (3, '2026-05-01T00:00:02.000Z');
      INSERT INTO schema_version VALUES (4, '2026-05-01T00:00:03.000Z');
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT,
        technology_family_id TEXT,
        source_path TEXT,
        doc_path TEXT,
        products TEXT NOT NULL DEFAULT '[]',
        domains TEXT NOT NULL DEFAULT '[]',
        role TEXT NOT NULL DEFAULT '',
        raw_json TEXT NOT NULL
      );
      INSERT INTO projects (id, name, technology_family_id, source_path, doc_path, products, domains, role, raw_json)
      VALUES (
        'legacy-project',
        'Legacy',
        'frontend',
        '',
        '',
        '["dhb"]',
        '["goods"]',
        'subpackage',
        '{"id":"legacy-project","name":"Legacy","products":["dhb"],"domains":["goods"],"role":"subpackage"}'
      );
    `);

    initializeSchema(db);

    const versions = db.prepare("SELECT version FROM schema_version ORDER BY version").all();
    assert.deepEqual(versions.map((row) => row.version), [1, 2, 3, 4, 5]);
    const row = db.prepare("SELECT products, domains, role, components, raw_json FROM projects WHERE id = ?").get("legacy-project");
    assert.deepEqual(JSON.parse(row.products), ["dhb"]);
    assert.deepEqual(JSON.parse(row.domains), ["goods"]);
    assert.equal(row.role, "subpackage");
    assert.deepEqual(JSON.parse(row.components), []);
    assert.deepEqual(JSON.parse(row.raw_json), {
      id: "legacy-project",
      name: "Legacy",
      products: ["dhb"],
      domains: ["goods"],
      role: "subpackage",
      components: []
    });
  } finally {
    db.close();
  }
});

test("migrations are idempotent", () => {
  const db = new Database(":memory:");
  try {
    initializeSchema(db);
    initializeSchema(db);

    const count = db.prepare("SELECT COUNT(*) AS n FROM schema_version").get().n;
    assert.equal(count, 5);
  } finally {
    db.close();
  }
});
