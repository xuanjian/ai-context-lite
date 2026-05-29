import {
  actionCommands,
  actionError,
  actionOk,
  buildSceneDoc,
  listFromBody,
  loadProjectsByIdsFromStore,
  normalizeId,
  removeRootPaths,
  removeRuntimeReferencesFromStore,
  removeSceneFromProjectsInStore,
  removeValue,
  titleFromId,
  upsertById,
  writeRootText
} from "./shared.mjs";

export const sceneActions = {
  add_scene: { run: addScene },
  delete_scene: { run: deleteScene }
};

export async function addScene({ rootPath, actionId, body }) {
  const commands = await actionCommands(rootPath);
  const id = normalizeId(body?.sceneId || body?.name);
  if (!id) {
    return actionError(actionId, "invalid_scene_id", "新增场景需要填写场景名称或场景 ID。");
  }
  const name = String(body?.name || titleFromId(id));
  const summary = String(body?.summary || body?.purpose || `${name} 场景。`);
  const projectIds = listFromBody(body?.projectIds);
  const projects = await loadProjectsByIdsFromStore(commands, projectIds);

  const scene = {
    version: 1,
    id,
    templateType: "scene-template",
    name,
    summary,
    purpose: String(body?.purpose || summary),
    source: { path: `docs/scenes/${id}.md` },
    sourcePath: `docs/scenes/${id}.md`,
    projectHints: projects.map((project) => ({ id: project.id, role: "primary" })),
    projects: projects.map((project) => ({ id: project.id, name: project.name, summary: project.summary })),
    ruleHints: [],
    rules: []
  };

  const changedPaths = [];
  await commands.writeSceneTemplate(scene);
  await writeRootText(rootPath, `docs/scenes/${id}.md`, buildSceneDoc(scene));
  changedPaths.push("data/devflow.db", `docs/scenes/${id}.md`);

  for (const project of projects) {
    project.scenes = project.scenes || [];
    upsertById(project.scenes, { id, name, summary, sourcePath: `docs/scenes/${id}.md` });
    await commands.writeProject(project);
  }

  return actionOk(actionId, `新增场景 ${name}，已挂载 ${projects.length} 个项目。`, changedPaths);
}

export async function deleteScene({ rootPath, actionId, body }) {
  const commands = await actionCommands(rootPath);
  const id = normalizeId(body?.sceneId || body?.id || body?.name);
  if (!id) return actionError(actionId, "invalid_scene_id", "删除场景需要填写 sceneId。");

  const scene = await commands.getSceneTemplate(id);
  if (!scene) return actionError(actionId, "unknown_scene", `Unknown sceneId: ${id}`);

  const changedPaths = [];
  const docPath = scene?.sourcePath || scene?.source?.path || `docs/scenes/${id}.md`;

  await commands.deleteSceneTemplate(id);
  changedPaths.push("data/devflow.db");
  changedPaths.push(...await removeRootPaths(rootPath, [docPath]));

  await removeSceneFromProjectsInStore(commands, id);

  for (const rule of await commands.listRules()) {
    const nextSceneIds = removeValue(rule.sceneIds || [], id);
    if (nextSceneIds.length !== (rule.sceneIds || []).length) {
      await commands.writeRule({ ...rule, sceneIds: nextSceneIds });
    }
  }

  await removeRuntimeReferencesFromStore(commands, { sceneId: id });
  return actionOk(actionId, `删除场景 ${id}。`, changedPaths);
}
