import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useApprovals } from "@/runtime/provider";
import { PRESENTATION } from "@/runtime/convert";
import { elapsedLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

export function ReplyActivity() {
  const { inputRequests } = useApprovals();
  const active = useAuiState((s) =>
    s.thread.isRunning && s.message.isLast && s.message.status?.type === "running",
  );
  const presentation = useAuiState((s) =>
    s.message.metadata.custom[PRESENTATION] as
      { phase?: string; since?: number } | undefined,
  );
  const phase = !active ? "none" : inputRequests.length ? "waiting"
    : presentation?.phase === "writing" ? "writing" : "working";
  return <ActivityLine phase={phase} since={presentation?.since} />;
}

export function ActivityLine({ phase, since }: {
  phase: "none" | "waiting" | "writing" | "working";
  since?: number;
}) {
  const [intervalStart, setIntervalStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const start = Date.now();
    setIntervalStart(start);
    setNow(start);
    if (phase !== "working") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [phase, since]);
  if (phase === "none") return null;
  const seconds = Math.max(0, Math.floor((now - intervalStart) / 1000));
  const label = phase === "writing" ? "Writing" :
    phase === "waiting" ? "Waiting for your response" : "Working";
  return (
    <div data-slot="reply-activity" data-phase={phase}
      className="text-muted-foreground my-2 flex min-h-6 items-center gap-2 text-sm"
      role="status" aria-live="polite" aria-label={label}>
      <span aria-hidden className={cn("size-1.5 rounded-full bg-current",
        phase !== "waiting" && "motion-safe:animate-pulse")} />
      <span>{label}</span>
      {phase === "working" && seconds >= 3 && (
        <span aria-hidden className="text-xs tabular-nums opacity-70">{elapsedLabel(seconds)}</span>
      )}
    </div>
  );
}
