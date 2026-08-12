import type { FC } from "react";
import {
  FileCode2Icon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  SheetIcon,
  VideoIcon,
} from "lucide-react";

import { guessIconKind, type FileIconKind } from "@/lib/files";

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
