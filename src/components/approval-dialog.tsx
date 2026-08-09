/**
 * The permission dialog. **This is the safety surface.**
 *
 * When the agent wants to do something consequential — run a shell command,
 * write a setting, delete a conversation — the kernel does not refuse and it
 * does not proceed. It asks, and the turn is blocked until somebody answers. A
 * client that ignores this looks exactly like a client that has hung.
 *
 * Three rules, all of which have cost this system time before:
 *
 * 1. **`enum` and `enum_labels` pair by index. Answer with the value, show the
 *    label.** Getting this backwards puts internal spellings like
 *    `always:api.search.brave.com` on a person's buttons.
 * 2. **Show `body` in full and never truncate it.** It carries the arguments and
 *    who is asking — which is the entire basis on which anyone can answer.
 * 3. **No auto-dismiss, no default, no escape.** Every option is equally
 *    reachable and none is pre-chosen; a dialog that can be dismissed by
 *    accident is a dialog that grants permission by accident.
 */

import { useEffect, useState, type FC } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApprovalPayload } from "@/lib/events";
import { useSecondBrain } from "@/runtime/provider";

/** One selectable answer: `value` goes to the server, `label` to the person. */
type Choice = { value: unknown; label: string };

/**
 * Pair `enum` with `enum_labels` **by index**.
 *
 * One named function rather than an inline `.map` at each call site, because
 * this is the rule that is easy to get subtly, silently wrong. Labels may be
 * absent even when values are not, so each falls back to its own value.
 */
function choicesOf(approval: ApprovalPayload): Choice[] {
  // The default when the server offers no enum. A boolean approval is the
  // common case and this is what it means.
  if (!Array.isArray(approval.enum) || approval.enum.length === 0) {
    if (approval.type === "string") return [];
    return [
      { value: true, label: "Allow" },
      { value: false, label: "Deny" },
    ];
  }
  const labels = approval.enum_labels ?? [];
  return approval.enum.map((value, index) => ({
    value,
    label: String(labels[index] ?? value),
  }));
}

export const ApprovalDialog: FC = () => {
  const { state, resolve } = useSecondBrain();
  const approval = state.approval;

  // A free-text approval — `type: "string"` with no enum. Rare, but it is the
  // difference between a question you can answer and one you cannot.
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(String(approval?.default ?? "")), [approval]);

  // Guards a double answer: the POST completes only when the *original* blocked
  // Request finishes, which can take a while, and a second click in that window
  // would answer a dialog that is already gone.
  const [answering, setAnswering] = useState(false);
  useEffect(() => setAnswering(false), [approval?.id]);

  if (!approval) return null;

  const choices = choicesOf(approval);

  const answer = (value: unknown) => {
    setAnswering(true);
    void resolve(value);
  };

  return (
    <Dialog open>
      <DialogContent
        // Every route out of this dialog that is not an answer is closed. The
        // close button, the escape key and clicking away would all read as
        // "never mind" while leaving the agent blocked — so there is no
        // dismissal, only an answer.
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        // Settings is itself a modal. Permission prompts are a nested safety
        // surface, so give both their backdrop and panel an explicit higher
        // layer instead of depending on portal insertion order.
        overlayClassName="z-[70]"
        className="z-[70] sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{approval.title || "Allow this?"}</DialogTitle>
          {approval.body && (
            <DialogDescription asChild>
              {/* `whitespace-pre-wrap` because the body is laid out by the
                  kernel — argument lists and command lines depend on their
                  newlines surviving. */}
              <pre className="text-muted-foreground max-h-64 overflow-y-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
                {approval.body}
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
      </DialogContent>
    </Dialog>
  );
};
