import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import DetailsDrawer from "./DetailsDrawer.jsx";

test("DetailsDrawer renders metadata, relationships, warnings, and actions", async () => {
  const onRunAction = vi.fn();
  const details = {
    node: { id: "project:demo", title: "Demo", type: "project", status: "warning", sourcePath: "config/projects/demo.json", docPath: "docs/repos/demo.md", raw: { id: "demo" } },
    documentationSummary: "Demo docs",
    related: { projects: [], sceneTemplates: [{ id: "sceneTemplate:demo", title: "Scene" }], skills: [], rules: [], gates: [{ id: "gate:demo:G4", title: "G4 Development" }], artifacts: [{ id: "artifact:demo", type: "artifact", title: "technical-design.md" }], profiles: [], tasks: [] },
    warnings: [{ code: "missing_project_doc", message: "Missing doc" }],
    actions: [{ actionId: "sync_project_entry", label: "Sync project", body: { projectId: "demo" } }]
  };

  render(<DetailsDrawer details={details} onRunAction={onRunAction} />);
  expect(screen.getByText("Demo")).toBeInTheDocument();
  expect(screen.getByText("Demo docs")).toBeInTheDocument();
  expect(screen.getByText("来源")).toBeInTheDocument();
  expect(screen.getByText("关联场景模板")).toBeInTheDocument();
  expect(screen.getByText("关联步骤")).toBeInTheDocument();
  expect(screen.getByText("关联产物")).toBeInTheDocument();
  const artifactLink = screen.getByRole("link", { name: "technical-design.md" });
  expect(artifactLink).toHaveAttribute("href", "/api/artifacts/artifact%3Ademo");
  expect(artifactLink).toHaveAttribute("target", "_blank");
  expect(screen.getByText("Missing doc")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Sync project" }));
  expect(onRunAction).toHaveBeenCalledWith("sync_project_entry", { projectId: "demo" });
});
