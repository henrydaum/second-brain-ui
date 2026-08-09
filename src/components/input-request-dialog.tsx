/**
 * The dialog for a question the kernel is blocking a turn on.
 *
 * **This is the safety surface, and it is more than that.** One kernel
 * primitive — `runtime.request_input` — raises all of these: a permission gate
 * asking to run a shell command or write a setting, and a tool asking the
 * person an ordinary question. The kernel does not refuse and does not proceed;
 * it asks, and the turn is blocked until somebody answers. A client that
 * ignores this looks exactly like a client that has hung.
 *
 * **And it is the only place any of it appears.** Approvals used to arrive as
 * chat messages because there was nowhere else to put them; the kernel no
 * longer narrates them at all, and nothing about a question — raised, answered,
 * declined — belongs in the transcript, the command panel, or the error banner.
 *
 * Four rules, all of which have cost this system time before:
 *
 * 1. **`enum` and `enum_labels` pair by index. Answer with the value, show the
 *    label.** Getting this backwards puts internal spellings like
 *    `always:api.search.brave.com` on a person's buttons. See `choicesOf`.
 * 2. **Show `body` in full and never truncate it.** It carries the arguments and
 *    who is asking — which is the entire basis on which anyone can answer.
 * 3. **No default, and no way out that is not an answer.** Every option is
 *    equally reachable and none is pre-chosen; a dialog that can be dismissed
 *    by accident is a dialog that grants permission by accident.
 *
 *    Escape and the close button are therefore wired to **cancel**, not to
 *    close. That is the distinction the rule is actually about: cancelling
 *    settles the question on the server — a sandbox gate reads it as refused,
 *    `ui.ask` as a refusal, a gated command is dropped without running — so it
 *    unblocks the turn in the safe direction. Merely hiding this panel would
 *    leave the agent waiting on a question nobody can see, which is the failure
 *    the original "no escape" rule was written against. Clicking the backdrop
 *    is still nothing at all, because that is the press people make by
 *    accident.
 * 4. **Answer the question that was asked.** The id travels with the answer,
 *    because a second question can arrive between drawing this and pressing a
 *    button, and "the current one" would then be the wrong one.
 */

import { useEffect, useState, type FC } from "react";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { choicesOf } from "@/lib/input-requests";
import { useSecondBrain } from "@/runtime/provider";

export const InputRequestDialog: FC = () => {
  const { inputRequests, resolve, cancelInputRequest } = useSecondBrain();
  // Head first, matching the order the kernel works its own queue down. A
  // second blocked call waits behind this one rather than replacing it.
  const request = inputRequests[0];
  const waiting = inputRequests.length - 1;

  // A free-text question — no enum, and a type that is not boolean. Rare for a
  // permission gate, ordinary for `ui.ask`, and the difference between a
  // question you can answer and one you cannot.
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(String(request?.default ?? "")), [request]);

  // Guards a double answer: the POST completes only when the *original* blocked
  // Request finishes, which can take a while, and a second click in that window
  // would answer a question that is already gone.
  const [answering, setAnswering] = useState(false);
  useEffect(() => setAnswering(false), [request?.id]);

  if (!request) return null;

  const choices = choicesOf(request);

  const answer = (value: unknown) => {
    setAnswering(true);
    void resolve(request.id, value);
  };

  /** Escape and the close button both land here — Radix routes each of them
   *  through `onOpenChange`, so there is one path out and it is a real cancel.
   *  Guarded by `answering` for the same reason the buttons are: an answer is
   *  already on its way and cancelling behind it would settle the *next*
   *  question. */
  const backOut = (open: boolean) => {
    if (open || answering) return;
    setAnswering(true);
    void cancelInputRequest(request.id);
  };

  return (
    <Dialog open onOpenChange={backOut}>
      <DialogContent
        // Escape and the corner button cancel — see rule 3 above. Clicking the
        // backdrop still does nothing: it is the press people make by accident,
        // and it is the one route out that carries no intent at all.
        //
        // The stock close button is declined in favour of the one below, whose
        // only difference is that it says what it does. "Close" is the wrong
        // word for the only control here that settles a question on the server,
        // and it is the word a screen reader would have read out.
        showCloseButton={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        // Settings is itself a modal, and a command running inside it is what
        // raises a good share of these. A question is a nested surface over
        // whatever asked it, so give both its backdrop and panel an explicit
        // higher layer instead of depending on portal insertion order.
        overlayClassName="z-[70]"
        className="z-[70] sm:max-w-xl"
      >
        <DialogClose
          disabled={answering}
          title="Cancel this request"
          className="ring-offset-background focus:ring-ring absolute end-4 top-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:pointer-events-none"
        >
          <XIcon />
          <span className="sr-only">Cancel this request</span>
        </DialogClose>

        <DialogHeader>
          {/* `pe-6` so a long title does not run under the corner button. */}
          <DialogTitle className="pe-6">
            {request.title || "The agent is asking"}
          </DialogTitle>
          {request.body && (
            <DialogDescription asChild>
              {/* `whitespace-pre-wrap` because the body is laid out by the
                  kernel — argument lists and command lines depend on their
                  newlines surviving. */}
              <pre className="text-muted-foreground max-h-64 overflow-y-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
                {request.body}
              </pre>
            </DialogDescription>
          )}
        </DialogHeader>

        {choices.length === 0 ? (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              answer(typed);
            }}
          >
            <input
              autoFocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="border-input flex-1 rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
            />
            <Button type="submit" disabled={answering}>
              Answer
            </Button>
          </form>
        ) : (
          <DialogFooter className="sm:justify-start">
            {choices.map((choice, index) => (
              <Button
                key={index}
                // Every option carries the same weight. Styling one as primary
                // is a recommendation, and this dialog has no business making
                // one.
                variant="outline"
                disabled={answering}
                onClick={() => answer(choice.value)}
              >
                {choice.label}
              </Button>
            ))}
          </DialogFooter>
        )}

        {/* Said quietly, but said: two gated calls in one turn each raise their
            own question, and without this the second looks like the first
            failing to close. */}
        {waiting > 0 && (
          <p className="text-muted-foreground text-xs">
            {waiting === 1
              ? "1 more question after this one."
              : `${waiting} more questions after this one.`}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
};
