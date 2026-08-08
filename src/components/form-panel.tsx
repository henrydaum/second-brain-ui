/**
 * A command collecting its arguments, one step at a time.
 *
 * **This one component is every admin screen.** `/config`, `/packages`,
 * `/permissions`, `/mode`, `/llm`, `/schedule` — they all arrive as the same
 * `form_field` frame, and none of them needs a screen of its own. That is the
 * single largest payoff available from this protocol, so it is worth building
 * properly once.
 *
 * **A form is answered by submitting plain text**, not by a special Request.
 * That is why this is a panel above the composer rather than a modal: the
 * composer is a perfectly good second input for the same question, and someone
 * who would rather type `Main` than hunt for the button should be able to. The
 * literal strings `/back`, `/skip` and `/cancel` drive the three affordances,
 * and an empty string skips an optional step.
 */

import { useEffect, useState, type FC } from "react";

import { Button } from "@/components/ui/button";
import { useSecondBrain } from "@/runtime/provider";

export const FormPanel: FC = () => {
  const { state, say } = useSecondBrain();
  const form = state.form;
  const display = form?.display;

  const [typed, setTyped] = useState("");

  // Each step is a fresh question, so the input clears — but it prefills with
  // the step's default when there is one, since a default nobody can see is a
  // default nobody uses.
  useEffect(() => {
    setTyped(form?.field?.default != null ? String(form.field.default) : "");
  }, [form]);

  if (!form || !display) return null;

  const choices = display.choices ?? [];
  const numeric =
    form.field?.type === "integer" || form.field?.type === "number";

  const answer = (text: string) => void say(text);

  return (
    <div className="bg-muted/40 mx-auto w-full max-w-(--thread-max-width) rounded-xl border p-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">{display.prompt}</p>
        {form.name && (
          <span className="text-muted-foreground shrink-0 font-mono text-xs">
            /{form.name}
          </span>
        )}
      </div>

      {display.assist && (
        <p className="text-muted-foreground mt-1 text-xs">{display.assist}</p>
      )}

      {choices.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {choices.map((choice, index) => (
            <Button
              key={index}
              size="sm"
              variant="outline"
              // The value is what the server understands; the label is what a
              // person understands. Same pairing rule as an approval.
              onClick={() => answer(String(choice.value))}
            >
              {choice.label ?? String(choice.value)}
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            answer(typed);
          }}
        >
          <input
            autoFocus
            // `input_mode` is a hint for the widget; the field's own type is the
            // reliable half, so numbers get a numeric keypad on touch devices
            // without pretending to validate anything the server will validate
            // properly anyway.
            inputMode={numeric ? "numeric" : undefined}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            className="border-input flex-1 rounded-md border bg-transparent px-3 py-1.5 outline-none focus-visible:ring-[3px]"
          />
          <Button type="submit" size="sm">
            Send
          </Button>
        </form>
      )}

      <div className="text-muted-foreground mt-3 flex gap-1">
        {/* Only shown when the server says the step has a previous one. */}
        {display.allow_back && (
          <Button size="sm" variant="ghost" onClick={() => answer("/back")}>
            Back
          </Button>
        )}
        {display.allow_skip && (
          <Button size="sm" variant="ghost" onClick={() => answer("/skip")}>
            Skip
          </Button>
        )}
        {/* `allow_cancel` is effectively always true, but it is read rather than
            assumed — a form nobody can get out of is the worse failure. */}
        {display.allow_cancel !== false && (
          <Button size="sm" variant="ghost" onClick={() => answer("/cancel")}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
};
