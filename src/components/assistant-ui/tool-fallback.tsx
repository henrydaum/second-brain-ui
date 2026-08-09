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

  // Emptiness is decided here, not by `result !== undefined`. A tool is free to
  // report nothing at all, and a heading over a blank box reads as a value that
  // went missing rather than one that was never sent.
  const outcome = result === undefined ? "" : printable(result).trim();
  const hasDetails = Boolean(argsText) || outcome !== "";

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
          {outcome !== "" && (
            <div>
              {/* One or the other, never both: the kernel leaves the summary
                  empty on a failure so that the error is the whole answer. */}
              <p
                className={cn(
                  "mb-1.5 text-xs font-medium",
                  failed ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {failed ? "Error" : "Result"}
              </p>
              <pre className="bg-muted/60 max-h-56 overflow-auto rounded-md p-2.5 text-xs whitespace-pre-wrap">
                {outcome}
              </pre>
            </div>
          )}
        </div>
      )}
    </details>
  );
};
