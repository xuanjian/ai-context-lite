import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createActionCommandService } from "../commands/action-store-commands.mjs";
import { PROFILE_CONFIG_KEY } from "../defaults/profile.mjs";
import { resolveInside } from "../paths.mjs";

const COMMAND_TIMEOUT_MS = 60000;

export async function actionCommands(rootPath) {
  return createActionCommandService({ rootDir: rootPath });
}


export async function createFileOnce(rootPath, actionId, relativePath, contents) {
  const filePath = resolveInside(rootPath, relativePath);
  try {
    await fs.access(filePath);
    return actionError(undefined, "file_exists", `File already exists: ${relativePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return actionError(undefined, "action_failed", error.message);
    }
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
  return {
    ok: true,
    actionId,
    summary: `Created ${relativePath}`,
    output: "",
    changedPaths: [relativePath],
    nextCheckIds: ["profile_json", "person_profile_doc"]
  };
}

export async function createMinimalProfileConfig({ rootPath, actionId }) {
  const commands = await actionCommands(rootPath);
  const existing = await commands.getConfig(PROFILE_CONFIG_KEY);
  if (existing) {
    return actionError(undefined, "file_exists", "Profile config already exists in SQLite.");
  }
  await commands.setConfig(PROFILE_CONFIG_KEY, {
    version: 1,
    sourcePath: "docs/person/profile.md",
    role: "TODO: fill in stable role and collaboration profile",
    collaborationPreferences: []
  });
  return {
    ok: true,
    actionId,
    summary: "Created profile config",
    output: "",
    changedPaths: ["data/devflow.db"],
    nextCheckIds: ["profile_json", "person_profile_doc"]
  };
}

export async function importSkillDirectory(rootPath, skillDir, options) {
  const skillFile = path.join(skillDir, "SKILL.md");
  const frontmatter = readFrontmatter(await fs.readFile(skillFile, "utf8"));
  const id = normalizeId(options.id || frontmatter.name || path.basename(skillDir));
  if (!id) throw new Error("skill id is required");
  const targetDir = resolveInside(rootPath, `bundles/skills/${id}`);
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(skillDir, targetDir, { recursive: true });
  const skill = buildSkillRecord({
    ...options,
    id,
    sourcePath: `bundles/skills/${id}/SKILL.md`,
    name: options.name || frontmatter.name,
    description: options.description || frontmatter.description,
    sourceExists: true,
    sourceType: "file"
  });
  upsertById(options.catalog.skills, skill);
  return { skill, changedPaths: [`bundles/skills/${id}/SKILL.md`] };
}

export async function registerExternalSkillDirectory(skillDir, options) {
  const skillFile = path.join(skillDir, "SKILL.md");
  const frontmatter = readFrontmatter(await fs.readFile(skillFile, "utf8"));
  const id = normalizeId(options.id || frontmatter.name || path.basename(skillDir));
  if (!id) throw new Error("skill id is required");
  const skill = buildSkillRecord({
    ...options,
    id,
    sourcePath: skillFile,
    name: options.name || frontmatter.name,
    description: options.description || frontmatter.description,
    sourceExists: true,
    sourceType: "external-file"
  });
  upsertById(options.catalog.skills, skill);
  return { skill, changedPaths: [] };
}

function buildSkillRecord(options) {
  const family = normalizeId(options.family);
  const idTag = normalizeId(options.id);
  const tags = uniqueSorted([
    ...listFromBody(options.tags),
    family,
    idTag,
    acronymFromId(idTag)
  ]);
  const description = String(options.description || `Use when ${titleFromId(options.id)} is needed.`);
  return {
    id: options.id,
    name: String(options.name || titleFromId(options.id)),
    description,
    trigger: String(options.trigger || description),
    sourcePath: options.sourcePath,
    sourceProjectId: options.sourceProjectId,
    family,
    scope: String(options.scope || "project"),
    tags,
    defaultSceneIds: listFromBody(options.sceneIds),
    whenToLoad: String(options.whenToLoad || description),
    sourceExists: options.sourceExists !== false,
    sourceType: options.sourceType || "file"
  };
}

function acronymFromId(id) {
  const parts = String(id || "").split("-").filter(Boolean);
  return parts.length > 1 ? parts.map((part) => part[0]).join("") : "";
}

export async function importRuleFile(rootPath, sourcePath, options) {
  const id = normalizeRuleId(options.id);
  if (!id) throw new Error("rule id is required");
  const targetPath = resolveInside(rootPath, `bundles/rules/${id}.md`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  const rule = buildRuleRecord({
    ...options,
    id,
    sourcePath: `bundles/rules/${id}.md`,
    sourceExists: true
  });
  upsertById(options.catalog.rules, rule);
  return { rule, changedPaths: [`bundles/rules/${id}.md`] };
}

export async function registerExternalRuleFile(sourcePath, options) {
  const id = normalizeRuleId(options.id);
  if (!id) throw new Error("rule id is required");
  const rule = buildRuleRecord({
    ...options,
    id,
    sourcePath,
    sourceExists: true,
    sourceType: "external-file"
  });
  upsertById(options.catalog.rules, rule);
  return { rule, changedPaths: [] };
}

export async function createRuleFile(rootPath, options) {
  const id = normalizeRuleId(options.id);
  if (!id) throw new Error("rule id is required");
  const sourcePath = `bundles/rules/${id}.md`;
  await writeRootText(rootPath, sourcePath, `# ${options.name || titleFromId(id)}

## 用途

${options.purpose}

## 读取时机

- 当任务命中挂载的项目或场景时按需读取。
- 先读项目/场景 JSON，再根据 rule id 读取本文件。

## 执行规则

- TODO: 用 AI 根据实际项目约束补全可执行规则。
`);
  const rule = buildRuleRecord({ ...options, id, sourcePath, sourceExists: true });
  upsertById(options.catalog.rules, rule);
  return { rule, changedPaths: [sourcePath] };
}

export function buildRuleRecord(options) {
  return {
    id: options.id,
    name: String(options.name || titleFromId(options.id)),
    purpose: String(options.purpose || ""),
    sourcePath: options.sourcePath,
    projectIds: listFromBody(options.projectIds),
    technologyFamilyIds: listFromBody(options.technologyFamilyIds),
    sceneIds: listFromBody(options.sceneIds),
    tags: uniqueSorted(listFromBody(options.tags)),
    scope: String(options.scope || "project"),
    whenToRead: String(options.whenToRead || "Read when this rule is mounted by the selected project or scene."),
    applyMode: String(options.applyMode || "project-on-demand"),
    globs: listFromBody(options.globs).length ? listFromBody(options.globs) : ["**/*"],
    sourceExists: options.sourceExists !== false,
    sourceType: options.sourceType || "file"
  };
}

export async function scanProjectIntroDocs(projectPath) {
  const candidates = [
    "AGENTS.md",
    "CLAUDE.md",
    "claude.md",
    "README.md",
    ".ai-configs/claude.md",
    ".claude/CLAUDE.md"
  ];
  const docs = [];
  for (const relativePath of candidates) {
    const filePath = path.join(projectPath, relativePath);
    const stat = await safeStat(filePath);
    if (stat?.isFile()) {
      docs.push({
        path: relativePath,
        content: await fs.readFile(filePath, "utf8")
      });
    }
  }
  for (const filePath of await listMarkdownFiles(path.join(projectPath, ".cursor/rules"), 1)) {
    docs.push({
      path: path.relative(projectPath, filePath).split(path.sep).join("/"),
      content: await fs.readFile(filePath, "utf8")
    });
  }
  return docs;
}

export async function scanSkillDirs(projectPath) {
  const roots = [".ai-configs/skills", ".codex/skills", ".agents/skills", ".claude/skills", "skills"];
  const dirs = [];
  for (const root of roots) {
    const absoluteRoot = path.join(projectPath, root);
    const entries = await safeReaddir(absoluteRoot);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(absoluteRoot, entry.name);
      if ((await safeStat(path.join(skillDir, "SKILL.md")))?.isFile()) {
        dirs.push(skillDir);
      }
    }
  }
  return dirs;
}

export async function scanRuleFiles(projectPath) {
  return uniqueSorted([
    ...await listMarkdownFiles(path.join(projectPath, ".ai-configs/rules"), 2),
    ...await listMarkdownFiles(path.join(projectPath, ".cursor/rules"), 2),
    ...await listMarkdownFiles(path.join(projectPath, "rules"), 3)
  ]);
}

export async function listMarkdownFiles(root, depth) {
  const stat = await safeStat(root);
  if (!stat?.isDirectory() || depth < 0) return [];
  const files = [];
  const entries = await safeReaddir(root);
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    const stat = await safeStat(filePath);
    if (!stat) continue;
    if (stat.isDirectory()) {
      files.push(...await listMarkdownFiles(filePath, depth - 1));
    } else if (stat.isFile() && /\.(md|mdc)$/i.test(entry.name)) {
      files.push(filePath);
    }
  }
  return files;
}

export async function ensureProjectEntryNote(projectPath, rootPath) {
  const note = `

<!-- DevFlow:managed-entry:start -->
## DevFlow 协作入口

- 当前项目的 AI 正文在 \`.ai-configs/project.md\`。
- 当前项目已接入 DevFlow，请先运行 \`devflow query route "<user request>"\`。
- 继续已有任务时运行 \`devflow query current\`；查看 skill/rule 清单时运行 \`devflow query skills\` 或 \`devflow query rules\`。
- 不要在聊天窗口一次性加载所有上下文，按任务需要加载。
<!-- DevFlow:managed-entry:end -->
`;
  const target = path.join(projectPath, "AGENTS.md");
  const existing = await readOptionalText(target);
  if (existing?.includes("<!-- DevFlow:managed-entry:start -->")) {
    return "";
  }
  await fs.writeFile(target, `${existing || `# ${path.basename(projectPath)}\n`}${note}`, "utf8");
  return target;
}

export async function ensureClaudeEntry(projectPath) {
  const note = `

<!-- DevFlow:managed-claude-entry:start -->
@AGENTS.md
<!-- DevFlow:managed-claude-entry:end -->
`;
  const target = path.join(projectPath, "CLAUDE.md");
  const existing = await readOptionalText(target);
  if (existing?.includes("<!-- DevFlow:managed-claude-entry:start -->") || existing?.includes("@AGENTS.md")) {
    return "";
  }
  await fs.writeFile(target, `${existing || "# CLAUDE.md\n"}${note}`, "utf8");
  return target;
}

export async function ensureDistributedProjectDoc(projectPath, project) {
  const target = path.join(projectPath, ".ai-configs/project.md");
  const existing = await readOptionalText(target);
  if (existing) return "";
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buildDistributedProjectDoc(project), "utf8");
  return target;
}

export function buildDistributedProjectDoc(project) {
  const sourceDocLines = project.sourceDocs.length
    ? project.sourceDocs.map((doc) => `- \`${doc.path}\``).join("\n")
    : "- 未发现 AGENTS、CLAUDE、README 或 Cursor rules 文档。";
  return `# ${project.name}

## 项目定位

${project.summary}

## DevFlow 入口

- DevFlow 项目 ID：\`${project.id}\`
- 这是该业务项目自己的 AI 正文，跟随业务仓库维护。
- DevFlow 只集中维护项目关系、场景、任务状态和挂载索引。
- 进入该项目上下文前运行 \`devflow query route "<user request>"\`，只读取返回的 readPaths、skills.sourcePath 或 rules.sourcePath。

## 原始资料来源

${sourceDocLines}
`;
}

export function buildProjectEntryFiles(projectPath) {
  return {
    projectDoc: ".ai-configs/project.md",
    agents: "AGENTS.md",
    claude: "CLAUDE.md",
    aiConfigRules: ".ai-configs/rules",
    aiConfigSkills: ".ai-configs/skills",
    cursorRules: ".cursor/rules"
  };
}

export function isManagedRootPath(filePath, allowedPrefix) {
  return Boolean(
    filePath
    && !path.isAbsolute(filePath)
    && !filePath.includes("..")
    && filePath.startsWith(allowedPrefix)
  );
}

export function buildImportedProjectDoc(project, sourceDocs, skills, rules) {
  const docLines = sourceDocs.length
    ? sourceDocs.map((doc) => `- \`${doc.path}\``).join("\n")
    : "- 未发现 AGENTS、CLAUDE、README 或 Cursor rules 文档。";
  const skillLines = skills.length ? skills.map((skill) => `- \`${skill.id}\` ${skill.name}`).join("\n") : "- 无";
  const ruleLines = rules.length ? rules.map((rule) => `- \`${rule.id}\` ${rule.name}`).join("\n") : "- 无";
  return `# ${project.name}

## 项目定位

${project.summary}

## 项目路径

\`${project.path}\`

## 发现的项目说明文档

${docLines}

## DevFlow 读取规则

- 用户选择该项目后，先运行 \`devflow query route "<user request>"\`。
- 只有 query 返回本文件或项目内原始说明文档时，再读取对应 source path。
- skill 与 rule 通过 \`devflow query skills\` / \`devflow query rules\` 或 route 结果按需加载，减少聊天窗口上下文。

## 已导入 Skills

${skillLines}

## 已导入 Rules

${ruleLines}
`;
}

export function buildSceneDoc(scene) {
  const projectLines = scene.projects.length ? scene.projects.map((project) => `- \`${project.id}\` ${project.name}`).join("\n") : "- 暂未挂项目";
  return `# ${scene.name}

## 场景用途

${scene.purpose || scene.summary}

## 挂载项目

${projectLines}

## 关系读取

- 进入该场景时先运行 \`devflow query route "<user request>"\`，确认命中的 scene template 与 Workset。
- 场景下的 rules 通过 \`devflow query rules\` 或 route 结果按需读取 rule source path。
`;
}

export async function loadProjectsByIdsFromStore(commands, ids) {
  const projects = [];
  for (const id of ids) {
    const project = await commands.getProject(id);
    if (!project) throw new Error(`Unknown projectId: ${id}`);
    projects.push(project);
  }
  return projects;
}

export async function loadScenesByIdsFromStore(commands, ids) {
  const scenes = [];
  for (const id of ids) {
    const scene = await commands.getSceneTemplate(id);
    if (!scene) throw new Error(`Unknown sceneId: ${id}`);
    scenes.push(scene);
  }
  return scenes;
}

export function makeSkillMount(skill) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    sourcePath: skill.sourcePath,
    whenToLoad: skill.whenToLoad
  };
}

export function makeRuleMount(rule) {
  return {
    id: rule.id,
    name: rule.name,
    purpose: rule.purpose,
    sourcePath: rule.sourcePath,
    applyMode: rule.applyMode,
    globs: rule.globs || ["**/*"],
    whenToRead: rule.whenToRead
  };
}

export async function resolveSkillDir(skillPath) {
  const stat = await safeStat(skillPath);
  if (stat?.isDirectory() && (await safeStat(path.join(skillPath, "SKILL.md")))?.isFile()) return skillPath;
  if (stat?.isFile() && path.basename(skillPath) === "SKILL.md") return path.dirname(skillPath);
  return "";
}

export function summarizeProject(name, docs) {
  const firstDoc = docs.find((doc) => doc.content.trim());
  if (!firstDoc) return `${name} 项目。`;
  const line = firstDoc.content
    .split(/\r?\n/)
    .map((item) => item.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return line ? `${name}: ${line}` : `${name} 项目。`;
}

export function inferTechnologyFamily(projectPath, packageJson) {
  const normalized = projectPath.split(path.sep).join("/");
  const deps = Object.keys({
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies
  }).join(" ");
  if (normalized.includes("/frontend/") || /(react|vue|vite|next|webpack|taro)/i.test(deps)) return "frontend";
  if (normalized.includes("/node/") || /(egg|koa|midway|tegg)/i.test(deps)) return "bff";
  if (normalized.includes("/ios/") || /\.(xcworkspace|xcodeproj)$/i.test(normalized)) return "ios";
  if (normalized.toLowerCase().includes("devflow") || normalized.includes("/ai-context")) return "workflow";
  return "unknown";
}

export function inferRepoType(technologyFamilyId, packageJson) {
  if (technologyFamilyId === "frontend") return packageJson ? "web-app" : "frontend-repository";
  if (technologyFamilyId === "bff") return "service";
  if (technologyFamilyId === "ios") return "ios-app";
  if (technologyFamilyId === "workflow") return "context-config-center";
  return "repository";
}

export function readFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return result;
}

export async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function readOptionalText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function writeRootText(rootPath, relativePath, value) {
  const filePath = resolveInside(rootPath, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

export async function removeRootPaths(rootPath, relativePaths) {
  const changedPaths = [];
  for (const relativePath of uniqueSorted(relativePaths.filter(Boolean))) {
    await fs.rm(resolveInside(rootPath, relativePath), { recursive: true, force: true });
    changedPaths.push(relativePath);
  }
  return changedPaths;
}

export async function removeGeneratedSource(rootPath, sourcePath, allowedPrefix) {
  if (!sourcePath || path.isAbsolute(sourcePath) || !sourcePath.startsWith(allowedPrefix)) return [];
  const removePath = sourcePath.endsWith("/SKILL.md") ? path.dirname(sourcePath) : sourcePath;
  return removeRootPaths(rootPath, [removePath]);
}

export async function removeProjectMountInStore(commands, field, id, sourcePath) {
  for (const project of await commands.listProjects()) {
    if (!project?.[field]) continue;
    const current = project[field] || [];
    const next = current.filter((mount) => mount.id !== id);
    if (next.length === current.length) continue;
    project[field] = next;
    if (project.readPolicy?.onDemandRead && sourcePath) {
      project.readPolicy.onDemandRead = removeValue(project.readPolicy.onDemandRead, sourcePath);
    }
    await commands.writeProject(project);
  }
}

export async function removeSceneFromProjectsInStore(commands, sceneId) {
  for (const project of await commands.listProjects()) {
    if (!project?.scenes) continue;
    const nextScenes = removeById(project.scenes, sceneId);
    if (nextScenes.length === project.scenes.length) continue;
    await commands.writeProject({ ...project, scenes: nextScenes });
  }
}

export async function removeSceneRuleMountInStore(commands, ruleId) {
  for (const scene of await commands.listSceneTemplates()) {
    const nextRuleHints = removeById(scene.ruleHints || [], ruleId);
    if (nextRuleHints.length === (scene.ruleHints || []).length) continue;
    await commands.writeSceneTemplate({ ...scene, ruleHints: nextRuleHints });
  }
}

export async function removeRuntimeReferencesFromStore(commands, { projectId, sceneId }) {
  for (const task of await commands.listTasks()) {
    let changed = false;
    const nextTask = { ...task };
    if (projectId && Array.isArray(task.projectIds)) {
      const next = removeValue(task.projectIds, projectId);
      changed = changed || next.length !== task.projectIds.length;
      nextTask.projectIds = next;
    }
    if (sceneId && Array.isArray(task.sceneIds)) {
      const next = removeValue(task.sceneIds, sceneId);
      changed = changed || next.length !== task.sceneIds.length;
      nextTask.sceneIds = next;
      nextTask.sceneTemplateIds = next;
    }
    if (nextTask.workset) {
      const nextWorkset = { ...nextTask.workset };
      if (projectId && Array.isArray(nextWorkset.projects)) {
        const next = removeById(nextWorkset.projects, projectId);
        changed = changed || next.length !== nextWorkset.projects.length;
        nextWorkset.projects = next;
      }
      if (sceneId && nextWorkset.sceneTemplateId === sceneId) {
        nextWorkset.sceneTemplateId = "";
        changed = true;
      }
      nextTask.workset = nextWorkset;
    }
    if (changed) {
      await commands.writeTask(nextTask);
    }
  }

  const activeTask = await commands.getActiveTask();
  if (activeTask) {
    await commands.setRuntimeState({
      activeProjectIds: activeTask.workset?.projects?.map((project) => project.id).filter(Boolean) || activeTask.projectIds || [],
      activeSceneTemplateId: activeTask.workset?.sceneTemplateId || "",
      activeSceneIds: activeTask.workset?.sceneTemplateId ? [activeTask.workset.sceneTemplateId] : [],
      activeWorksetId: activeTask.workset?.id || ""
    });
  }
}

export async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

export async function safeReaddir(dirPath) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function upsertById(list, item) {
  const index = list.findIndex((current) => current.id === item.id);
  if (index === -1) list.push(item);
  else list[index] = { ...list[index], ...item };
}

export function removeById(list, id) {
  return (list || []).filter((item) => item.id !== id);
}

export function removeValue(list, value) {
  return (list || []).filter((item) => item !== value);
}

export function listFromBody(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value).split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
}

export function isTruthy(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "yes";
}

export function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function normalizeId(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeRuleFileId(value) {
  return normalizeId(value) || "rule";
}

export function normalizeRuleId(value) {
  return String(value || "")
    .split("/")
    .map(normalizeId)
    .filter(Boolean)
    .join("/");
}

export function titleFromId(value) {
  return String(value || "")
    .split(/[/-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function actionOk(actionId, summary, changedPaths) {
  return {
    ok: true,
    actionId,
    summary,
    output: "",
    changedPaths: uniqueSorted(changedPaths),
    nextCheckIds: ["config_json_valid", "graph_relationships"]
  };
}

export async function runFixedCommand(rootPath, command, actionId) {
  const result = await runCommand(command, { cwd: rootPath, timeoutMs: COMMAND_TIMEOUT_MS });
  return {
    ok: result.ok,
    actionId,
    summary: result.ok ? `Ran ${command.join(" ")}` : `Failed ${command.join(" ")}`,
    output: result.output,
    changedPaths: [],
    nextCheckIds: ["install_check_command", "install_validate_command"]
  };
}

export async function runInstallModuleAction(rootPath, actionId, commandName, callback) {
  const result = await captureConsoleOutput(callback);
  if (result.error) {
    return {
      ok: false,
      actionId,
      error: {
        code: "action_failed",
        message: result.error.message || String(result.error)
      },
      summary: `Failed install-ai-context ${commandName}`,
      output: result.output,
      changedPaths: [],
      nextCheckIds: ["install_check_command", "install_validate_command"]
    };
  }
  return {
    ok: true,
    actionId,
    summary: `Ran install-ai-context ${commandName}`,
    output: result.output,
    changedPaths: [],
    nextCheckIds: ["install_check_command", "install_validate_command"]
  };
}

export async function captureConsoleOutput(callback) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];
  let error;
  console.log = (...args) => stdout.push(args.join(" "));
  console.warn = (...args) => stderr.push(args.join(" "));
  console.error = (...args) => stderr.push(args.join(" "));
  try {
    await callback();
  } catch (caught) {
    error = caught;
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  return {
    output: [...stdout, ...stderr].join("\n").trim(),
    error
  };
}

export function runCommand(command, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, output: "Command timed out." });
    }, timeoutMs);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: output.trim() });
    });
  });
}

export function actionError(actionId, code, message) {
  return {
    ok: false,
    actionId,
    error: { code, message },
    summary: message,
    output: "",
    changedPaths: [],
    nextCheckIds: []
  };
}
