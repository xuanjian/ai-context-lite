import { useEffect, useMemo, useState } from "react";
import { fetchGraph, fetchNodeDetails, runAction } from "./api.js";
import DetailsDrawer from "./components/DetailsDrawer.jsx";
import GraphView from "./components/GraphView.jsx";
import Sidebar from "./components/Sidebar.jsx";
import TaskBoardView from "./components/TaskBoardView.jsx";
import "./styles.css";

export default function App() {
  const [graph, setGraph] = useState({ nodes: [], edges: [], groups: [], warnings: [] });
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedNodeDetails, setSelectedNodeDetails] = useState(null);
  const [activeView, setActiveView] = useState("relations");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setError("");
    setGraph(await fetchGraph());
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh()
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedNodeDetails(null);
      return;
    }
    let cancelled = false;
    fetchNodeDetails(selectedNodeId)
      .then((details) => {
        if (!cancelled) setSelectedNodeDetails(details);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNodeId]);

  const scopedGraph = useMemo(() => {
    const scopedTypes = typesForView(activeView);
    const nodes = graph.nodes.filter((node) => {
      return !scopedTypes || scopedTypes.has(node.type);
    });
    const visible = new Set(nodes.map((node) => node.id));
    return {
      ...graph,
      nodes,
      edges: graph.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to))
    };
  }, [activeView, graph]);

  async function handleRunAction(actionId, body = {}) {
    await runAction(actionId, body);
    await refresh();
  }

  async function handleTaskAction(action, task) {
    const taskId = taskIdForNode(task);
    if (!taskId) return;
    try {
      if (action === "finish") {
        await runAction("finish_task", { taskId, note: "Panel direct completion." });
      } else if (action === "delete") {
        await runAction("delete_task", { taskId });
        if (selectedNodeId === task.id || selectedNodeId.startsWith(`gate:${taskId}:`)) {
          setSelectedNodeId("");
        }
      }
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="app-shell">
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
      />
      <section className="workspace">
        {loading ? <p className="state-message">正在加载上下文关系...</p> : null}
        {error ? <p className="state-message error-message" role="alert">{error}</p> : null}
        {!loading && activeView === "tasks" ? (
          <TaskBoardView
            graph={scopedGraph}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onTaskAction={handleTaskAction}
          />
        ) : null}
        {!loading && activeView === "relations" ? (
          <GraphView
            graph={scopedGraph}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        ) : null}
      </section>
      <DetailsDrawer details={selectedNodeDetails} onRunAction={handleRunAction} />
    </main>
  );
}

function taskIdForNode(task) {
  return String(task?.raw?.id || task?.id || "")
    .trim()
    .replace(/^task:/, "");
}

function typesForView(view) {
  const map = {
    relations: ["project", "sceneTemplate", "skill", "rule", "workset"],
    tasks: ["task", "gate", "project", "sceneTemplate", "skill", "rule", "workset", "artifact"]
  };
  return map[view] ? new Set(map[view]) : null;
}
