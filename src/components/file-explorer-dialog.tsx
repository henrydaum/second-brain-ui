import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAui } from "@assistant-ui/react";
import { ArrowUpIcon, FolderIcon, FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileKindIcon } from "@/components/file-kind-icon";
import { sdk } from "@/lib/client";
import { mentionPath, parentHostPath, readDirectory, visibleEntries, type DirectoryEntry } from "@/lib/file-explorer";
import { forgetFile } from "@/lib/files";
import { forgetThumbnail } from "@/lib/thumbnails";
import { useFileActivity } from "@/runtime/file-activity-provider";

const inputClass = "bg-background min-w-0 rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const messageOf = (error: unknown) => error instanceof Error ? error.message : "Could not load this folder.";

export function FileExplorerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const aui = useAui();
  const { view, viewing } = useFileActivity();
  const [directory, setDirectory] = useState("");
  const directoryRef = useRef("");
  const [pathInput, setPathInput] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [locationFailure, setLocationFailure] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);
  const retry = useRef<() => void>(() => {});
  const mentionFocus = useRef(false);
  const previewButton = useRef<HTMLElement | null>(null);
  const wasViewing = useRef(false);

  const navigate = useCallback(async (path: string, validate = false) => {
    const id = ++request.current;
    retry.current = () => void navigate(path, validate);
    setBusy(true);
    setFailure(null);
    try {
      const result = await readDirectory(path, validate);
      if (id !== request.current) return;
      directoryRef.current = result.path;
      setDirectory(result.path);
      setPathInput(result.path);
      setEntries(result.entries);
    } catch (error) {
      if (id === request.current) setFailure(messageOf(error));
    } finally {
      if (id === request.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const initialRequest = ++request.current;
    setBusy(true);
    setFailure(null);
    setLocationFailure(null);
    retry.current = () => setRefresh((value) => value + 1);
    // A failed shortcut read must not prevent browsing a known location.
    void Promise.allSettled([
      sdk<string>("paths.get", { name: "data" }),
      sdk<string[] | null>("config.read", { key: "fs_writable_dirs" }),
    ]).then(([data, writable]) => {
      if (!alive) return;
      const dataPath = data.status === "fulfilled" ? data.value : "";
      const folders = writable.status === "fulfilled" && Array.isArray(writable.value) ? writable.value : [];
      setLocations([...new Set([dataPath, ...folders].filter((path) => typeof path === "string" && path.length > 0))]);
      if (data.status === "rejected" || writable.status === "rejected") setLocationFailure("Some folder shortcuts could not be loaded. Refresh to retry.");
      if (initialRequest !== request.current) return;
      const target = directoryRef.current || dataPath;
      if (target) void navigate(target);
      else {
        setBusy(false);
        setFailure("Could not discover the data folder. Retry or enter a host folder path.");
      }
    });
    return () => { alive = false; ++request.current; };
  }, [open, refresh, navigate]);

  useEffect(() => {
    if (wasViewing.current && !viewing && open) previewButton.current?.focus();
    wasViewing.current = Boolean(viewing);
  }, [viewing, open]);

  const shown = useMemo(() => visibleEntries(entries, filter), [entries, filter]);
  const paths = shown.filter((entry) => !entry.is_dir).map((entry) => entry.path);
  const parent = directory ? parentHostPath(directory) : "";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!viewing) onOpenChange(next); }}>
      <DialogContent
        className="flex h-[min(94dvh,54rem)] w-[min(calc(100vw-1rem),70rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        overlayClassName="bg-black/45 backdrop-blur-[2px]"
        onEscapeKeyDown={(event) => { if (viewing) event.preventDefault(); }}
        onCloseAutoFocus={(event) => {
          if (!mentionFocus.current) return;
          event.preventDefault();
          mentionFocus.current = false;
          const composer = document.querySelector<HTMLTextAreaElement>('[data-slot="chat-composer-input"]');
          composer?.focus();
          if (composer) composer.setSelectionRange(composer.value.length, composer.value.length);
        }}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b ps-4 pe-14 sm:h-16 sm:ps-6">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg"><FolderOpenIcon className="size-4" /></span>
          <div className="min-w-0">
            <DialogTitle className="text-base">File explorer</DialogTitle>
            <DialogDescription className="text-xs">Files on your Second Brain host</DialogDescription>
          </div>
        </header>
        <div className="flex flex-col gap-2 border-b p-3 sm:p-4">
          <div className="flex flex-wrap gap-2">
            <select aria-label="Folder shortcuts" value="" className={`${inputClass} w-full sm:w-56`} onChange={(event) => void navigate(event.target.value, true)}>
              <option value="" disabled>Folder shortcuts</option>
              {locations.map((path) => <option key={path} value={path}>{path}</option>)}
            </select>
            <input aria-label="Filter filenames" placeholder="Filter filenames…" className={`${inputClass} flex-1`} value={filter} onChange={(event) => setFilter(event.target.value)} />
          </div>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void navigate(pathInput.trim(), true); }}>
            <Button type="button" variant="outline" size="icon" aria-label="Up one folder" disabled={!directory || parent === directory} onClick={() => void navigate(parent)}><ArrowUpIcon className="size-4" /></Button>
            <input aria-label="Host folder path" className={`${inputClass} flex-1`} value={pathInput} onChange={(event) => setPathInput(event.target.value)} />
            <Button type="submit" variant="outline">Go</Button>
            <Button type="button" variant="outline" size="icon" aria-label="Refresh folder" onClick={() => setRefresh((value) => value + 1)}><RefreshCwIcon className="size-4" /></Button>
          </form>
          {directory && <p className="text-muted-foreground truncate text-xs" title={directory}>{directory}</p>}
          {locationFailure && <p role="status" className="text-muted-foreground text-xs">{locationFailure}</p>}
          {failure && <div role="alert" className="text-destructive flex items-center gap-2 text-sm"><span>{failure}</span><Button variant="outline" size="sm" onClick={() => retry.current()}>Retry</Button></div>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3" aria-busy={busy}>
          {busy && <p role="status" className="text-muted-foreground p-3 text-sm">Loading folder…</p>}
          {!busy && directory && shown.length === 0 && <p className="text-muted-foreground p-3 text-sm">{entries.length ? "No matching filenames." : "This folder is empty."}</p>}
          <ul aria-label="Directory contents">
            {shown.map((entry) => <li key={entry.path} className="hover:bg-accent/50 flex min-w-0 items-center gap-2 rounded-md">
              <button type="button" disabled={busy} className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-3 text-start text-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" title={entry.path} onClick={(event) => {
                if (entry.is_dir) { void navigate(entry.path); return; }
                previewButton.current = event.currentTarget;
                for (const path of paths) { forgetFile(path); forgetThumbnail(path); }
                view(paths, paths.indexOf(entry.path));
              }}>
                {entry.is_dir ? <FolderIcon className="text-muted-foreground size-5 shrink-0" /> : <FileKindIcon path={entry.path} className="text-muted-foreground size-5 shrink-0" />}
                <span className="truncate">{entry.name}</span>
              </button>
              {!entry.is_dir && <Button variant="ghost" size="sm" className="shrink-0" disabled={busy} aria-label={`Mention ${entry.name}`} onClick={() => {
                const composer = aui.composer();
                composer.setText(mentionPath(composer.getState().text, entry.path));
                mentionFocus.current = true;
                ++request.current;
                onOpenChange(false);
              }}>Mention</Button>}
            </li>)}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
