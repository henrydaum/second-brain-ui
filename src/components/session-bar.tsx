import type { Session } from "@/lib/api";

/**
 * What the server thinks is going on, read-only.
 *
 * It earns its place mainly because of `mode`: that is the standing answer the
 * approver gives, and therefore what decides whether you are asked about a
 * shell command at all. Without it on screen, "why did it not prompt me?" is
 * unanswerable from the UI.
 */
export function SessionBar({
  title,
  session,
  reachable,
}: {
  title: string;
  session: Session;
  reachable: boolean;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4 text-sm">
      <span className="truncate font-medium">{title}</span>

      {session ? (
        <span className="text-muted-foreground">
          mode: <span className="font-mono">{session.mode}</span>
        </span>
      ) : null}

      <span className="ml-auto flex items-center gap-2 text-xs">
        <span
          aria-hidden
          className={
            reachable
              ? "size-2 rounded-full bg-green-500"
              : "bg-destructive size-2 rounded-full"
          }
        />
        <span className="text-muted-foreground">
          {reachable ? "connected" : "unreachable"}
        </span>
      </span>
    </header>
  );
}
