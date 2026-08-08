/**
 * A command, start to finish, without touching the chat.
 *
 * **The chat is between the person and the agent.** Choosing a tool from a list
 * is administration — it travels over the same wire, but interleaving it turns
 * the conversation into a log of button presses. So everything a command does
 * happens here: the question it is asking, the answers given so far, and
 * whatever it printed at the end.
 *
 * Above the composer rather than in a modal, because a step is still answered
 * by submitting plain text. Someone who would rather type `run_script` than
 * hunt for the button should be able to, and the composer has to stay live for
 * that.
 *
 * Prompts are markdown — the kernel sends tables describing a tool's arguments —
 * so they go through the same renderer the chat uses.
 */

import { useEffect, useState, type FC } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { TextMessagePartProvider } from "@assistant-ui/react";

import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSecondBrain } from "@/runtime/provider";

/**
 * Server markdown, rendered the way the chat renders it.
 *
 * `MarkdownText` reads its text from *message-part* scope, which
 * `TextMessagePartProvider` exists to supply — so it is mounted directly.
 * Wrapping it in `MessagePrimitive.Parts` instead does not work: that needs a
 * *message* scope, and there is no message here, only a string.
 */
const Markdown: FC<{ text: string }> = ({ text }) => (
  <TextMessagePartProvider text={text}>
    <MarkdownText />
  </TextMessagePartProvider>
);

export const CommandPanel: FC = () => {
  const { state, say, dismissCommand } = useSecondBrain();
  const { command, form } = state;
  const display = form?.display;

  const [typed, setTyped] = useState("");

  // Each step is a fresh question, so the input clears — but it prefills with
  // the step's default when there is one, since a default nobody can see is a
  // default nobody uses.
  useEffect(() => {
    setTyped(form?.field?.default != null ? String(form.field.default) : "");
  }, [form]);

  if (!command && !form) return null;

  const choices = display?.choices ?? [];
  const numeric =
    form?.field?.type === "integer" || form?.field?.type === "number";
  const answer = (text: string) => void say(text);

  // Answers given so far, straight off the command's own `args` — the wire
  // sends them cumulatively, so there is nothing to track here.
  const collected = Object.entries(command?.args ?? {});
  const finished = command?.status === "finished";
  const failed = finished && command?.ok === false;

  return (
    <div
      data-slot="command-panel"
      className="bg-muted/40 mx-auto w-full max-w-(--thread-max-width) overflow-hidden rounded-xl border text-sm"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="font-mono text-xs font-medium">
          /{command?.name ?? form?.name}
        </span>

        {collected.map(([name, value]) => (
          // The blurb Henry asked for: what has been answered, growing a chip
          // at a time as each step is given.
          <span
            key={name}
            className="bg-background text-muted-foreground rounded-md border px-1.5 py-0.5 text-xs"
          >
            {name}: <span className="text-foreground">{String(value)}</span>
          </span>
        ))}

        {finished && (
          <span
            className={cn(
              "ms-auto inline-flex items-center gap-1 text-xs",
              failed ? "text-destructive" : "text-emerald-600",
            )}
          >
            {failed ? <XIcon className="size-3" /> : <CheckIcon className="size-3" />}
            {failed ? (command?.error ?? "failed") : "done"}
          </span>
        )}
      </div>

      <div className="p-3">
        {/* The question, while there is one. */}
        {display && (
          <>
            <div className="[&_p]:my-0 [&_table]:my-2">
              <Markdown text={display.prompt} />
            </div>
            {display.assist && (
              <p className="text-muted-foreground mt-1 text-xs">
                {display.assist}
              </p>
            )}

            {choices.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {choices.map((choice, index) => (
                  <Button
                    key={index}
                    size="sm"
                    variant="outline"
                    // The value goes to the server, the label to the person —
                    // the same pairing rule as an approval.
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
              {/* `allow_cancel` is effectively always true, but it is read
                  rather than assumed — a form nobody can get out of is the
                  worse failure. */}
              {display.allow_cancel !== false && (
                <Button size="sm" variant="ghost" onClick={() => answer("/cancel")}>
                  Cancel
                </Button>
              )}
            </div>
          </>
        )}

        {/* What it printed. Here rather than in the chat, which is the whole
            point of this component. */}
        {command && command.outcome.length > 0 && (
          <div className={cn(display && "mt-3 border-t pt-3")}>
            {command.outcome.map((text, index) => (
              <Markdown key={index} text={text} />
            ))}
          </div>
        )}

        {/* Only once there is nothing left to answer — a command still asking
            questions is dismissed with Cancel, which tells the server too. */}
        {command && !display && (
          <Button
            size="sm"
            variant="outline"
            className={cn(command.outcome.length > 0 && "mt-3")}
            onClick={dismissCommand}
          >
            Close
          </Button>
        )}
      </div>
    </div>
  );
};
