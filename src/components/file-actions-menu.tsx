import { useRef } from "react";
import { CopyIcon, FolderOpenIcon, MessageSquareIcon, MoreHorizontalIcon } from "lucide-react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { nameOf } from "@/lib/files";

export function FileActionsMenu({ path, disabled, onMention, onReveal, onCopyResult }: {
  path: string;
  disabled?: boolean;
  onMention?: () => void;
  onReveal?: () => void;
  onCopyResult: (message: string) => void;
}) {
  const leaving = useRef(false);
  return <DropdownMenu onOpenChange={(open) => { if (open) leaving.current = false; }}>
    <DropdownMenuTrigger asChild>
      <TooltipIconButton tooltip="File actions" aria-label={`Actions for ${nameOf(path)}`} disabled={disabled} className="size-8">
        <MoreHorizontalIcon className="size-4" />
      </TooltipIconButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
      if (leaving.current) event.preventDefault();
    }}>
      {onMention && <DropdownMenuItem onSelect={() => { leaving.current = true; onMention(); }}><MessageSquareIcon className="size-4" />Mention in chat</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => {
        void (async () => {
          try { await navigator.clipboard.writeText(path); onCopyResult("Path copied."); }
          catch { onCopyResult("Could not copy path. Clipboard access is unavailable."); }
        })();
      }}><CopyIcon className="size-4" />Copy path</DropdownMenuItem>
      {onReveal && <DropdownMenuItem onSelect={() => { leaving.current = true; onReveal(); }}><FolderOpenIcon className="size-4" />Open containing folder</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
