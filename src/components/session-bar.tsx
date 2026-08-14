/**
 * What the connection is doing, and what went wrong.
 *
 * Both exist for the same reason: **a dropped stream looks exactly like a hung
 * agent.** Nothing else in the UI distinguishes "the server stopped talking to
 * us" from "the server is thinking", and the difference decides whether you wait
 * or go and restart something. So the transport's own state gets a permanent
 * line of its own.
 */

import { useEffect, type FC } from "react";
import { FilesIcon, PanelLeftOpenIcon, XIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { ConversationMenu } from "@/components/conversation-menu";
import { NotificationPanel } from "@/components/notification-panel";
import { preloadFilesDrawer } from "@/components/lazy-files-drawer";
import { cn } from "@/lib/utils";
import { useFileActivity } from "@/runtime/file-activity-provider";
import { useSession } from "@/runtime/provider";

const LABELS = {
  connecting: "Connecting…",
  open: "Connected",
  reconnecting: "Reconnecting…",
} as const;

export const SessionBar: FC<{ onOpenNav: () => void }> = ({ onOpenNav }) => {
  const { status } = useSession();
  const { filesOpen, setFilesOpen, total } = useFileActivity();
  const label = LABELS[status];

  useEffect(() => {
    const timer = window.setTimeout(preloadFilesDrawer, 900);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 px-2 sm:px-4">
      {/* Below `md` the sidebar is an off-canvas drawer, so the only way back
          to it is from out here. */}
      <TooltipIconButton
        tooltip="Show conversations"
        side="bottom"
        className="size-8 md:hidden"
        onClick={onOpenNav}
      >
        <PanelLeftOpenIcon className="size-4" />
      </TooltipIconButton>

      {/* Which conversation you are in, and — since it is the thing you point
          at when you mean "this conversation" — what you can do to it. */}
      <ConversationMenu />

      {/**
       * The chrome at the far end, spaced by padding rather than by a gap.
       *
       * **These three have to look evenly spaced, and a `gap` cannot do it.**
       * An icon button is a box with its glyph centred in it, so it brings
       * padding of its own to every edge; the status indicator is text and
       * brings none. One `gap` across the row therefore lands as two different
       * measurements — glyph to glyph read 16px and 24px on a desktop — and the
       * coarse-pointer floor pushed them further apart on a phone by growing
       * only the buttons. So the group sets no gap at all and pads the odd one
       * out to match, leaving a single rhythm that follows whatever size the
       * buttons happen to be.
       *
       * The gap on top of that is the desktop's original spacing between two
       * icon buttons, kept: padding alone makes the row even but also tighter
       * than it was, and there is room up here for the looser measurement. A
       * phone has no room to spare and the touch floor has already spent it,
       * so down there the padding is the whole of it.
       */}
      <div className="flex shrink-0 items-center gap-0 pointer-fine:gap-2">
        <span
          className="text-muted-foreground flex shrink-0 items-center gap-2 px-(--header-control-inset) text-xs"
          // The transport's state, announced when it changes: a dropped stream
          // looks exactly like a thinking agent, and only this tells them apart.
          role="status"
          aria-live="polite"
        >
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              status === "open" ? "bg-emerald-500" : "bg-amber-500",
              status !== "open" && "animate-pulse",
            )}
          />
          {/* The dot alone carries this below `sm`, where the header is
              tight. */}
          <span className="hidden sm:inline">{label}</span>
          <span className="sr-only sm:hidden">{label}</span>
        </span>

        {/* Before Files, which keeps Files hard against the edge its drawer
            comes out of. The bell's panel is a popover and has no edge of its
            own to line up with. */}
        <NotificationPanel />

        {/* Last in the row, against the edge the panel comes out of — the same
            pairing the conversations button has with the sidebar at the other
            end. Not hidden at any width, unlike that one: the files panel
            starts closed everywhere, so this is the only way to it. */}
        <TooltipIconButton
          tooltip={filesOpen ? "Hide files" : "Show files"}
          side="bottom"
          className="relative size-8"
          aria-expanded={filesOpen}
          onPointerEnter={preloadFilesDrawer}
          onFocus={preloadFilesDrawer}
          onClick={() => setFilesOpen(!filesOpen)}
        >
          <FilesIcon className="size-4" />
          {/* A dot rather than a number. How *many* files there are is the
              drawer's business; whether there are any is the only thing worth
              saying from out here, and it is what decides whether opening it is
              worth doing. */}
          {total > 0 && !filesOpen && (
            <span
              aria-hidden
              className="bg-primary absolute end-1 top-1 size-1.5 rounded-full"
            />
          )}
        </TooltipIconButton>
      </div>
    </header>
  );
};

/**
 * An `error` frame, shown until dismissed.
 *
 * Rendered above the composer rather than inside the thread: an error is about
 * the turn as a whole, not about a message, and the kernel does not tell us
 * which message it belonged to.
 */
export const ErrorBanner: FC = () => {
  const { state, dismissError } = useSession();
  if (!state.error) return null;

  /**
   * The server has this session recorded as another frontend's.
   *
   * **This should not be reachable.** The kernel's owner check is about
   * sessions, not conversations: it stops one frontend declaring another's
   * session attended, since attendance is what decides whether an unsafe
   * Request raises a dialog rather than being refused. Our session key is
   * always `http:<thread>` and we are always the http frontend, so the two can
   * only disagree if something mislabelled the session.
   *
   * Native frontends survive being mislabelled because `_tag_session` re-stamps
   * the session with their own name on every use — the REPL and Telegram open
   * each other's conversations all day without noticing. This frontend cannot,
   * and the reason it is fatal rather than untidy is a deadlock: every Request
   * the bridge makes goes through `frontend.act`, *including the submit that
   * would trigger the re-tag*, so the repair path sits behind the check that is
   * failing.
   *
   * Hence the wording: an inconsistency, not a rule. Presenting it as how the
   * system works would teach the wrong thing about conversations, which are
   * rows in a database and belong to no frontend at all.
   */
  const taken = state.error.details === "session_taken";

  return (
    <div
      data-slot="error-banner"
      className="border-destructive bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm"
    >
      <div className="flex-1">
        <p>
          {taken
            ? "Second Brain has this session filed under another frontend's name and is refusing to act on it. That is a stale label rather than anything you did."
            : (state.error.message ?? "Something went wrong.")}
          {!taken && state.error.code && (
            <span className="ml-2 font-mono text-xs opacity-70">
              {state.error.code}
            </span>
          )}
        </p>
        {taken && (
          <>
            <p className="mt-1 text-xs opacity-80">
              Restarting Second Brain clears it, since sessions are only held in
              memory. A fresh session works too — your conversations are in the
              database and belong to no frontend.
            </p>
            <button
              onClick={() => {
                // A thread name the server has never seen is a new session, and
                // the only recovery that does not need the server restarted.
                const url = new URL(window.location.href);
                url.searchParams.set("thread", `web-${Date.now()}`);
                window.location.assign(url);
              }}
              className="border-destructive mt-2 rounded-md border px-2 py-1 text-xs"
            >
              Start a fresh session
            </button>
          </>
        )}
      </div>
      <button
        onClick={dismissError}
        aria-label="Dismiss"
        className="focus-visible:ring-ring shrink-0 rounded-md opacity-70 outline-none hover:opacity-100 focus-visible:ring-2"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
};
