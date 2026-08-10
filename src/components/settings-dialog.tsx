import { useEffect, useMemo, useRef, useState, type FC } from "react";
import { ChevronRightIcon, Settings2Icon } from "lucide-react";

import { CommandPanel } from "@/components/command-panel";
import {
  SETTINGS_PAGES,
  SYSTEM_ACTIONS,
  commandPresentation,
  commandsForPage,
  pageForCommand,
  type SettingsPageId,
} from "@/components/settings-structure";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Command } from "@/lib/commands";
import { cn } from "@/lib/utils";
import { useSecondBrain } from "@/runtime/provider";

function CommandCard({
  command,
  onRun,
  disabled,
}: {
  command: Command;
  onRun: () => void;
  disabled: boolean;
}) {
  const presentation = commandPresentation(command);
  const Icon = presentation.icon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onRun}
      className="group bg-card hover:bg-accent/50 focus-visible:ring-ring flex w-full items-start gap-3 rounded-lg border p-3 text-start transition-colors focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="bg-muted text-muted-foreground group-hover:text-foreground flex size-8 shrink-0 items-center justify-center rounded-md transition-colors">
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{presentation.title}</span>
        <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
          {presentation.detail}
        </span>
      </span>
      <ChevronRightIcon className="text-muted-foreground mt-1.5 size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

const SystemActions: FC<{
  commands: Command[];
  disabled: boolean;
  onRun: (name: string) => void;
  compact?: boolean;
}> = ({ commands, disabled, onRun, compact = false }) => {
  const available = new Set(commands.map((command) => command.name));
  return (
    <div className={cn("space-y-1", compact && "grid gap-2 space-y-0")}>
      {!compact && (
        <p className="text-muted-foreground px-2 pb-1 text-xs font-medium">
          System
        </p>
      )}
      {SYSTEM_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            key={action.name}
            type="button"
            size="sm"
            variant={action.tone}
            title={action.description}
            disabled={disabled || !available.has(action.name)}
            onClick={() => onRun(action.name)}
            className={cn(
              "text-muted-foreground hover:text-foreground w-full justify-start gap-2 font-normal",
              action.danger &&
                "hover:bg-destructive/10 hover:text-destructive",
            )}
          >
            <Icon className="size-3.5" />
            {action.label}
          </Button>
        );
      })}
    </div>
  );
};

export const SettingsDialog: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ open, onOpenChange }) => {
  const {
    commands,
    say,
    state,
    dismissCommand,
    settingsRequest,
    clearSettingsRequest,
  } = useSecondBrain();
  const [page, setPage] = useState<SettingsPageId>("agents");
  const [commandActionPending, setCommandActionPending] = useState(false);
  const commandActionPendingRef = useRef(false);
  const activeName = state.form?.name ?? state.command?.name;
  const commandActive = Boolean(activeName);
  const commandRunning =
    commandActive && state.command?.status !== "finished";

  useEffect(() => {
    if (activeName) setPage(pageForCommand(activeName));
  }, [activeName]);

  /**
   * Somebody asked for a particular section on the way in.
   *
   * **Consumed, not watched.** Clearing it here is what makes this a landing
   * place rather than a lock: without the clear, navigating away would be undone
   * by the next render that still saw the request standing.
   *
   * After the effect above on purpose. Both can fire on one render — Settings
   * opened at a section while a command happens to be running — and an explicit
   * request from a person should beat an inference from what the session is
   * doing.
   */
  useEffect(() => {
    if (!settingsRequest) return;
    setPage(settingsRequest.page);
    clearSettingsRequest();
  }, [settingsRequest, clearSettingsRequest]);

  const pageDefinition =
    SETTINGS_PAGES.find((item) => item.id === page) ?? SETTINGS_PAGES[0];
  const activeCommand = commands.find((item) => item.name === activeName);
  const activePresentation = activeCommand
    ? commandPresentation(activeCommand)
    : null;
  const ActiveCommandIcon = activePresentation?.icon;
  const visibleCommands = useMemo(
    () => commandsForPage(commands, page),
    [commands, page],
  );

  const afterCurrentCommand = async (action: () => void | Promise<void>) => {
    if (!commandActive) {
      await action();
      return;
    }
    if (commandActionPendingRef.current) return;

    commandActionPendingRef.current = true;
    setCommandActionPending(true);
    try {
      if (commandRunning) {
        const submitted = await say("/cancel");
        if (!submitted) return;
      }
      dismissCommand();
      await action();
    } finally {
      commandActionPendingRef.current = false;
      setCommandActionPending(false);
    }
  };

  const run = (name: string) => {
    void afterCurrentCommand(async () => {
      setPage(pageForCommand(name));
      await say(`/${name}`);
    });
  };

  const navigateTo = (nextPage: SettingsPageId) => {
    void afterCurrentCommand(() => setPage(nextPage));
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
        className="flex h-[min(88vh,54rem)] w-[min(94vw,70rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        overlayClassName="bg-black/40 backdrop-blur-sm"
        closeButtonDisabled={commandActionPending}
      >
        <header className="flex h-16 shrink-0 items-center gap-3 border-b px-5 sm:px-6">
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

        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[14rem_minmax(0,1fr)]">
          <nav
            className="bg-muted/25 hidden min-h-0 flex-col border-r p-3 sm:flex"
            aria-label="Settings sections"
          >
            <div>
              {SETTINGS_PAGES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  disabled={commandActionPending}
                  onClick={() => navigateTo(id)}
                  className={cn(
                    "mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors disabled:pointer-events-none disabled:opacity-50",
                    page === id
                      ? "bg-background font-medium shadow-sm"
                      : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-auto border-t pt-3">
              <SystemActions
                commands={commands}
                disabled={
                  commandActionPending || (!commandActive && state.typing)
                }
                onRun={run}
              />
            </div>
          </nav>

          <main className="min-w-0 overflow-y-auto p-4 sm:p-6">
            <label className="mb-4 block sm:hidden">
              <span className="sr-only">Settings section</span>
              <select
                value={page}
                disabled={commandActionPending}
                onChange={(event) =>
                  navigateTo(event.target.value as SettingsPageId)
                }
                className="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
              >
                {SETTINGS_PAGES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="mb-6">
              {activeName ? (
                <div className="flex items-start gap-3">
                  {ActiveCommandIcon && (
                    <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <ActiveCommandIcon className="size-4.5" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-muted-foreground font-mono text-xs">
                      /{activeName}
                    </p>
                    <h2 className="mt-0.5 text-lg font-semibold">
                      {activePresentation?.title ?? pageDefinition.label}
                    </h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {state.command?.narration ||
                        activePresentation?.detail ||
                        pageDefinition.description}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="text-lg font-semibold">{pageDefinition.label}</h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {pageDefinition.description}
                  </p>
                </>
              )}
            </div>

            {commandActive ? (
              <CommandPanel />
            ) : commands.length === 0 ? (
              <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
                Settings are unavailable while the command catalog is loading.
              </div>
            ) : visibleCommands.length === 0 ? (
              <div className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm">
                No commands are available in this section.
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {visibleCommands.map((command) => (
                  <CommandCard
                    key={command.name}
                    command={command}
                    disabled={state.typing}
                    onRun={() => run(command.name)}
                  />
                ))}
              </div>
            )}

            {!commandActive && (
              <div className="mt-8 border-t pt-5 sm:hidden">
                <h3 className="mb-3 text-sm font-medium">System actions</h3>
                <SystemActions
                  compact
                  commands={commands}
                  disabled={state.typing}
                  onRun={run}
                />
              </div>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
};
