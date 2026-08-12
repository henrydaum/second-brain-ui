/** @vitest-environment jsdom */

/**
 * Coming back to a page a phone suspended while it was in a pocket.
 *
 * The failure this guards against is silent by construction: the tab resumes
 * holding a stream that says `OPEN` and carries nothing, the status line stays
 * green, and the only symptom is a conversation that never moves again. There
 * is no error to assert on, so what gets pinned instead is the decision — when
 * a stream is thrown away, when it is left alone, and that the replacement asks
 * for what it missed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/client", () => ({
  serverUrl: (path: string) => new URL(path, "http://localhost:4173"),
  authHeaders: () => ({}),
}));

const { connect } = await import("@/lib/events");

/** Enough of an `EventSource` to be opened, driven and closed. jsdom has none
 *  of its own, and the real one would want a server. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  static opened: FakeEventSource[] = [];

  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: URL | string) {
    this.url = String(url);
    FakeEventSource.opened.push(this);
  }

  /** The server accepted it. */
  accept() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }

  /** One frame, with the sequence number the server sends as `id:`. */
  deliver(id: string, frame: unknown) {
    this.onmessage?.({
      data: JSON.stringify(frame),
      lastEventId: id,
    } as MessageEvent);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

/** The most recent stream handed out, which is the live one. */
const latest = () => FakeEventSource.opened.at(-1)!;
const openedCount = () => FakeEventSource.opened.length;

function hide() {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
}

function show() {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Long enough that an `OPEN` stream stops being believed. */
const A_WHILE = 61_000;

beforeEach(() => {
  FakeEventSource.opened = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("returning to a foregrounded page", () => {
  it("reopens a stream the browser has given up on, however brief the absence", () => {
    const close = connect(vi.fn(), vi.fn());
    latest().accept();

    // The connection died while the page was suspended — which is the state a
    // suspended page cannot have noticed, since none of its code ran.
    latest().close();
    hide();
    show();

    expect(openedCount()).toBe(2);
    close();
  });

  it("reopens a stream that still claims to be open, after a long absence", () => {
    const close = connect(vi.fn(), vi.fn());
    latest().accept();

    hide();
    vi.advanceTimersByTime(A_WHILE);
    show();

    // The zombie: `OPEN`, carrying nothing, and no event will ever say so.
    expect(openedCount()).toBe(2);
    close();
  });

  it("leaves a healthy stream alone when the absence was brief", () => {
    const close = connect(vi.fn(), vi.fn());
    latest().accept();

    hide();
    vi.advanceTimersByTime(2_000);
    show();

    // Reopening hands the session back and forth on the server. A glance at
    // another window is not evidence of anything.
    expect(openedCount()).toBe(1);
    close();
  });

  it("asks for the frames it missed", () => {
    const close = connect(vi.fn(), vi.fn());
    latest().accept();
    latest().deliver("41", { kind: "typing", payload: true });

    hide();
    vi.advanceTimersByTime(A_WHILE);
    show();

    // **The point of the whole exercise.** A `new EventSource` sends no
    // `Last-Event-ID`, so without this the reconnect would drop the turn that
    // ran while the phone was asleep — the one thing somebody came back for.
    expect(latest().url).toContain("since=41");
    close();
  });

  it("does not interrupt a first connection that is still being made", () => {
    // Opening the app in a background tab and switching to it a moment later.
    // Nothing has gone wrong yet; replacing the in-flight request with an
    // identical one would only make the first paint later.
    const close = connect(vi.fn(), vi.fn());
    hide();
    vi.advanceTimersByTime(2_000);
    show();

    expect(openedCount()).toBe(1);
    close();
  });

  it("does not ask for a replay on the first connection", () => {
    const close = connect(vi.fn(), vi.fn());
    expect(latest().url).not.toContain("since=");
    close();
  });

  it("keeps handing frames to the caller across a reopen", () => {
    const onFrame = vi.fn();
    const close = connect(onFrame, vi.fn());
    latest().accept();

    hide();
    vi.advanceTimersByTime(A_WHILE);
    show();
    latest().accept();
    latest().deliver("42", { kind: "typing", payload: false });

    expect(onFrame).toHaveBeenCalledWith({ kind: "typing", payload: false });
    close();
  });

  it("says it is reconnecting, so the resync effects run again", () => {
    const onStatus = vi.fn();
    const close = connect(vi.fn(), onStatus);
    latest().accept();
    onStatus.mockClear();

    hide();
    vi.advanceTimersByTime(A_WHILE);
    show();
    latest().accept();

    // The provider keys `reconcile`, the notification backfill and
    // `syncSession` on the transition back to "open" — which is exactly the
    // work a page returning from a suspension needs done.
    expect(onStatus.mock.calls.map(([status]) => status)).toEqual([
      "reconnecting",
      "open",
    ]);
    close();
  });

  it("opens nothing once the caller has closed it", () => {
    const close = connect(vi.fn(), vi.fn());
    latest().accept();
    close();

    hide();
    vi.advanceTimersByTime(A_WHILE);
    show();

    // StrictMode unmounts and remounts this in development. A listener that
    // outlived its stream would open a second one against the same thread and
    // quietly evict the live mount's.
    expect(openedCount()).toBe(1);
  });
});
