import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import Sidebar from "./Sidebar.jsx";

test("Sidebar renders only relation and task navigation", async () => {
  const onChange = vi.fn();
  render(<Sidebar activeView="relations" onViewChange={onChange} />);

  expect(screen.getByText("上下文工作台")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "关系" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "任务" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "总览" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "画像" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "检查" })).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText("搜索节点、文件或说明")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "任务" }));
  expect(onChange).toHaveBeenCalledWith("tasks");
});
