/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UiUpdate } from "./ui-update";
import { sdk } from "@/lib/client";
vi.mock("@/lib/client", () => ({ sdk: vi.fn() }));
afterEach(cleanup);

it("shows process output and a failed exit without claiming deployment succeeded", async () => {
  vi.mocked(sdk).mockResolvedValueOnce({ id: "update-1", running: true })
    .mockResolvedValueOnce({ id: "update-1", running: false, code: 1, output: "git pull: network unavailable" });
  render(<UiUpdate />);
  fireEvent.click(screen.getByRole("button", { name: "Update UI" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "/Users/test/UI repo" } });
  fireEvent.click(screen.getByRole("button", { name: "Start UI update" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("UI update failed"));
  expect(screen.getByText("git pull: network unavailable")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reload UI" })).toBeNull();
  expect(sdk).toHaveBeenCalledWith("proc.start", expect.objectContaining({ cwd: "/Users/test/UI repo" }));
  expect(sdk).toHaveBeenCalledWith("proc.status", { id: "update-1", tail: 12000 });
});
