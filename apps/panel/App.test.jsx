import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import App from "./App.jsx";

afterEach(() => {
  vi.restoreAllMocks();
});

test("App renders loading state then main regions", async () => {
  global.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      nodes: [
        { id: "project:demo", type: "project", title: "Demo Project", status: "ok" },
        { id: "task:demo", type: "task", title: "Demo Task", status: "ok", raw: { currentGate: "G4", status: "doing", projectIds: ["demo"] } },
        { id: "profile:main", type: "profile", title: "Persona Profile", status: "ok", raw: { role: "Developer", products: ["DemoProduct"], strengths: ["React"] }, docPath: "docs/person/profile.md" }
      ],
      edges: [],
      groups: [],
      warnings: []
    }) });

  render(<App />);

  expect(screen.getByText("上下文工作台")).toBeInTheDocument();
  expect(await screen.findByText("项目列表")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "筛选项目 Demo Project" })).toBeInTheDocument();
  expect(screen.getByTestId("graph-node-project:demo")).toBeInTheDocument();
  expect(screen.queryByText("安装与 AI 工具配置")).not.toBeInTheDocument();
  expect(screen.queryByText("搜索")).not.toBeInTheDocument();
});

test("App relation view hides the root node and starts with four relation groups", async () => {
  global.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      nodes: [
        { id: "root:context-index", type: "root", title: "上下文索引", status: "ok" },
        { id: "group:projects", type: "group", title: "Projects", status: "ok" },
        { id: "group:sceneTemplates", type: "group", title: "Scene Templates", status: "ok" },
        { id: "group:skills", type: "group", title: "Skills", status: "ok" },
        { id: "group:rules", type: "group", title: "Rules", status: "ok" },
        { id: "project:demo", type: "project", title: "Demo Project", status: "ok" },
        { id: "sceneTemplate:demo", type: "sceneTemplate", title: "Demo Scene", status: "ok" },
        { id: "skill:demo", type: "skill", title: "Demo Skill", status: "ok" },
        { id: "rule:demo", type: "rule", title: "Demo Rule", status: "ok" }
      ],
      edges: [
        { from: "root:context-index", to: "group:projects", relation: "contains" },
        { from: "root:context-index", to: "group:sceneTemplates", relation: "contains" },
        { from: "project:demo", to: "sceneTemplate:demo", relation: "uses-scene-template" }
      ],
      groups: [],
      warnings: []
    }) });

  render(<App />);

  await screen.findByText("项目列表");
  expect(screen.getByRole("button", { name: "筛选项目 Demo Project" })).toBeInTheDocument();
  expect(screen.getByTestId("edge-project:demo-sceneTemplate:demo-uses-scene-template")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "任务" }));
  expect(screen.getByText("Tasks")).toBeInTheDocument();
});

test("App routes task context menu actions through panel actions API", async () => {
  const graph = {
    nodes: [
      { id: "task:demo", type: "task", title: "Demo Task", status: "ok", raw: { id: "demo", currentGate: "G4", status: "active" } },
      { id: "gate:demo:G4", type: "gate", title: "G4 Development", status: "warning", raw: { id: "G4", name: "Development", status: "in_progress" } }
    ],
    edges: [{ from: "task:demo", to: "gate:demo:G4", relation: "has-gate" }],
    groups: [],
    warnings: []
  };
  global.fetch = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => graph })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
    .mockResolvedValueOnce({ ok: true, json: async () => graph });

  render(<App />);

  await userEvent.click(await screen.findByRole("button", { name: "任务" }));
  fireEvent.contextMenu(screen.getByRole("button", { name: /Demo Task/ }), { clientX: 100, clientY: 120 });
  await userEvent.click(screen.getByRole("menuitem", { name: "直接完成任务" }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith("/api/actions/finish_task", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ taskId: "demo", note: "Panel direct completion." })
    }));
  });
});

test("task detail panel keeps content near the top instead of vertical centering", () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, "styles.css"), "utf8");
  const gatePanelRule = [...css.matchAll(/\.gate-panel\s*\{[^}]+\}/g)]
    .map((match) => match[0])
    .join("\n");

  expect(gatePanelRule).not.toContain("justify-content: center");
  expect(gatePanelRule).toContain("justify-content: flex-start");
});
