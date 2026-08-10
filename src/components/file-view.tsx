/**
 * Showing a host file, whatever it turns out to be.
 *
 * One component, one prop, six outcomes — because the alternative is every
 * caller deciding for itself what a `.png` is, and a drawer that draws files
 * differently from the transcript that produced them.
 *
 * **The bytes come from `/files`, not from `fs.read_bytes`.** The older path
 * (`downloadFromHost` → `Blob` → object URL) works for a small image and cannot
 * work at all for video: seeking needs `Range`, and `Range` needs a URL. It also
 * meant holding every file a long conversation ever showed in memory at once.
 * `fileUrl` hands the browser a real URL with a real `Content-Type` and lets it
 * do what it is good at.
 *
 * **Every kind wears the same frame.** A bordered box, the same skeleton while
 * it loads, the same one-line explanation when it fails. The point is that a
 * CSV and an MP4 look like two views of one system rather than two features,
 * and that a failure reads as a fact about the file rather than as the UI
 * breaking.
 *
 * All of this is a single file rather than a directory: the renderers are ten
 * to thirty lines each and they only make sense next to the frame they share.
 */

import { useEffect, useState, type FC, type ReactNode } from "react";
import {
  DownloadIcon,
  FileIcon,
  MusicIcon,
} from "lucide-react";

import { DotMatrix } from "@/components/assistant-ui/dot-matrix";
import { fileUrl } from "@/lib/client";
import { delimiterFor, parseDelimited } from "@/lib/csv";
import {
  describeStatus,
  FileUnavailable,
  formatBytes,
  kindOf,
  nameOf,
  probeStatus,
  readText,
  suffixOf,
  type FileKind,
} from "@/lib/files";
import { cn } from "@/lib/utils";

/** How much of a table anybody reads in a pane. Past this it is a data set
 *  rather than a document, and the download link is the honest offer. */
const ROW_CAP = 200;

export type FileViewSize = "inline" | "full";

/* ── The shared frame ───────────────────────────────────────────────── */

const Frame: FC<{ children: ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div
    data-slot="file-view"
    className={cn(
      "bg-muted/30 flex items-center justify-center overflow-hidden rounded-lg border",
      className,
    )}
  >
    {children}
  </div>
);

/**
 * Nothing yet.
 *
 * **At `full` this fills whatever it is given rather than choosing a size.**
 * The viewer hands it a stage of fixed dimensions, so the box you see while a
 * file loads is exactly the box the file lands in — no reflow, and nothing
 * jumping under the pointer half a second after you clicked. Sizing itself
 * here is what made the old one a thin tall sliver that then sprang open.
 */
const Loading: FC<{ path: string; size: FileViewSize }> = ({ path, size }) => (
  <Frame className={size === "full" ? "size-full" : "h-40 w-full"}>
    <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
      <DotMatrix state="loading" aria-hidden />
      {nameOf(path)}
    </span>
  </Frame>
);

/**
 * Why there is nothing to show.
 *
 * **A path in a ledger row is a record of what happened, not a promise the file
 * is still there.** So this is an ordinary outcome rather than an error state,
 * and it says which outcome: a file the policy refuses still exists and a file
 * that 404s does not, and those want different things done about them.
 */
const Unavailable: FC<{ path: string; reason: string; size: FileViewSize }> = ({
  path,
  reason,
  size,
}) => (
  <Frame
    className={cn(
      "flex-col gap-1 p-6 text-center",
      size === "full" ? "size-full" : "w-full",
    )}
  >
    <FileIcon className="text-muted-foreground size-5" aria-hidden />
    <span className="text-sm font-medium">{nameOf(path)}</span>
    <span className="text-muted-foreground text-xs">{reason}</span>
  </Frame>
);

/* ── Asynchronous odds and ends ─────────────────────────────────────── */

/** Whichever renderer this path wants, once the kernel has been asked. */
function useKind(path: string): FileKind | null {
  const [kind, setKind] = useState<FileKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    setKind(null);
    void kindOf(path).then((answer) => {
      if (!cancelled) setKind(answer);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return kind;
}

type Loaded = { text: string; truncated: boolean; total: number };

/** A text-shaped file, whole — see `fetchWhole` for why that takes a loop, and
 *  `readText` for why it usually does not have to. */
function useText(path: string): {
  loaded: Loaded | null;
  failure: string | null;
} {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setFailure(null);

    void (async () => {
      try {
        const whole = await readText(path);
        if (!cancelled) setLoaded(whole);
      } catch (error) {
        if (cancelled) return;
        setFailure(
          error instanceof FileUnavailable
            ? error.message
            : "This file could not be read.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path]);

  return { loaded, failure };
}

/**
 * What a media element's silent failure actually was.
 *
 * `<img>` and `<video>` report trouble as a bare `onError` with no status on it
 * anywhere, so a deleted file and a refused one look identical. One `HEAD`
 * afterwards is what turns that into the right sentence — and it only costs a
 * round trip on the path where something already went wrong.
 */
function useMediaFailure(path: string) {
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => setFailure(null), [path]);

  const onError = () => {
    void probeStatus(path).then((status) =>
      setFailure(
        status === 0
          ? "This file could not be reached."
          : status < 300
            ? // The file is there and readable, so the element is the one
              // objecting: a codec the browser has no decoder for, or bytes
              // that do not match the extension they were given.
              "This file is there, but the browser could not display it."
            : describeStatus(status),
      ),
    );
  };

  return { failure, onError };
}

/* ── The renderers ──────────────────────────────────────────────────── */

const ImageView: FC<{ path: string; size: FileViewSize }> = ({ path, size }) => {
  const { failure, onError } = useMediaFailure(path);
  if (failure) return <Unavailable path={path} reason={failure} size={size} />;

  return (
    <img
      src={fileUrl(path)}
      alt={nameOf(path)}
      loading="lazy"
      decoding="async"
      onError={onError}
      className={cn(
        "rounded-lg border object-contain",
        // `max-*`, never a fixed size: the stage already has the dimensions,
        // and the picture fits itself inside them.
        size === "full" ? "max-h-full max-w-full" : "max-h-80",
      )}
    />
  );
};

const VideoView: FC<{ path: string; size: FileViewSize }> = ({ path, size }) => {
  const { failure, onError } = useMediaFailure(path);
  if (failure) return <Unavailable path={path} reason={failure} size={size} />;

  return (
    // No `preload="auto"`: the route honours Range, so the browser fetches the
    // header, draws a first frame, and leaves the rest until the scrubber asks.
    <video
      controls
      preload="metadata"
      src={fileUrl(path)}
      onError={onError}
      className={cn(
        "w-full rounded-lg border bg-black",
        size === "full" ? "max-h-full" : "max-h-80",
      )}
    />
  );
};

const AudioView: FC<{ path: string; size: FileViewSize }> = ({ path, size }) => {
  const { failure, onError } = useMediaFailure(path);
  if (failure) return <Unavailable path={path} reason={failure} size={size} />;

  return (
    <Frame className="w-full flex-col items-stretch gap-2 p-3">
      <span className="inline-flex items-center gap-2 text-xs font-medium">
        <MusicIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{nameOf(path)}</span>
      </span>
      <audio
        controls
        preload="metadata"
        src={fileUrl(path)}
        onError={onError}
        className="w-full"
      />
    </Frame>
  );
};

const TableView: FC<{ path: string; size: FileViewSize }> = ({ path, size }) => {
  const { loaded, failure } = useText(path);
  if (failure) return <Unavailable path={path} reason={failure} size={size} />;
  if (!loaded) return <Loading path={path} size={size} />;

  const rows = parseDelimited(loaded.text, delimiterFor(suffixOf(path)));
  if (!rows.length) {
    return <Unavailable path={path} reason="This file is empty." size={size} />;
  }

  // The first row is the header, which is what a spreadsheet export always
  // means by it — and being wrong costs one misnamed column rather than a
  // misread table.
  const [header, ...body] = rows;
  const shown = body.slice(0, ROW_CAP);

  return (
    <div className={cn("flex w-full flex-col", size === "full" && "h-full")}>
      {/* The scroll lives here, not on the page: a table thirty columns wide
          must not make the whole conversation scroll sideways. */}
      <Frame className="block w-full min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/60 sticky top-0">
            <tr>
              {header.map((cell, i) => (
                <th
                  key={i}
                  className="border-b px-2.5 py-1.5 text-start font-medium whitespace-nowrap"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, r) => (
              <tr key={r} className="even:bg-muted/20">
                {header.map((_, c) => (
                  <td
                    key={c}
                    className="max-w-64 truncate border-b px-2.5 py-1 align-top"
                    title={row[c] ?? ""}
                  >
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Frame>
      <p className="text-muted-foreground mt-1.5 shrink-0 text-[11px]">
        {body.length} {body.length === 1 ? "row" : "rows"}
        {shown.length < body.length && ` · showing ${shown.length}`}
        {loaded.truncated &&
          ` · read the first ${formatBytes(loaded.text.length)} of ${formatBytes(loaded.total)}`}
      </p>
    </div>
  );
};

const TextView: FC<{ path: string; size: FileViewSize }> = ({ path, size }) => {
  const { loaded, failure } = useText(path);
  if (failure) return <Unavailable path={path} reason={failure} size={size} />;
  if (!loaded) return <Loading path={path} size={size} />;

  return (
    <div className={cn("flex w-full flex-col", size === "full" && "h-full")}>
      <Frame
        className={cn(
          "block w-full overflow-auto p-3",
          size === "full" ? "min-h-0 flex-1" : "max-h-80",
        )}
      >
        {/* Shown as source rather than rendered, including for Markdown. What
            the agent wrote is the thing being inspected here, and rendering it
            would quietly hide the difference between a file and its output. */}
        <pre className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
          {loaded.text}
        </pre>
      </Frame>
      {loaded.truncated && (
        <p className="text-muted-foreground mt-1.5 shrink-0 text-[11px]">
          The first {formatBytes(loaded.text.length)} of{" "}
          {formatBytes(loaded.total)} — download it to see the rest.
        </p>
      )}
    </div>
  );
};

/** PDFs and SVGs: the browser already knows how, and the kernel has no parser
 *  for either. Modality answers `"unknown"` for both, which is exactly the case
 *  `kindOf` refuses to take as "not renderable". */
const EmbedView: FC<{ path: string; size: FileViewSize }> = ({ path, size }) => (
  <embed
    src={fileUrl(path)}
    title={nameOf(path)}
    className={cn("w-full rounded-lg border", size === "full" ? "h-full" : "h-80")}
  />
);

/** Everything with no better answer. `/files` serves it as
 *  `application/octet-stream`, which is a download, so this offers one. */
const DownloadView: FC<{ path: string }> = ({ path }) => (
  <a
    href={fileUrl(path)}
    download={nameOf(path)}
    className="hover:bg-accent inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
  >
    <DownloadIcon className="size-3.5" aria-hidden />
    {nameOf(path)}
  </a>
);

/* ── The one entry point ────────────────────────────────────────────── */

export const FileView: FC<{ path: string; size?: FileViewSize }> = ({
  path,
  size = "inline",
}) => {
  const kind = useKind(path);
  if (kind === null) return <Loading path={path} size={size} />;

  // No `default`: a seventh kind is a compile error here rather than a blank
  // pane somebody notices in a month.
  switch (kind) {
    case "image":
      return <ImageView path={path} size={size} />;
    case "video":
      return <VideoView path={path} size={size} />;
    case "audio":
      return <AudioView path={path} size={size} />;
    case "table":
      return <TableView path={path} size={size} />;
    case "text":
      return <TextView path={path} size={size} />;
    case "embed":
      return <EmbedView path={path} size={size} />;
    case "download":
      return <DownloadView path={path} />;
  }
};
