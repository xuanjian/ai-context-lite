import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import PersonaView from "./PersonaView.jsx";

test("PersonaView renders the profile markdown document content", () => {
  render(<PersonaView document={{
    sourcePath: "docs/person/profile.md",
    markdown: "# 开发者长期画像\n\n> 稳定信息。\n\n## 协作偏好\n\n- 先查根因\n- 少讲抽象原则"
  }} />);

  expect(screen.getByRole("region", { name: "画像文档" })).toBeInTheDocument();
  expect(screen.getByText("开发者长期画像")).toBeInTheDocument();
  expect(screen.getByText("协作偏好")).toBeInTheDocument();
  expect(screen.getByText("先查根因")).toBeInTheDocument();
  expect(screen.getByText("少讲抽象原则")).toBeInTheDocument();
});

test("PersonaView renders ordered lists from markdown", () => {
  render(<PersonaView document={{
    sourcePath: "docs/person/profile.md",
    markdown: "## 默认读取方式\n\n1. config/entry.json\n2. config/profile.json"
  }} />);

  expect(screen.getByText("config/entry.json").closest("ol")).toBeInTheDocument();
});

test("PersonaView reports document read errors", () => {
  render(<PersonaView document={{ sourcePath: "docs/person/profile.md", markdown: "" }} error="missing file" />);

  expect(screen.getByRole("alert")).toHaveTextContent("missing file");
});
