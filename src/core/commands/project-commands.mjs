import { normalizeCommandResult } from "../contracts/devflow-types.mjs";

export async function addProject(repository, input = {}) {
  const project = {
    id: input.projectId,
    name: input.name || input.projectId,
    technologyFamilyId: input.technologyFamilyId || "",
    path: input.projectPath || input.path || ".",
    products: normalizeStringList(input.products),
    domains: normalizeStringList(input.domains),
    role: normalizeString(input.role),
    components: normalizeComponents(input.components)
  };

  if (input.dryRun) {
    const existing = project.id && typeof repository.getProject === "function"
      ? await repository.getProject(project.id)
      : null;
    return {
      ...normalizeCommandResult({
        status: "noop",
        action: "addProject",
        entityType: "project",
        entityId: project.id,
        message: "Dry run only. SQLite was not changed.",
        paths: []
      }),
      project,
      before: existing,
      willWrite: JSON.stringify(existing) !== JSON.stringify(project)
    };
  }

  await repository.writeProject(project);

  return normalizeCommandResult({
    status: "ok",
    action: "addProject",
    entityType: "project",
    entityId: project.id,
    message: `Added project ${project.id}.`,
    paths: []
  });
}

function normalizeStringList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value))
    .filter(Boolean))];
}

function normalizeComponents(values) {
  const components = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const component = {
      name: normalizeString(value?.name),
      purpose: normalizeString(value?.purpose),
      path: normalizeString(value?.path)
    };
    if (!component.name || !component.path) continue;
    const key = `${component.name}\0${component.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    components.push(component);
  }
  return components;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}
