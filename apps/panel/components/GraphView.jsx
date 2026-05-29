import { useEffect, useMemo, useRef, useState } from "react";
import { labelForType, titleForNode } from "../labels.js";

const GRAPH_TOP_SAFE_SPACE = 86;
const NODE_BOX_HALF_HEIGHT = 58;
const NODE_BOX_HEIGHT = 116;
const NODE_BOX_WIDTH = 190;
const FORCE_VIEWPORT = { width: 2200, height: 1500 };
const RELATION_LEGEND_ITEMS = [
  { relation: "chain", label: "chain" },
  { relation: "depends-on", label: "depends-on" },
  { relation: "calls", label: "calls" }
];

export default function GraphView({ graph, selectedNodeId, onSelectNode }) {
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [pinnedPositions, setPinnedPositions] = useState({});
  const [animatedPositions, setAnimatedPositions] = useState(new Map());
  const allNodes = graph.nodes || [];
  const projectNodes = useMemo(() => allNodes.filter((node) => node.type === "project").sort(compareNodesByTitle), [allNodes]);
  const projectGraph = useMemo(() => buildProjectGraph(graph, selectedProjectId), [graph, selectedProjectId]);
  const nodes = projectGraph.nodes;
  const seedPositions = useMemo(() => mergePinnedPositions(layoutNodes(nodes), pinnedPositions), [nodes, pinnedPositions]);
  const positions = useMemo(() => mergeVisiblePositions(seedPositions, animatedPositions, nodes), [animatedPositions, nodes, seedPositions]);
  const viewport = getGraphViewport(positions);
  const visibleEdges = projectGraph.edges;
  const activeFocusId = selectedProjectId || selectedNodeId;
  const highlightedNodeIds = getHighlightedNodeIds(visibleEdges, activeFocusId);
  const nodeLayoutKey = nodes.map((node) => node.id).join("|");
  const viewportRef = useRef(null);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const nodeDragRef = useRef(null);
  const suppressClickRef = useRef("");
  const hasCenteredRef = useRef(false);
  const hasSettledCenteredRef = useRef(false);
  const animationFrameRef = useRef(0);
  const simulationRef = useRef({ nodes: new Map(), settled: false });

  useEffect(() => {
    if (selectedProjectId && !projectNodes.some((node) => node.id === selectedProjectId)) {
      setSelectedProjectId("");
    }
  }, [projectNodes, selectedProjectId]);

  useEffect(() => {
    hasCenteredRef.current = false;
    hasSettledCenteredRef.current = false;
  }, [nodeLayoutKey, selectedProjectId]);

  useEffect(() => {
    const visibleIds = new Set(nodes.map((node) => node.id));
    setPinnedPositions((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => visibleIds.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [nodes]);

  useEffect(() => {
    simulationRef.current = initializeSimulation({
      current: simulationRef.current,
      edges: visibleEdges,
      nodes,
      pinnedPositions,
      seedPositions
    });
    setAnimatedPositions(snapshotSimulationPositions(simulationRef.current.nodes));
    let lastTime = performance.now();

    function tick(now) {
      const delta = Math.min(32, now - lastTime);
      lastTime = now;
      const moving = stepSimulation(simulationRef.current, visibleEdges, pinnedPositions, delta);
      setAnimatedPositions(snapshotSimulationPositions(simulationRef.current.nodes));
      if (moving || nodeDragRef.current) {
        animationFrameRef.current = requestAnimationFrame(tick);
      } else {
        simulationRef.current.settled = true;
        centerSettledGraph();
      }
    }

    function centerSettledGraph() {
      if (hasSettledCenteredRef.current || nodeDragRef.current) {
        return;
      }
      const element = viewportRef.current;
      if (!element) {
        return;
      }
      hasSettledCenteredRef.current = true;
      const settledPositions = snapshotSimulationPositions(simulationRef.current.nodes);
      centerGraphCanvas(element, getGraphViewport(settledPositions), settledPositions);
    }

    cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [nodes, pinnedPositions, seedPositions, visibleEdges]);

  useEffect(() => {
    if (hasCenteredRef.current) {
      return;
    }
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    hasCenteredRef.current = true;
    requestAnimationFrame(() => {
      centerGraphCanvas(element, viewport, positions);
    });
  }, [positions, selectedProjectId, viewport.height, viewport.width]);

  function handleMouseDown(event) {
    if (event.button !== 0 || event.target.closest(".graph-node")) {
      return;
    }
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop
    };
    element.classList.add("is-dragging");
  }

  function handleMouseMove(event) {
    const nodeDrag = nodeDragRef.current;
    if (nodeDrag) {
      const point = eventPointInSvg(event, svgRef.current, viewport);
      if (!point) {
        return;
      }
      const x = clamp(point.x - nodeDrag.offsetX, 80, viewport.width - 80);
      const y = clamp(point.y - nodeDrag.offsetY, GRAPH_TOP_SAFE_SPACE + NODE_BOX_HALF_HEIGHT, viewport.height - 80);
      nodeDrag.moved = nodeDrag.moved || Math.hypot(x - nodeDrag.startX, y - nodeDrag.startY) > 3;
      setPinnedPositions((current) => ({
        ...current,
        [nodeDrag.nodeId]: { x: Math.round(x), y: Math.round(y) }
      }));
      return;
    }

    const drag = dragRef.current;
    const element = viewportRef.current;
    if (!drag || !element) {
      return;
    }
    element.scrollLeft = drag.scrollLeft - (event.clientX - drag.x);
    element.scrollTop = drag.scrollTop - (event.clientY - drag.y);
  }

  function stopDrag() {
    if (nodeDragRef.current?.moved) {
      suppressClickRef.current = nodeDragRef.current.nodeId;
      setTimeout(() => {
        suppressClickRef.current = "";
      }, 0);
    }
    nodeDragRef.current = null;
    dragRef.current = null;
    viewportRef.current?.classList.remove("is-dragging");
  }

  function startNodeDrag(event, nodeId) {
    if (event.button !== 0) {
      return;
    }
    const point = positions.get(nodeId);
    const eventPoint = eventPointInSvg(event, svgRef.current, viewport);
    if (!point || !eventPoint) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    nodeDragRef.current = {
      nodeId,
      offsetX: eventPoint.x - point.x,
      offsetY: eventPoint.y - point.y,
      startX: point.x,
      startY: point.y,
      moved: false
    };
  }

  function selectNode(nodeId) {
    if (suppressClickRef.current === nodeId) {
      return;
    }
    onSelectNode(nodeId);
  }

  function selectProject(projectId) {
    setSelectedProjectId(projectId);
    onSelectNode(projectId);
  }

  return (
    <section className="graph-view" aria-label="上下文关系图">
      <aside className="graph-project-rail" aria-label="项目列表">
        <div className="project-rail-header">
          <strong>项目列表</strong>
          <span>{projectNodes.length} 个</span>
        </div>
        <button
          className={!selectedProjectId ? "active" : ""}
          onClick={() => selectProject("")}
          type="button"
        >
          全部项目
        </button>
        <div className="project-rail-list">
          {projectNodes.map((project) => (
            <button
              aria-label={`筛选项目 ${titleForNode(project)}`}
              className={selectedProjectId === project.id ? "active" : ""}
              key={project.id}
              onClick={() => selectProject(project.id)}
              type="button"
            >
              <span className="project-rail-dot" aria-hidden="true" />
              <span>{titleForNode(project)}</span>
            </button>
          ))}
        </div>
      </aside>
      <div
        className="graph-canvas"
        onMouseDown={handleMouseDown}
        onMouseLeave={stopDrag}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrag}
        ref={viewportRef}
      >
        <div className="graph-toolbar">
          <div className="graph-toolbar-copy">
            <strong>{selectedProjectId ? "项目关系" : selectedNodeId ? "聚焦关系" : "全局关系"}</strong>
            <span>{selectedProjectId ? "只显示当前项目的直接业务关联" : selectedNodeId ? "已突出当前节点的直接业务关联" : "拖拽画布查看全局关系；选择节点后聚焦相邻关系"}</span>
          </div>
          <RelationLegend />
        </div>
        <svg
          height={viewport.height}
          viewBox={`0 0 ${viewport.width} ${viewport.height}`}
          width={viewport.width}
          role="img"
          aria-label="DevFlow 上下文关系图"
          ref={svgRef}
        >
          {visibleEdges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            const fromAnchor = edgeAnchorPoint(from);
            const toAnchor = edgeAnchorPoint(to);
            return (
              <line
                className={`graph-edge ${edgeClassName(edge, selectedProjectId || selectedNodeId)}`}
                data-testid={`edge-${edge.from}-${edge.to}-${edge.relation}`}
                key={`${edge.from}-${edge.to}-${edge.relation}`}
                x1={fromAnchor.x}
                y1={fromAnchor.y}
                x2={toAnchor.x}
                y2={toAnchor.y}
              />
            );
          })}
          {nodes.map((node) => {
            const point = positions.get(node.id);
            const metadataTags = metadataTagsForNode(node);
            return (
              <foreignObject className="graph-node-shell" height={NODE_BOX_HEIGHT} key={node.id} width={NODE_BOX_WIDTH} x={point.x - NODE_BOX_WIDTH / 2} y={point.y - NODE_BOX_HALF_HEIGHT}>
                <button
                  aria-label={`${titleForNode(node)} ${labelForType(node.type)}`}
                  className={`graph-node node-${node.type} status-${node.status} ${activeFocusId === node.id ? "selected" : ""} ${highlightedNodeIds.has(node.id) ? "highlighted" : ""} ${activeFocusId && !highlightedNodeIds.has(node.id) ? "dimmed" : ""}`}
                  data-testid={`graph-node-${node.id}`}
                  onClick={() => selectNode(node.id)}
                  onMouseDown={(event) => startNodeDrag(event, node.id)}
                  type="button"
                >
                  <span className="node-dot" aria-hidden="true" />
                  <span className="node-copy">{titleForNode(node)}</span>
                  {metadataTags.length ? (
                    <span className="node-metadata-tags" aria-label="项目 metadata">
                      {metadataTags.map((tag) => (
                        <span className={`node-metadata-chip ${tag.kind}`} key={`${tag.kind}:${tag.value}`}>{tag.value}</span>
                      ))}
                    </span>
                  ) : null}
                </button>
              </foreignObject>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

function RelationLegend() {
  return (
    <div className="graph-relation-legend" aria-label="relation legend">
      <span>relation</span>
      {RELATION_LEGEND_ITEMS.map((item) => (
        <i className={`relation-legend-item relation-${item.relation}`} key={item.relation}>
          <b aria-hidden="true" />
          {item.label}
        </i>
      ))}
    </div>
  );
}

function initializeSimulation({ current, edges, nodes, pinnedPositions, seedPositions }) {
  const nextNodes = new Map();
  for (const node of nodes) {
    const existing = current.nodes.get(node.id);
    const seeded = seedPositions.get(node.id) || { x: FORCE_VIEWPORT.width / 2, y: FORCE_VIEWPORT.height / 2 };
    const pinned = pinnedPositions[node.id];
    nextNodes.set(node.id, {
      id: node.id,
      type: node.type,
      x: pinned?.x ?? existing?.x ?? seeded.x,
      y: pinned?.y ?? existing?.y ?? seeded.y,
      vx: existing?.vx ?? 0,
      vy: existing?.vy ?? 0
    });
  }
  const degree = new Map();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  }
  for (const node of nextNodes.values()) {
    node.degree = degree.get(node.id) || 0;
  }
  return { nodes: nextNodes, settled: false };
}

function stepSimulation(simulation, edges, pinnedPositions, delta) {
  const nodes = [...simulation.nodes.values()];
  if (!nodes.length) return false;
  const pinnedIds = new Set(Object.keys(pinnedPositions));
  const alpha = Math.min(1.2, Math.max(0.35, delta / 16));
  const center = { x: FORCE_VIEWPORT.width / 2, y: FORCE_VIEWPORT.height / 2 + GRAPH_TOP_SAFE_SPACE / 2 };
  let totalVelocity = 0;

  for (let index = 0; index < nodes.length; index += 1) {
    const left = nodes[index];
    for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
      const right = nodes[nextIndex];
      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distanceSq = dx * dx + dy * dy;
      if (distanceSq < 1) {
        dx = deterministicJitter(left.id, right.id);
        dy = deterministicJitter(right.id, left.id);
        distanceSq = dx * dx + dy * dy;
      }
      const distance = Math.sqrt(distanceSq);
      const strength = Math.min(22, 11000 / distanceSq) * alpha;
      const fx = (dx / distance) * strength;
      const fy = (dy / distance) * strength;
      if (!pinnedIds.has(left.id)) {
        left.vx -= fx;
        left.vy -= fy;
      }
      if (!pinnedIds.has(right.id)) {
        right.vx += fx;
        right.vy += fy;
      }
    }
  }

  for (const edge of edges) {
    const from = simulation.nodes.get(edge.from);
    const to = simulation.nodes.get(edge.to);
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const desired = desiredEdgeDistance(from, to, edge);
    const force = (distance - desired) * 0.012 * alpha;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    if (!pinnedIds.has(from.id)) {
      from.vx += fx;
      from.vy += fy;
    }
    if (!pinnedIds.has(to.id)) {
      to.vx -= fx;
      to.vy -= fy;
    }
  }

  for (const node of nodes) {
    if (pinnedPositions[node.id]) {
      node.x = pinnedPositions[node.id].x;
      node.y = pinnedPositions[node.id].y;
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    const gravity = node.type === "group" || node.type === "root" ? 0.010 : 0.004;
    node.vx += (center.x - node.x) * gravity * alpha;
    node.vy += (center.y - node.y) * gravity * alpha;
    node.vx *= 0.86;
    node.vy *= 0.86;
    node.x = clamp(node.x + node.vx * alpha, 90, FORCE_VIEWPORT.width - 90);
    node.y = clamp(node.y + node.vy * alpha, GRAPH_TOP_SAFE_SPACE + 48, FORCE_VIEWPORT.height - 90);
    totalVelocity += Math.abs(node.vx) + Math.abs(node.vy);
  }

  return totalVelocity / nodes.length > 0.035;
}

function desiredEdgeDistance(from, to, edge) {
  if (edge.relation === "contains") return 180;
  if (from.type === "task" || to.type === "task") return 250;
  if (from.type === "artifact" || to.type === "artifact") return 210;
  if (from.type === "workset" || to.type === "workset") return 235;
  return 190 + Math.min(80, (from.degree + to.degree) * 4);
}

function deterministicJitter(leftId, rightId) {
  let hash = 0;
  const text = `${leftId}:${rightId}`;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return (hash % 1000) / 500 - 1;
}

function snapshotSimulationPositions(nodes) {
  const positions = new Map();
  for (const node of nodes.values()) {
    positions.set(node.id, { x: Math.round(node.x), y: Math.round(node.y) });
  }
  return positions;
}

function mergeVisiblePositions(seedPositions, animatedPositions, nodes) {
  const positions = new Map();
  for (const node of nodes) {
    positions.set(node.id, animatedPositions.get(node.id) || seedPositions.get(node.id) || { x: 640, y: 420 });
  }
  return positions;
}

function buildProjectGraph(graph, selectedProjectId) {
  const nodes = graph.nodes || [];
  const edges = (graph.edges || []).filter((edge) => edge.relation !== "contains");
  if (!selectedProjectId) {
    return { nodes, edges };
  }

  const visibleIds = new Set([selectedProjectId]);
  const projectEdges = edges.filter((edge) => {
    const connected = edge.from === selectedProjectId || edge.to === selectedProjectId;
    if (connected) {
      visibleIds.add(edge.from);
      visibleIds.add(edge.to);
    }
    return connected;
  });

  return {
    nodes: nodes.filter((node) => visibleIds.has(node.id)),
    edges: projectEdges
  };
}

function edgeClassName(edge, selectedNodeId) {
  const relationClass = `relation-${edge.relation || "unknown"}`;
  if (!selectedNodeId) return `${relationClass} ambient-edge`;
  return `${relationClass} ${edge.from === selectedNodeId || edge.to === selectedNodeId ? "focused-edge" : "muted-edge"}`;
}

function metadataTagsForNode(node) {
  if (node.type !== "project") {
    return [];
  }
  const metadata = node.metadata || node.raw || {};
  return [
    ...toTagList(metadata.products, "product"),
    ...toTagList(metadata.domains, "domain"),
    ...toTagList(metadata.role ? [metadata.role] : [], "role")
  ];
}

function toTagList(values, kind) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => ({ kind, value }));
}

function getHighlightedNodeIds(edges, selectedNodeId) {
  const ids = new Set();
  if (selectedNodeId) ids.add(selectedNodeId);
  for (const edge of edges) {
    if (selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId)) {
      ids.add(edge.from);
      ids.add(edge.to);
    }
  }
  return ids;
}

function compareNodesByTitle(left, right) {
  return titleForNode(left).localeCompare(titleForNode(right));
}

function mergePinnedPositions(basePositions, pinnedPositions) {
  const positions = new Map(basePositions);
  for (const [nodeId, point] of Object.entries(pinnedPositions)) {
    if (positions.has(nodeId)) {
      positions.set(nodeId, point);
    }
  }
  return positions;
}

function eventPointInSvg(event, svgElement, viewport) {
  if (!svgElement) {
    return null;
  }
  const rect = svgElement.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  return {
    x: ((event.clientX - rect.left) / rect.width) * viewport.width,
    y: ((event.clientY - rect.top) / rect.height) * viewport.height
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function edgeAnchorPoint(point) {
  return {
    x: point.x,
    y: point.y - 27
  };
}

function getGraphViewport(positions) {
  const points = [...positions.values()];
  const maxX = Math.max(FORCE_VIEWPORT.width, ...points.map((point) => point.x + 160));
  const maxY = Math.max(FORCE_VIEWPORT.height, ...points.map((point) => point.y + 180));
  return {
    width: maxX,
    height: maxY
  };
}

function centerGraphCanvas(element, viewport, positions) {
  const bounds = getVisibleGraphBounds(positions);
  const centerX = bounds ? (bounds.minX + bounds.maxX) / 2 : viewport.width / 2;
  const centerY = bounds ? (bounds.minY + bounds.maxY) / 2 : viewport.height / 2;
  const maxScrollLeft = Math.max(0, viewport.width - element.clientWidth);
  const maxScrollTop = Math.max(0, viewport.height - element.clientHeight);
  element.scrollLeft = clamp(centerX - element.clientWidth / 2, 0, maxScrollLeft);
  element.scrollTop = clamp(centerY - element.clientHeight / 2, 0, maxScrollTop);
}

function getVisibleGraphBounds(positions) {
  const points = [...positions.values()];
  if (!points.length) return null;
  return {
    minX: Math.min(...points.map((point) => point.x - 120)),
    maxX: Math.max(...points.map((point) => point.x + 120)),
    minY: Math.min(...points.map((point) => point.y - GRAPH_TOP_SAFE_SPACE)),
    maxY: Math.max(...points.map((point) => point.y + 90))
  };
}

function layoutNodes(nodes) {
  const positions = new Map();
  const groups = nodes.filter((node) => node.type === "group");
  const root = nodes.find((node) => node.type === "root");
  const center = { x: 640, y: 360 + GRAPH_TOP_SAFE_SPACE };
  if (root) positions.set(root.id, center);

  groups.forEach((node, index) => {
    positions.set(node.id, { x: 310, y: 170 + GRAPH_TOP_SAFE_SPACE + index * 112 });
  });

  const graphNodes = nodes.filter((node) => node.type !== "root" && node.type !== "group");
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  graphNodes.forEach((node, index) => {
    const radius = 115 + (index % 4) * 48 + Math.floor(index / 8) * 54;
    const angle = index * goldenAngle - Math.PI / 2;
    const typeOffset = typeOffsetForNode(node.type);
    positions.set(node.id, {
      x: Math.round(center.x + Math.cos(angle) * radius + typeOffset.x),
      y: Math.round(center.y + Math.sin(angle) * radius + typeOffset.y)
    });
  });
  return normalizeTopSafeSpace(positions);
}

function normalizeTopSafeSpace(positions) {
  const minY = Math.min(...[...positions.values()].map((point) => point.y - NODE_BOX_HALF_HEIGHT));
  const topLimit = GRAPH_TOP_SAFE_SPACE;
  if (!Number.isFinite(minY) || minY >= topLimit) {
    return positions;
  }
  const offsetY = topLimit - minY;
  const normalized = new Map();
  for (const [id, point] of positions) {
    normalized.set(id, { x: point.x, y: point.y + offsetY });
  }
  return normalized;
}

function typeOffsetForNode(type) {
  const offsets = {
    project: { x: -80, y: -10 },
    sceneTemplate: { x: 54, y: -26 },
    skill: { x: -36, y: 62 },
    rule: { x: 74, y: 58 },
    workset: { x: 124, y: -28 },
    profile: { x: -110, y: -76 },
    task: { x: 116, y: -70 },
    gate: { x: 138, y: 88 }
  };
  return offsets[type] || { x: 0, y: 0 };
}
