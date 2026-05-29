import { normalizeTaskSpec } from "../task-spec.mjs";

export async function queryCurrent(repository) {
  const task = await repository.getActiveTask();
  if (!task) {
    return {
      type: "current",
      task: null,
      workset: null,
      nextAction: "",
      recoveryPoint: ""
    };
  }

  const worksetId = task.workset?.id || task.worksetId || task.id;
  const workset = task.workset || await repository.getWorkset(worksetId);
  const currentTask = {
    ...task,
    spec: normalizeTaskSpec(task.spec)
  };
  return {
    type: "current",
    task: currentTask,
    workset,
    nextAction: task.nextAction || "",
    recoveryPoint: task.recoveryPoint || ""
  };
}

export async function querySkills(repository, { projectId, templateId, worksetId } = {}) {
  const skills = await repository.listSkills();
  const workset = await resolveWorkset(repository, worksetId);
  const relatedItemIds = await resolveRelatedItemIds(repository, { projectId, templateId, workset }, "skills");
  return {
    type: "skills",
    skills: filterContextItems(skills, { projectId, templateId, worksetId, workset, relatedItemIds, itemType: "skills" })
  };
}

export async function queryRules(repository, { projectId, templateId, worksetId } = {}) {
  const rules = await repository.listRules();
  const workset = await resolveWorkset(repository, worksetId);
  const relatedItemIds = await resolveRelatedItemIds(repository, { projectId, templateId, workset }, "rules");
  return {
    type: "rules",
    rules: filterContextItems(rules, { projectId, templateId, worksetId, workset, relatedItemIds, itemType: "rules" })
  };
}

async function resolveWorkset(repository, worksetId) {
  if (!worksetId) {
    return null;
  }

  const directWorkset = await repository.getWorkset(worksetId);
  if (directWorkset) {
    return directWorkset;
  }

  const task = await repository.getTask(worksetId);
  return task?.workset || null;
}

async function resolveRelatedItemIds(repository, { projectId, templateId, workset }, itemType) {
  const ids = new Set((workset?.[itemType] || []).map((item) => item.id).filter(Boolean));

  for (const id of [projectId, ...(workset?.projects || []).map((project) => project.id)].filter(Boolean)) {
    for (const item of await listProjectItems(repository, id, itemType)) {
      if (item?.id) ids.add(item.id);
    }
  }

  const sceneTemplateId = templateId || workset?.sceneTemplateId;
  if (sceneTemplateId) {
    for (const item of await listSceneTemplateItems(repository, sceneTemplateId, itemType)) {
      if (item?.id) ids.add(item.id);
    }
  }

  return ids;
}

async function listProjectItems(repository, projectId, itemType) {
  const methodName = itemType === "skills" ? "listSkillsForProject" : "listRulesForProject";
  if (typeof repository[methodName] === "function") {
    return repository[methodName](projectId);
  }
  const project = await repository.getProject(projectId);
  return project?.[itemType] || [];
}

async function listSceneTemplateItems(repository, sceneTemplateId, itemType) {
  const methodName = itemType === "skills" ? "listSkillsForSceneTemplate" : "listRulesForSceneTemplate";
  if (typeof repository[methodName] === "function") {
    return repository[methodName](sceneTemplateId);
  }
  const sceneTemplate = await repository.getSceneTemplate(sceneTemplateId);
  const hintKey = itemType === "skills" ? "skillHints" : "ruleHints";
  return sceneTemplate?.[hintKey] || [];
}

function filterContextItems(items, { projectId, templateId, worksetId, workset, relatedItemIds, itemType }) {
  if (!projectId && !templateId && !worksetId) {
    return items;
  }

  const worksetProjectIds = new Set((workset?.projects || []).map((project) => project.id).filter(Boolean));
  const worksetItemIds = new Set((workset?.[itemType] || []).map((item) => item.id).filter(Boolean));
  const effectiveTemplateId = templateId || workset?.sceneTemplateId;
  const effectiveProjectIds = new Set([projectId, ...worksetProjectIds].filter(Boolean));

  return items.filter((item) => {
    if (itemType === "skills" && item.scope === "global") {
      return true;
    }
    if (relatedItemIds?.has(item.id)) {
      return true;
    }
    if (worksetItemIds.has(item.id)) {
      return true;
    }
    if (worksetId && includesValue(item.worksetIds, worksetId)) {
      return true;
    }
    if (effectiveTemplateId && (
      includesValue(item.templateIds, effectiveTemplateId)
      || includesValue(item.sceneTemplateIds, effectiveTemplateId)
      || includesValue(item.sceneIds, effectiveTemplateId)
      || item.templateId === effectiveTemplateId
      || item.sceneTemplateId === effectiveTemplateId
      || item.sceneId === effectiveTemplateId
    )) {
      return true;
    }
    for (const id of effectiveProjectIds) {
      if (
        includesValue(item.projectIds, id)
        || includesObjectId(item.projects, id)
        || item.projectId === id
      ) {
        return true;
      }
    }
    return false;
  });
}

function includesValue(values, expected) {
  return Array.isArray(values) && values.includes(expected);
}

function includesObjectId(values, expected) {
  return Array.isArray(values) && values.some((value) => value?.id === expected);
}
