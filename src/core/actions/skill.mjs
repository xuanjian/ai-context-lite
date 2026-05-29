import fs from "node:fs/promises";
import path from "node:path";
import {
  actionCommands,
  actionError,
  actionOk,
  importSkillDirectory,
  listFromBody,
  loadProjectsByIdsFromStore,
  makeSkillMount,
  normalizeId,
  registerExternalSkillDirectory,
  removeGeneratedSource,
  removeProjectMountInStore,
  resolveSkillDir,
  upsertById
} from "./shared.mjs";

export const skillActions = {
  add_skill_from_path: { run: addSkillFromPath },
  delete_skill: { run: deleteSkill }
};

export async function addSkillFromPath({ rootPath, actionId, body }) {
  const commands = await actionCommands(rootPath);
  const skillPath = body?.skillPath ? path.resolve(String(body.skillPath)) : "";
  if (!skillPath) {
    return actionError(actionId, "invalid_skill_path", "新增技能需要填写 skill 路径。");
  }
  const skillDir = await resolveSkillDir(skillPath);
  const batchSkillDirs = skillDir ? [] : await listChildSkillDirs(skillPath);
  const skillDirs = skillDir ? [skillDir] : batchSkillDirs;
  if (!skillDirs.length) {
    return actionError(actionId, "invalid_skill_path", `未找到 SKILL.md: ${skillPath}`);
  }
  const skillCatalog = { version: 1, skills: await commands.listSkills() };
  const family = normalizeId(body?.family);
  const scope = body?.scope ? String(body.scope).trim() : undefined;
  const tags = [...listFromBody(body?.tags), family].filter(Boolean);
  const isBatch = batchSkillDirs.length > 0;
  const registerExternal = isBatch || family === "superpowers";
  const importedSkills = [];
  const changedPaths = [];
  for (const dir of skillDirs) {
    const importOptions = {
      id: isBatch ? undefined : normalizeId(body?.skillId || path.basename(dir)),
      name: isBatch ? undefined : body?.name,
      description: isBatch ? undefined : body?.description,
      projectIds: listFromBody(body?.projectIds),
      family,
      scope,
      tags,
      catalog: skillCatalog
    };
    const imported = registerExternal
      ? await registerExternalSkillDirectory(dir, importOptions)
      : await importSkillDirectory(rootPath, dir, importOptions);
    await commands.writeSkill(imported.skill);
    importedSkills.push(imported.skill);
    changedPaths.push(...imported.changedPaths);
  }
  changedPaths.push("data/devflow.db");
  const projects = await loadProjectsByIdsFromStore(commands, listFromBody(body?.projectIds));
  for (const project of projects) {
    project.skills = project.skills || [];
    for (const skill of importedSkills) {
      upsertById(project.skills, makeSkillMount(skill));
    }
    await commands.writeProject(project);
  }
  const label = importedSkills.length === 1 ? importedSkills[0].name : `${importedSkills.length} 个技能`;
  return actionOk(actionId, `新增技能 ${label}，已挂载 ${projects.length} 个项目。`, changedPaths);
}

async function listChildSkillDirs(parentPath) {
  let entries;
  try {
    entries = await fs.readdir(parentPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const skillDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(parentPath, entry.name);
    try {
      await fs.access(path.join(candidate, "SKILL.md"));
      skillDirs.push(candidate);
    } catch {
      // Non-skill subdirectories are ignored by batch registration.
    }
  }
  return skillDirs.sort((a, b) => a.localeCompare(b));
}

export async function deleteSkill({ rootPath, actionId, body }) {
  const commands = await actionCommands(rootPath);
  const id = normalizeId(body?.skillId || body?.id || body?.name);
  if (!id) return actionError(actionId, "invalid_skill_id", "删除 skill 需要填写 skillId。");

  const skill = (await commands.listSkills()).find((item) => item.id === id);
  if (!skill) return actionError(actionId, "unknown_skill", `Unknown skillId: ${id}`);

  const changedPaths = [];
  await commands.deleteSkill(id);
  changedPaths.push("data/devflow.db");
  await removeProjectMountInStore(commands, "skills", id, skill.sourcePath);
  changedPaths.push(...await removeGeneratedSource(rootPath, skill.sourcePath, "bundles/skills/"));

  return actionOk(actionId, `删除 skill ${id}。`, changedPaths);
}
