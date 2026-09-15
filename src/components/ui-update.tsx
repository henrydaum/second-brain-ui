import { useState, useSyncExternalStore } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sdk } from "@/lib/client";

type Job = { id: string; running: boolean; code?: number; output?: string };
type Progress = { busy: boolean; message: string; output: string; success: boolean };
let progress: Progress = { busy: false, message: "", output: "", success: false };
const listeners = new Set<() => void>();
function publish(next: Partial<Progress>) {
  progress = { ...progress, ...next };
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Kept outside the panel so navigating Settings does not lose the process or
// start a second updater. The kernel retains the full output in its process log.
async function update(cwd: string) {
  if (progress.busy) return;
  publish({ busy: true, success: false, output: "", message: "Waiting for permission to start the UI update…" });
  try {
    const started = await sdk<Job>("proc.start", {
      argv: ["sh", "-c", "set -eu\nprintf '\\nPulling UI repository…\\n'\ngit pull --ff-only\nprintf '\\nRepository pulled. Issuing sh deploy/macos/manage.sh update…\\n'\nsh deploy/macos/manage.sh update"],
      cwd,
      label: "Update UI",
    });
    publish({ message: "UI update started. Pulling the repository, then deploying…" });
    for (;;) {
      const job = await sdk<Job>("proc.status", { id: started.id, tail: 12000 });
      publish({ output: job.output ?? "" });
      if (!job.running) {
        if (job.code !== 0) throw new Error(`UI update failed (exit ${job.code ?? "unknown"}). See the command output below.`);
        publish({ busy: false, success: true, message: "UI update completed. Reload to use the new version." });
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
  } catch (error) {
    publish({ busy: false, message: error instanceof Error ? error.message : "Could not monitor the UI update." });
  }
}

export function UiUpdate() {
  const state = useSyncExternalStore(subscribe, () => progress);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState(() => {
    try { return localStorage.getItem("second-brain:ui-repo") ?? ""; }
    catch { return ""; }
  });
  return <div>
    <Button type="button" size="sm" variant="ghost" className="text-muted-foreground w-full justify-start gap-2 font-normal" onClick={() => setOpen(!open)} aria-expanded={open}>
      <RefreshCwIcon className="size-3.5" />Update UI
    </Button>
    {open && <section aria-label="UI update" className="mt-2 space-y-3 rounded-lg border p-3 text-sm">
      <label className="block">UI repository on the Mac
        <input className="mt-1 w-full rounded border bg-background p-2 text-base" placeholder="/Users/you/second-brain-ui" value={path} disabled={state.busy} onChange={(event) => setPath(event.target.value)} />
      </label>
      <Button size="sm" disabled={state.busy || !path.trim().startsWith("/")} onClick={() => {
        try { localStorage.setItem("second-brain:ui-repo", path.trim()); } catch { /* Optional preference. */ }
        void update(path.trim());
      }}>{state.busy ? "Updating…" : "Start UI update"}</Button>
      <p role="status" className="break-words text-xs">{state.message}</p>
      {state.output && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{state.output}</pre>}
      {state.success && <Button size="sm" onClick={() => window.location.reload()}>Reload UI</Button>}
    </section>}
  </div>;
}
