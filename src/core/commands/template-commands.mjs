import { normalizeCommandResult, normalizeSceneTemplate } from "../contracts/devflow-types.mjs";

export async function addSceneTemplate(repository, input = {}) {
  const sceneTemplate = normalizeSceneTemplate({
    id: input.templateId || input.id,
    name: input.name,
    summary: input.summary,
    capabilityIds: input.capabilityIds,
    projectHints: input.projectHints,
    skillHints: input.skillHints,
    ruleHints: input.ruleHints,
    sourcePath: input.sourcePath
  });

  await repository.writeSceneTemplate(sceneTemplate);

  return normalizeCommandResult({
    status: "ok",
    action: "addSceneTemplate",
    entityType: "sceneTemplate",
    entityId: sceneTemplate.id,
    message: `Added scene template ${sceneTemplate.id}.`,
    paths: []
  });
}
