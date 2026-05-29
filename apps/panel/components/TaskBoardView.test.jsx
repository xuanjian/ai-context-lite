import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import TaskBoardView from "./TaskBoardView.jsx";

test("TaskBoardView renders tasks and gate progress from graph nodes", async () => {
  const onSelectNode = vi.fn();
  const graph = {
    nodes: [
      { id: "task:demo", type: "task", title: "Demo Task", summary: "Active work", status: "ok", raw: { currentGate: "G4", status: "doing", isActive: true } },
      { id: "task:other", type: "task", title: "Other Task", summary: "Older work", status: "ok", raw: { currentGate: "G2", status: "active" } },
      { id: "project:demo-a", type: "project", title: "Demo A", status: "ok" },
      { id: "project:demo-b", type: "project", title: "Demo B", status: "ok" },
      { id: "gate:demo:G1", type: "gate", title: "G1 Intent", summary: "Intake", status: "ok", raw: { id: "G1", name: "Intent", status: "done" } },
      { id: "gate:demo:G4", type: "gate", title: "G4 Development", summary: "Development", status: "warning", raw: { id: "G4", name: "Development", status: "in_progress" } },
      { id: "gate:other:G2", type: "gate", title: "G2 Discovery", summary: "Discovery", status: "warning", raw: { id: "G2", name: "Discovery", status: "in_progress" } }
    ],
    edges: [
      { from: "task:demo", to: "gate:demo:G1", relation: "has-gate" },
      { from: "task:demo", to: "gate:demo:G4", relation: "has-gate" },
      { from: "task:demo", to: "project:demo-a", relation: "workset-project" },
      { from: "task:demo", to: "project:demo-b", relation: "workset-project" },
      { from: "task:other", to: "gate:other:G2", relation: "has-gate" }
    ]
  };

  const view = render(<TaskBoardView graph={graph} selectedNodeId="" onSelectNode={onSelectNode} />);

  expect(screen.getAllByText("Demo Task").length).toBeGreaterThan(0);
  expect(screen.getByText("Other Task")).toBeInTheDocument();
  expect(screen.getByText("当前")).toBeInTheDocument();
  expect(screen.getByText("关联项目")).toBeInTheDocument();
  expect(screen.getByText("Demo A")).toBeInTheDocument();
  expect(screen.getByText("Demo B")).toBeInTheDocument();
  expect(screen.getByLabelText("当前流程")).toHaveTextContent("G4 Development");
  await userEvent.click(screen.getAllByRole("button", { name: /G4 Development/ }).find((item) => item.classList.contains("gate-card")));
  expect(onSelectNode).toHaveBeenCalledWith("gate:demo:G4");

  view.rerender(<TaskBoardView graph={graph} selectedNodeId="task:other" onSelectNode={onSelectNode} />);
  expect(screen.getByLabelText("当前流程")).toHaveTextContent("G2 Discovery");
  expect(screen.queryAllByRole("button", { name: /G4 Development/ }).find((item) => item.classList.contains("gate-card"))).toBeUndefined();
});

test("TaskBoardView task project map renders project metadata and project relation edges", async () => {
  const graph = {
    nodes: [
      { id: "task:demo", type: "task", title: "Demo Task", summary: "Active work", status: "ok", raw: { currentGate: "G4", status: "doing", projectIds: ["goods-h5", "bff-goods", "dhbfront-utils"] } },
      { id: "project:goods-h5", type: "project", title: "Goods H5", status: "ok", metadata: { products: ["dhb"], domains: ["goods"], role: "h5" } },
      { id: "project:bff-goods", type: "project", title: "BFF Goods", status: "ok", metadata: { products: ["dhb"], domains: ["goods"], role: "bff-service" } },
      { id: "project:dhbfront-utils", type: "project", title: "dhbfront-utils", status: "ok", metadata: { products: ["dhb"], domains: [], role: "frontend-common" } },
      { id: "gate:demo:G4", type: "gate", title: "G4 Development", summary: "Development", status: "warning", raw: { id: "G4", name: "Development", status: "in_progress" } }
    ],
    edges: [
      { from: "task:demo", to: "gate:demo:G4", relation: "has-gate" },
      { from: "project:goods-h5", to: "project:bff-goods", relation: "calls" },
      { from: "project:goods-h5", to: "project:dhbfront-utils", relation: "depends-on" },
      { from: "project:bff-goods", to: "project:dhbfront-utils", relation: "chain" }
    ]
  };

  render(<TaskBoardView graph={graph} selectedNodeId="" onSelectNode={() => {}} />);

  expect(screen.getByText("relation")).toBeInTheDocument();
  expect(screen.getByText("chain")).toBeInTheDocument();
  expect(screen.getByText("depends-on")).toBeInTheDocument();
  expect(screen.getByText("calls")).toBeInTheDocument();
  expect(screen.getAllByText("dhb").length).toBeGreaterThan(0);
  expect(screen.getAllByText("goods").length).toBeGreaterThan(0);
  expect(screen.getByText("h5")).toBeInTheDocument();
  expect(screen.getByText("bff-service")).toBeInTheDocument();
  expect(screen.getByTestId("task-project-edge-project:goods-h5-project:bff-goods-calls")).toHaveClass("relation-calls");
  expect(screen.getByTestId("task-project-edge-project:goods-h5-project:dhbfront-utils-depends-on")).toHaveClass("relation-depends-on");
  expect(screen.getByTestId("task-project-edge-project:bff-goods-project:dhbfront-utils-chain")).toHaveClass("relation-chain");
});

test("TaskBoardView opens task context menu and confirms destructive deletion", async () => {
  const onTaskAction = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const graph = {
    nodes: [
      { id: "task:demo", type: "task", title: "Demo Task", summary: "Active work", status: "ok", raw: { id: "demo", currentGate: "G4", status: "active" } },
      { id: "gate:demo:G4", type: "gate", title: "G4 Development", summary: "Development", status: "warning", raw: { id: "G4", name: "Development", status: "in_progress" } }
    ],
    edges: [
      { from: "task:demo", to: "gate:demo:G4", relation: "has-gate" }
    ]
  };

  render(<TaskBoardView graph={graph} selectedNodeId="" onSelectNode={() => {}} onTaskAction={onTaskAction} />);

  fireEvent.contextMenu(screen.getByRole("button", { name: /Demo Task/ }), { clientX: 120, clientY: 150 });
  const menu = screen.getByRole("menu", { name: "任务操作" });
  expect(menu).toBeInTheDocument();
  expect(menu.parentElement).toBe(document.body);

  await userEvent.click(screen.getByRole("menuitem", { name: "直接完成任务" }));
  expect(onTaskAction).toHaveBeenCalledWith("finish", expect.objectContaining({ id: "task:demo" }));

  fireEvent.contextMenu(screen.getByRole("button", { name: /Demo Task/ }), { clientX: 120, clientY: 150 });
  await userEvent.click(screen.getByRole("menuitem", { name: "删除任务" }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Demo Task"));
  expect(onTaskAction).toHaveBeenCalledTimes(1);

  confirm.mockReturnValue(true);
  fireEvent.contextMenu(screen.getByRole("button", { name: /Demo Task/ }), { clientX: 120, clientY: 150 });
  await userEvent.click(screen.getByRole("menuitem", { name: "删除任务" }));
  expect(onTaskAction).toHaveBeenCalledWith("delete", expect.objectContaining({ id: "task:demo" }));
  confirm.mockRestore();
});
