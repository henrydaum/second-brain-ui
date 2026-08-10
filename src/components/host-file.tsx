/**
 * Files the person attached.
 *
 * **Named, not fetched.** These arrive as the *names* of files that were just
 * sent, and there is nothing to read back: ingesting a file moves it, so the
 * scratch copy it was written to is gone by the time this renders. Drawing the
 * name they chose is the only honest thing available.
 *
 * Files the *agent* produced used to live here too, fetched a chunk at a time
 * through `fs.read_bytes` and reassembled into an object URL. They have moved
 * to `components/turn-files.tsx`, for two reasons. The bytes now come from
 * `GET /files`, which hands the browser a URL and a `Content-Type` instead of a
 * blob held in memory — the only way a video can seek, and the difference
 * between six recognised image extensions and every kind of file there is. And
 * the paths now come from the ledger rather than from the frame, because a
 * frame does not survive a reload and `conversation_messages` has nowhere to
 * keep one.
 */

import type { FC } from "react";
import { PaperclipIcon } from "lucide-react";

import {
  makeAssistantDataUI,
  type DataMessagePartProps,
} from "@assistant-ui/react";
import { nameOf } from "@/lib/files";
import { HOST_FILES } from "@/runtime/convert";

type HostFiles = { paths: string[] };

export const HostFiles: FC<DataMessagePartProps<HostFiles>> = ({ data }) => (
  <div className="my-2 flex flex-wrap items-start gap-2">
    {data.paths.map((path: string) => (
      <span
        key={path}
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs"
      >
        <PaperclipIcon className="size-3.5" aria-hidden />
        {nameOf(path)}
      </span>
    ))}
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
 * Only user messages carry this part now, so only the first registry is
 * strictly needed. This stays anyway: it costs nothing, it draws nothing, and
 * the next named data part to appear on an assistant message would otherwise
 * rediscover the same silent `null` from scratch.
 */
export const HostFilesDataUI = makeAssistantDataUI<HostFiles>({
  name: HOST_FILES,
  render: HostFiles,
});
