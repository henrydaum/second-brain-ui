/**
 * What the agent did to files, kept current, for everything that draws it.
 *
 * Three surfaces read this and they are nowhere near each other in the tree —
 * the Files button in the header, the drawer at the far edge, and a chip in
 * every assistant message's footer. That is the same reason `settingsOpen`
 * lives in the runtime provider rather than in `App`.
 *
 * It is a separate context rather than more of `runtime/provider.tsx` because
 * it owns nothing that provider owns: no frames, no session, no Requests that
 * can block on a person. It reads three things from it — which conversation,
 * which turns, and whether the agent is still typing — and does its own asking.
 *
 * ## Reading versus polling
 *
 * Renders are events and the ledger is state, so this loads once when a
 * conversation opens and then asks for the tail. `since_id` filters in SQL on
 * the `(conversation_id, id)` index, which is what makes an idle poll cheap
 * enough to do on a timer. There is no push notification for ledger rows.
 *
 * The timer only runs while a turn is running, plus one read as it ends. The
 * documented trigger is a `tool_status` frame with `status: "finished"`, but
 * raw frames do not reach this far and `typing` is the same information at a
 * coarser grain — the difference is a file appearing in the drawer up to three
 * seconds late during a turn, against wiring a second frame path through the
 * provider for it.
 */

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import { forgetFile } from "@/lib/files";
import { readLedger, toFileEvents, type FileEvent } from "@/lib/ledger";
import { forgetThumbnail } from "@/lib/thumbnails";
import {
  bindByTime,
  countOf,
  fileTurns,
  sameFileTurns,
  toSections,
  UNATTRIBUTED,
  withStoreAttachments,
  type FileSection,
} from "@/runtime/file-activity";
import { useConversations, useSession } from "@/runtime/provider";
import type { Turn } from "@/runtime/store";

/** How often to ask, while there is a turn in flight. Slow enough that an idle
 *  conversation costs nothing, quick enough that a file shows up while you are
 *  still looking at the reply that made it. */
const POLL_MS = 3000;

/** What the viewer dialog is showing: a list to step through, and where in it.
 *  The list is the section's, so the arrows walk that turn's files. */
export type Viewing = { paths: string[]; index: number };

export type FileActivity = {
  /** Sections, newest turn first, loose events on top. */
  sections: FileSection[];
  /** One turn's section, or null when it touched no files. */
  sectionFor: (turnId: string) => FileSection | null;
  /** Every file in the conversation, counted once per section it appears in. */
  total: number;
  /** Why there is nothing to show, when the reason is not "nothing happened". */
  failure: string | null;

  filesOpen: boolean;
  setFilesOpen: (open: boolean) => void;
  /** Open the drawer with one turn's section scrolled into view. */
  openFilesAt: (turnId: string) => void;
  /** The section the drawer should scroll to, until it has. */
  focusTurn: string | null;
  clearFocus: () => void;

  viewing: Viewing | null;
  view: (paths: string[], index: number) => void;
  stepView: (by: number) => void;
  closeView: () => void;
};

const FileActivityContext = createContext<FileActivity | null>(null);

export function useFileActivity(): FileActivity {
  const value = use(FileActivityContext);
  if (!value) throw new Error("useFileActivity outside FileActivityProvider");
  return value;
}

/**
 * The same context, for a caller that has to work without it.
 *
 * `FileView` is the one: it is mounted inside the provider everywhere the app
 * renders it, and standalone in its own tests — and a Markdown note that only
 * *offers* to follow a link to its neighbour should not be the thing that makes
 * rendering one outside the tree throw. Every other reader wants the loud
 * version above, because a Files button with no file activity behind it is a
 * wiring mistake rather than a degraded mode.
 */
export function useFileActivityMaybe(): FileActivity | null {
  return use(FileActivityContext);
}

/**
 * Which turn incremental rows belong to.
 *
 * **By identity, never by time.** A live turn is stamped `Date.now()` in this
 * browser and the ledger is stamped by the server; the two clocks agree by
 * luck. Rows that arrive during a turn belong to the turn that is open, and
 * that is a fact this side already knows.
 *
 * The last turn being a *user* turn is the case worth handling rather than
 * papering over: the reducer drops an assistant turn that produced no parts, so
 * a slash command's file activity has no turn left to belong to. Attributing it
 * to the previous answer would be a confident lie; `UNATTRIBUTED` is not.
 */
function openTurnId(turns: Turn[]): string {
  const last = turns.at(-1);
  return last?.role === "assistant" ? last.id : UNATTRIBUTED;
}

const highestId = (rows: { id: number }[], from: number) =>
  rows.reduce((max, row) => Math.max(max, row.id), from);

export function FileActivityProvider({ children }: PropsWithChildren) {
  const { conversationId } = useConversations();
  const { state } = useSession();

  /** Everything read in one go when the conversation opened. Left unbound to
   *  turns, because the turns may not have arrived yet — see the memo below. */
  const [historical, setHistorical] = useState<FileEvent[]>([]);
  /** Rows that arrived since, already bound to the turn they happened in. */
  const [live, setLive] = useState<Map<string, FileEvent[]>>(new Map());
  const [failure, setFailure] = useState<string | null>(null);

  const [filesOpen, setFilesOpen] = useState(false);
  const [focusTurn, setFocusTurn] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);

  /** The highest row id held, which is the poll cursor. */
  const cursor = useRef(0);
  /** Whether the opening read has finished. Polling before it has would read
   *  the whole conversation a second time and file it under one turn. */
  const ready = useRef(false);
  /** Turns, readable from a callback without making it a dependency of one —
   *  the same trick `commandsRef` plays in `runtime/provider.tsx`. */
  const turns = useRef<Turn[]>([]);
  turns.current = state.turns;

  /* ── The opening read ─────────────────────────────────────────────── */

  useEffect(() => {
    setHistorical([]);
    setLive(new Map());
    setFailure(null);
    cursor.current = 0;
    ready.current = false;
    if (conversationId === null) return;

    let cancelled = false;
    void (async () => {
      try {
        const rows = await readLedger(conversationId);
        if (cancelled) return;
        cursor.current = highestId(rows, 0);
        setHistorical(toFileEvents(rows));
      } catch {
        // Said in the drawer rather than in the error banner. A kernel with no
        // `ledger.read` would otherwise raise a banner on every conversation
        // you opened, about a panel you may never have looked at.
        if (!cancelled) {
          setFailure("Second Brain would not say which files this touched.");
        }
      } finally {
        if (!cancelled) ready.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  /* ── Keeping it current ───────────────────────────────────────────── */

  const poll = useCallback(async () => {
    if (conversationId === null || !ready.current) return;
    let rows;
    try {
      rows = await readLedger(conversationId, cursor.current);
    } catch {
      // A failed poll is not worth saying anything about: the next one is
      // three seconds away, and the drawer still holds what it had.
      return;
    }
    if (!rows.length) return;

    cursor.current = highestId(rows, cursor.current);
    const events = toFileEvents(rows);
    if (!events.length) return;

    // A row naming a file is the only notice we get that a file we may be
    // holding a copy of is no longer that file. Reading a stale version out of
    // the cache is worse than reading it again.
    for (const event of events) {
      forgetFile(event.path);
      forgetThumbnail(event.path);
    }

    const id = openTurnId(turns.current);
    setLive((previous) => {
      const next = new Map(previous);
      next.set(id, [...events, ...(next.get(id) ?? [])]);
      return next;
    });
  }, [conversationId]);

  const typing = state.typing;
  useEffect(() => {
    if (conversationId === null) return;

    if (typing) {
      const timer = setInterval(() => void poll(), POLL_MS);
      return () => clearInterval(timer);
    }

    // The turn is over — and this runs *after* the reducer has settled, which
    // matters: `typing: false` drops turns that produced nothing, and the turn
    // these rows belong to has to still exist when they are bound to it.
    void poll();
  }, [typing, conversationId, poll]);

  /* ── What the surfaces read ───────────────────────────────────────── */

  /**
   * The conversation as this panel sees it, which is a far slower-moving thing
   * than the conversation.
   *
   * `state.turns` is a new array on every streamed token, and the derivation
   * below is not cheap — it buckets every ledger event, merges, collapses each
   * section and sorts it — while this provider's value re-renders a chip inside
   * every message in the transcript. A token cannot change any of its inputs;
   * see `fileTurns`. Holding the last projection and replacing it only when it
   * genuinely differs is what turns "per token" back into "per file".
   */
  const projection = useRef<Turn[]>([]);
  if (!sameFileTurns(projection.current, state.turns)) {
    projection.current = fileTurns(state.turns);
  }
  const turnsForFiles = projection.current;

  const sections = useMemo(() => {
    // Derived rather than stored, so the historical read and the conversation
    // read can land in either order. They race, and this is what makes the
    // race not matter: whichever arrives second re-runs the binding.
    const bound = bindByTime(historical, turnsForFiles);
    for (const [turnId, events] of live) {
      bound.set(turnId, [...events, ...(bound.get(turnId) ?? [])]);
    }
    return toSections(withStoreAttachments(bound, turnsForFiles), turnsForFiles);
  }, [historical, live, turnsForFiles]);

  const byTurn = useMemo(
    () => new Map(sections.map((section) => [section.turnId, section])),
    [sections],
  );

  /** Distinct files across the whole conversation — the header button's dot.
   *  Behind the same memo as everything else, because `countOf` rebuilds a map
   *  and sorts it once per section and used to do so on every render. */
  const total = useMemo(
    () => sections.reduce((sum, section) => sum + countOf(section), 0),
    [sections],
  );

  const value = useMemo<FileActivity>(
    () => ({
      sections,
      sectionFor: (turnId) => byTurn.get(turnId) ?? null,
      total,
      failure,

      filesOpen,
      setFilesOpen,
      openFilesAt: (turnId) => {
        setFilesOpen(true);
        setFocusTurn(turnId);
      },
      focusTurn,
      clearFocus: () => setFocusTurn(null),

      viewing,
      view: (paths, index) => setViewing({ paths, index }),
      stepView: (by) =>
        setViewing((current) => {
          if (!current) return current;
          // Wraps, because a two-file group with a disabled arrow at each end
          // is more chrome than the case deserves.
          const count = current.paths.length;
          const index = (current.index + by + count) % count;
          return { ...current, index };
        }),
      closeView: () => setViewing(null),
    }),
    [sections, byTurn, total, failure, filesOpen, focusTurn, viewing],
  );

  return (
    <FileActivityContext value={value}>{children}</FileActivityContext>
  );
}
