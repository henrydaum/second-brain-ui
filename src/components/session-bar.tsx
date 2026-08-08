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

  return (
    <div className="border-destructive bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm">
      <p className="flex-1">
        {state.error.message ?? "Something went wrong."}
        {state.error.code && (
          <span className="ml-2 font-mono text-xs opacity-70">
            {state.error.code}
          </span>
        )}
      </p>
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
