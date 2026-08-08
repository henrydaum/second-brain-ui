"use client";

import { type ComponentPropsWithRef, forwardRef } from "react";
import { Slot } from "radix-ui";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TooltipIconButtonProps = ComponentPropsWithRef<typeof Button> & {
  tooltip: string;
  side?: "top" | "bottom" | "left" | "right";
};

export const TooltipIconButton = forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(({ children, tooltip, side = "bottom", className, ...rest }, ref) => {
  // `delay`, not `delayDuration`: shadcn's tooltip is built on @base-ui now and
  // renamed the prop. assistant-ui's registry copy still passes the old Radix
  // name, so this one line diverges from what the registry generated.
  return (
    <TooltipProvider delay={0}>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon" {...rest} className={cn(
                            "aui-button-icon size-6 p-1 active:scale-90",
                            className,
                          )} ref={ref} />}><Slot.Slottable>{children}</Slot.Slottable><span className="aui-sr-only sr-only">{tooltip}</span></TooltipTrigger>
        <TooltipContent side={side}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

TooltipIconButton.displayName = "TooltipIconButton";
