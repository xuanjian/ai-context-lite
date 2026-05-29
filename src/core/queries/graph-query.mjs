export async function buildGraph(repository) {
  const [projects, sceneTemplates, skills, rules, tasks, edges] = await Promise.all([
    repository.listProjects(),
    repository.listSceneTemplates(),
    repository.listSkills(),
    repository.listRules(),
    repository.listTasks(),
    repository.listGraphEdges()
  ]);

  return {
    type: "graph",
    nodes: [
      ...projects.map((project) => toNode("project", project)),
      ...sceneTemplates.map((sceneTemplate) => toNode("sceneTemplate", sceneTemplate)),
      ...skills.map((skill) => toNode("skill", skill)),
      ...rules.map((rule) => toNode("rule", rule)),
      ...tasks.map((task) => toNode("task", task))
    ],
    edges
  };
}

function toNode(type, entity) {
  return {
    id: `${type}:${entity.id}`,
    type,
    title: entity.name || entity.title || entity.id,
    raw: entity
  };
}
