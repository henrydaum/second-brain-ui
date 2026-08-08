/**
 * The settings surface — a placeholder, deliberately.
 *
 * There is nothing to build here yet, and inventing a settings UI would be
 * inventing a second source of truth. Second Brain already answers "what
 * settings exist, what are they worth, and what may I change" through
 * `config.read` and the `/config` command, and the command panel already draws
 * that flow properly. So this is the room those things will move into once
 * there is a reason to give them a bigger surface than a panel above the
 * composer.
 *
 * What is real here is the shell: the size, the blurred backdrop, and the
 * scrolling body, so dropping content in later is the only work left.
 */

import type { FC } from "react";
import { SettingsIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export const SettingsDialog: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ open, onOpenChange }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      // Most of the screen, but never the whole of it: the margin is what makes
      // it read as a panel over the app rather than a new page.
      className="flex h-[86vh] w-[92vw] max-w-none flex-col gap-0 p-0 sm:max-w-5xl"
      // The blur is what sells it as a layer. Kept here rather than on every
      // dialog — see `overlayClassName`.
      overlayClassName="bg-black/40 backdrop-blur-sm"
    >
      <header className="flex items-center gap-2 border-b px-6 py-4">
        <SettingsIcon className="size-4" />
        <DialogTitle className="text-base">Settings</DialogTitle>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <DialogDescription className="max-w-prose">
          Nothing lives here yet.
        </DialogDescription>
        <p className="text-muted-foreground mt-3 max-w-prose text-sm">
          Everything configurable is already reachable — type{" "}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">/config</code>{" "}
          and the command panel walks through it. This is the room those screens
          move into when they outgrow a panel above the composer.
        </p>
      </div>
    </DialogContent>
  </Dialog>
);
