import path from "node:path";
import {
  actionCommands,
  actionError,
  actionOk,
  createRuleFile,
  importRuleFile,
  listFromBody,
  loadProjectsByIdsFromStore,
  loadScenesByIdsFromStore,
  makeRuleMount,
  normalizeRuleId,
  removeGeneratedSource,
  removeProjectMountInStore,
  removeSceneRuleMountInStore,
  safeStat,
  titleFromId,
  upsertById
} from "./shared.mjs";

export const ruleActions = {
  add_rule: { run: addRule },
  delete_rule: { run: deleteRule }
};

export async function addRule({ rootPath, actionId, body }) {
  const commands = await actionCommands(rootPath);
  const id = normalizeRuleId(body?.ruleId || body?.name);
  if (!id) {
    return actionError(actionId, "invalid_rule_id", "新增规则需要填写规则 ID 或规则名称。");
  }
  const sourcePath = body?.sourcePath ? path.resolve(String(body.sourcePath)) : "";
  const sourceStat = sourcePath ? await safeStat(sourcePath) : null;
  if (sourcePath && !sourceStat?.isFile()) {
    return actionError(actionId, "missing_rule_file", `规则文件不存在或不是文件: ${sourcePath}`);
  }
  const purpose = String(body?.purpose || "").trim();
  if (!sourceStat && !purpose) {
    return actionError(actionId, "missing_rule_content", "没有规则文件时，需要填写规则用途，系统才能生成配套 rule 文件。");
  }
  const ruleCatalog = { version: 1, rules: await commands.listRules() };
  const imported = sourceStat
    ? await importRuleFile(rootPath, sourcePath, {
      id,
      name: body?.name || titleFromId(id),
      purpose: purpose || `Rule imported from ${path.basename(sourcePath)}.`,
      projectIds: listFromBody(body?.projectIds),
      sceneIds: listFromBody(body?.sceneIds),
      applyMode: String(body?.applyMode || "project-on-demand"),
      catalog: ruleCatalog
    })
    : await createRuleFile(rootPath, {
      id,
      name: body?.name || titleFromId(id),
      purpose,
      projectIds: listFromBody(body?.projectIds),
      sceneIds: listFromBody(body?.sceneIds),
      applyMode: String(body?.applyMode || "project-on-demand"),
      catalog: ruleCatalog
    });

  await commands.writeRule(imported.rule);
  imported.changedPaths.push("data/devflow.db");
  const projects = await loadProjectsByIdsFromStore(commands, imported.rule.projectIds || []);
  for (const project of projects) {
    project.rules = project.rules || [];
    upsertById(project.rules, makeRuleMount(imported.rule));
    await commands.writeProject(project);
  }

  const scenes = await loadScenesByIdsFromStore(commands, imported.rule.sceneIds || []);
  for (const scene of scenes) {
    scene.ruleHints = scene.ruleHints || [];
    upsertById(scene.ruleHints, { id: imported.rule.id, name: imported.rule.name, sourcePath: imported.rule.sourcePath });
    await commands.writeSceneTemplate(scene);
  }

  return actionOk(actionId, `新增规则 ${imported.rule.name}，已挂载 ${projects.length} 个项目、${scenes.length} 个场景。`, imported.changedPaths);
}

export async function deleteRule({ rootPath, actionId, body }) {
  const commands = await actionCommands(rootPath);
  const id = normalizeRuleId(body?.ruleId || body?.id || body?.name);
  if (!id) return actionError(actionId, "invalid_rule_id", "删除 rule 需要填写 ruleId。");

  const rule = (await commands.listRules()).find((item) => item.id === id);
  if (!rule) return actionError(actionId, "unknown_rule", `Unknown ruleId: ${id}`);

  const changedPaths = [];
  await commands.deleteRule(id);
  changedPaths.push("data/devflow.db");
  await removeProjectMountInStore(commands, "rules", id, rule.sourcePath);
  await removeSceneRuleMountInStore(commands, id);
  changedPaths.push(...await removeGeneratedSource(rootPath, rule.sourcePath, "bundles/rules/"));

  return actionOk(actionId, `删除 rule ${id}。`, changedPaths);
}
