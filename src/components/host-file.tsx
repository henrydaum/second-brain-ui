/**
 * Files the agent produced.
 *
 * An `attachments` frame carries **filesystem paths on the host** — not URLs and
 * not bytes. The server is a Mac Mini behind a tunnel and this is a browser, so
 * there is nothing to link to: the only way to show the file is to ask for its
 * contents through `fs.read_bytes` and build an object URL out of them.
 *
 * That is a real fetch per file, so it happens here, lazily, in the component
 * that renders one — rather than in the store, which must stay pure and cheap.
 */

import { useEffect, useState, type FC } from "react";
import { FileIcon, PaperclipIcon } from "lucide-react";

import {
  makeAssistantDataUI,
  type DataMessagePartProps,
} from "@assistant-ui/react";
import { downloadFromHost } from "@/lib/upload";
import { HOST_FILES } from "@/runtime/convert";

type HostFiles = {
  paths: string[];
  /** These came *from* the person, so they are names rather than host paths and
   *  there is nothing to fetch — see `FilesPart` in `runtime/store.ts`. */
  sent?: boolean;
};

/** Best-effort MIME from the extension. The kernel does not tell us, and the
 *  only thing riding on it is whether the browser will draw the image inline. */
function mimeOf(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const images: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  return images[extension] ?? "application/octet-stream";
}

const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path;

const OneFile: FC<{ path: string }> = ({ path }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;

    void (async () => {
      try {
        const bytes = await downloadFromHost(path);
        if (cancelled) return;
        created = URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) }));
        setUrl(created);
      } catch {
        // A file the policy will not hand over, or one that has since moved.
        // Naming it is more useful than an empty space where it should be.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      // Object URLs hold their blob alive until revoked, and a long
      // conversation full of images would otherwise keep every one of them.
      if (created) URL.revokeObjectURL(created);
    };
  }, [path]);

  const name = nameOf(path);

  if (failed) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
        <FileIcon className="size-3.5" />
        {name} (could not be read)
      </span>
    );
  }

  if (!url) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
        <FileIcon className="size-3.5 animate-pulse" />
        {name}
      </span>
    );
  }

  if (mimeOf(path).startsWith("image/")) {
    return (
      <img
        src={url}
        alt={name}
        className="max-h-80 rounded-lg border object-contain"
      />
    );
  }

  return (
    <a
      href={url}
      download={name}
      className="hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs"
    >
      <FileIcon className="size-3.5" />
      {name}
    </a>
  );
};

/** A file the person attached. Named, not fetched: the copy it was sent from is
 *  gone by the time this renders, because ingesting moves it. */
const SentFile: FC<{ name: string }> = ({ name }) => (
  <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs">
    <PaperclipIcon className="size-3.5" />
    {name}
  </span>
);

export const HostFiles: FC<DataMessagePartProps<HostFiles>> = ({ data }) => (
  <div className="my-2 flex flex-wrap items-start gap-2">
    {data.paths.map((path: string) =>
      data.sent ? (
        <SentFile key={path} name={nameOf(path)} />
      ) : (
        <OneFile key={path} path={path} />
      ),
    )}
  </div>
);

/**
 * Register the renderer above with assistant-ui, for the duration of the mount.
 *
 * **There are two different registries and they are not interchangeable.**
 * Passing `components={{ data: { by_name } }}` to `MessagePrimitive.Parts`
 * registers a renderer for *that* subtree, which is how a person's own
 * attachments render inside `UserMessage`. `MessagePrimitive.GroupedParts` —
 * what assistant messages use, because they interleave text and tool calls —
 * takes no `components` prop at all: it hands the render function a
 * `dataRendererUI` looked up in the assistant-wide registry, and returns `null`
 * when nothing is registered there.
 *
 * So the assistant side was rendering `null` for every `attachments` frame: a
 * file the agent produced simply never appeared, with no error anywhere. This
 * component is the assistant-wide half. Render it once, anywhere inside the
 * runtime provider; it draws nothing itself.
 */
export const HostFilesDataUI = makeAssistantDataUI<HostFiles>({
  name: HOST_FILES,
  render: HostFiles,
});
