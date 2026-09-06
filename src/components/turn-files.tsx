/**
 * A reply's files, where the reply is.
 *
 * Two paths share one renderer:
 *
 * **One shown file previews inline.** The agent handing you a chart and the
 * chart itself belong together, and putting it behind a click would be a
 * regression on what this app already did.
 *
 * **A live attachment renders at its event boundary.** If one event carries
 * several paths, the first path represents the set and the footer reports the
 * full count. Separate events may each render once in chronological order.
 *
 * Files the agent *edited* never appear inline at either count. That is
 * activity, not presentation — the agent did not choose to show it to you, and
 * a reply that quietly grew a list of everything it wrote reads as noise.
 *
 * ## Why this is not a message part
 *
 * Live frames become data parts and therefore preserve their position between
 * text segments. `conv.read` cannot restore that exact position, so after a
 * reload the ledger supplies one end-of-message fallback instead.
 *
 * Both paths use the current conversation-wide file projection, so deleting a
 * file removes its preview rather than replacing it with a stale error card.
 */

import { Suspense, type FC } from "react";
import { FilesIcon, Maximize2Icon } from "lucide-react";
import { useAuiState, type DataMessagePartProps } from "@assistant-ui/react";

import { LazyFileView, preloadFileView } from "@/components/lazy-file-view";
import { preloadFileViewer } from "@/components/lazy-file-viewer";
import { Button } from "@/components/ui/button";
import { nameOf } from "@/lib/files";
import { conversationEntries, countOf } from "@/runtime/file-activity";
import { useFileActivity } from "@/runtime/file-activity-provider";
import { AGENT_FILES } from "@/runtime/convert";

type AgentFilesData = { paths?: unknown };

function pathsFrom(data: AgentFilesData): string[] {
  return Array.isArray(data.paths)
    ? data.paths.filter((path): path is string => typeof path === "string")
    : [];
}

export const InlineAgentFiles: FC<DataMessagePartProps<AgentFilesData>> = ({
  data,
}) => {
  const { sections } = useFileActivity();
  const current = new Set(
    conversationEntries(sections).map((entry) => entry.path),
  );
  return (
    <InlinePreview
      paths={pathsFrom(data).filter((path) => current.has(path))}
    />
  );
};

/** The one file this turn showed you, or null — the shape the rules above
 *  reduce to. A file that has since been deleted is not offered. */
function useShown(): string[] {
  const id = useAuiState((s) => s.message.id);
  const hasInlinePart = useAuiState((s) =>
    s.message.parts.some(
      (part) => part.type === "data" && part.name === AGENT_FILES,
    ),
  );
  const { sectionFor, sections } = useFileActivity();
  if (hasInlinePart) return [];
  const current = new Set(
    conversationEntries(sections).map((entry) => entry.path),
  );
  return (sectionFor(id)?.shown ?? [])
    .filter((entry) => !entry.gone && current.has(entry.path))
    .map((entry) => entry.path)
    .sort((a, b) => a.localeCompare(b));
}

export const TurnShownFile: FC = () => {
  const paths = useShown();
  return <InlinePreview paths={paths} />;
};

const InlinePreview: FC<{ paths: string[] }> = ({ paths }) => {
  const { view } = useFileActivity();
  const path = paths[0];
  if (!path) return null;

  return (
    <div className="my-2 flex flex-col items-start gap-1">
      {/* Not wrapped in a button. A `<video>` and an `<audio>` carry their own
          controls, and a click target over them would swallow every press of
          play; a download falls back to an `<a>`, which may not be nested in a
          button at all. The line underneath is the click target for all of
          them, which also means it behaves the same whatever the file is. */}
      <Suspense
        fallback={
          <div className="bg-muted/30 h-40 w-full animate-pulse rounded-lg border" />
        }
      >
        <LazyFileView path={path} size="inline" />
      </Suspense>
      <button
        type="button"
        onClick={() => view(paths, 0)}
        onPointerEnter={() => {
          preloadFileView();
          preloadFileViewer();
        }}
        onFocus={() => {
          preloadFileView();
          preloadFileViewer();
        }}
        title={path}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex max-w-full items-center gap-1.5 rounded px-1 text-xs outline-none focus-visible:ring-2"
      >
        <Maximize2Icon className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{nameOf(path)}</span>
      </button>
    </div>
  );
};

/**
 * The chip under a reply: how many files this turn touched.
 *
 * Sized to the footer strip it lives in — see `FOOTER_HEIGHT` in `thread.tsx`,
 * which must stay no taller than the gap between messages.
 */
export const TurnFilesButton: FC = () => {
  const id = useAuiState((s) => s.message.id);
  const { sectionFor, openFilesAt } = useFileActivity();
  const section = sectionFor(id);
  if (!section) return null;

  const count = countOf(section);
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => openFilesAt(id)}
      className="text-muted-foreground gap-1.5"
    >
      <FilesIcon aria-hidden />
      {count} {count === 1 ? "file" : "files"}
    </Button>
  );
};
