import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runAction } from "../../src/core/actions.mjs";
import { createSqliteRepository } from "../../src/core/repositories/sqlite-repository.mjs";
import { seedSqliteFromJsonFixture } from "../helpers/sqlite-fixtures.mjs";

const testFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(testFile), "../..");
const legacyGeneratedDocGuidancePattern = /config\/(?:projects\/[^`\s]+\.json|scenes\/[^`\s]+\.json|rules\/rules\.json)/;

test("runAction rejects unknown actions", async () => {
  const result = await runAction({
    rootDir: new URL("./fixtures/basic-ai-context/", import.meta.url),
    actionId: "rm_rf",
    body: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unsupported_action");
});

test("create_minimal_profile_json refuses to overwrite existing files", async () => {
  const rootDir = await copyFixture();
  const result = await runAction({
    rootDir,
    actionId: "create_minimal_profile_json",
    body: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "file_exists");
});

test("sync_project_entry requires a known project id", async () => {
  const result = await runAction({
    rootDir: new URL("./fixtures/basic-ai-context/", import.meta.url),
    actionId: "sync_project_entry",
    body: { projectId: "../bad" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_project_id");
});

test("ai context actions run install-ai-context in-process against SQLite state", async () => {
  const rootDir = await copyFixture();
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "context-studio-sync-project-"));
  try {
    await copyCoreSkills(rootDir);
    const repository = createSqliteRepository({ rootDir });
    const project = await repository.getProject("demo-project");
    await repository.writeProject({ ...project, path: projectDir });
    await fs.rm(path.join(rootDir, "config"), { recursive: true, force: true });
    await fs.rm(path.join(rootDir, "runtime"), { recursive: true, force: true });

    const validate = await runAction({ rootDir, actionId: "validate_ai_context" });
    assert.equal(validate.ok, true, validate.output || validate.error?.message);
    assert.match(validate.output, /DevFlow validation passed/);

    const sync = await runAction({
      rootDir,
      actionId: "sync_project_entry",
      body: { projectId: "demo-project" }
    });
    assert.equal(sync.ok, true, sync.output || sync.error?.message);
    assert.match(await fs.readFile(path.join(projectDir, "AGENTS.md"), "utf8"), /devflow query route "<user request>"/);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  }
});

test("create_minimal_person_profile creates only the missing allowlisted file", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "context-studio-action-"));
  await fs.mkdir(path.join(rootDir, "docs/person"), { recursive: true });

  const result = await runAction({
    rootDir,
    actionId: "create_minimal_person_profile",
    body: {}
  });

  assert.equal(result.ok, true);
  assert.ok(result.changedPaths.includes("docs/person/profile.md"));
  assert.match(await fs.readFile(path.join(rootDir, "docs/person/profile.md"), "utf8"), /TODO/);
});

test("add_project_from_path scans project docs, skills, rules and writes relationships", async () => {
  const rootDir = await copyFixture();
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-project-"));
  await fs.mkdir(path.join(projectDir, ".codex/skills/release-helper"), { recursive: true });
  await fs.mkdir(path.join(projectDir, ".cursor/rules"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "AGENTS.md"), "# Payment App\n\nHandles payment callbacks.\n", "utf8");
  await fs.writeFile(path.join(projectDir, ".codex/skills/release-helper/SKILL.md"), "---\nname: release-helper\ndescription: Release helper skill.\n---\n# Release Helper\n", "utf8");
  await fs.writeFile(path.join(projectDir, ".cursor/rules/payment.mdc"), "# Payment Rule\n\nRead ai-context project config first.\n", "utf8");

  const result = await runAction({
    rootDir,
    actionId: "add_project_from_path",
    body: {
      projectPath: projectDir,
      projectId: "payment-app",
      name: "Payment App",
      technologyFamilyId: "bff",
      confirmAiConfigsMigration: true
    }
  });

  assert.equal(result.ok, true);
  assert.ok(result.changedPaths.includes(path.join(projectDir, ".ai-configs/project.md")));
  assert.ok(result.changedPaths.includes("data/devflow.db"));
  assert.equal(result.changedPaths.includes("docs/repos/payment-app.md"), false);
  assert.equal(await exists(path.join(rootDir, "docs/repos/payment-app.md")), false);
  assert.equal(await exists(path.join(rootDir, "bundles/skills/payment-app-release-helper/SKILL.md")), false);
  assert.equal(await exists(path.join(rootDir, "bundles/rules/payment-app/payment.md")), false);
  assert.equal(await exists(path.join(rootDir, "config/projects/payment-app.json")), false);

  const repository = createSqliteRepository({ rootDir });
  const project = await repository.getProject("payment-app");
  assert.equal(project.path, projectDir);
  assert.equal(project.doc.path, path.join(projectDir, ".ai-configs/project.md"));
  assert.equal(project.sourceOfTruth.projectDoc, "distributed");
  assert.equal(project.entryFiles.projectDoc, ".ai-configs/project.md");
  assert.equal(project.skills[0].id, "payment-app-release-helper");
  assert.equal(project.skills[0].sourcePath, path.join(projectDir, ".codex/skills/release-helper/SKILL.md"));
  assert.equal(project.rules[0].id, "payment-app/payment");
  assert.equal(project.rules[0].sourcePath, path.join(projectDir, ".cursor/rules/payment.mdc"));
  const projectDoc = await fs.readFile(path.join(projectDir, ".ai-configs/project.md"), "utf8");
  assert.match(projectDoc, /devflow query route/);
  assert.doesNotMatch(projectDoc, legacyGeneratedDocGuidancePattern);

  const skills = await repository.listSkills();
  assert.ok(skills.some((skill) => skill.id === "payment-app-release-helper" && skill.sourceType === "external-file"));
  const rules = await repository.listRules();
  assert.ok(rules.some((rule) => rule.id === "payment-app/payment" && rule.projectIds.includes("payment-app") && rule.sourceType === "external-file"));
});

test("add_project_from_path asks before creating .ai-configs", async () => {
  const rootDir = await copyFixture();
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-project-"));
  await fs.writeFile(path.join(projectDir, "README.md"), "# Needs Confirmation\n", "utf8");

  const result = await runAction({
    rootDir,
    actionId: "add_project_from_path",
    body: {
      projectPath: projectDir,
      projectId: "needs-confirmation",
      name: "Needs Confirmation",
      technologyFamilyId: "frontend"
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "confirmation_required");
  assert.equal(await exists(path.join(projectDir, ".ai-configs/project.md")), false);
});

test("add_project_from_path skips unreadable rule symlinks", async () => {
  const rootDir = await copyFixture();
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-project-"));
  await fs.mkdir(path.join(projectDir, ".ai-configs/rules"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "README.md"), "# Symlink App\n", "utf8");
  await fs.symlink(".ai-configs", path.join(projectDir, ".cursor"));
  await fs.symlink(
    path.join(projectDir, "missing-rule-source.mdc"),
    path.join(projectDir, ".ai-configs/rules/broken-rule.mdc")
  );

  const result = await runAction({
    rootDir,
    actionId: "add_project_from_path",
    body: {
      projectPath: projectDir,
      projectId: "symlink-app",
      name: "Symlink App",
      technologyFamilyId: "frontend"
    }
  });

  assert.equal(result.ok, true, result.error?.message);
  const rules = await createSqliteRepository({ rootDir }).listRules();
  assert.equal(rules.some((rule) => rule.id === "symlink-app/broken-rule"), false);
});

test("add_scene creates scene docs and mounts it to projects", async () => {
  const rootDir = await copyFixture();

  const result = await runAction({
    rootDir,
    actionId: "add_scene",
    body: {
      sceneId: "payment-debug",
      name: "Payment Debug",
      projectIds: ["demo-project"],
      summary: "Debug payment failures."
    }
  });

  assert.equal(result.ok, true);
  assert.equal(await exists(path.join(rootDir, "config/scenes/payment-debug.json")), false);
  const repository = createSqliteRepository({ rootDir });
  const scene = await repository.getSceneTemplate("payment-debug");
  assert.equal(scene.projectHints[0].id, "demo-project");
  const project = await repository.getProject("demo-project");
  assert.ok(project.scenes.some((item) => item.id === "payment-debug"));
  assert.ok(result.changedPaths.includes("docs/scenes/payment-debug.md"));
  const sceneDoc = await fs.readFile(path.join(rootDir, "docs/scenes/payment-debug.md"), "utf8");
  assert.match(sceneDoc, /devflow query route/);
  assert.match(sceneDoc, /devflow query rules/);
  assert.doesNotMatch(sceneDoc, legacyGeneratedDocGuidancePattern);
});

test("add_skill_from_path copies skill and mounts it to selected projects", async () => {
  const rootDir = await copyFixture();
  const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), "external-skill-"));
  await fs.writeFile(path.join(skillDir, "SKILL.md"), "---\nname: qa-helper\ndescription: QA helper skill.\n---\n# QA Helper\n", "utf8");

  const result = await runAction({
    rootDir,
    actionId: "add_skill_from_path",
    body: { skillPath: skillDir, skillId: "qa-helper", projectIds: ["demo-project"] }
  });

  assert.equal(result.ok, true);
  assert.ok(result.changedPaths.includes("bundles/skills/qa-helper/SKILL.md"));
  const project = await createSqliteRepository({ rootDir }).getProject("demo-project");
  assert.ok(project.skills.some((item) => item.id === "qa-helper"));
});

test("add_skill_from_path registers batch skill directories with family and global scope without vendoring", async () => {
  const rootDir = await copyFixture();
  const superpowersRoot = await fs.mkdtemp(path.join(os.tmpdir(), "superpowers-skills-"));
  await fs.mkdir(path.join(superpowersRoot, "test-driven-development"), { recursive: true });
  await fs.mkdir(path.join(superpowersRoot, "writing-plans"), { recursive: true });
  await fs.writeFile(
    path.join(superpowersRoot, "test-driven-development", "SKILL.md"),
    "---\nname: test-driven-development\ndescription: Use when implementing feature work or bugfixes.\n---\n# TDD\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(superpowersRoot, "writing-plans", "SKILL.md"),
    "---\nname: writing-plans\ndescription: Use when writing implementation plans.\n---\n# Writing Plans\n",
    "utf8"
  );

  const result = await runAction({
    rootDir,
    actionId: "add_skill_from_path",
    body: { skillPath: superpowersRoot, family: "superpowers", scope: "global" }
  });

  assert.equal(result.ok, true, result.error?.message);
  assert.ok(result.changedPaths.includes("data/devflow.db"));
  assert.equal(result.changedPaths.some((item) => item.startsWith("bundles/skills/test-driven-development")), false);
  const skills = await createSqliteRepository({ rootDir }).listSkills();
  const tdd = skills.find((skill) => skill.id === "test-driven-development");
  const plans = skills.find((skill) => skill.id === "writing-plans");
  assert.equal(tdd.family, "superpowers");
  assert.equal(tdd.scope, "global");
  assert.equal(tdd.sourcePath, path.join(superpowersRoot, "test-driven-development", "SKILL.md"));
  assert.equal(tdd.sourceType, "external-file");
  assert.ok(tdd.tags.includes("superpowers"));
  assert.ok(tdd.tags.includes("test-driven-development"));
  assert.ok(tdd.tags.includes("tdd"));
  assert.equal(plans.family, "superpowers");
  assert.equal(plans.scope, "global");
  assert.equal(await exists(path.join(rootDir, "bundles/skills/test-driven-development/SKILL.md")), false);
});

test("add_rule creates a rule file and mounts project plus scene relationships", async () => {
  const rootDir = await copyFixture();

  const result = await runAction({
    rootDir,
    actionId: "add_rule",
    body: {
      ruleId: "payment/safe-callback",
      name: "Payment Safe Callback",
      purpose: "Validate payment callback changes.",
      projectIds: ["demo-project"],
      sceneIds: ["demo-scene"],
      applyMode: "scene-on-demand"
    }
  });

  assert.equal(result.ok, true);
  assert.ok(result.changedPaths.includes("bundles/rules/payment/safe-callback.md"));
  const repository = createSqliteRepository({ rootDir });
  const rules = await repository.listRules();
  assert.ok(rules.some((rule) => rule.id === "payment/safe-callback" && rule.sceneIds.includes("demo-scene")));
  const scene = await repository.getSceneTemplate("demo-scene");
  assert.ok(scene.ruleHints.some((item) => item.id === "payment/safe-callback"));
});

test("delete_project removes project indexes and graph references without touching external repo", async () => {
  const rootDir = await copyFixture();
  const repository = createSqliteRepository({ rootDir });
  const externalPath = (await repository.getProject("demo-project")).path;

  const result = await runAction({
    rootDir,
    actionId: "delete_project",
    body: { projectId: "demo-project" }
  });

  assert.equal(result.ok, true);
  assert.equal(await exists(path.join(rootDir, "config/projects/demo-project.json")), true);
  assert.equal(await exists(path.join(rootDir, "docs/repos/demo-project.md")), false);
  assert.equal(await repository.getProject("demo-project"), null);
  const scene = await repository.getSceneTemplate("demo-scene");
  assert.equal(scene.projectHints.some((item) => item.id === "demo-project"), false);
  const rules = await repository.listRules();
  assert.deepEqual(rules[0].projectIds, []);
  const task = await repository.getTask("demo-task");
  assert.deepEqual(task.projectIds, []);
  assert.deepEqual(task.workset.projects, []);
  assert.equal(externalPath, "/tmp/demo-project");
});

test("finish_task action marks a task finished at G7 through SQLite state", async () => {
  const rootDir = await copyFixture();

  const result = await runAction({
    rootDir,
    actionId: "finish_task",
    body: { taskId: "demo-task", note: "completed from panel" }
  });

  assert.equal(result.ok, true);
  assert.ok(result.changedPaths.includes("data/devflow.db"));
  assert.ok(result.changedPaths.includes("runtime/tasks/demo-task/handoff.md"));
  const task = await createSqliteRepository({ rootDir }).getTask("demo-task");
  assert.equal(task.status, "finished");
  assert.equal(task.currentGate, "G7");
});

test("delete_task action removes only SQLite task records and leaves markdown handoff in place", async () => {
  const rootDir = await copyFixture();
  const handoffPath = path.join(rootDir, "runtime/tasks/demo-task/handoff.md");

  const result = await runAction({
    rootDir,
    actionId: "delete_task",
    body: { taskId: "demo-task" }
  });

  assert.equal(result.ok, true);
  assert.ok(result.changedPaths.includes("data/devflow.db"));
  assert.equal(await exists(handoffPath), true);
  const repository = createSqliteRepository({ rootDir });
  assert.equal(await repository.getTask("demo-task"), null);
  assert.equal(await repository.getWorkset("demo-task"), null);
  assert.equal(await repository.getActiveTask(), null);
});

test("delete_scene removes scene indexes and task references", async () => {
  const rootDir = await copyFixture();

  const result = await runAction({
    rootDir,
    actionId: "delete_scene",
    body: { sceneId: "demo-scene" }
  });

  assert.equal(result.ok, true);
  assert.equal(await exists(path.join(rootDir, "config/scenes/demo-scene.json")), true);
  assert.equal(await exists(path.join(rootDir, "docs/scenes/demo-scene.md")), false);
  const repository = createSqliteRepository({ rootDir });
  assert.equal(await repository.getSceneTemplate("demo-scene"), null);
  const project = await repository.getProject("demo-project");
  assert.equal(project.scenes.some((item) => item.id === "demo-scene"), false);
  const rules = await repository.listRules();
  assert.deepEqual(rules[0].sceneIds, []);
  const task = await repository.getTask("demo-task");
  assert.deepEqual(task.sceneIds, []);
  assert.equal(task.workset.sceneTemplateId, "");
});

test("delete_skill removes catalog entry and project mounts", async () => {
  const rootDir = await copyFixture();

  const result = await runAction({
    rootDir,
    actionId: "delete_skill",
    body: { skillId: "demo-skill" }
  });

  assert.equal(result.ok, true);
  const repository = createSqliteRepository({ rootDir });
  const skills = await repository.listSkills();
  assert.equal(skills.some((item) => item.id === "demo-skill"), false);
  const project = await repository.getProject("demo-project");
  assert.equal(project.skills.some((item) => item.id === "demo-skill"), false);
});

test("delete_rule removes catalog entry and project plus scene mounts", async () => {
  const rootDir = await copyFixture();

  const result = await runAction({
    rootDir,
    actionId: "delete_rule",
    body: { ruleId: "demo-rule" }
  });

  assert.equal(result.ok, true);
  assert.equal(await exists(path.join(rootDir, "bundles/rules/demo-rule.md")), false);
  const repository = createSqliteRepository({ rootDir });
  const rules = await repository.listRules();
  assert.equal(rules.some((item) => item.id === "demo-rule"), false);
  const project = await repository.getProject("demo-project");
  assert.equal(project.rules.some((item) => item.id === "demo-rule"), false);
  const scene = await repository.getSceneTemplate("demo-scene");
  assert.equal(scene.ruleHints.some((item) => item.id === "demo-rule"), false);
});

async function copyFixture() {
  const source = new URL("./fixtures/basic-ai-context/", import.meta.url);
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "context-studio-fixture-"));
  await fs.cp(source, rootDir, { recursive: true });
  await seedSqliteFromJsonFixture(rootDir);
  return rootDir;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyCoreSkills(rootDir) {
  await fs.mkdir(path.join(rootDir, "bundles", "skills"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "scripts"), { recursive: true });
  await fs.cp(path.join(repoRoot, "bundles/skills/devflow"), path.join(rootDir, "bundles/skills/devflow"), { recursive: true });
  await fs.cp(path.join(repoRoot, "bundles/skills/devflow-init"), path.join(rootDir, "bundles/skills/devflow-init"), { recursive: true });
  await fs.cp(path.join(repoRoot, "scripts/install-ai-context.mjs"), path.join(rootDir, "scripts/install-ai-context.mjs"));
  const repository = createSqliteRepository({ rootDir });
  const entry = await repository.getEntry();
  await repository.setConfig("entry", {
    ...entry,
    installation: {
      ...(entry.installation || {}),
      script: "scripts/install-ai-context.mjs"
    }
  });
  const [rule] = await repository.listRules();
  await repository.writeRule({
    ...rule,
    applyMode: "scene-on-demand",
    globs: ["**/*"],
    whenToRead: "Read this demo rule for validation fixtures."
  });
}
