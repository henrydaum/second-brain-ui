import { ChevronDownIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { spellModelWord } from "@/lib/model-names";
import { useModels, type ReasoningEffort } from "@/runtime/provider";

/** A compact, provider-free label for the composer trigger. The exact profile
 * key remains untouched everywhere that identity matters. */
export function compactModelName(modelName: string | null | undefined): string {
  const exact = (modelName ?? "").trim();
  if (!exact) return "Select model";
  const parts = exact.split("/").filter(Boolean);
  const suffix = parts.at(-1) || exact;
  const words = suffix.replace(/[-_]+/g, " ").trim().split(/\s+/);
  if (words.length === 0 || !words[0]) return exact;
  return words.map(spellModelWord).join(" ");
}

const REASONING_LEVELS: readonly (readonly [ReasoningEffort, string])[] = [
  ["off", "Off"],
  ["low", "Low"],
  ["medium", "Med"],
  ["high", "High"],
] as const;

/**
 * The effort segments, as a row of the model panel.
 *
 * **A radio group, not a row of buttons.** `MarkdownModePicker` wears the same
 * clothes but uses `aria-pressed`, because its two buttons each do a thing;
 * these four are one field carrying one value, and a screen reader should hear
 * it that way.
 *
 * **Not a `DropdownMenuItem`.** Menu items close the menu when chosen, which is
 * right for picking a model and wrong for a control you may want to try twice.
 * That leaves it outside Radix's roving focus, so it is reached by Tab rather
 * than by arrow keys, and the menu's typeahead has to be kept off the keys the
 * buttons want.
 */
function ReasoningRow() {
  const { reasoningEffort, settingReasoning, switchingModel, modelName, setReasoningEffort } =
    useModels();
  const disabled = settingReasoning || switchingModel || !modelName;

  return (
    <div
      className="flex items-center justify-between gap-2 px-2 py-1.5"
      // Printable keys only, which is exactly what the menu's typeahead listens
      // for — it would otherwise throw focus back to a model whose name starts
      // with whatever was typed. Arrow keys are deliberately let through, so
      // the model list above is still reachable from here. Escape does not
      // depend on this either way: Radix listens for it on the document in the
      // capture phase, so it never reaches this handler.
      onKeyDown={(event) => {
        if (event.key.length === 1) event.stopPropagation();
      }}
    >
      <span className="text-muted-foreground text-xs">Reasoning</span>
      <div
        role="radiogroup"
        aria-label="Reasoning effort"
        className={cn(
          "bg-muted/40 inline-flex shrink-0 items-center gap-0.5 rounded-md border p-0.5",
          disabled && "opacity-50",
        )}
      >
        {REASONING_LEVELS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={reasoningEffort === value}
            disabled={disabled}
            onClick={() => void setReasoningEffort(value)}
            className={cn(
              "focus-visible:ring-ring inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] outline-none focus-visible:ring-2 disabled:pointer-events-none",
              reasoningEffort === value
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ModelSelector() {
  const [open, setOpen] = useState(false);
  const {
    models,
    modelName,
    agentProfile,
    modelsLoading,
    modelsFailure,
    switchingModel,
    setModel,
  } = useModels();
  const label = modelsLoading && !modelName ? "Loading…" : compactModelName(modelName);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={modelName ? `Model: ${modelName}` : "Select model"}
          className="text-muted-foreground hover:text-foreground h-7 min-w-0 max-w-36 flex-1 gap-1 px-2 text-xs sm:w-auto sm:max-w-52 sm:flex-none sm:justify-end"
        >
          {switchingModel && <LoaderCircleIcon className="size-3 animate-spin" />}
          <span className="min-w-0 truncate sm:text-right">{label}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        className="w-[min(22rem,calc(100vw-2rem))]"
      >
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Default language model
        </DropdownMenuLabel>
        {models.length > 0 ? (
          <DropdownMenuRadioGroup
            value={modelName ?? ""}
            onValueChange={(value) => {
              setOpen(false);
              void setModel(value);
            }}
            className="max-h-64 overflow-y-auto"
          >
            {models.map((model) => (
              <DropdownMenuRadioItem
                key={model.model_name}
                value={model.model_name}
                disabled={switchingModel}
                className="font-mono text-xs"
              >
                <span className="min-w-0 truncate">{model.model_name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <p className="text-muted-foreground px-2 py-3 text-sm">
            {modelsLoading
              ? "Loading configured models…"
              : modelsFailure
                ? "Models are temporarily unavailable."
                : "No LLM profiles are configured."}
          </p>
        )}
        <DropdownMenuSeparator />
        <ReasoningRow />
        <DropdownMenuSeparator />
        <div className="text-muted-foreground px-2 py-1 text-xs">
          Agent profile: <span className="text-foreground">{agentProfile}</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
