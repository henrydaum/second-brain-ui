/**
 * Which turn each file belongs to, and one row per file rather than per event.
 *
 * ## Attribution has two paths, and mixing them is the bug
 *
 * A ledger row does not say which turn it came from — there is no turn id in
 * the ledger and no message id on the wire — so the join has to be made here,
 * and the right way to make it depends on where the rows came from.
 *
 * **Reading a conversation back**: bucket by time. Every timestamp in play is
 * the server's own — `conversation_messages.timestamp` and the ledger's `ts`
 * are written by the same process — and the kernel stores an assistant row
 * *before* running the tools it announces, while `toTurns` folds a whole tool
 * loop into one turn starting at that first row. So an event belongs to the
 * last assistant turn that had started when it happened. That is `bindByTime`.
 *
 * **Watching one happen**: do not bucket by time at all. A live turn is stamped
 * `Date.now()` in *this browser*, and the server is a Mac Mini behind a tunnel;
 * the two clocks agree only by luck. Incremental rows are handed straight to
 * the turn that was open when they were polled, by identity. The provider does
 * that; there is nothing to compute.
 *
 * Keeping those separate is why clock skew cannot break this feature.
 *
 * ## Events are not rows in a panel
 *
 * A file written eight times during a turn is one line saying "edited ×8", not
 * eight lines. A rename is one line, not a dead path and a live one. `collapse`
 * is that reduction, and it is the reason this module is worth testing.
 */

import type { FileEffect, FileEvent } from "@/lib/ledger";
import type { Turn } from "@/runtime/store";

/**
 * The bucket for events belonging to no assistant turn.
 *
 * Reachable two ways, both real: an event stamped before the first reply, and a
 * slash command's file activity — a command turn produces no message parts, so
 * `typing: false` filters the turn away entirely and there is nothing left to
 * attribute to. Showing these under their own heading is better than dropping
 * them, since they did happen.
 */
export const UNATTRIBUTED = "unattributed";

/** One file, and everything that happened to it within one turn. */
export type FileEntry = {
  path: string;
  /** The most recent thing that happened to it. */
  effect: FileEffect;
  /** How many times, for "edited ×8". Always at least 1. */
  edits: number;
  /** The paths were read off a command line rather than serviced by the
   *  kernel — a weaker claim, worth a badge. */
  viaShell: boolean;
  /** Epoch milliseconds of the most recent event. */
  ts: number;
  /** The file is not there any more, so there is nothing to open. */
  gone: boolean;
  /** Where a renamed file came from, when this entry is the destination. */
  movedFrom?: string;
  /** The command line, when a shell did it. */
  command?: string;
};

/** One turn's worth, as the drawer draws it. */
export type FileSection = {
  /** A turn id, or `UNATTRIBUTED`. */
  turnId: string;
  /** When the turn began, epoch milliseconds. Absent for `UNATTRIBUTED` and
   *  for a stored turn whose row carried no time. */
  at?: number;
  /** Files the agent chose to show you. */
  shown: FileEntry[];
  /** Files it changed. */
  touched: FileEntry[];
};

/**
 * Bucket events onto the turn that was running when they happened.
 *
 * Only assistant turns are boundaries. A user turn is not somewhere file
 * activity can belong — the person did not do any of this — so an event
 * between a question and its first reply row lands on the previous answer,
 * which is where it was in fact still running.
 */
export function bindByTime(
  events: FileEvent[],
  turns: Turn[],
): Map<string, FileEvent[]> {
  const starts = turns
    .filter((turn) => turn.role === "assistant" && turn.createdAt !== undefined)
    .map((turn) => ({ id: turn.id, at: turn.createdAt as number }));

  const bound = new Map<string, FileEvent[]>();
  for (const event of events) {
    // Backwards, because turns are in order and the answer is nearly always
    // one of the last few. A conversation never has enough turns for this to
    // be worth a binary search.
    let id = UNATTRIBUTED;
    for (let i = starts.length - 1; i >= 0; i--) {
      if (starts[i].at <= event.ts) {
        id = starts[i].id;
        break;
      }
    }
    const list = bound.get(id);
    if (list) list.push(event);
    else bound.set(id, [event]);
  }
  return bound;
}

/**
 * Fold in the attachments the store already has, for as long as it needs to.
 *
 * **The ledger is the record; the frame is only the notification.** An
 * `attachments` frame lands in the store the instant the agent shows you
 * something, while the ledger row naming the same file is not read until the
 * next poll. Without this the file would take a beat to appear; with it, it
 * appears at once.
 *
 * **The stand-in has to be dropped conversation-wide, not per turn.** Both
 * copies name one file, but they need not land on the same turn: the frame goes
 * to whichever turn was open when it arrived, and the ledger row goes to
 * whichever turn its `since_id` poll caught. When those disagree — and a turn
 * boundary crossing between the two is enough — a per-turn merge leaves the
 * file listed twice, in two different sections, which is exactly what it did.
 * So a path the ledger knows about anywhere gets no stand-in at all.
 *
 * That also explains the reported symptom that a reload "fixed" it: a reloaded
 * conversation has no frames, so there was never a second copy to disagree.
 *
 * User attachments are skipped. Those are the person's files, named rather than
 * fetched, and their own message already shows them.
 */
export function withStoreAttachments(
  bound: Map<string, FileEvent[]>,
  turns: Turn[],
): Map<string, FileEvent[]> {
  const recorded = new Set<string>();
  for (const events of bound.values()) {
    for (const event of events) {
      if (event.effect === "shown") recorded.add(event.path);
    }
  }

  const merged = new Map(bound);
  for (const turn of turns) {
    if (turn.role !== "assistant") continue;
    const paths = turn.parts
      .flatMap((part) =>
        part.kind === "files" && part.sent !== true ? part.paths : [],
      )
      .filter((path) => !recorded.has(path));
    if (!paths.length) continue;

    merged.set(turn.id, [
      ...(merged.get(turn.id) ?? []),
      ...paths.map((path) => ({
        // Negative, so nothing mistakes it for a row that could be polled
        // again — this event exists only until the ledger catches up.
        rowId: -1,
        ts: turn.createdAt ?? 0,
        path,
        effect: "shown" as const,
        viaShell: false,
      })),
    ]);
  }

  return merged;
}

/**
 * Events → one entry per file.
 *
 * Shown and edited stay apart, because they are different claims about the same
 * file and a file can honestly be both: the agent wrote a chart and then showed
 * it to you.
 *
 * Expects newest-first input, which is what `ledger.read` gives. The first
 * event seen for a path is therefore the current state of it, and the rest only
 * add to the count.
 */
export function collapse(events: FileEvent[]): {
  shown: FileEntry[];
  touched: FileEntry[];
} {
  const shown = new Map<string, FileEntry>();
  const touched = new Map<string, FileEntry>();

  // A rename names both ends in one row. The destination is the file; the
  // source is a path that no longer exists and is not worth a line of its own,
  // so it is folded into the destination's entry as where it came from. Both
  // ends are indexed by row id first, because the two events can be any
  // distance apart in the list.
  const ends = new Map<number, { from?: string; to?: string }>();
  for (const event of events) {
    if (event.effect !== "moved-from" && event.effect !== "moved-to") continue;
    const pair = ends.get(event.rowId) ?? {};
    if (event.effect === "moved-from") pair.from = event.path;
    else pair.to = event.path;
    ends.set(event.rowId, pair);
  }

  for (const event of events) {
    const pair = ends.get(event.rowId);
    if (event.effect === "moved-from" && pair?.to !== undefined) continue;

    const into = event.effect === "shown" ? shown : touched;
    const existing = into.get(event.path);
    if (existing) {
      existing.edits++;
      continue;
    }

    const movedFrom = event.effect === "moved-to" ? pair?.from : undefined;
    into.set(event.path, {
      path: event.path,
      effect: event.effect,
      edits: 1,
      viaShell: event.viaShell,
      ts: event.ts,
      gone: event.effect === "deleted" || event.effect === "moved-from",
      ...(movedFrom === undefined ? {} : { movedFrom }),
      ...(event.command === undefined ? {} : { command: event.command }),
    });
  }

  return { shown: [...shown.values()], touched: [...touched.values()] };
}

/**
 * The drawer's list: one section per turn, **oldest first**.
 *
 * Same direction as the transcript, and for the same reason. A conversation
 * reads downwards and the newest reply is at the bottom; a panel beside it that
 * ran the other way meant reading two timelines at once and constantly working
 * out which way round each one was. The drawer opens scrolled to the end, so
 * "the newest" is still what you see first.
 *
 * `UNATTRIBUTED` therefore goes last: the things that land there are a running
 * command's activity and anything whose turn could not be worked out, which is
 * recent far more often than it is old.
 *
 * Turns with nothing in them produce no section, so the list stays short even
 * in a long conversation.
 */
export function toSections(
  bound: Map<string, FileEvent[]>,
  turns: Turn[],
): FileSection[] {
  const sections: FileSection[] = [];

  for (const turn of turns) {
    const events = bound.get(turn.id);
    if (!events?.length) continue;
    sections.push({
      turnId: turn.id,
      ...(turn.createdAt === undefined ? {} : { at: turn.createdAt }),
      ...collapse(events),
    });
  }

  const loose = bound.get(UNATTRIBUTED);
  if (loose?.length) {
    sections.push({ turnId: UNATTRIBUTED, ...collapse(loose) });
  }

  return sections;
}

/**
 * A section's files as one list, in the order they happened.
 *
 * `shown` and `touched` are kept apart in the section because they answer
 * different questions — the inline preview only ever wants what the agent
 * *showed* you — but a panel does not need to say which list a row came from.
 * The badge already does: a file with a tag on it was changed, and a file
 * without one was shown. Two headings saying the same thing again is two
 * headings to read past.
 *
 * Merging also fixes something the split quietly got wrong. A file the agent
 * writes and then shows you is in both lists, and that is one file — two rows
 * with the same name, one tagged and one not, reads as a bug rather than as a
 * distinction. The change is the louder fact, so it takes the row.
 */
export function entriesOf(section: FileSection): FileEntry[] {
  const byPath = new Map<string, FileEntry>();
  for (const entry of section.shown) byPath.set(entry.path, entry);
  for (const entry of section.touched) byPath.set(entry.path, entry);
  return [...byPath.values()].sort((a, b) => a.ts - b.ts);
}

/** How many files a section is about — what the count on a chip means. Distinct
 *  files, so a file that was written and then shown counts once. */
export function countOf(section: FileSection): number {
  return entriesOf(section).length;
}
