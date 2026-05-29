import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(testFile), "..");
const skillPath = path.join(rootDir, "bundles", "skills", "devflow", "SKILL.md");
const initSkillPath = path.join(rootDir, "bundles", "skills", "devflow-init", "SKILL.md");
const readmePath = path.join(rootDir, "README.md");
const projectIntroPath = path.join(rootDir, "docs", "project-introduction.md");
const legacyJsonRoutingGuidancePattern = /config\/(?:entry\.json|projects\/index\.json|projects\/<project-id>\.json|scenes\/index\.json|scenes\/<scene-id>\.json|skills\/skills\.json|rules\/rules\.json)|runtime\/current\.json/;

test("DevFlow skill documents chat subcommands as one routed skill", () => {
  const skill = fs.readFileSync(skillPath, "utf8");

  assert.match(skill, /@devflow:add/);
  assert.match(skill, /@devflow:del/);
  assert.match(skill, /@devflow:task/);
  assert.match(skill, /@devflow:panel/);
  assert.match(skill, /@devflow:init/);
  assert.match(skill, /one\s+DevFlow skill/i);
  assert.match(skill, /sub-intent/i);
});

test("devflow:add contract covers project, scene-template, skill, and rule association", () => {
  const skill = fs.readFileSync(skillPath, "utf8");

  assert.match(skill, /project path/i);
  assert.match(skill, /AGENTS\.md/);
  assert.match(skill, /CLAUDE\.md/);
  assert.match(skill, /@devflow:add scene-template/);
  assert.match(skill, /projectIds/);
  assert.match(skill, /sceneIds/);
  assert.match(skill, /add_project_from_path/);
  assert.match(skill, /add_scene/);
  assert.match(skill, /add_skill_from_path/);
  assert.match(skill, /add_rule/);
});

test("DevFlow skill routes panel and task work through query-first Workset scope", () => {
  const skill = fs.readFileSync(skillPath, "utf8");

  assert.match(skill, /devflow query route/);
  assert.match(skill, /devflow query current/);
  assert.match(skill, /devflow query skills/);
  assert.match(skill, /devflow query rules/);
  assert.match(skill, /Read only returned readPaths and skills\.sourcePath/);
  assert.match(skill, /If devflow query is unavailable[\s\S]+SQLite\/query migration is incomplete/);
  assert.match(skill, /@devflow:panel[\s\S]+panel is optional/i);
  assert.match(skill, /CLI\/TUI and query commands are primary/i);
  assert.match(skill, /@devflow:task[\s\S]+Workset as task runtime scope/i);
});

test("DevFlow skills do not route agents through legacy config JSON indexes", () => {
  const combined = [
    fs.readFileSync(skillPath, "utf8"),
    fs.readFileSync(initSkillPath, "utf8")
  ].join("\n");

  assert.match(combined, /devflow query route/);
  assert.match(combined, /devflow query current/);
  assert.match(combined, /devflow query skills/);
  assert.match(combined, /devflow query rules/);
  assert.doesNotMatch(combined, legacyJsonRoutingGuidancePattern);
});

test("devflow:del contract covers safe removal actions", () => {
  const skill = fs.readFileSync(skillPath, "utf8");

  assert.match(skill, /delete_project/);
  assert.match(skill, /delete_scene/);
  assert.match(skill, /delete_skill/);
  assert.match(skill, /delete_rule/);
  assert.match(skill, /must not delete\s+the real business repository/i);
});

test("devflow:task uses Socratic multiple-choice clarification for large vague work", () => {
  const skill = fs.readFileSync(skillPath, "utf8");
  const readme = fs.readFileSync(readmePath, "utf8");

  assert.match(skill, /Socratic multiple-choice clarification/i);
  assert.match(skill, /2-3 concrete\s+options/i);
  assert.match(skill, /choose\s+`1`,\s+`2`,\s+`3`/i);
  assert.match(skill, /Avoid asking only open-ended questions/i);
  assert.match(readme, /几个可选方向/);
  assert.match(readme, /1\/2\/3/);
});

test("devflow:init creates missing profile through guided choices", () => {
  const initSkill = fs.readFileSync(initSkillPath, "utf8");
  const readme = fs.readFileSync(readmePath, "utf8");

  assert.match(initSkill, /config\/profile\.json.*docs\/person\/profile\.md/s);
  assert.match(initSkill, /Socratic multiple-choice questions/i);
  assert.match(initSkill, /pick\s+`1`,\s+`2`,\s+`3`/i);
  assert.match(initSkill, /Write the selected answers into `config\/profile\.json`/);
  assert.match(readme, /如果还没有个人画像/);
  assert.match(readme, /选项式提问/);
});

test("devflow:init keeps memory-derived private names out of public templates", () => {
  const initSkill = fs.readFileSync(initSkillPath, "utf8");

  assert.match(initSkill, /Assistant memory or home-level context may be used/i);
  assert.match(initSkill, /do not write inferred private company/i);
  assert.match(initSkill, /after the user confirms it/i);
  assert.match(initSkill, /memory-derived candidates/i);
  assert.match(initSkill, /frontend app/i);
  assert.match(initSkill, /BFF\/API/i);
});

test("README keeps chat entry guidance without a common commands block", () => {
  const readme = fs.readFileSync(readmePath, "utf8");

  assert.match(readme, /## 聊天入口/);
  assert.match(readme, /@devflow:init/);
  assert.match(readme, /@devflow:add \/path\/to\/project/);
  assert.match(readme, /@devflow:del project old-project/);
  assert.match(readme, /@devflow:task/);
  assert.doesNotMatch(readme, /## 常用命令/);
  assert.doesNotMatch(readme, /## 常用聊天入口/);
  assert.doesNotMatch(readme, /## 终端排障和本地开发/);
  assert.doesNotMatch(readme, /同一个 `DevFlow` skill/);
  assert.doesNotMatch(readme, /子意图/);
  assert.doesNotMatch(readme, /底层 action/);
  assert.doesNotMatch(readme, /JSON 索引做路由/);
});

test("public docs avoid private project examples and company registry leaks", () => {
  const publicFiles = [
    readmePath,
    projectIntroPath,
    skillPath,
    initSkillPath,
    path.join(rootDir, "package-lock.json")
  ];
  const combined = publicFiles
    .filter(filePath => fs.existsSync(filePath))
    .map(filePath => fs.readFileSync(filePath, "utf8"))
    .join("\n");

  assert.doesNotMatch(combined, /\/Users\/[A-Za-z0-9._-]+|C:\\Users\\|token\s*[:=]|password\s*[:=]|api[_-]?key\s*[:=]/i);
});

test("public template config stays skeleton-only and avoids private inventory", () => {
  const profile = JSON.parse(fs.readFileSync(path.join(rootDir, "config", "profile.json"), "utf8"));
  const projects = JSON.parse(fs.readFileSync(path.join(rootDir, "config", "projects", "index.json"), "utf8"));
  const scenes = JSON.parse(fs.readFileSync(path.join(rootDir, "config", "scenes", "index.json"), "utf8"));
  const skills = JSON.parse(fs.readFileSync(path.join(rootDir, "config", "skills", "skills.json"), "utf8"));
  const rules = JSON.parse(fs.readFileSync(path.join(rootDir, "config", "rules", "rules.json"), "utf8"));
  const combined = JSON.stringify({ profile, projects, scenes, skills, rules });

  assert.equal(profile.name || "", "");
  assert.deepEqual((projects.projects || []).map(project => project.id), ["devflow"]);
  assert.deepEqual((scenes.scenes || []).map(scene => scene.id), []);
  assert.deepEqual((skills.skills || []).map(skill => skill.id).sort(), ["devflow", "devflow-init"]);
  assert.deepEqual(rules.rules || [], []);
  assert.doesNotMatch(combined, /\/Users\/[A-Za-z0-9._-]+|C:\\Users\\|token\s*[:=]|password\s*[:=]|api[_-]?key\s*[:=]/i);
});
