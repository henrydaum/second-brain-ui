import { lazy, Suspense, useRef, useState, type FC } from "react";
import { LoaderCircleIcon, Settings2Icon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSession } from "@/runtime/provider";

let settingsModule: ReturnType<typeof importSettings> | null = null;

function importSettings() {
  return import("@/components/settings-dialog");
}

function loadSettings() {
  settingsModule ??= importSettings();
  return settingsModule;
}

const LazySettingsContent = lazy(() =>
  loadSettings().then((module) => ({ default: module.SettingsDialogContent })),
);

export function preloadSettings() {
  void loadSettings();
}

/**
 * The dialog shell is eager and persistent. Only its body crosses the lazy
 * boundary, so resolving the Settings chunk cannot remount an already-open
 * Radix dialog and replay its entrance animation.
 */
export const SettingsDialog: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ open, onOpenChange }) => {
  const { say, state, dismissCommand } = useSession();
  const [commandActionPending, setCommandActionPending] = useState(false);
  const commandActionPendingRef = useRef(false);
  const activeName = state.form?.name ?? state.command?.name;
  const commandActive = Boolean(activeName);
  const commandRunning =
    commandActive && state.command?.status !== "finished";

  const afterCurrentCommand = async (
    action: () => void | Promise<void>,
  ) => {
    if (!commandActive) {
      await action();
      return true;
    }
    if (commandActionPendingRef.current) return false;

    commandActionPendingRef.current = true;
    setCommandActionPending(true);
    try {
      if (commandRunning) {
        const submitted = await say("/cancel");
        if (!submitted) return false;
      }
      dismissCommand();
      await action();
      return true;
    } finally {
      commandActionPendingRef.current = false;
      setCommandActionPending(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    // Closing while a command is active is also a cancellation. Wait for the
    // server to accept it before hiding Settings so a failed submission does
    // not leave the session waiting on an invisible question.
    if (!next && commandActive) {
      void afterCurrentCommand(() => onOpenChange(false));
      return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex h-[min(94dvh,54rem)] w-[min(calc(100vw-1rem),70rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        overlayClassName="bg-black/45 backdrop-blur-[2px]"
        closeButtonDisabled={commandActionPending}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 sm:h-16 sm:px-6">
          <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Settings2Icon className="size-4" />
          </span>
          <div>
            <DialogTitle className="text-base">Second Brain settings</DialogTitle>
            <DialogDescription className="text-xs">
              Kernel, agents, security, plugins, and packages
            </DialogDescription>
          </div>
        </header>

        <Suspense fallback={<SettingsFallback />}>
          <LazySettingsContent
            commandActionPending={commandActionPending}
            afterCurrentCommand={afterCurrentCommand}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
};

const SettingsFallback: FC = () => (
  <div
    className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm"
    role="status"
  >
    <LoaderCircleIcon className="size-4 animate-spin" />
    Loading settings…
  </div>
);
