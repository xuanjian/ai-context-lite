import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import ChecksView from "./ChecksView.jsx";

test("ChecksView groups checks and runs repair actions", async () => {
  const onRunAction = vi.fn();
  render(<ChecksView checks={[{ id: "profile_json", title: "Profile JSON", area: "profile", status: "fail", message: "Missing", actionId: "create_minimal_profile_json" }]} onRunAction={onRunAction} />);

  expect(screen.getByText("画像")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /修复 Profile JSON/i }));
  expect(onRunAction).toHaveBeenCalledWith("create_minimal_profile_json", {});
});
