import { lazy, type FC } from "react";
import { LoaderCircleIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

let settingsModule: ReturnType<typeof importSettings> | null = null;

function importSettings() {
  return import("@/components/settings-dialog");
}

function loadSettings() {
  settingsModule ??= importSettings();
  return settingsModule;
}

export const LazySettingsDialog = lazy(() =>
  loadSettings().then((module) => ({ default: module.SettingsDialog })),
);

export function preloadSettings() {
  void loadSettings();
}

export const SettingsFallback: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ open, onOpenChange }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      className="flex h-[min(94dvh,54rem)] w-[min(calc(100vw-1rem),70rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      overlayClassName="bg-black/45 backdrop-blur-[2px]"
    >
      <header className="flex h-14 shrink-0 flex-col justify-center border-b px-4 sm:h-16 sm:px-6">
        <DialogTitle className="text-base">Second Brain settings</DialogTitle>
        <DialogDescription className="text-xs">
          Kernel, agents, security, plugins, and packages
        </DialogDescription>
      </header>
      <div
        className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm"
        role="status"
      >
        <LoaderCircleIcon className="size-4 animate-spin" />
        Loading settings…
      </div>
    </DialogContent>
  </Dialog>
);
