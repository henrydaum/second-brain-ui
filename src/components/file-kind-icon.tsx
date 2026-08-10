import type { FC } from "react";
import {
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  SheetIcon,
  VideoIcon,
} from "lucide-react";

import { guessKind, type FileKind } from "@/lib/files";

const KIND_ICONS: Record<FileKind, typeof FileIcon> = {
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
  const Icon = KIND_ICONS[guessKind(path)];
  return <Icon className={className} aria-hidden />;
};
