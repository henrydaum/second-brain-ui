// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime } from "@assistant-ui/react";
import { useReducer, type Dispatch } from "react";
import { initialState, reduce, type Action } from "@/runtime/store";
import { convertMessage } from "@/runtime/convert";
import { type Frame } from "@/lib/events";

const controls = vi.hoisted(() => ({ waiting: false, rows: [] as unknown[], listeners: new Set<() => void>() }));
vi.mock("@/runtime/provider", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useApprovals: () => {
    const waiting = useSyncExternalStore((listener) => {
      controls.listeners.add(listener);
      return () => { controls.listeners.delete(listener); };
    }, () => controls.waiting);
    return { inputRequests: waiting ? [{}] : [] };
  } };
});
vi.mock("@/lib/client", () => ({
  fileUrl: (path: string) => "http://localhost/files?path=" + encodeURIComponent(path),
  sdk: async () => null,
}));
vi.mock("@/lib/ledger", async (original) => ({
  ...await original<typeof import("@/lib/ledger")>(),
  readLedger: async () => controls.rows,
}));

const { AssistantMessage } = await import("@/components/thread");
const { FileActivityContext, currentFiles } = await import("@/runtime/file-activity-provider");
const { toSections, withStoreAttachments } = await import("@/runtime/file-activity");
const { ActivityLine } = await import("@/components/reply-activity");
const { ToolInput } = await import("@/components/tool-input");
let dispatch: Dispatch<Action>;
const view = vi.fn();

function Harness() {
  const [state, send] = useReducer(reduce, initialState);
  dispatch = send;
  const runtime = useExternalStoreRuntime({
    messages: state.turns, convertMessage, isRunning: state.typing, onNew: async () => {},
  });
  const sections = toSections(withStoreAttachments(new Map(), state.turns), state.turns);
  const files = currentFiles([], state.turns);
  return <AssistantRuntimeProvider runtime={runtime}>
      <FileActivityContext value={{
        sections, sectionFor: (id) => sections.find((section) => section.turnId === id) ?? null,
        fileFor: (path) => files.get(path), recoveredFor: () => [],
        entries: [...files.values()], total: files.size, failure: null,
        filesOpen: false, setFilesOpen: () => {}, openFilesAt: () => {},
        focusTurn: null, focusRequest: 0, clearFocus: () => {},
        viewing: null, view, stepView: () => {}, closeView: () => {},
      }}>
        <ThreadPrimitive.Root><ThreadPrimitive.Messages components={{ AssistantMessage, UserMessage: () => null }} /></ThreadPrimitive.Root>
      </FileActivityContext>
  </AssistantRuntimeProvider>;
}
const frame = (value: Frame) => act(async () => { dispatch({ type: "frame", frame: value }); });
const text = (stream_id: string, delta: string, seq = 1, done = false) =>
  frame({ kind: "stream_delta", payload: { stream_id, delta, seq, done } });

beforeEach(() => {
  controls.waiting = false;
  view.mockClear();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("assembled assistant-ui reply", () => {
  it("keeps two file events inside the reply, between their text and above the footer", async () => {
    const { container } = render(<Harness />);
    await frame({ kind: "typing", payload: true });
    await text("s1", "Before the first images");
    await frame({ kind: "attachments", payload: ["/one.png", "/two.png"] });
    await text("s1", "Between the images", 2);
    await frame({ kind: "tool_status", payload: {
      call_id: "c2", tool_name: "show_files", status: "started", args: { paths: ["/three.png"] },
    } });
    await frame({ kind: "attachments", payload: ["/three.png"] });
    await frame({ kind: "tool_status", payload: { call_id: "c2", tool_name: "show_files", status: "finished", ok: true } });
    await text("s2", "After the images", 1, true);
    await frame({ kind: "typing", payload: false });
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(3));
    const replies = container.querySelectorAll('[data-role="assistant"]');
    expect(replies).toHaveLength(1);
    const reply = replies[0] as HTMLElement;
    const groups = reply.querySelectorAll('[data-slot="attachment-group"]');
    expect(groups).toHaveLength(2);
    const footer = reply.querySelector('[data-slot="assistant-message-footer"]')!;
    expect(footer.parentElement?.lastElementChild).toBe(footer);
    expect(groups[0].compareDocumentPosition(screen.getByText("Between the images")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Between the images").compareDocumentPosition(groups[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(reply).getByRole("button", { name: "3 files" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open two.png" }));
    expect(view).toHaveBeenCalledWith(["/one.png", "/two.png"], 1);
  });

  it("switches one status line using stream completion, including waiting", async () => {
    render(<Harness />);
    await frame({ kind: "typing", payload: true });
    expect(screen.getByRole("status")).toHaveTextContent("Working");
    await text("s1", "A finished paragraph");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Writing");
    await text("s1", "", 2, true);
    expect(screen.getByRole("status")).toHaveTextContent("Working");
    act(() => { controls.waiting = true; controls.listeners.forEach((listener) => listener()); });
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for your response");
    await frame({ kind: "typing", payload: false });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("expands large galleries and retains separate intentional shares", async () => {
    render(<Harness />);
    await frame({ kind: "typing", payload: true });
    await frame({ kind: "attachments", payload: ["/1.png", "/2.png", "/3.png", "/4.png", "/5.png"] });
    expect(await screen.findAllByRole("img")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Show 1 more" }));
    expect(screen.getAllByRole("img")).toHaveLength(5);
    await text("s1", "Here is an updated version", 1, true);
    await frame({ kind: "attachments", payload: ["/1.png"] });
    expect(screen.getAllByRole("img")).toHaveLength(6);
    fireEvent.error(screen.getAllByRole("img")[0]);
    expect(screen.getByText("Preview unavailable · Open file")).toBeInTheDocument();
  });
});

it("restarts Working elapsed time after Writing and waiting", () => {
  vi.useFakeTimers();
  const { rerender } = render(<ActivityLine phase="working" />);
  act(() => vi.advanceTimersByTime(4000));
  expect(screen.getByText("4s")).toBeInTheDocument();
  rerender(<ActivityLine phase="writing" />);
  rerender(<ActivityLine phase="working" />);
  expect(screen.queryByText("4s")).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByText("3s")).toBeInTheDocument();
  rerender(<ActivityLine phase="waiting" />);
  expect(screen.queryByText("3s")).not.toBeInTheDocument();
});

it("shows literal structured inputs, with raw and copy controls", () => {
  const args = { paths: ["/a folder/image.png"], caption: "*Literal* caption", options: { count: 2 } };
  render(<ToolInput args={args} argsText={JSON.stringify(args)} />);
  expect(screen.getByText("/a folder/image.png")).toBeInTheDocument();
  expect(screen.getByText("*Literal* caption")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Raw JSON" }));
  expect(screen.getByRole("button", { name: "Copy input" })).toBeInTheDocument();
  expect(document.querySelector("pre")?.textContent).toBe(JSON.stringify(args, null, 2));
});
