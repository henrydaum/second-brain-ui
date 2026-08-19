/**
 * Older pages of scrollback, arriving above what is on screen.
 *
 * `conv.read` answers with a page, so scrolling up asks for the one above and
 * puts it on the front. The two things that make this more than a concat are
 * both failure-shaped: prepending must not disturb transient state a person is
 * looking at, and a re-read page must not double rows.
 */

import { describe, expect, it } from "vitest";

import { initialState, reduce, type State, type Turn } from "@/runtime/store";

const turn = (id: string, text = id): Turn => ({
  id,
  role: "user",
  parts: [{ kind: "text", streamId: id, text, done: true }],
  running: false,
  aborted: false,
});

const withTurns = (...turns: Turn[]): State =>
  reduce(initialState, { type: "history", turns });

describe("olderTurns", () => {
  it("puts the page on the front, oldest first", () => {
    const state = reduce(withTurns(turn("c"), turn("d")), {
      type: "olderTurns",
      turns: [turn("a"), turn("b")],
    });

    expect(state.turns.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("drops rows already on screen rather than duplicating them", () => {
    // A page boundary can be read twice — a retry, a cursor asked for again.
    // Stored turns are keyed by row id, so a duplicate is not merely untidy:
    // React would see two children with one key and silently drop one.
    const state = reduce(withTurns(turn("b"), turn("c")), {
      type: "olderTurns",
      turns: [turn("a"), turn("b")],
    });

    expect(state.turns.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op when the whole page is already held", () => {
    const before = withTurns(turn("a"), turn("b"));

    const after = reduce(before, { type: "olderTurns", turns: [turn("a")] });

    expect(after).toBe(before);
  });

  it("is a no-op for an empty page", () => {
    const before = withTurns(turn("a"));

    expect(reduce(before, { type: "olderTurns", turns: [] })).toBe(before);
  });

  it("leaves everything transient alone", () => {
    // The reason this is not `history`. That clause resets the reducer, which
    // is right for a conversation switch and completely wrong for rows landing
    // above the one somebody scrolled up to read: a half-answered form and a
    // command panel still being read would both vanish.
    const busy: State = {
      ...withTurns(turn("b")),
      typing: true,
      error: { message: "kept" } as State["error"],
    };

    const state = reduce(busy, { type: "olderTurns", turns: [turn("a")] });

    expect(state.typing).toBe(true);
    expect(state.error).toEqual({ message: "kept" });
    expect(state.turns.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
