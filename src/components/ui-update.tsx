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
async function update() {
  if (progress.busy) return;
  publish({ busy: true, success: false, output: "", message: "Waiting for permission to start the UI update…" });
  try {
    const started = await sdk<Job>("proc.start", {
      argv: ["sh", "-c", `set -eu
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
printf '\\nLocating the installed UI repository…\\n'
ui_plist="$HOME/Library/LaunchAgents/com.secondbrain.ui.plist"
if [ ! -f "$ui_plist" ]; then
  printf 'UI installation not found: %s\\n' "$ui_plist" >&2
  exit 1
fi
ui_repo=$(/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' "$ui_plist")
cd "$ui_repo"
if [ ! -f deploy/macos/manage.sh ] || [ ! -f package.json ]; then
  printf 'The installed UI checkout is missing deployment files: %s\\n' "$ui_repo" >&2
  exit 1
fi
printf 'Found UI repository: %s\\n' "$ui_repo"
printf '\\nPulling UI repository…\\n'
git pull --ff-only
printf '\\nRepository pulled. Issuing sh deploy/macos/manage.sh update…\\n'
sh deploy/macos/manage.sh update`],
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
  return <div>
    <Button type="button" size="sm" variant="ghost" className="text-muted-foreground w-full justify-start gap-2 font-normal" onClick={() => setOpen(!open)} aria-expanded={open}>
      <RefreshCwIcon className="size-3.5" />Update UI
    </Button>
    {open && <section aria-label="UI update" className="mt-2 space-y-3 rounded-lg border p-3 text-sm">
      <Button size="sm" disabled={state.busy} onClick={() => {
        void update();
      }}>{state.busy ? "Updating…" : "Start UI update"}</Button>
      <p role="status" className="break-words text-xs">{state.message}</p>
      {state.output && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 text-xs">{state.output}</pre>}
      {state.success && <Button size="sm" onClick={() => window.location.reload()}>Reload UI</Button>}
    </section>}
  </div>;
}
