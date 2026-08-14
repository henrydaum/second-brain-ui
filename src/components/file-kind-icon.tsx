import { useState, type FC } from "react";
import {
  FileCode2Icon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  SheetIcon,
  VideoIcon,
} from "lucide-react";

import { fileUrl } from "@/lib/client";
import { guessIconKind, guessKind, type FileIconKind } from "@/lib/files";
import { cn } from "@/lib/utils";

const KIND_ICONS: Record<FileIconKind, typeof FileIcon> = {
  code: FileCode2Icon,
  image: ImageIcon,
  video: VideoIcon,
  audio: MusicIcon,
  table: SheetIcon,
  text: FileTextIcon,
  embed: FileTextIcon,
  download: FileIcon,
};

export const FileKindIcon: FC<{ path: string; className?: string }> = ({
  path,
  className,
}) => {
  const Icon = KIND_ICONS[guessIconKind(path)];
  return <Icon className={className} aria-hidden />;
};

/**
 * A file as a small square: its picture if it has one, its icon otherwise.
 *
 * **The icon is always drawn, and the picture sits on top of it.** That is what
 * makes a failure free: an image that will not load reveals what was already
 * painted underneath rather than swapping one element for another, so there is
 * no flicker and no second layout.
 *
 * **A failed picture is remembered in state, never removed from the DOM.** The
 * obvious version — `event.currentTarget.remove()` — takes a node out of the
 * document that React still has in its tree, and the bill arrives later:
 * unmounting the row throws `NotFoundError` from `removeChild` and the error
 * boundary replaces the entire app with a stack trace. A path here is a record
 * of what happened rather than a promise the file is still there, so a missing
 * file is the *common* case and a white screen was one stale row away.
 *
 * Both surfaces that draw one — the files drawer's list and a user message's
 * attachments — had their own copy of all of the above.
 */
export const FileThumbnail: FC<{
  /** What to classify by. A file name is enough; a whole path is fine too. */
  name: string;
  /** Where to fetch the picture from. **Omit for a file that is gone**, or one
   *  whose durable path has not been read back yet — the icon still draws. */
  path?: string;
  /** The caller already knows this is an image, whatever the name suggests —
   *  a stored attachment carries its modality, which beats guessing at an
   *  extension. Widens the guess rather than replacing it. */
  image?: boolean;
  /** The box: size, radius, and any shadow. */
  className?: string;
  /** The icon inside it, which does not scale with the box. */
  iconClassName?: string;
}> = ({ name, path, image = false, className, iconClassName }) => {
  const [broken, setBroken] = useState(false);
  const picture = path && !broken && (image || guessKind(name) === "image");

  return (
    <span
      className={cn(
        "bg-muted/60 relative flex shrink-0 items-center justify-center overflow-hidden border",
        className,
      )}
    >
      <FileKindIcon
        path={name}
        className={cn("text-muted-foreground", iconClassName)}
      />
      {picture && (
        <img
          src={fileUrl(path)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
};
