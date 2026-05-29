import path from "node:path";
import {
  actionCommands,
  actionError,
  actionOk,
  buildProjectEntryFiles,
  ensureClaudeEntry,
  ensureDistributedProjectDoc,
  ensureProjectEntryNote,
  inferRepoType,
  inferTechnologyFamily,
  isManagedRootPath,
  isTruthy,
  listFromBody,
  makeRuleMount,
  makeSkillMount,
  normalizeId,
  normalizeRuleFileId,
  readOptionalJson,
  registerExternalRuleFile,
  registerExternalSkillDirectory,
  removeById,
  removeRootPaths,
  removeRuntimeReferencesFromStore,
  removeValue,
  safeStat,
  scanProjectIntroDocs,
  scanRuleFiles,
  scanSkillDirs,
  summarizeProject,
  titleFromId,
  uniqueSorted
} from "./shared.mjs";

export const projectActions = {
  add_project_from_path: { run: addProjectFromPath },
  delete_project: { run: deleteProject }
};

export async function addProjectFromPath({ rootPath, actionId, body }) {
  const commands = await actionCommands(rootPath);
  const projectPath = body?.projectPath ? path.resolve(String(body.projectPath)) : "";
  if (!projectPath) {
    return actionError(actionId, "invalid_project_path", "新增项目需要填写项目路径。");
  }
  const stat = await safeStat(projectPath);
  if (!stat?.isDirectory()) {
    return actionError(actionId, "invalid_project_path", `项目路径不存在或不是目录: ${projectPath}`);
  }

  const packageJson = await readOptionalJson(path.join(projectPath, "package.json"));
  const folderName = path.basename(projectPath);
  const id = normalizeId(body?.projectId || folderName);
  if (!id) {
    return actionError(actionId, "invalid_project_id", "新增项目需要可用的项目 ID。");
  }
  const name = String(body?.name || packageJson?.name || folderName);
  const technologyFamilyId = String(body?.technologyFamilyId || inferTechnologyFamily(projectPath, packageJson));
  const repoType = String(body?.repoType || inferRepoType(technologyFamilyId, packageJson));
  const sourceDocs = await scanProjectIntroDocs(projectPath);
  const summary = String(body?.summary || summarizeProject(name, sourceDocs));
  const aiConfigsDir = path.join(projectPath, ".ai-configs");
  const projectDocPath = path.join(aiConfigsDir, "project.md");
  const hasAiConfigs = (await safeStat(aiConfigsDir))?.isDirectory();
  if (!hasAiConfigs && !isTruthy(body?.confirmAiConfigsMigration)) {
    return actionError(
      actionId,
      "confirmation_required",
      `项目 ${name} 还没有 .ai-configs。确认后 DevFlow 会创建 .ai-configs/project.md，把现有项目入口资料整理成项目内唯一正文，并只在 DevFlow 中登记索引关系。`
    );
  }

  const changedPaths = [];
  const projectDocNote = await ensureDistributedProjectDoc(projectPath, { id, name, summary, sourceDocs });
  if (projectDocNote) changedPaths.push(projectDocNote);
  const projectRuleNote = await ensureProjectEntryNote(projectPath, rootPath);
  if (projectRuleNote) changedPaths.push(projectRuleNote);
  const claudeEntryNote = await ensureClaudeEntry(projectPath);
  if (claudeEntryNote) changedPaths.push(claudeEntryNote);

  const skillCatalog = { version: 1, skills: await commands.listSkills() };
  const ruleCatalog = { version: 1, rules: await commands.listRules() };

  const importedSkills = [];
  for (const skillDir of await scanSkillDirs(projectPath)) {
    const imported = await registerExternalSkillDirectory(skillDir, {
      id: `${id}-${normalizeId(path.basename(skillDir))}`,
      projectIds: [id],
      sourceProjectId: id,
      catalog: skillCatalog
    });
    importedSkills.push(imported.skill);
    changedPaths.push(...imported.changedPaths);
  }

  const importedRules = [];
  for (const ruleFile of await scanRuleFiles(projectPath)) {
    const ruleBase = normalizeRuleFileId(path.basename(ruleFile, path.extname(ruleFile)));
    const imported = await registerExternalRuleFile(ruleFile, {
      id: `${id}/${ruleBase}`,
      name: titleFromId(ruleBase),
      purpose: `Rules discovered from ${name}.`,
      projectIds: [id],
      sceneIds: [],
      applyMode: "project-on-demand",
      catalog: ruleCatalog
    });
    importedRules.push(imported.rule);
    changedPaths.push(...imported.changedPaths);
  }

  const project = {
    version: 1,
    id,
    name,
    technologyFamilyId,
    repoType,
    summary,
    path: projectPath,
    tags: uniqueSorted([technologyFamilyId, ...listFromBody(body?.tags)]),
    entryFiles: buildProjectEntryFiles(projectPath),
    sourceOfTruth: {
      projectDoc: "distributed",
      rules: "distributed",
      skills: "distributed",
      relations: "centralized",
      tasks: "centralized"
    },
    doc: {
      path: projectDocPath,
      location: "distributed",
      title: name,
      summary,
      whenToRead: "Read after this project is selected and the JSON summary is insufficient. This file lives in the business project."
    },
    scenes: [],
    skills: importedSkills.map(makeSkillMount),
    rules: importedRules.map(makeRuleMount),
    readPolicy: {
      defaultRead: [`config/projects/${id}.json`],
      onDemandRead: [
        projectDocPath,
        ...importedSkills.map((skill) => skill.sourcePath),
        ...importedRules.map((rule) => rule.sourcePath)
      ],
      notes: "Start with JSON. Load distributed project docs, skills, and rules only when the task needs them."
    }
  };

  for (const skill of importedSkills) await commands.writeSkill(skill);
  for (const rule of importedRules) await commands.writeRule(rule);
  await commands.writeProject(project);
  changedPaths.push("data/devflow.db");

  return actionOk(actionId, `新增项目 ${name}，登记 ${importedSkills.length} 个外部 skill、${importedRules.length} 条外部 rule。`, changedPaths);
}

export async function deleteProject({ rootPath, actionId, body }) {
  const commands = await actionCommands(rootPath);
  const id = normalizeId(body?.projectId || body?.id || body?.name);
  if (!id) return actionError(actionId, "invalid_project_id", "删除项目需要填写 projectId。");

  const project = await commands.getProject(id);
  if (!project) return actionError(actionId, "unknown_project", `Unknown projectId: ${id}`);

  const changedPaths = [];
  const docPath = project?.doc?.path || `docs/repos/${id}.md`;
  const managedDocPath = isManagedRootPath(docPath, "docs/repos/") ? docPath : "";

  await commands.deleteProject(id);
  changedPaths.push("data/devflow.db");
  changedPaths.push(...await removeRootPaths(rootPath, [managedDocPath]));

  for (const scene of await commands.listSceneTemplates()) {
    const nextProjectHints = removeById(scene.projectHints || [], id);
    if (nextProjectHints.length === (scene.projectHints || []).length) continue;
    await commands.writeSceneTemplate({ ...scene, projectHints: nextProjectHints });
  }

  for (const rule of await commands.listRules()) {
    const nextProjectIds = removeValue(rule.projectIds || [], id);
    if (nextProjectIds.length !== (rule.projectIds || []).length) {
      await commands.writeRule({ ...rule, projectIds: nextProjectIds });
    }
  }

  await removeRuntimeReferencesFromStore(commands, { projectId: id });
  return actionOk(actionId, `删除项目 ${id}。真实业务仓库不会被删除。`, changedPaths);
}
