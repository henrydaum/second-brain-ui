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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { spellModelWord } from "@/lib/model-names";
import { useModels } from "@/runtime/provider";

/** The radio value standing for "no value at all". A sentinel rather than a
 *  word, because any word could be a value some provider accepts. */
const NOT_SET = "\u0000not-set";

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

/**
 * The reasoning control, as a row of the model panel.
 *
 * **Nothing is hardcoded, including whether the row exists.** It used to be
 * four fixed values written into `reasoning_effort`, which was a guess in
 * three directions at once: that the parameter is called that, that this model
 * takes it, and that `off/low/medium/high` are its values. The backend answers
 * all three per model, and answers "no control" for most of them.
 *
 * **A submenu, not dots on a track.** The dots carried exactly four positions
 * and read as a slider because four is what they always were; a provider names
 * anywhere from two values to seven. One rendering that does not depend on how
 * many come back is worth more than a control that looks like a scale until it
 * has six dots in it.
 *
 * **`Not set` is not `Off`.** Removing the parameter leaves the provider's own
 * default, which may well still reason — only a value the provider names, like
 * `none`, actually means off, and it appears in the list when it is offered.
 * The old control called this Off and wrote the string `"off"`, which no
 * provider accepts as a level.
 */
function ReasoningRow() {
  const { reasoningControl, settingReasoning, switchingModel, setReasoningValue } =
    useModels();
  // No control is the ordinary case, not an error state: the backend says so
  // for every model it cannot vouch for, and a row explaining its own absence
  // would be in the panel more often than the control is.
  if (!reasoningControl) return null;
  const disabled = settingReasoning || switchingModel;
  const { choices, value } = reasoningControl;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        // `min-h-9` rather than padding: it is the height every menu item
        // above is on, and the agent profile row below is on the same floor,
        // so the three read as one rhythm instead of three heights.
        className="min-h-9 gap-3 px-2 text-xs"
        disabled={disabled}
      >
        <span className="text-muted-foreground min-w-0 truncate">
          Reasoning:{" "}
          <span className="text-foreground">{value ?? "Not set"}</span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={value ?? NOT_SET}
          onValueChange={(next) =>
            void setReasoningValue(next === NOT_SET ? null : next)
          }
        >
          <DropdownMenuRadioItem value={NOT_SET} className="text-xs">
            Not set
          </DropdownMenuRadioItem>
          {choices.map((choice) => (
            <DropdownMenuRadioItem
              key={choice}
              value={choice}
              className="text-xs"
            >
              {choice}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
    refreshReasoning,
  } = useModels();
  const label = modelsLoading && !modelName ? "Loading…" : compactModelName(modelName);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Asked on every open rather than held from the last one. Whether this
        // model has a reasoning dial, and which values it takes, can move
        // under us — a backend install or an edit in `/llm` both do it — and
        // the kernel caches the answer per model, so asking again is a round
        // trip and no work.
        if (next) void refreshReasoning();
      }}
    >
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
