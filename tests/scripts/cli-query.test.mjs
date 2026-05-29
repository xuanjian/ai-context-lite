import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { seedSqliteFromJsonFixture } from "../helpers/sqlite-fixtures.mjs";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "../..");
const cliPath = path.join(repoRoot, "scripts/devflow-cli.mjs");
const fixtureRoot = path.join(repoRoot, "tests/core/fixtures/basic-ai-context");

function copyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-cli-query-"));
  fs.cpSync(fixtureRoot, root, { recursive: true });
  return root;
}

function runCli(rootDir, args) {
  return spawnSync(process.execPath, [cliPath, "--root", rootDir, ...args], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf8"
  });
}

function parseJson(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("query route prints the locked JSON result shape", async () => {
  const root = copyFixture();
  await seedSqliteFromJsonFixture(root);
  const result = runCli(root, ["query", "route", "demo task"]);
  const json = parseJson(result);

  assert.equal(json.type, "route");
  assert.equal(json.mode, "light");
  assert.equal(json.sceneTemplate.id, "demo-scene");
  assert.equal(json.sceneTemplate.templateType, "scene-template");
  assert.equal(json.workset.sceneTemplateId, "demo-scene");
  assert.equal(json.workset.projects[0].id, "demo-project");
});

test("query current, skills, rules, and graph print JSON without an HTTP server", async () => {
  const root = copyFixture();
  await seedSqliteFromJsonFixture(root);
  const current = parseJson(runCli(root, ["query", "current"]));
  const skills = parseJson(runCli(root, ["query", "skills", "--project", "demo-project"]));
  const worksetSkills = parseJson(runCli(root, ["query", "skills", "--workset", "demo-task"]));
  const rules = parseJson(runCli(root, ["query", "rules", "--template", "demo-scene"]));
  const graph = parseJson(runCli(root, ["graph"]));
  const status = parseJson(runCli(root, ["status"]));

  assert.equal(current.type, "current");
  assert.equal(current.task.id, "demo-task");
  assert.equal(current.workset.id, "workset-demo-task");
  assert.equal(skills.type, "skills");
  assert.equal(Array.isArray(skills.skills), true);
  assert.equal(skills.skills.some((skill) => skill.id === "demo-skill"), true);
  assert.equal(worksetSkills.skills.some((skill) => skill.id === "demo-skill"), true);
  assert.equal(rules.type, "rules");
  assert.equal(Array.isArray(rules.rules), true);
  assert.equal(rules.rules.some((rule) => rule.id === "demo-rule"), true);
  assert.equal(graph.type, "graph");
  assert.equal(graph.nodes.some((node) => node.id === "sceneTemplate:demo-scene"), true);
  assert.equal(status.type, "current");
});

test("doctor and index rebuild are accepted facade routes", () => {
  const root = copyFixture();
  const doctor = parseJson(runCli(root, ["doctor"]));
  const rebuild = parseJson(runCli(root, ["index", "rebuild"]));

  assert.equal(doctor.status, "noop");
  assert.equal(doctor.action, "doctor");
  assert.match(doctor.message, /devflow migrate from-json/);
  assert.equal(doctor.warnings[0].code, "missing_sqlite_database_json_sources");
  assert.equal(rebuild.status, "noop");
  assert.equal(rebuild.action, "index rebuild");
  assert.match(rebuild.message, /deprecated/i);
  assert.match(rebuild.message, /devflow migrate from-json/);
  assert.equal(fs.existsSync(path.join(root, "data/devflow.db")), false);
});

test("add scene-template derives a template id from the name", async () => {
  const root = copyFixture();
  await seedSqliteFromJsonFixture(root);
  const result = parseJson(runCli(root, ["add", "scene-template", "Payment Debug"]));

  assert.equal(result.status, "ok");
  assert.equal(result.action, "addSceneTemplate");
  assert.equal(result.entityId, "payment-debug");
});

test("add skill registers a batch skill directory with family and scope flags", async () => {
  const root = copyFixture();
  await seedSqliteFromJsonFixture(root);
  const skillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "devflow-cli-superpowers-"));
  fs.mkdirSync(path.join(skillRoot, "test-driven-development"), { recursive: true });
  fs.writeFileSync(
    path.join(skillRoot, "test-driven-development", "SKILL.md"),
    "---\nname: test-driven-development\ndescription: Use when implementing feature work or bugfixes.\n---\n# TDD\n"
  );

  const result = parseJson(runCli(root, [
    "add",
    "skill",
    skillRoot,
    "--family",
    "superpowers",
    "--scope",
    "global"
  ]));
  const skills = parseJson(runCli(root, ["query", "skills"])).skills;
  const tdd = skills.find((skill) => skill.id === "test-driven-development");

  assert.equal(result.ok, true, result.error?.message);
  assert.equal(tdd.family, "superpowers");
  assert.equal(tdd.scope, "global");
  assert.equal(tdd.sourcePath, path.join(skillRoot, "test-driven-development", "SKILL.md"));
  assert.equal(fs.existsSync(path.join(root, "bundles/skills/test-driven-development/SKILL.md")), false);
});
