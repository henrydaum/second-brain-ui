import { useState, type FC } from "react";
import { CheckIcon, ChevronDownIcon, ShieldCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSecondBrain } from "@/runtime/provider";

const MODES = [
  {
    id: "lockdown" as const,
    label: "Lockdown",
    description: "Refuse actions that would require approval.",
  },
  {
    id: "ask" as const,
    label: "Ask",
    description: "Ask before actions that require approval.",
  },
  {
    id: "yolo" as const,
    label: "YOLO",
    description: "Approve those actions automatically while attended.",
  },
];

export const SecurityModePicker: FC = () => {
  const { securityMode, setSecurityMode, state } = useSecondBrain();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const selected = MODES.find((mode) => mode.id === securityMode) ?? MODES[1];
  const disabled =
    changing ||
    state.typing ||
    state.form !== null ||
    state.approval !== null;

  const choose = async (mode: (typeof MODES)[number]["id"]) => {
    setOpen(false);
    if (mode === securityMode) return;
    setChanging(true);
    try {
      await setSecurityMode(mode);
    } finally {
      setChanging(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onMouseDown={(event) => event.stopPropagation()}
          className="text-muted-foreground hover:text-foreground h-7 gap-1.5 rounded-full px-2 text-xs font-normal"
          aria-label={`Security mode: ${selected.label}`}
        >
          <ShieldCheckIcon className="size-3.5" />
          <span>{changing ? "Changing…" : selected.label}</span>
          <ChevronDownIcon className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-72 p-1.5"
      >
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">Security mode</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Choose how this conversation handles approval requests.
          </p>
        </div>
        <div className="mt-1" role="menu">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="menuitemradio"
              aria-checked={mode.id === securityMode}
              onClick={() => void choose(mode.id)}
              className={cn(
                "hover:bg-accent flex w-full items-start gap-2 rounded-md px-2 py-2 text-start",
                mode.id === securityMode && "bg-accent/60",
              )}
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {mode.id === securityMode && <CheckIcon className="size-3.5" />}
              </span>
              <span>
                <span className="block text-sm font-medium">{mode.label}</span>
                <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                  {mode.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
