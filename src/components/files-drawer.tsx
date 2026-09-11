/**
 * What the agent showed you and what it changed, for the whole conversation.
 *
 * **Sectioned by turn, not flat.** Attribution is most of the value: "the agent
 * wrote these four files" is a much weaker statement than "it wrote these four
 * files while answering *that*". But scoping the whole panel to one turn would
 * answer only the question you already know the answer to — the one you can see
 * on screen — and leave "where did that chart from earlier go?" with nowhere to
 * ask it. So the drawer holds the conversation, in turn-shaped sections, and
 * the chip under a message scrolls to its own.
 *
 * The shape mirrors `conversation-sidebar.tsx`, flipped to the end edge, but
 * stays an overlay until `xl`. This keeps the thread comfortable on tablets
 * and small desktops when the conversation rail is open too.
 */

import { useEffect, useRef, useState, type FC } from "react";
import { TerminalIcon, XIcon } from "lucide-react";

import { FileThumbnail } from "@/components/file-kind-icon";
import { preloadFileViewer } from "@/components/lazy-file-viewer";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { nameOf } from "@/lib/files";
import { fullTimestamp } from "@/lib/time";
import { useMediaQuery, XL_QUERY } from "@/lib/media";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type FileEntry,
} from "@/runtime/file-activity";
import { useFileActivity } from "@/runtime/file-activity-provider";

/** How long a section stays ringed after being jumped to. Long enough to
 *  notice, short enough not to become part of the design. */
const FLASH_MS = 1600;

export const FilesDrawer: FC = () => {
  const {
    sections,
    entries,
    total,
    failure,
    filesOpen,
    setFilesOpen,
    focusTurn,
    focusRequest,
    clearFocus,
    view,
  } = useFileActivity();
  const isInline = useMediaQuery(XL_QUERY);
  const focusedPaths = new Set(
    focusTurn
      ? sections
          .filter((section) => section.turnId === focusTurn)
          .flatMap((section) => [
            ...section.shown.map((entry) => entry.path),
            ...section.touched.map((entry) => entry.path),
          ])
      : [],
  );

  /**
   * The drawer is lazy-loaded and is not mounted until its first opening. If it
   * reads `filesOpen` immediately, its first painted position is already open,
   * leaving the browser no closed position to transition from. Give that first
   * mount one painted frame in the closed position. The component stays mounted
   * afterwards, so every later open and close continues to follow `filesOpen`
   * directly.
  */
  const [hasPaintedClosed, setHasPaintedClosed] = useState(false);
  useEffect(() => {
    let openFrame = 0;
    const paintFrame = window.requestAnimationFrame(() => {
      openFrame = window.requestAnimationFrame(() => setHasPaintedClosed(true));
    });
    return () => {
      window.cancelAnimationFrame(paintFrame);
      window.cancelAnimationFrame(openFrame);
    };
  }, []);
  const visible = filesOpen && hasPaintedClosed;

  const close = () => setFilesOpen(false);

  /**
   * Escape closes it, as it does for every other overlay here — but only if
   * this is the thing Escape is about.
   *
   * **A dialog opened from the drawer is in front of the drawer.** Radix
   * dismisses on a `document` keydown, and this listens on `window`, so both
   * ran: pressing Escape to put a file away also put the panel it was opened
   * from away. One Escape, two layers, and the wrong one lost. So the outer
   * layer stands down whenever an inner one is on screen.
   */
  useEffect(() => {
    if (!isInline || !visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      setFilesOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, isInline, setFilesOpen]);

  // Jumping to a section, when the chip under a message asked for one. The
  // clear is on a timer rather than on the scroll finishing, because a smooth
  // scroll has no completion event worth waiting for.
  // A Sheet mounts its portal after the parent effect. Observe node arrival too.
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!focusTurn || !visible) return;
    if (!body) return;
    const targets = [...body.querySelectorAll<HTMLElement>("[data-file-path]")]
      .filter((element) => focusedPaths.has(element.dataset.filePath ?? ""));
    if (!targets.length) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = targets.at(-1)!;
    const bodyRect = body.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const delta = rect.top < bodyRect.top ? rect.top - bodyRect.top - 8
      : rect.bottom > bodyRect.bottom ? rect.bottom - bodyRect.bottom + 8 : 0;
    if (delta) body.scrollTo({ top: body.scrollTop + delta, behavior: reduced ? "instant" : "smooth" });
    const layers = targets.map((element) =>
      element.querySelector<HTMLElement>("[data-file-highlight]")!);
    const animations = layers.map((layer) => {
      if (reduced) { layer.style.opacity = "1"; return null; }
      return layer.animate([
        { opacity: 0, offset: 0, easing: "ease-in-out" },
        { opacity: 1, offset: 0.125 },
        { opacity: 1, offset: 0.6875, easing: "ease-in-out" },
        { opacity: 0, offset: 1 },
      ], { duration: FLASH_MS, easing: "linear" });
    });
    const timer = setTimeout(clearFocus, FLASH_MS);
    return () => {
      clearTimeout(timer);
      animations.forEach((animation) => animation?.cancel());
      layers.forEach((layer) => { layer.style.opacity = ""; });
    };
  }, [focusTurn, focusRequest, visible, clearFocus, sections, body]);

  /**
   * Opened from the header, with no particular turn in mind: show the end, the
   * way the transcript does. The list runs oldest-first to match the chat, so
   * the newest files are at the bottom and this is what puts them on screen.
   *
   * Once per opening, hence the ref. Re-running it as the conversation grew
   * would yank the panel away from somebody who had scrolled up to read it,
   * and re-running it when the flash clears would undo the jump the chip
   * just made.
   *
   * It waits for something to land on. Opening the panel during the ledger
   * read — which is easy, the button is right there at boot — otherwise
   * scrolled an empty list to its bottom, counted that as done, and left a
   * long conversation's files sitting at the oldest end.
   */
  const landed = useRef(false);
  useEffect(() => {
    if (!visible) {
      landed.current = false;
      return;
    }
    if (landed.current || sections.length === 0) return;
    landed.current = true;
    if (focusTurn) return; // the jump above owns the scroll this time
    if (body) body.scrollTop = body.scrollHeight;
  }, [visible, focusTurn, sections.length, body]);

  /** The turn still being written, so its section can say so rather than
   *  wearing a clock time that is only seconds old. */
  /**
   * The panel itself, positioned by whoever is showing it.
   *
   * **No off-canvas machinery of its own** — see the same note on
   * `conversation-sidebar.tsx`. Below `xl` this is handed to the `Sheet` at the
   * bottom of this file, which is already a fixed, scrimmed, animated overlay;
   * from `xl` it is in the flow and animates its own width, so opening it
   * reflows the thread rather than covering the part you were reading. The two
   * paths are mutually exclusive, so the `fixed`/`translate-x` pair this used
   * to carry was dead in both.
   */
  const drawer = (
    <aside
      data-slot="files-drawer"
      aria-label="Files"
      // `inert` rather than unmounting: the panel keeps its scroll position
      // between openings, and a closed overlay must not hold focus or be
      // reachable by tab.
      inert={!visible}
      className={cn(
        "sb-panel sb-divider-start bg-sidebar flex h-full w-full flex-col overflow-hidden",
        "xl:shrink-0 xl:transition-[width]",
        visible ? "xl:w-96" : "xl:w-0 xl:border-s-0",
      )}
    >
      {!isInline && <SheetTitle className="sr-only">Files</SheetTitle>}
      {/* The inner width is pinned from `xl` and only there: the panel
          animates out to `xl:w-0`, and contents that shrank with it would
          reflow the whole list on the way. Below `xl` they simply fill the
          sheet. */}
      <header className="sb-divider-bottom flex h-12 w-full shrink-0 items-center gap-2 px-2 xl:w-96">
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
          Files
          {total > 0 && (
            <span className="text-muted-foreground ms-2 text-xs font-normal tabular-nums">
              {total}
            </span>
          )}
        </span>
        <TooltipIconButton
          tooltip="Hide files"
          side="left"
          className="size-8"
          onClick={close}
        >
          <XIcon className="size-4" />
        </TooltipIconButton>
      </header>

      <div
        ref={setBody}
        className="min-h-0 w-full flex-1 overflow-y-auto xl:w-96"
      >
        {failure ? (
          <p className="text-muted-foreground p-4 text-xs">{failure}</p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground p-4 text-xs">
            Nothing yet. Files the agent shows you, and files it writes,
            appear here as it works.
          </p>
        ) : (
          <FileList
            entries={entries}
            onOpen={view}
          />
        )}
      </div>
    </aside>
  );

  if (isInline) return drawer;

  return (
    <Sheet open={visible} onOpenChange={setFilesOpen}>
      <SheetContent side="right" className="w-80 max-w-[85vw] border-0">
        {drawer}
      </SheetContent>
    </Sheet>
  );
};

const FileList: FC<{
  entries: FileEntry[];
  onOpen: (paths: string[], index: number) => void;
}> = ({ entries, onOpen }) => {
  // One list for the arrows to walk, in the order the section draws them, so
  // "next" in the viewer means what it looks like it means.
  const openable = entries
    .filter((entry) => !entry.gone)
    .map((entry) => entry.path);

  const open = (entry: FileEntry) => {
    const index = openable.indexOf(entry.path);
    if (index >= 0) onOpen(openable, index);
  };

  return (
    <section className="px-2 py-2">
      {/* The turn, and nothing else. No count beside it: the rows underneath
          are the count, and no "shown"/"changed" headings either — a row that
          was changed says so on itself, and one that was not is a row the
          agent showed you. */}
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <Row
            key={entry.path}
            entry={entry}
            onOpen={open}
          />
        ))}
      </ul>
    </section>
  );
};

/** What a section is called. `UNATTRIBUTED` gets a name that says what it is
 *  rather than a time it does not have — see the constant's own note. */
/**
 * One file.
 *
 * **A file that is gone is not a button.** Its path is a record of what
 * happened, not a promise it is still there, and offering to open something
 * that can only answer 404 is an invitation to a dead end. It stays in the list
 * — it is half the point of the list — struck through and inert.
 */
const Row: FC<{
  entry: FileEntry;
  onOpen: (entry: FileEntry) => void;
}> = ({ entry, onOpen }) => {
  const inside = (
    <>
      {/* Any image still on disk gets its own picture, whether the agent showed
          it to you or merely wrote it — a thumbnail identifies a file faster
          than its name does, and there is no reason the two cases should look
          different. A file that is gone gets no `path`, so nothing is fetched
          for it and the icon stands alone. */}
      <FileThumbnail
        name={entry.path}
        path={entry.gone ? undefined : entry.path}
        // The last thing that happened to this file, which is what makes a
        // cached thumbnail safe: the agent editing a picture changes the
        // timestamp, and a changed timestamp is a different cache key.
        version={entry.ts}
        className="size-9 rounded"
        iconClassName="size-4"
      />

      <span className="flex min-w-0 flex-1 flex-col text-start">
        <span
          className={cn(
            "truncate text-xs font-medium",
            entry.gone && "text-muted-foreground line-through",
          )}
        >
          {nameOf(entry.path)}
        </span>
        <Badges entry={entry} />
      </span>
    </>
  );

  const className =
    "relative isolate flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-start";

  // Where the file lives is not in this list at all — not as a line, and not
  // as a tooltip either. The full host path is three times the width of the
  // panel, and the viewer already puts it under the filename the moment you
  // open one. A row is a name, a picture and what happened to it.
  return (
    <li>
      {entry.gone ? (
        <div className={className}>{inside}</div>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              data-file-path={entry.path}
              type="button"
              onClick={() => onOpen(entry)}
              onPointerEnter={preloadFileViewer}
              onFocus={preloadFileViewer}
              className={cn(
                className,
                "hover:bg-accent focus-visible:bg-accent",
              )}
            >
              <span data-file-highlight aria-hidden className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-accent opacity-0" />
              {inside}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" variant="subtle">
            {fullTimestamp(new Date(entry.ts))}
          </TooltipContent>
        </Tooltip>
      )}
    </li>
  );
};

const Badges: FC<{ entry: FileEntry }> = ({ entry }) => {
  const words: string[] = [];
  switch (entry.effect) {
    case "shown":
      break;
    case "deleted":
      words.push("deleted");
      break;
    case "moved-from":
      words.push("moved away");
      break;
    case "moved-to":
      words.push(
        entry.movedFrom ? `moved from ${nameOf(entry.movedFrom)}` : "moved",
      );
      break;
    case "wrote":
      words.push(entry.edits > 1 ? `edited ×${entry.edits}` : "edited");
      break;
  }

  if (!words.length && !entry.viaShell) return null;

  return (
    <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[11px]">
      {words.map((word) => (
        <span key={word} className="bg-muted rounded px-1 py-px">
          {word}
        </span>
      ))}
      {/* A weaker claim than the rest, so it says so. These paths were read out
          of a command line rather than serviced by the kernel. */}
      {entry.viaShell && (
        <span
          className="inline-flex items-center gap-0.5"
          title={entry.command ?? "Read from a shell command line"}
        >
          <TerminalIcon className="size-3" aria-hidden />
          shell
        </span>
      )}
    </span>
  );
};
