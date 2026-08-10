/**
 * One file, big enough to actually look at.
 *
 * The drawer is a list and stays one — at 24rem a chart is a thumbnail and a
 * table is unreadable. Opening a file therefore takes over the middle of the
 * screen, and brings its neighbours with it: the arrows step through the files
 * of the section it was opened from, because "the next one" is the thing you
 * want after looking at a file, and going back to the list for it is a click
 * per file.
 */

import { useEffect, type FC } from "react";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";

import { FileView } from "@/components/file-view";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fileUrl } from "@/lib/client";
import { dirOf, nameOf } from "@/lib/files";
import { useFileActivity } from "@/runtime/file-activity-provider";

export const FileViewerDialog: FC = () => {
  const { viewing, stepView, closeView } = useFileActivity();

  /**
   * Arrow keys, bound to the window rather than to the dialog: the focus after
   * opening sits on whatever Radix chose, and a viewer you cannot page through
   * without first clicking it is a viewer that feels broken.
   *
   * **Unless the arrows already mean something.** A focused `<video>` or
   * `<audio>` scrubs with the same two keys, so paging the viewer as well made
   * nudging back five seconds jump to the next file instead. Whatever has focus
   * has first claim on a key it uses.
   */
  useEffect(() => {
    if (!viewing || viewing.paths.length < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const focused = document.activeElement;
      if (focused instanceof HTMLMediaElement) return;
      if (focused instanceof HTMLElement && focused.isContentEditable) return;
      if (focused instanceof HTMLInputElement) return;
      stepView(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, stepView]);

  if (!viewing) return null;

  const path = viewing.paths[viewing.index];
  if (path === undefined) return null;

  const many = viewing.paths.length > 1;

  return (
    <Dialog open onOpenChange={(open) => !open && closeView()}>
      <DialogContent
        className="max-h-[90vh] gap-3 overflow-hidden p-4 sm:max-w-4xl"
        overlayClassName="backdrop-blur-sm"
      >
        <DialogHeader className="pe-8">
          <DialogTitle className="truncate text-base" title={path}>
            {nameOf(path)}
          </DialogTitle>
          <DialogDescription className="truncate text-xs">
            {dirOf(path) || "The host filesystem"}
          </DialogDescription>
        </DialogHeader>

        {/* The file and its arrows on one row, so paging does not move the
            thing you are looking at. */}
        <div className="flex min-h-0 items-center gap-2">
          {many && (
            <TooltipIconButton
              tooltip="Previous file"
              side="right"
              className="size-8"
              onClick={() => stepView(-1)}
            >
              <ChevronLeftIcon className="size-4" />
            </TooltipIconButton>
          )}
          {/**
           * The stage, and its size is fixed on purpose.
           *
           * Every file that lands here is a different shape, and each one takes
           * a moment to arrive — so a box that sized itself to its contents
           * spent that moment as a sliver and then sprang open, moving the
           * dialog, the arrows and the download link out from under the
           * pointer. Deciding the dimensions up front costs some empty space
           * around a small image and buys a viewer that never moves: the
           * spinner is already in the middle of the box the picture will fill.
           */}
          <div className="flex h-[70vh] min-w-0 flex-1 items-center justify-center overflow-hidden">
            {/* Keyed on the path so switching files remounts rather than
                showing the previous file's bytes under the new one's name. */}
            <FileView key={path} path={path} size="full" />
          </div>
          {many && (
            <TooltipIconButton
              tooltip="Next file"
              side="left"
              className="size-8"
              onClick={() => stepView(1)}
            >
              <ChevronRightIcon className="size-4" />
            </TooltipIconButton>
          )}
        </div>

        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>
            {many
              ? `${viewing.index + 1} of ${viewing.paths.length}`
              : " "}
          </span>
          <a
            href={fileUrl(path)}
            download={nameOf(path)}
            className="hover:text-foreground inline-flex items-center gap-1.5"
          >
            <DownloadIcon className="size-3.5" aria-hidden />
            Download
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
};
