/**
 * The light/dark control.
 *
 * A three-way menu rather than a two-state toggle, because "System" is a real
 * answer and the one most people are already on — see `lib/theme.ts`. The shape
 * is deliberately the same as `SecurityModePicker`: a small ghost trigger and a
 * radio menu in a popover, so the two controls in the chrome do not each invent
 * their own idiom.
 */

import type { FC } from "react";
import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTheme, type Theme } from "@/lib/theme";

const OPTIONS: { id: Theme; label: string; icon: typeof SunIcon }[] = [
  { id: "system", label: "System", icon: MonitorIcon },
  { id: "light", label: "Light", icon: SunIcon },
  { id: "dark", label: "Dark", icon: MoonIcon },
];

export const ThemePicker: FC = () => {
  const { theme, setTheme, resolved } = useTheme();

  // The trigger shows what you are *looking at*, not what you *chose* — on
  // "System" a sun icon at night would be simply wrong.
  const TriggerIcon = resolved === "dark" ? MoonIcon : SunIcon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* A plain `Button`, matching `SecurityModePicker`. A tooltip on a
            control that opens a labelled menu is one hover surface too many,
            and it keeps this trigger to a single `asChild` hand-off. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Appearance"
          className="text-muted-foreground hover:text-foreground size-8"
        >
          <TriggerIcon className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-44 p-1.5">
        <p className="px-2 py-1.5 text-sm font-medium">Appearance</p>
        <div role="menu">
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = option.id === theme;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => setTheme(option.id)}
                className={cn(
                  "hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm",
                  active && "bg-accent/60",
                )}
              >
                <Icon className="text-muted-foreground size-4 shrink-0" />
                <span className="flex-1">{option.label}</span>
                {active && <CheckIcon className="size-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
};
