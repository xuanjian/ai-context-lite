import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { titleForNode } from "../labels.js";

const PROJECT_MAP_VIEWPORT = { width: 760, height: 300 };
const PROJECT_MAP_CENTER = { x: 380, y: 150 };
const PROJECT_RELATIONS = new Set(["chain", "depends-on", "calls"]);
const RELATION_LEGEND_ITEMS = [
  { relation: "chain", label: "chain" },
  { relation: "depends-on", label: "depends-on" },
  { relation: "calls", label: "calls" }
];

export default function TaskBoardView({ graph, selectedNodeId, onSelectNode, onTaskAction }) {
  const [contextMenu, setContextMenu] = useState(null);
  const edges = graph.edges || [];
  const tasks = (graph.nodes || []).filter((node) => node.type === "task").sort(compareTasks);
  const selectedTaskId = resolveSelectedTaskId(tasks, edges, selectedNodeId);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || tasks[0];
  const gates = (graph.nodes || [])
    .filter((node) => node.type === "gate")
    .filter((gate) => edges.some((edge) => edge.relation === "has-gate" && edge.from === selectedTask?.id && edge.to === gate.id))
    .sort(compareGateNodes);
  const currentGate = gates.find((gate) => gate.raw?.id === selectedTask?.raw?.currentGate);
  const progress = summarizeProgress(gates, currentGate);
  const relatedProjects = resolveTaskProjects(selectedTask, graph.nodes || [], edges);
  const relatedProjectEdges = resolveProjectRelationEdges(relatedProjects, edges);

  useEffect(() => {
    if (!contextMenu) return undefined;

    function closeMenu() {
      setContextMenu(null);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenu]);

  function openTaskMenu(event, task) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      task,
      ...menuPosition(event)
    });
  }

  function runTaskAction(action) {
    const task = contextMenu?.task;
    if (!task) return;
    if (action === "delete") {
      const confirmed = window.confirm(`确认删除任务 ${titleForNode(task)} 吗？这只会删除 SQLite 任务记录，不会删除 runtime/tasks 下的 markdown。`);
      if (!confirmed) {
        setContextMenu(null);
        return;
      }
    }
    onTaskAction?.(action, task);
    setContextMenu(null);
  }

  return (
    <section className="task-board-view" aria-label="任务看板">
      <div className="task-list-panel">
        <h2>Tasks</h2>
        {!tasks.length ? <p className="empty-state">还没有 SQLite task 记录。</p> : null}
        {tasks.map((task) => (
          <button
            className={selectedTask?.id === task.id ? "active" : ""}
            key={task.id}
            onClick={() => onSelectNode(task.id)}
            onContextMenu={(event) => openTaskMenu(event, task)}
            type="button"
          >
            <span className="task-title-row">
              <strong>{titleForNode(task)}</strong>
              {task.raw?.isActive ? <em>当前</em> : null}
            </span>
            <span>{task.raw?.status || task.status} · {gateLabelForTask(task, graph.nodes, edges)}</span>
          </button>
        ))}
        <TaskContextMenu contextMenu={contextMenu} onTaskAction={runTaskAction} />
      </div>
      <div className="gate-panel">
        <header className="task-flow-header">
          <div>
            <h2>{selectedTask ? titleForNode(selectedTask) : "G1-G7"}</h2>
            <p>{selectedTask?.summary || "选择一个任务后查看它在 superpower 流程中的位置。"}</p>
          </div>
          <div className="task-flow-summary" aria-label="当前流程">
            <span>当前流程</span>
            <strong>{currentGate ? titleForNode(currentGate) : selectedTask?.raw?.currentGate || "未记录"}</strong>
            <small>{progress.label}</small>
            <div className="task-progress-bar" aria-hidden="true">
              <i style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        </header>
        <div className="gate-track">
          {gates.map((gate) => {
            const connected = edges.some((edge) => edge.from === selectedTask?.id && edge.to === gate.id);
            return (
              <button
                aria-label={`${gate.raw?.id || ""} ${gate.raw?.name || titleForNode(gate)}`.trim()}
                className={`gate-card status-${gate.status} ${selectedNodeId === gate.id ? "active" : ""}`}
                disabled={!connected}
                key={gate.id}
                onClick={() => onSelectNode(gate.id)}
                type="button"
              >
                <span>{gate.raw?.id || titleForNode(gate).split(" ")[0]}</span>
                <strong>{gate.raw?.name || titleForNode(gate)}</strong>
                <small>{gate.raw?.status || gate.status}</small>
              </button>
            );
          })}
        </div>
        <TaskProjectMap
          projects={relatedProjects}
          projectEdges={relatedProjectEdges}
          selectedTask={selectedTask}
          onSelectNode={onSelectNode}
        />
      </div>
    </section>
  );
}

function TaskContextMenu({ contextMenu, onTaskAction }) {
  if (!contextMenu) return null;
  return createPortal(
    <div
      aria-label="任务操作"
      className="task-context-menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      <button role="menuitem" type="button" onClick={() => onTaskAction("finish")}>
        直接完成任务
      </button>
      <button className="danger" role="menuitem" type="button" onClick={() => onTaskAction("delete")}>
        删除任务
      </button>
    </div>,
    document.body
  );
}

function menuPosition(event) {
  const menuWidth = 178;
  const menuHeight = 92;
  const viewportWidth = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : event.clientX + menuWidth;
  const viewportHeight = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : event.clientY + menuHeight;
  return {
    x: Math.max(8, Math.min(event.clientX, viewportWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(event.clientY, viewportHeight - menuHeight - 8))
  };
}

function TaskProjectMap({ projects, projectEdges = [], selectedTask, onSelectNode }) {
  const [positions, setPositions] = useState(new Map());
  const [pinnedPositions, setPinnedPositions] = useState({});
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef("");
  const frameRef = useRef(0);
  const simulationRef = useRef({ nodes: new Map() });
  const mapNodes = useMemo(() => [
    ...(selectedTask ? [{ ...selectedTask, mapType: "task" }] : []),
    ...projects.map((project) => ({ ...project, mapType: "project" }))
  ], [projects, selectedTask]);

  useEffect(() => {
    const visibleIds = new Set(mapNodes.map((node) => node.id));
    setPinnedPositions((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => visibleIds.has(id)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [mapNodes]);

  useEffect(() => {
    simulationRef.current = initializeProjectMapSimulation(mapNodes, pinnedPositions);
    setPositions(snapshotProjectMapPositions(simulationRef.current.nodes));
    let lastTime = performance.now();

    function tick(now) {
      const delta = Math.min(32, now - lastTime);
      lastTime = now;
      const moving = stepProjectMapSimulation(simulationRef.current, pinnedPositions, delta);
      setPositions(snapshotProjectMapPositions(simulationRef.current.nodes));
      if (moving || dragRef.current) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [mapNodes, pinnedPositions]);

  if (!selectedTask) return null;

  function startDrag(event, nodeId) {
    if (event.button !== 0 || nodeId === selectedTask.id) return;
    const point = eventPointInSvg(event, svgRef.current, PROJECT_MAP_VIEWPORT);
    const current = positions.get(nodeId);
    if (!point || !current) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      nodeId,
      offsetX: point.x - current.x,
      offsetY: point.y - current.y,
      moved: false,
      startX: current.x,
      startY: current.y
    };
  }

  function handleMouseMove(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = eventPointInSvg(event, svgRef.current, PROJECT_MAP_VIEWPORT);
    if (!point) return;
    const x = clamp(point.x - drag.offsetX, 82, PROJECT_MAP_VIEWPORT.width - 82);
    const y = clamp(point.y - drag.offsetY, 48, PROJECT_MAP_VIEWPORT.height - 48);
    drag.moved = drag.moved || Math.hypot(x - drag.startX, y - drag.startY) > 3;
    setPinnedPositions((current) => ({
      ...current,
      [drag.nodeId]: { x, y }
    }));
  }

  function stopDrag() {
    if (dragRef.current?.moved) {
      suppressClickRef.current = dragRef.current.nodeId;
      requestAnimationFrame(() => {
        suppressClickRef.current = "";
      });
    }
    dragRef.current = null;
  }

  function selectProject(event, projectId) {
    if (suppressClickRef.current === projectId) {
      event.preventDefault();
      return;
    }
    onSelectNode(projectId);
  }

  return (
    <section className="task-project-map" aria-label="关联项目">
      <header>
        <h3>关联项目</h3>
        <span>{projects.length ? `${projects.length} 个项目` : "未记录项目"}</span>
      </header>
      {projectEdges.length ? <RelationLegend /> : null}
      {!projects.length ? <p className="empty-state">这个任务还没有挂载项目。</p> : (
        <svg
          onMouseLeave={stopDrag}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDrag}
          ref={svgRef}
          viewBox={`0 0 ${PROJECT_MAP_VIEWPORT.width} ${PROJECT_MAP_VIEWPORT.height}`}
          role="img"
          aria-label="任务关联项目脑图"
        >
          {projects.map((project) => {
            const point = positions.get(project.id) || seedProjectMapPosition(projects, project);
            return (
              <line
                className="project-map-edge"
                key={`edge-${project.id}`}
                x1={PROJECT_MAP_CENTER.x}
                y1={PROJECT_MAP_CENTER.y}
                x2={point.x}
                y2={point.y}
              />
            );
          })}
          {projectEdges.map((edge) => {
            const from = positions.get(edge.from) || seedProjectMapPosition(projects, { id: edge.from });
            const to = positions.get(edge.to) || seedProjectMapPosition(projects, { id: edge.to });
            return (
              <line
                className={`project-map-relation-edge relation-${edge.relation}`}
                data-testid={`task-project-edge-${edge.from}-${edge.to}-${edge.relation}`}
                key={`${edge.from}-${edge.to}-${edge.relation}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            );
          })}
          <foreignObject className="graph-node-shell project-map-node-shell" height="82" width="190" x={PROJECT_MAP_CENTER.x - 95} y={PROJECT_MAP_CENTER.y - 42}>
            <button
              aria-label={`${titleForNode(selectedTask)} 任务`}
              className={`graph-node project-map-graph-node node-task status-${selectedTask.status || "ok"} task-node selected`}
              onClick={() => onSelectNode(selectedTask.id)}
              type="button"
            >
              <span className="node-dot" aria-hidden="true" />
              <span className="node-copy">{titleForNode(selectedTask)}</span>
            </button>
          </foreignObject>
          {projects.map((project) => {
            const point = positions.get(project.id) || seedProjectMapPosition(projects, project);
            const metadataTags = metadataTagsForNode(project);
            return (
              <foreignObject className="graph-node-shell project-map-node-shell" height="116" key={project.id} width="190" x={point.x - 95} y={point.y - 58}>
                <button
                  aria-label={`${titleForNode(project)} 项目`}
                  className={`graph-node project-map-graph-node node-project status-${project.status || "ok"} project-node`}
                  onClick={(event) => selectProject(event, project.id)}
                  onMouseDown={(event) => startDrag(event, project.id)}
                  type="button"
                >
                  <span className="node-dot" aria-hidden="true" />
                  <span className="node-copy">{titleForNode(project)}</span>
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
      )}
    </section>
  );
}

function RelationLegend() {
  return (
    <div className="graph-relation-legend task-project-relation-legend" aria-label="relation legend">
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

function initializeProjectMapSimulation(nodes, pinnedPositions) {
  const nextNodes = new Map();
  const projectNodes = nodes.filter((node) => node.mapType === "project");
  for (const node of nodes) {
    const seeded = node.mapType === "task" ? PROJECT_MAP_CENTER : seedProjectMapPosition(projectNodes, node);
    const pinned = pinnedPositions[node.id];
    nextNodes.set(node.id, {
      id: node.id,
      mapType: node.mapType,
      x: node.mapType === "task" ? PROJECT_MAP_CENTER.x : pinned?.x ?? seeded.x,
      y: node.mapType === "task" ? PROJECT_MAP_CENTER.y : pinned?.y ?? seeded.y,
      vx: 0,
      vy: 0
    });
  }
  return { nodes: nextNodes };
}

function stepProjectMapSimulation(simulation, pinnedPositions, delta) {
  const nodes = [...simulation.nodes.values()];
  const projects = nodes.filter((node) => node.mapType === "project");
  const alpha = Math.min(1.25, Math.max(0.4, delta / 16));
  let totalVelocity = 0;

  for (let index = 0; index < projects.length; index += 1) {
    const left = projects[index];
    for (let nextIndex = index + 1; nextIndex < projects.length; nextIndex += 1) {
      const right = projects[nextIndex];
      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distanceSq = dx * dx + dy * dy;
      if (distanceSq < 1) {
        dx = 0.5;
        dy = 0.5;
        distanceSq = 0.5;
      }
      const distance = Math.sqrt(distanceSq);
      const strength = Math.min(18, 7200 / distanceSq) * alpha;
      const fx = (dx / distance) * strength;
      const fy = (dy / distance) * strength;
      if (!pinnedPositions[left.id]) {
        left.vx -= fx;
        left.vy -= fy;
      }
      if (!pinnedPositions[right.id]) {
        right.vx += fx;
        right.vy += fy;
      }
    }
  }

  for (const node of projects) {
    if (pinnedPositions[node.id]) {
      node.x = pinnedPositions[node.id].x;
      node.y = pinnedPositions[node.id].y;
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    const dx = PROJECT_MAP_CENTER.x - node.x;
    const dy = PROJECT_MAP_CENTER.y - node.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const desired = 185;
    const spring = (distance - desired) * 0.025 * alpha;
    node.vx += (dx / distance) * spring;
    node.vy += (dy / distance) * spring;
    node.vx *= 0.84;
    node.vy *= 0.84;
    node.x = clamp(node.x + node.vx * alpha, 88, PROJECT_MAP_VIEWPORT.width - 88);
    node.y = clamp(node.y + node.vy * alpha, 42, PROJECT_MAP_VIEWPORT.height - 42);
    totalVelocity += Math.abs(node.vx) + Math.abs(node.vy);
  }

  return projects.length ? totalVelocity / projects.length > 0.025 : false;
}

function snapshotProjectMapPositions(nodes) {
  const positions = new Map();
  for (const node of nodes.values()) {
    positions.set(node.id, { x: Math.round(node.x), y: Math.round(node.y) });
  }
  return positions;
}

function compareTasks(left, right) {
  if (left.raw?.isActive !== right.raw?.isActive) {
    return left.raw?.isActive ? -1 : 1;
  }
  return String(right.raw?.id || right.id).localeCompare(String(left.raw?.id || left.id));
}

function resolveSelectedTaskId(tasks, edges, selectedNodeId) {
  if (selectedNodeId?.startsWith("task:")) {
    return selectedNodeId;
  }
  if (selectedNodeId?.startsWith("gate:")) {
    const parentEdge = edges.find((edge) => edge.relation === "has-gate" && edge.to === selectedNodeId);
    if (parentEdge) {
      return parentEdge.from;
    }
  }
  return tasks.find((task) => task.raw?.isActive)?.id || tasks[0]?.id;
}

function gateLabelForTask(task, nodes, edges) {
  const gateId = task.raw?.currentGate;
  if (!gateId) {
    return "Gate 未记录";
  }
  const gateNodeId = edges.find((edge) => edge.relation === "has-gate" && edge.from === task.id && edge.to.endsWith(`:${gateId}`))?.to;
  const gate = nodes.find((node) => node.id === gateNodeId);
  return gate ? titleForNode(gate) : gateId;
}

function resolveTaskProjects(task, nodes, edges) {
  if (!task) return [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const projectIds = new Set((task.raw?.projectIds || []).map((id) => `project:${id}`));
  const worksetIds = new Set(edges
    .filter((edge) => edge.from === task.id && edge.relation === "has-workset")
    .map((edge) => edge.to));

  for (const edge of edges) {
    if (edge.from === task.id && edge.to.startsWith("project:")) projectIds.add(edge.to);
    if (edge.to === task.id && edge.from.startsWith("project:")) projectIds.add(edge.from);
    if (worksetIds.has(edge.from) && edge.to.startsWith("project:")) projectIds.add(edge.to);
    if (worksetIds.has(edge.to) && edge.from.startsWith("project:")) projectIds.add(edge.from);
  }

  for (const project of task.raw?.workset?.projects || []) {
    if (project.id) projectIds.add(`project:${project.id}`);
  }

  return [...projectIds]
    .map((id) => nodesById.get(id) || { id, type: "project", title: id.slice("project:".length), status: "unknown" })
    .sort(compareNodesByTitle);
}

function resolveProjectRelationEdges(projects, edges) {
  const projectIds = new Set(projects.map((project) => project.id));
  return edges.filter((edge) => (
    PROJECT_RELATIONS.has(edge.relation)
      && projectIds.has(edge.from)
      && projectIds.has(edge.to)
  ));
}

function metadataTagsForNode(node) {
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

function seedProjectMapPosition(projects, project) {
  const index = Math.max(0, projects.findIndex((item) => item.id === project.id));
  const radiusX = projects.length <= 2 ? 210 : 250;
  const radiusY = projects.length <= 2 ? 76 : 96;
  const angle = projects.length === 1 ? -Math.PI / 2 : (Math.PI * 2 * index) / projects.length - Math.PI / 2;
  return {
    x: Math.round(PROJECT_MAP_CENTER.x + Math.cos(angle) * radiusX),
    y: Math.round(PROJECT_MAP_CENTER.y + Math.sin(angle) * radiusY)
  };
}

function eventPointInSvg(event, svgElement, viewport) {
  if (!svgElement) return null;
  const rect = svgElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: ((event.clientX - rect.left) / rect.width) * viewport.width,
    y: ((event.clientY - rect.top) / rect.height) * viewport.height
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function summarizeProgress(gates, currentGate) {
  if (!gates.length) {
    return { label: "0/7 未记录", percent: 0 };
  }
  const doneCount = gates.filter((gate) => gate.raw?.status === "done").length;
  const currentIndex = currentGate ? gates.findIndex((gate) => gate.id === currentGate.id) + 1 : doneCount;
  const position = Math.max(doneCount, currentIndex, 0);
  const percent = Math.min(100, Math.round((position / gates.length) * 100));
  return { label: `${doneCount}/${gates.length} 已完成 · 第 ${position || 1} 步`, percent };
}

function compareGateNodes(left, right) {
  return gateNumber(left) - gateNumber(right);
}

function compareNodesByTitle(left, right) {
  return titleForNode(left).localeCompare(titleForNode(right));
}

function gateNumber(node) {
  const id = node.raw?.id || node.title || "";
  const match = String(id).match(/G(\d+)/);
  return match ? Number(match[1]) : 99;
}
