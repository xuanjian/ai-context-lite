import { GROUP_BY_TYPE } from "./grouping.mjs";

export function addQueryNode(graph, node, activeTaskId) {
  const raw = node.type === "task" ? normalizeTaskRaw(node.raw || {}) : (node.raw || {});
  const status = statusForNode({ ...node, raw }, activeTaskId);
  const metadata = metadataForNode(node.type, raw);
  const panelNode = {
    id: node.id,
    type: node.type,
    title: node.title || raw.name || raw.title || raw.id || node.id,
    summary: raw.summary || raw.description || raw.trigger || raw.note || "",
    sourcePath: sourcePathForNode(node),
    docPath: raw.doc?.path || raw.sourcePath || "",
    status,
    ...(metadata ? { metadata } : {}),
    raw: node.type === "task" ? { ...raw, isActive: raw.id === activeTaskId } : raw
  };
  addNode(graph, panelNode);

  const groupId = GROUP_BY_TYPE[node.type];
  if (groupId) {
    addEdge(graph, groupId, node.id, "contains", "repository");
  }
}

export function metadataForNode(type, raw = {}) {
  if (type !== "project") {
    return null;
  }
  return {
    products: normalizeStringList(raw.products),
    domains: normalizeStringList(raw.domains),
    role: normalizeString(raw.role)
  };
}

function normalizeStringList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value))
    .filter(Boolean))];
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

export function normalizeTaskRaw(task) {
  const workset = task.workset || null;
  const sceneTemplateId = task.sceneTemplateId || task.sceneTemplateIds?.[0] || task.sceneIds?.[0] || workset?.sceneTemplateId || "";
  const projectIds = task.projectIds?.length
    ? task.projectIds
    : (workset?.projects || []).map((project) => project.id).filter(Boolean);
  const sceneIds = task.sceneIds?.length ? task.sceneIds : (sceneTemplateId ? [sceneTemplateId] : []);

  return {
    ...task,
    currentGate: task.currentGate || task.gate || "",
    taskLevel: task.taskLevel || task.level || "",
    level: task.level || task.taskLevel || "",
    projectIds,
    sceneIds,
    sceneTemplateIds: task.sceneTemplateIds?.length ? task.sceneTemplateIds : sceneIds
  };
}

export function sourcePathForNode(node) {
  const raw = node.raw || {};
  if (raw.sourcePath || raw.path || raw.taskPath || raw.paths?.handoff) {
    return raw.sourcePath || raw.path || raw.taskPath || raw.paths?.handoff;
  }
  if (node.type === "task" && raw.id) {
    return `runtime/tasks/${raw.id}/handoff.md`;
  }
  return "";
}

export function addWorksetNodes(graph) {
  const taskNodes = graph.nodes.filter((node) => node.type === "task");
  for (const task of taskNodes) {
    const workset = task.raw?.workset;
    if (!workset?.id) continue;
    const worksetNodeId = `workset:${workset.id}`;
    addNode(graph, {
      id: worksetNodeId,
      type: "workset",
      title: workset.id,
      summary: workset.reason || workset.sourceText || "",
      status: "ok",
      raw: workset
    });
    addEdge(graph, task.id, worksetNodeId, "has-workset", "repository");
    if (workset.sceneTemplateId) {
      addEdge(graph, worksetNodeId, `sceneTemplate:${workset.sceneTemplateId}`, "loads-scene-template", "workset");
    }
    for (const project of workset.projects || []) {
      addEdge(graph, worksetNodeId, `project:${project.id}`, "loads-project", "workset");
    }
    for (const skill of workset.skills || []) {
      addEdge(graph, worksetNodeId, `skill:${skill.id}`, "loads-skill", "workset");
    }
    for (const rule of workset.rules || []) {
      addEdge(graph, worksetNodeId, `rule:${rule.id}`, "loads-rule", "workset");
    }
  }
}

export function addTaskGateNodes(graph, gateCatalog) {
  const taskNodes = graph.nodes.filter((node) => node.type === "task");
  for (const task of taskNodes) {
    for (const gate of gatesForTask(task.raw, gateCatalog)) {
      const gateNodeId = `gate:${task.raw.id || task.id.slice("task:".length)}:${gate.id}`;
      addNode(graph, {
        id: gateNodeId,
        type: "gate",
        title: `${gate.id} ${gate.name || ""}`.trim(),
        summary: gate.purpose || gate.summary || "",
        sourcePath: task.sourcePath,
        status: statusForGate(gate.status),
        raw: { ...gate, taskId: task.raw.id }
      });
      addEdge(graph, task.id, gateNodeId, "has-gate", task.sourcePath || "repository");
    }
  }
}


export function ensureTaskGateNode(graph, task, gateId, gateCatalog) {
  if (!gateId) return null;
  const taskId = task.raw?.id || task.id.slice("task:".length);
  const gateNodeId = `gate:${taskId}:${gateId}`;
  const existing = graph.nodes.find((node) => node.id === gateNodeId);
  if (existing) return existing;
  const catalogGate = gateCatalog.find((gate) => gate.id === gateId) || { id: gateId, name: gateId };
  const gateNode = addNode(graph, {
    id: gateNodeId,
    type: "gate",
    title: `${catalogGate.id} ${catalogGate.name || ""}`.trim(),
    summary: catalogGate.purpose || catalogGate.summary || "",
    sourcePath: task.sourcePath,
    status: "unknown",
    raw: { ...catalogGate, taskId }
  });
  addEdge(graph, task.id, gateNode.id, "has-gate", task.sourcePath || "repository");
  return gateNode;
}


export function gatesForTask(task, gateCatalog) {
  if (task?.gates?.length) {
    return task.gates;
  }
  if (!task?.currentGate && !task?.gate) {
    return [];
  }
  const currentGate = task.currentGate || task.gate;
  return gateCatalog.map((gate) => ({
    ...gate,
    status: statusForDefaultGate(gate.id, currentGate)
  }));
}

export function statusForDefaultGate(gateId, currentGate) {
  const gateNumber = Number(String(gateId).replace(/^G/i, ""));
  const currentNumber = Number(String(currentGate).replace(/^G/i, ""));
  if (!gateNumber || !currentNumber) return "";
  if (gateNumber < currentNumber) return "done";
  if (gateNumber === currentNumber) return "in_progress";
  return "";
}

export function materializeMissingReferenceNodes(graph) {
  let changed = false;
  do {
    changed = false;
    const known = new Set(graph.nodes.map((node) => node.id));
    for (const edge of graph.edges) {
      for (const nodeId of [edge.from, edge.to]) {
        if (known.has(nodeId)) continue;
        const placeholder = placeholderNodeFor(nodeId, edge.source);
        if (!placeholder) continue;
        addNode(graph, placeholder);
        const groupId = GROUP_BY_TYPE[placeholder.type];
        if (groupId) {
          addEdge(graph, groupId, nodeId, "contains", placeholder.sourcePath || "placeholder");
        }
        addWarning(graph, "placeholder_reference", `Reference has no indexed metadata: ${nodeId}`, placeholder.sourcePath, nodeId);
        changed = true;
      }
    }
  } while (changed);
}

export function placeholderNodeFor(nodeId, sourcePath) {
  const [type, ...rest] = String(nodeId).split(":");
  const id = rest.join(":");
  if (!id || !["project", "sceneTemplate", "skill", "rule"].includes(type)) {
    return null;
  }
  return {
    id: nodeId,
    type,
    title: id,
    summary: "Referenced by migrated task or Workset; metadata is not present in the SQLite index.",
    sourcePath: sourcePath || "repository",
    status: "warning",
    raw: { id, placeholder: true }
  };
}


export function addNode(graph, node) {
  const existing = graph.nodes.find((item) => item.id === node.id);
  if (existing) {
    Object.assign(existing, { ...node, status: mergeStatus(existing.status, node.status) });
    return existing;
  }
  graph.nodes.push({ status: "unknown", summary: "", ...node });
  return node;
}

export function addEdge(graph, from, to, relation, source) {
  if (!from || !to || graph.edges.some((edge) => edge.from === from && edge.to === to && edge.relation === relation)) {
    return;
  }
  graph.edges.push({ from, to, relation, source });
}

export function addWarning(graph, code, message, sourcePath, nodeId) {
  graph.warnings.push({ code, message, sourcePath, nodeId });
}

export function addMissingReferenceWarnings(graph) {
  const known = new Set(graph.nodes.map((node) => node.id));
  for (const edge of graph.edges) {
    if (!known.has(edge.from)) {
      addWarning(graph, "missing_graph_reference", `Missing graph node referenced by edge: ${edge.from}`, edge.source);
    }
    if (!known.has(edge.to)) {
      addWarning(graph, "missing_graph_reference", `Missing graph node referenced by edge: ${edge.to}`, edge.source);
    }
  }
}

export function buildDetails(graph) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    const relatedIds = new Set();
    for (const edge of graph.edges) {
      if (edge.from === node.id) relatedIds.add(edge.to);
      if (edge.to === node.id) relatedIds.add(edge.from);
    }
    const relatedNodes = [...relatedIds].map((id) => nodesById.get(id)).filter(Boolean);
    graph.detailsById[node.id] = {
      node,
      documentationSummary: node.documentationSummary || "",
      related: {
        projects: relatedNodes.filter((item) => item.type === "project"),
        scenes: relatedNodes.filter((item) => item.type === "sceneTemplate"),
        sceneTemplates: relatedNodes.filter((item) => item.type === "sceneTemplate"),
        skills: relatedNodes.filter((item) => item.type === "skill"),
        rules: relatedNodes.filter((item) => item.type === "rule"),
        gates: relatedNodes.filter((item) => item.type === "gate"),
        profiles: relatedNodes.filter((item) => item.type === "profile"),
        tasks: relatedNodes.filter((item) => item.type === "task"),
        worksets: relatedNodes.filter((item) => item.type === "workset"),
        artifacts: relatedNodes.filter((item) => item.type === "artifact")
      },
      warnings: graph.warnings.filter((warning) => warning.nodeId === node.id || warning.sourcePath === node.sourcePath || warning.sourcePath === node.docPath),
      actions: []
    };
  }
}

export function statusForNode(node, activeTaskId) {
  if (node.type === "task") {
    if (node.raw?.status === "blocked") return "warning";
    if (node.raw?.status === "failed") return "missing";
    return node.raw?.id === activeTaskId ? "warning" : "ok";
  }
  if (node.raw?.sourceExists === false) return "warning";
  return node.status || "ok";
}

export function statusForGate(status) {
  if (status === "done") return "ok";
  if (status === "blocked") return "warning";
  if (status === "failed") return "missing";
  return status ? "warning" : "unknown";
}

export function mergeStatus(left, right) {
  const order = { missing: 3, warning: 2, unknown: 1, ok: 0, pass: 0 };
  return (order[right] || 0) > (order[left] || 0) ? right : left;
}
