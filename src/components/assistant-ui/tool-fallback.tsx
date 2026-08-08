import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  WrenchIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

function title(name: string) {
  return name
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function printable(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export const ToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
  status,
  isError,
}) => {
  const running = status.type === "running";
  const failed = status.type === "incomplete" || isError === true;
  const hasDetails = Boolean(argsText || result !== undefined);

  const icon = running ? (
    <LoaderCircleIcon className="size-3.5 animate-spin" />
  ) : failed ? (
    <CircleAlertIcon className="size-3.5" />
  ) : (
    <CheckIcon className="size-3.5" />
  );

  return (
    <details
      className={cn(
        "group/tool rounded-lg border bg-background/70 text-sm",
        failed && "border-destructive/40",
      )}
    >
      <summary
        className={cn(
          "flex min-h-10 list-none items-center gap-2.5 px-3 py-2",
          hasDetails && "cursor-pointer",
        )}
      >
        <WrenchIcon className="text-muted-foreground size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {title(toolName)}
        </span>
        <span
          className={cn(
            "text-muted-foreground flex items-center gap-1.5 text-xs",
            failed && "text-destructive",
          )}
        >
          {icon}
          {running ? "Running" : failed ? "Failed" : "Done"}
        </span>
        {hasDetails && (
          <ChevronRightIcon className="text-muted-foreground size-3.5 transition-transform group-open/tool:rotate-90" />
        )}
      </summary>
      {hasDetails && (
        <div className="space-y-3 border-t px-3 py-3">
          {argsText && (
            <div>
              <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                Input
              </p>
              <pre className="bg-muted/60 max-h-48 overflow-auto rounded-md p-2.5 text-xs whitespace-pre-wrap">
                {argsText}
              </pre>
            </div>
          )}
          {result !== undefined && (
            <div>
              <p className="text-muted-foreground mb-1.5 text-xs font-medium">
                Result
              </p>
              <pre className="bg-muted/60 max-h-56 overflow-auto rounded-md p-2.5 text-xs whitespace-pre-wrap">
                {printable(result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </details>
  );
};
