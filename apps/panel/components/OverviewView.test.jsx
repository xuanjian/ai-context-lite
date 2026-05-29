import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import OverviewView from "./OverviewView.jsx";

test("OverviewView summarizes install, relationships, tasks, and profile", async () => {
  const onViewChange = vi.fn();
  const graph = {
    nodes: [
      { id: "project:demo", type: "project", title: "Demo", status: "ok" },
      { id: "skill:demo", type: "skill", title: "Skill", status: "ok" },
      { id: "rule:demo", type: "rule", title: "Rule", status: "ok" },
      { id: "sceneTemplate:demo", type: "sceneTemplate", title: "Scene", status: "ok" },
      { id: "task:demo", type: "task", title: "Demo Task", status: "ok", raw: { currentGate: "G4", status: "doing", projectIds: ["demo"] } },
      { id: "profile:main", type: "profile", title: "Persona Profile", status: "ok", raw: { role: "Developer", products: ["DemoProduct"], strengths: ["React"] }, docPath: "docs/person/profile.md" }
    ],
    edges: [{ from: "project:demo", to: "skill:demo", relation: "uses-skill" }]
  };
  const checks = [{ id: "entry_json", title: "Entry JSON", area: "config", status: "pass" }];

  render(<OverviewView graph={graph} checks={checks} onSelectNode={() => {}} onViewChange={onViewChange} />);

  expect(screen.getByText("安装与 AI 工具配置")).toBeInTheDocument();
  expect(screen.getByText("项目 / 技能 / 规则 / 模板")).toBeInTheDocument();
  expect(screen.getByText("工作流与 Tasks")).toBeInTheDocument();
  expect(screen.getByText("个人画像")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "查看任务" }));
  expect(onViewChange).toHaveBeenCalledWith("tasks");

  await userEvent.click(screen.getByRole("button", { name: "查看关系" }));
  expect(onViewChange).toHaveBeenCalledWith("relations");
});
