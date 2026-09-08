/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileExplorerDialog } from "@/components/file-explorer-dialog";
import { FileViewerDialog } from "@/components/file-viewer-dialog";

const mocks = vi.hoisted(() => ({
  sdk: vi.fn(), setText: vi.fn(), view: vi.fn(), forgetFile: vi.fn(), forgetThumbnail: vi.fn(),
  draft: "", activity: {} as Record<string, unknown>,
}));
vi.mock("@/lib/client", () => ({ sdk: mocks.sdk, fileUrl: (path: string) => path }));
vi.mock("@assistant-ui/react", () => ({ useAui: () => ({ composer: () => ({
  getState: () => ({ text: mocks.draft, attachments: ["existing attachment"] }), setText: mocks.setText,
}) }) }));
vi.mock("@/runtime/file-activity-provider", () => ({ useFileActivity: () => mocks.activity }));
vi.mock("@/lib/files", async (original) => ({ ...await original<object>(), forgetFile: mocks.forgetFile }));
vi.mock("@/lib/thumbnails", () => ({ forgetThumbnail: mocks.forgetThumbnail }));
vi.mock("@/components/file-view", () => ({ FileView: ({ path }: { path: string }) => <div data-slot="file-view" tabIndex={0}>{path}</div> }));
vi.mock("@/components/markdown-mode", () => ({ MarkdownModePicker: () => null }));
vi.mock("@/components/assistant-ui/tooltip-icon-button", () => ({
  TooltipIconButton: ({ tooltip, side: _side, ...props }: { tooltip: string; side?: string }) => <button aria-label={tooltip} {...props} />,
}));

const entry = (name: string, is_dir = false, root = "/data") => ({ name, path: `${root}/${name}`, is_dir, size: 0, mtime: 0 });
const initial = [entry("b.txt"), entry("notes", true), entry("a.txt")];
function Harness() {
  const [open, setOpen] = useState(true);
  const [viewing, setViewing] = useState<{ paths: string[]; index: number } | null>(null);
  mocks.activity = {
    viewing,
    view: (paths: string[], index: number) => { mocks.view(paths, index); setViewing({ paths, index }); },
    stepView: (by: number) => setViewing((value) => value && ({ ...value, index: (value.index + by + value.paths.length) % value.paths.length })),
    closeView: () => setViewing(null),
  };
  return <>
    <button onClick={() => setOpen(true)}>Open explorer</button>
    <textarea data-slot="chat-composer-input" defaultValue="Draft" />
    <FileExplorerDialog open={open} onOpenChange={setOpen} />
    {viewing && <FileViewerDialog />}
  </>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.draft = "";
  mocks.sdk.mockImplementation(async (type: string, args: { path?: string }) => {
    if (type === "paths.get") return "/data";
    if (type === "config.read") return ["/work"];
    if (type === "fs.stat") return { path: args.path, is_dir: true };
    return args.path === "/data" ? initial : [entry("child.txt", false, args.path)];
  });
});
afterEach(cleanup);

it("discovers shortcuts, navigates and filters without per-file requests", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByRole("button", { name: "notes" });
  expect(mocks.sdk).toHaveBeenCalledWith("fs.list", { path: "/data", details: true });
  expect(mocks.sdk).not.toHaveBeenCalledWith("fs.stat", expect.anything());
  await user.type(screen.getByLabelText("Filter filenames"), "A.");
  expect(screen.queryByRole("button", { name: "b.txt" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "a.txt" })).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Filter filenames"));
  await user.selectOptions(screen.getByLabelText("Folder shortcuts"), "/work");
  await screen.findByRole("button", { name: "child.txt" });
  expect(mocks.sdk).toHaveBeenCalledWith("fs.stat", { path: "/work" });
  expect(screen.getByLabelText("Host folder path")).toHaveValue("/work");
});

it.each(["", "Please read this", "Please read this\n"])("mentions into draft %j and focuses chat", async (draft) => {
  mocks.draft = draft;
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(await screen.findByRole("button", { name: "Mention a.txt" }));
  expect(mocks.setText).toHaveBeenCalledWith(`${draft}${draft && !draft.endsWith("\n") ? "\n" : ""}/data/a.txt\n`);
  await waitFor(() => expect(document.querySelector("textarea")).toHaveFocus());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("previews visible files, pages them, and returns with Escape and focus intact", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const file = await screen.findByRole("button", { name: "a.txt" });
  await user.click(file);
  expect(mocks.view).toHaveBeenCalledWith(["/data/a.txt", "/data/b.txt"], 0);
  expect(mocks.forgetFile).toHaveBeenCalledWith("/data/b.txt");
  await user.click(screen.getByRole("button", { name: "Next file" }));
  expect(screen.getByRole("dialog", { name: "b.txt" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "b.txt" })).not.toBeInTheDocument());
  expect(screen.getByRole("dialog", { name: "File explorer" })).toBeInTheDocument();
  await waitFor(() => expect(file).toHaveFocus());
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("retains the last directory and filter on reopening and refreshes configuration", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(await screen.findByRole("button", { name: "notes" }));
  await screen.findByRole("button", { name: "child.txt" });
  await user.type(screen.getByLabelText("Filter filenames"), "child");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Open explorer" }));
  await screen.findByRole("button", { name: "child.txt" });
  expect(screen.getByLabelText("Host folder path")).toHaveValue("/data/notes");
  expect(screen.getByLabelText("Filter filenames")).toHaveValue("child");
  expect(mocks.sdk.mock.calls.filter(([type]) => type === "config.read")).toHaveLength(2);
});

it("keeps the previous listing on failed navigation and retries the failed target", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByRole("button", { name: "a.txt" });
  mocks.sdk.mockRejectedValueOnce(new Error("Access denied"));
  await user.click(screen.getByRole("button", { name: "notes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
  expect(screen.getByRole("button", { name: "a.txt" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "child.txt" });
});

it("ignores stale listings when a newer navigation completes", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByRole("button", { name: "notes" });
  let resolve!: (entries: typeof initial) => void;
  mocks.sdk.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await user.click(screen.getByRole("button", { name: "notes" }));
  fireEvent.change(screen.getByLabelText("Host folder path"), { target: { value: "/new" } });
  await user.click(screen.getByRole("button", { name: "Go" }));
  await screen.findByRole("button", { name: "child.txt" });
  await act(async () => resolve([entry("stale.txt")]));
  expect(screen.getByLabelText("Host folder path")).toHaveValue("/new");
  expect(screen.queryByRole("button", { name: "stale.txt" })).not.toBeInTheDocument();
});

it("handles absent writable folders and rejects relative paths without a request", async () => {
  mocks.sdk.mockImplementation(async (type: string) => type === "paths.get" ? "/data" : type === "config.read" ? null : []);
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByText("This folder is empty.");
  const count = mocks.sdk.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Host folder path"), { target: { value: "relative" } });
  await user.click(screen.getByRole("button", { name: "Go" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("absolute path");
  expect(mocks.sdk).toHaveBeenCalledTimes(count);
});

it("keeps browsing available when shortcut discovery fails", async () => {
  mocks.sdk.mockImplementation(async (type: string) => {
    if (type === "config.read") throw new Error("Unavailable");
    return type === "paths.get" ? "/data" : initial;
  });
  render(<Harness />);
  await screen.findByRole("button", { name: "a.txt" });
  expect(screen.getByText(/Some folder shortcuts/)).toBeInTheDocument();
});

it("rejects a manually entered file without listing it", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByRole("button", { name: "a.txt" });
  mocks.sdk.mockResolvedValueOnce({ path: "/data/a.txt", is_dir: false });
  fireEvent.change(screen.getByLabelText("Host folder path"), { target: { value: "/data/a.txt" } });
  await user.click(screen.getByRole("button", { name: "Go" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This path is a file");
  expect(mocks.sdk).not.toHaveBeenCalledWith("fs.list", { path: "/data/a.txt", details: true });
});

it("discards a pending navigation after closure", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByRole("button", { name: "notes" });
  let resolve!: (entries: typeof initial) => void;
  mocks.sdk.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await user.click(screen.getByRole("button", { name: "notes" }));
  await user.keyboard("{Escape}");
  await act(async () => resolve([entry("stale.txt")]));
  await user.click(screen.getByRole("button", { name: "Open explorer" }));
  await screen.findByRole("button", { name: "a.txt" });
  expect(screen.getByLabelText("Host folder path")).toHaveValue("/data");
  expect(screen.queryByRole("button", { name: "stale.txt" })).not.toBeInTheDocument();
});
