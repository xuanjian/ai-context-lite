import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import GraphView from "./GraphView.jsx";

test("GraphView renders nodes and calls onSelectNode", async () => {
  const onSelectNode = vi.fn();
  const graph = {
    nodes: [
      { id: "root:context-index", type: "root", title: "上下文索引", status: "ok" },
      { id: "group:projects", type: "group", title: "Projects", status: "ok" },
      { id: "project:demo", type: "project", title: "Demo", status: "warning" }
    ],
    edges: [{ from: "root:context-index", to: "group:projects", relation: "contains" }]
  };

  render(<GraphView graph={graph} selectedNodeId="" onSelectNode={onSelectNode} />);
  expect(screen.getByText("全局关系")).toBeInTheDocument();
  await userEvent.click(screen.getByTestId("graph-node-project:demo"));
  expect(onSelectNode).toHaveBeenCalledWith("project:demo");
});

test("GraphView hides cross links until a related node is selected", () => {
  const graph = {
    nodes: [
      { id: "root:context-index", type: "root", title: "上下文索引", status: "ok" },
      { id: "group:projects", type: "group", title: "Projects", status: "ok" },
      { id: "project:demo", type: "project", title: "Demo", status: "ok" },
      { id: "sceneTemplate:demo", type: "sceneTemplate", title: "Scene", status: "ok" },
      { id: "gate:demo:G4", type: "gate", title: "G4 Development", status: "ok" }
    ],
    edges: [
      { from: "root:context-index", to: "group:projects", relation: "contains" },
      { from: "group:projects", to: "project:demo", relation: "contains" },
      { from: "project:demo", to: "sceneTemplate:demo", relation: "uses-scene-template" },
      { from: "project:demo", to: "gate:demo:G4", relation: "touches-gate" }
    ]
  };

  const { rerender } = render(<GraphView graph={graph} selectedNodeId="" onSelectNode={() => {}} />);
  expect(screen.getByTestId("edge-project:demo-sceneTemplate:demo-uses-scene-template")).toBeInTheDocument();
  expect(screen.queryByTestId("edge-root:context-index-group:projects-contains")).not.toBeInTheDocument();
  expect(screen.queryByTestId("edge-group:projects-project:demo-contains")).not.toBeInTheDocument();

  rerender(<GraphView graph={graph} selectedNodeId="project:demo" onSelectNode={() => {}} />);
  expect(screen.getByText("聚焦关系")).toBeInTheDocument();
  expect(screen.getByTestId("edge-project:demo-sceneTemplate:demo-uses-scene-template")).toBeInTheDocument();
  expect(screen.queryByTestId("edge-group:projects-project:demo-contains")).not.toBeInTheDocument();
  expect(screen.getByText("G4 Development")).toBeInTheDocument();
});

test("GraphView filters to a selected project from the project rail", async () => {
  const graph = {
    nodes: [
      { id: "project:demo-a", type: "project", title: "Demo A", status: "ok" },
      { id: "project:demo-b", type: "project", title: "Demo B", status: "ok" },
      { id: "skill:demo", type: "skill", title: "Skill", status: "ok" }
    ],
    edges: [
      { from: "project:demo-a", to: "skill:demo", relation: "uses-skill" }
    ]
  };

  render(<GraphView graph={graph} selectedNodeId="" onSelectNode={() => {}} />);

  expect(screen.getByRole("button", { name: "筛选项目 Demo A" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "筛选项目 Demo B" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "筛选项目 Demo A" }));
  expect(screen.getByText("项目关系")).toBeInTheDocument();
  expect(screen.getByTestId("edge-project:demo-a-skill:demo-uses-skill")).toBeInTheDocument();
});

test("GraphView renders project metadata chips, relation legend, and relation edge classes", () => {
  const graph = {
    nodes: [
      {
        id: "project:goods-h5",
        type: "project",
        title: "Goods H5",
        status: "ok",
        metadata: { products: ["dhb"], domains: ["goods"], role: "h5" }
      },
      {
        id: "project:bff-goods",
        type: "project",
        title: "BFF Goods",
        status: "ok",
        metadata: { products: ["dhb"], domains: ["goods"], role: "bff-service" }
      },
      {
        id: "project:dhbfront-utils",
        type: "project",
        title: "dhbfront-utils",
        status: "ok",
        metadata: { products: ["dhb"], domains: [], role: "frontend-common" }
      }
    ],
    edges: [
      { from: "project:goods-h5", to: "project:bff-goods", relation: "calls" },
      { from: "project:goods-h5", to: "project:dhbfront-utils", relation: "depends-on" },
      { from: "project:bff-goods", to: "project:dhbfront-utils", relation: "chain" }
    ]
  };

  render(<GraphView graph={graph} selectedNodeId="" onSelectNode={() => {}} />);

  expect(screen.getByText("relation")).toBeInTheDocument();
  expect(screen.getByText("chain")).toBeInTheDocument();
  expect(screen.getByText("depends-on")).toBeInTheDocument();
  expect(screen.getByText("calls")).toBeInTheDocument();
  expect(screen.getAllByText("dhb").length).toBeGreaterThan(0);
  expect(screen.getAllByText("goods").length).toBeGreaterThan(0);
  expect(screen.getByText("h5")).toBeInTheDocument();
  expect(screen.getByText("bff-service")).toBeInTheDocument();
  expect(screen.getByTestId("edge-project:goods-h5-project:bff-goods-calls")).toHaveClass("relation-calls");
  expect(screen.getByTestId("edge-project:goods-h5-project:dhbfront-utils-depends-on")).toHaveClass("relation-depends-on");
  expect(screen.getByTestId("edge-project:bff-goods-project:dhbfront-utils-chain")).toHaveClass("relation-chain");
});

test("GraphView expands the canvas height to include long node columns", () => {
  const projectNodes = Array.from({ length: 18 }, (_, index) => ({
    id: `project:demo-${index}`,
    type: "project",
    title: `Project ${index}`,
    status: "ok"
  }));
  const graph = {
    nodes: [
      { id: "root:context-index", type: "root", title: "上下文索引", status: "ok" },
      { id: "group:projects", type: "group", title: "Projects", status: "ok" },
      ...projectNodes
    ],
    edges: []
  };

  render(<GraphView graph={graph} selectedNodeId="" onSelectNode={() => {}} />);

  const svg = screen.getByRole("img", { name: /上下文关系图/i });
  const [, , , height] = svg.getAttribute("viewBox").split(" ").map(Number);
  expect(height).toBeGreaterThan(900);
});

test("GraphView centers the visible node cluster in the scrollable canvas", async () => {
  const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 960 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 420 });

  const graph = {
    nodes: [
      { id: "project:demo", type: "project", title: "Demo", status: "ok" },
      { id: "sceneTemplate:demo", type: "sceneTemplate", title: "Scene", status: "ok" },
      { id: "skill:demo", type: "skill", title: "Skill", status: "ok" },
      { id: "rule:demo", type: "rule", title: "Rule", status: "ok" }
    ],
    edges: [
      { from: "project:demo", to: "sceneTemplate:demo", relation: "uses-scene-template" },
      { from: "project:demo", to: "skill:demo", relation: "uses-skill" },
      { from: "project:demo", to: "rule:demo", relation: "uses-rule" }
    ]
  };

  try {
    const { container } = render(<GraphView graph={graph} selectedNodeId="" onSelectNode={() => {}} />);
    const canvas = container.querySelector(".graph-canvas");
    expect(canvas).toBeInTheDocument();

    await waitFor(() => {
      expect(canvas.scrollTop).toBeGreaterThan(0);
    });
  } finally {
    if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth);
    if (clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
  }
});
