/**
 * What the connection is doing, and what went wrong.
 *
 * Both exist for the same reason: **a dropped stream looks exactly like a hung
 * agent.** Nothing else in the UI distinguishes "the server stopped talking to
 * us" from "the server is thinking", and the difference decides whether you wait
 * or go and restart something. So the transport's own state gets a permanent
 * line of its own.
 */

import type { FC } from "react";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useSecondBrain } from "@/runtime/provider";

const LABELS = {
  connecting: "Connecting…",
  open: "Connected",
  reconnecting: "Reconnecting…",
} as const;

export const SessionBar: FC = () => {
  const { status, state } = useSecondBrain();

  // "Thinking" outranks "Connected": while the agent has the turn, that is the
  // more useful of the two facts. A dropped connection still wins over both,
  // because it is the one that means something is wrong.
  const label =
    status === "open" && state.typing ? "Thinking…" : LABELS[status];

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <span className="text-sm font-medium">Second Brain</span>
      <span className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            status === "open" ? "bg-emerald-500" : "bg-amber-500",
            status !== "open" && "animate-pulse",
          )}
        />
        {label}
      </span>
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
  const { state, dismissError } = useSecondBrain();
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
        className="shrink-0 opacity-70 hover:opacity-100"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
};
