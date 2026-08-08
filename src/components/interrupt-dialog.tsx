import { useEffect, useState } from "react";
import type { AgUiInterrupt, AgUiResumeEntry } from "@assistant-ui/react-ag-ui";
import {
  useAgUiInterrupts,
  useAgUiSubmitInterruptResponses,
} from "@assistant-ui/react-ag-ui";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cancel, describe, resolveWith } from "@/lib/interrupts";

/**
 * The agent, blocked, asking the person something.
 *
 * Modal by deliberate choice: approvals were inline for years and the point of
 * this client is that the chat stays a conversation between two parties, with
 * everything administrative given its own surface.
 *
 * This component is **presentational** — it takes an interrupt and two
 * callbacks and knows nothing about where the answer goes. That is what lets
 * the same dialog serve both a live interrupt (answered through the runtime)
 * and one recovered from `/session` after a reload (answered by POSTing a
 * resume ourselves, because the runtime never saw it).
 */
export function InterruptDialog({
  interrupt,
  onAnswer,
  onCancel,
  busy,
}: {
  interrupt: AgUiInterrupt;
  onAnswer: (entry: AgUiResumeEntry) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const view = describe(interrupt);
  const [typed, setTyped] = useState(view.defaultValue);

  // A new interrupt reuses this component, so the input has to be reset
  // explicitly — otherwise the previous field's answer is sitting there
  // pre-filled, one Enter away from being submitted to a different question.
  useEffect(() => setTyped(view.defaultValue), [interrupt.id, view.defaultValue]);

  const answer = (value: string) => onAnswer(resolveWith(interrupt, value));

  return (
    // `open` is a literal, and there is deliberately no `onOpenChange`: an
    // outside click or a stray Escape cannot close this. The only ways out are
    // the buttons below, each of which sends a real answer. An interrupt that
    // is dismissed rather than answered leaves the agent parked in
    // `approving_request`, which looks exactly like the app having hung — and
    // for a permission prompt, dismissing by accident is the failure that
    // matters most.
    <Dialog open>
      <DialogContent className="max-w-xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {view.isApproval ? "Permission required" : "Input required"}
          </DialogTitle>
          {view.assist ? (
            <DialogDescription>{view.assist}</DialogDescription>
          ) : null}
        </DialogHeader>

        {/* The full message, never truncated — for an approval this is the
            actual command about to run, and it is the only thing the person
            has to judge by. `whitespace-pre-wrap` keeps the server's own line
            breaks, which is how the command sits on its own line. */}
        <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm">
          {view.message}
        </p>

        {view.choices.length > 0 ? (
          // One button per option, including multi-option grants like "always
          // allow this host". Every one is rendered: hiding an option the
          // server offered would quietly remove a choice the person has.
          <div className="flex flex-wrap gap-2">
            {view.choices.map((choice) => (
              <Button
                key={choice.value}
                // Deliberately uniform styling. Allow and Deny must be equally
                // easy to hit — no primary colour on the permissive one, and
                // no autofocus anywhere, so nothing is approved by reflex.
                variant="outline"
                disabled={busy}
                onClick={() => answer(choice.value)}
              >
                {choice.label}
              </Button>
            ))}
          </div>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              answer(typed);
            }}
          >
            <input
              className="border-input flex-1 rounded-md border px-3 py-2 text-sm"
              type={view.inputType}
              value={typed}
              disabled={busy}
              onChange={(event) => setTyped(event.target.value)}
            />
            <Button type="submit" disabled={busy}>
              Send
            </Button>
          </form>
        )}

        <div className="flex gap-2 border-t pt-3">
          {view.allowBack ? (
            <Button variant="ghost" disabled={busy} onClick={() => answer("/back")}>
              Back
            </Button>
          ) : null}
          {view.allowSkip ? (
            <Button variant="ghost" disabled={busy} onClick={() => answer("/skip")}>
              Skip
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="ml-auto"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The live case: an interrupt raised by the run currently on screen.
 *
 * `useAgUiInterrupts` is populated from the stream, so this covers everything
 * except a page reload — that gap is what `/session`'s `pending` field exists
 * to close, handled separately in App.
 */
export function LiveInterrupts() {
  const interrupts = useAgUiInterrupts();
  const submit = useAgUiSubmitInterruptResponses();
  const [busy, setBusy] = useState(false);

  // Only ever one at a time. The server raises them one per turn, and stacking
  // dialogs would make it ambiguous which question a button belongs to.
  const interrupt = interrupts[0];
  if (!interrupt) return null;

  const send = async (entry: AgUiResumeEntry) => {
    setBusy(true);
    try {
      await submit([entry]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <InterruptDialog
      interrupt={interrupt}
      busy={busy}
      onAnswer={send}
      onCancel={() => send(cancel(interrupt))}
    />
  );
}
