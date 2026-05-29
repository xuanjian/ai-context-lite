import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DEVFLOW_PROJECT } from "../../../src/core/defaults/devflow-project.mjs";
import { createSqliteRepository } from "../../../src/core/repositories/sqlite-repository.mjs";
import { ensureSqliteDatabase } from "../../../src/core/storage/sqlite-bootstrap.mjs";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "../../..");
const fixtureRoot = path.join(repoRoot, "tests/core/fixtures/basic-ai-context");

test("ensureSqliteDatabase refuses to rebuild from legacy JSON implicitly", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-bootstrap-json-"));
  fs.cpSync(fixtureRoot, root, { recursive: true });

  await assert.rejects(
    () => ensureSqliteDatabase({ rootDir: root }),
    /devflow migrate from-json/
  );
  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), false);
});

test("ensureSqliteDatabase bootstraps a fresh install from defaults", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-bootstrap-fresh-"));
  const result = await ensureSqliteDatabase({ rootDir: root });
  const repository = createSqliteRepository({ rootDir: root });

  assert.equal(result.status, "created");
  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), true);
  assert.equal((await repository.getProject("devflow")).name, DEFAULT_DEVFLOW_PROJECT.name);
  assert.equal((await repository.getEntry()).name, "DevFlow entry");
  assert.equal((await repository.getActiveTask()), null);
  assert.equal(fs.existsSync(path.join(root, "config/entry.json")), false);
  assert.equal(fs.existsSync(path.join(root, "runtime/current.json")), false);
});
