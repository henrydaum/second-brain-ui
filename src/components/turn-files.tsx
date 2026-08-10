/**
 * A reply's files, where the reply is.
 *
 * Two pieces, and the split between them is the design:
 *
 * **One shown file previews inline.** The agent handing you a chart and the
 * chart itself belong together, and putting it behind a click would be a
 * regression on what this app already did.
 *
 * **Two or more do not.** A grid of thumbnails inside a message is a second,
 * worse files panel competing with the real one, and it pushes the reply you
 * were reading off the screen. The footer chip says how many and opens the
 * drawer at this turn's section.
 *
 * Files the agent *edited* never appear inline at either count. That is
 * activity, not presentation — the agent did not choose to show it to you, and
 * a reply that quietly grew a list of everything it wrote reads as noise.
 *
 * ## Why this is not a message part
 *
 * The obvious home for the preview is the `attachments` frame, which already
 * travels into the store as a `FilesPart`. It cannot be, because `conv.read`
 * has no metadata column: a reloaded conversation has no frames and therefore
 * no parts, and every image the agent ever produced would vanish on refresh.
 * The ledger is the only record that survives, and it records *that* a turn
 * showed you a file, not *where* in the turn.
 *
 * So the preview lands at the end of the reply rather than at the point in the
 * stream where the frame arrived. That is the price, it is paid once, and at a
 * cap of one file it reads fine.
 */

import type { FC } from "react";
import { FilesIcon, Maximize2Icon } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";

import { FileView } from "@/components/file-view";
import { Button } from "@/components/ui/button";
import { nameOf } from "@/lib/files";
import { countOf } from "@/runtime/file-activity";
import { useFileActivity } from "@/runtime/file-activity-provider";

/** The one file this turn showed you, or null — the shape the rules above
 *  reduce to. A file that has since been deleted is not offered. */
function useOnlyShown(): string | null {
  const id = useAuiState((s) => s.message.id);
  const { sectionFor } = useFileActivity();
  const shown = sectionFor(id)?.shown.filter((entry) => !entry.gone) ?? [];
  return shown.length === 1 ? shown[0].path : null;
}

export const TurnShownFile: FC = () => {
  const { view } = useFileActivity();
  const path = useOnlyShown();
  if (path === null) return null;

  return (
    <div className="my-2 flex flex-col items-start gap-1">
      {/* Not wrapped in a button. A `<video>` and an `<audio>` carry their own
          controls, and a click target over them would swallow every press of
          play; a download falls back to an `<a>`, which may not be nested in a
          button at all. The line underneath is the click target for all of
          them, which also means it behaves the same whatever the file is. */}
      <FileView path={path} size="inline" />
      <button
        type="button"
        onClick={() => view([path], 0)}
        title={path}
        className="text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1.5 rounded px-1 text-[11px]"
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
