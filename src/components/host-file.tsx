/** Files a user message carried, above the prose rather than inside it. */

import type { FC, ReactNode } from "react";
import { useAuiState } from "@assistant-ui/react";

import { FileKindIcon } from "@/components/file-kind-icon";
import { preloadFileViewer } from "@/components/lazy-file-viewer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fileUrl } from "@/lib/client";
import { guessKind } from "@/lib/files";
import { SENT_ATTACHMENTS } from "@/runtime/convert";
import { useFileActivity } from "@/runtime/file-activity-provider";
import type { MessageAttachment } from "@/runtime/store";

function messageAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is MessageAttachment =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as MessageAttachment).fileName === "string",
  );
}

export const UserMessageAttachments: FC = () => {
  const { view } = useFileActivity();
  const stored = useAuiState(
    (state) => state.message.metadata.custom[SENT_ATTACHMENTS],
  );
  const attachments = messageAttachments(stored);
  if (!attachments.length) return null;

  const paths = attachments.flatMap((attachment) =>
    attachment.path ? [attachment.path] : [],
  );

  return (
    <div className="col-span-full col-start-1 row-start-1 flex max-w-full flex-wrap justify-end gap-2">
      {attachments.map((attachment, position) => {
        const path = attachment.path;
        const tile = <AttachmentTile attachment={attachment} />;
        if (!path) {
          return (
            <Tooltip key={`${attachment.fileName}-${position}`}>
              <TooltipTrigger asChild>
                <div>{tile}</div>
              </TooltipTrigger>
              <TooltipContent side="top">{attachment.fileName}</TooltipContent>
            </Tooltip>
          );
        }
        const index = paths.indexOf(path);
        return (
          <Tooltip key={`${path}-${position}`}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`View ${attachment.fileName}`}
                onClick={() => view(paths, index)}
                onPointerEnter={preloadFileViewer}
                onFocus={preloadFileViewer}
                className="focus-visible:ring-ring rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2"
              >
                {tile}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{attachment.fileName}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
};

const AttachmentTile: FC<{ attachment: MessageAttachment }> = ({
  attachment,
}) => {
  const image =
    attachment.modality === "image" ||
    guessKind(attachment.fileName) === "image";
  const icon: ReactNode = (
    <FileKindIcon
      path={attachment.fileName}
      className="text-muted-foreground size-5"
    />
  );

  return (
    <span className="bg-muted/60 relative flex size-14 items-center justify-center overflow-hidden rounded-md border shadow-sm">
      {icon}
      {image && attachment.path && (
        <img
          src={fileUrl(attachment.path)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(event) => event.currentTarget.remove()}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      <span className="sr-only">{attachment.fileName}</span>
    </span>
  );
};
