import { buildGraph } from "./queries/graph-query.mjs";
import { GROUPS } from "./panel-graph/grouping.mjs";
import {
  addEdge,
  addMissingReferenceWarnings,
  addNode,
  addQueryNode,
  addTaskGateNodes,
  addWorksetNodes,
  buildDetails,
  materializeMissingReferenceNodes
} from "./panel-graph/node-builder.mjs";
import { addArtifactNodes, readGateCatalog, readProfileNode } from "./panel-graph/artifact-resolver.mjs";
import { toPath } from "./paths.mjs";

const HIDDEN_FRAMEWORK_NODE_IDS = new Set([
  "project:devflow",
  "skill:devflow",
  "skill:devflow-init"
]);

export async function buildPanelGraph(repository, { rootDir = process.cwd() } = {}) {
  const rootPath = toPath(rootDir);
  const [queryGraph, activeTask, profile, gateCatalog] = await Promise.all([
    buildGraph(repository),
    repository.getActiveTask(),
    readProfileNode(rootPath),
    readGateCatalog(rootPath)
  ]);

  const graph = {
    nodes: [],
    edges: [],
    groups: GROUPS.map(({ id, title }) => ({ id, title })),
    warnings: [],
    detailsById: {}
  };

  addNode(graph, {
    id: "root:context-index",
    type: "root",
    title: "上下文索引",
    summary: "Project, scene-template, skill, rule, profile, task, and Workset index",
    status: "ok"
  });
  for (const group of GROUPS) {
    addNode(graph, { ...group, status: "ok" });
    addEdge(graph, "root:context-index", group.id, "contains", "system");
  }

  for (const node of queryGraph.nodes || []) {
    if (isHiddenFrameworkNode(node.id)) continue;
    addQueryNode(graph, node, activeTask?.id);
  }
  for (const edge of queryGraph.edges || []) {
    if (isHiddenFrameworkNode(edge.from) || isHiddenFrameworkNode(edge.to)) continue;
    addEdge(graph, edge.from, edge.to, edge.relation, edge.source || "repository");
  }

  addWorksetNodes(graph);
  addTaskGateNodes(graph, gateCatalog);
  await addArtifactNodes(graph, rootPath, gateCatalog);
  pruneHiddenFrameworkReferences(graph);
  materializeMissingReferenceNodes(graph);
  pruneHiddenFrameworkReferences(graph);
  if (profile) {
    addNode(graph, profile);
  }

  addMissingReferenceWarnings(graph);
  buildDetails(graph);
  return graph;
}

function isHiddenFrameworkNode(nodeId) {
  return HIDDEN_FRAMEWORK_NODE_IDS.has(nodeId);
}

function pruneHiddenFrameworkReferences(graph) {
  graph.nodes = graph.nodes.filter((node) => !isHiddenFrameworkNode(node.id));
  graph.edges = graph.edges.filter((edge) => !isHiddenFrameworkNode(edge.from) && !isHiddenFrameworkNode(edge.to));
}

export function getPanelNodeDetails(graph, nodeId) {
  return graph.detailsById?.[nodeId] || null;
}
