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
  ["medium", "Medium"],
  ["high", "High"],
] as const;

/**
 * The effort control, as a row of the model panel.
 *
 * **Dots on a track, not four labelled segments.** Four boxes of text inside a
 * bordered box inside the popover was three nested containers deep, and the
 * labels sat at whatever width their words happened to be. A slider carries the
 * same four positions in one shape, and the value it is on is said once, in the
 * row's own text — the same `label: value` line the agent profile below it
 * uses, so the two rows read as a pair rather than as a widget above a caption.
 *
 * The dots stay monochrome deliberately: every colour token in this palette is
 * chroma 0 apart from `destructive`, so a coloured dot would be the only hue in
 * the panel.
 *
 * **A radio group, not a row of buttons.** `MarkdownModePicker` wears similar
 * clothes but uses `aria-pressed`, because its two buttons each do a thing;
 * these four are one field carrying one value, and a screen reader should hear
 * it that way. Each dot names itself, since none of them carries visible text.
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
  const current = REASONING_LEVELS.find(([value]) => value === reasoningEffort);

  return (
    <div
      // `min-h-9` rather than padding: it is the height every menu item above
      // is on, and the agent profile row below is on the same floor, so the
      // three read as one rhythm instead of three heights.
      className="flex min-h-9 items-center gap-3 px-2"
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
      <span className="text-muted-foreground min-w-0 truncate text-xs">
        Reasoning: <span className="text-foreground">{current?.[1]}</span>
      </span>
      <div
        role="radiogroup"
        aria-label="Reasoning effort"
        className={cn(
          "bg-muted/60 ms-auto flex shrink-0 items-center rounded-full px-1",
          disabled && "opacity-50",
        )}
      >
        {REASONING_LEVELS.map(([value, label]) => {
          const active = value === reasoningEffort;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              disabled={disabled}
              onClick={() => void setReasoningEffort(value)}
              // The dot is small; the button around it is a touch target.
              className="focus-visible:ring-ring group flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 disabled:pointer-events-none"
            >
              <span
                className={cn(
                  "rounded-full transition-all duration-150",
                  active
                    ? "bg-foreground size-3"
                    : "bg-muted-foreground/50 group-hover:bg-muted-foreground size-1.5",
                )}
              />
            </button>
          );
        })}
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
        className="w-[min(20rem,calc(100vw-2rem))]"
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
        <div className="text-muted-foreground flex min-h-9 items-center px-2 text-xs">
          {/* Wrapped so the label and value stay one inline run — as direct
              children of a flex box the space between them is discarded. */}
          <span className="min-w-0 truncate">
            Agent profile: <span className="text-foreground">{agentProfile}</span>
          </span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
