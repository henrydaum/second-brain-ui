/**
 * The chat window.
 *
 * Structurally this is the assistant-ui starter template, with everything the
 * server cannot do taken out: no regenerate, no message editing, no branch
 * picker. The model picker is backed by Second Brain's global configuration
 * SDK rather than assistant-ui's request config because this runtime is an
 * external store.
 *
 * assistant-ui's "primitives" are unstyled components that carry behaviour:
 * `ThreadPrimitive.Messages` knows how to iterate messages, `ComposerPrimitive.
 * Send` knows how to send. They read the runtime through context, which is why
 * nothing here is passed any props about the conversation.
 */

import type { FC } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  SquareIcon,
} from "lucide-react";
import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  groupPartByType,
  useAuiState,
} from "@assistant-ui/react";

import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { DotMatrix } from "@/components/assistant-ui/dot-matrix";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HostFiles, HostFilesDataUI } from "@/components/host-file";
import { ErrorBanner } from "@/components/session-bar";
import { ModelSelector } from "@/components/model-selector";
import { SecurityModePicker } from "@/components/security-mode-picker";
import { TurnFilesButton, TurnShownFile } from "@/components/turn-files";
import { VoiceNoteButton } from "@/components/voice-note";
import { fullTimestamp, shortTimestamp } from "@/lib/time";
import { FINE_POINTER_QUERY, useMediaQuery } from "@/lib/media";
import { cn } from "@/lib/utils";
import { HOST_FILES, SENT_AT } from "@/runtime/convert";

/**
 * Shown while the agent has the turn but has not said anything yet.
 *
 * Without it, sending a message looks like nothing happened until the first
 * token arrives. **With it unguarded, it lies.** assistant-ui renders this slot
 * whenever a message has nothing to show *or*, by default, whenever the last
 * part is not text — and a command turn ends on a tool-call part, so "Thinking"
 * would appear next to a finished command and stay there. `isRunning` follows
 * the `typing` frame, which is the server's own statement about whether it
 * still has the turn, so it is the only honest thing to key this on.
 */
const WorkingIndicator: FC = () => {
  const running = useAuiState((s) => s.thread.isRunning);
  if (!running) return null;

  return (
    <span
      className="text-muted-foreground inline-flex items-center gap-2"
      role="status"
      aria-live="polite"
      aria-label="Second Brain is working"
    >
      <DotMatrix state="connecting" aria-hidden />
      <span className="text-sm">Working</span>
    </span>
  );
};

/** How every message's parts are drawn. One object, reused by both roles, so
 *  markdown and tool rendering cannot drift between them. */
const messageComponents = {
  Text: MarkdownText,
  Empty: WorkingIndicator,
  tools: { Fallback: ToolFallback },
  // The person's own attachments, which arrive as a named data part. The
  // agent's files are not parts at all — see `components/turn-files.tsx`.
  data: { by_name: { [HOST_FILES]: HostFiles } },
} as const;

/**
 * A user message ending in a data part is complete, not empty.
 *
 * `MessagePrimitive.Parts` asks its Empty renderer to fill a message whose last
 * part is non-text. That is useful for the assistant's blank running turn, but
 * a voice note is precisely such a non-text user message; sharing the assistant
 * fallback put "Working" inside the attachment bubble while the agent replied.
 */
const userMessageComponents = {
  ...messageComponents,
  Empty: () => null,
} as const;

export const Thread: FC = () => {
  // A conversation with nothing in it centres the composer, the way a new chat
  // does everywhere else. The zero-message geometry applies during loading as
  // well, so an empty chat's composer paints where it will remain instead of
  // jumping up from the bottom. The greeting is still separately guarded by
  // `isLoading` below, because loaded scrollback must not flash a welcome on
  // its way in.
  const centerComposer = useAuiState(
    (s) => s.thread.messages.length === 0,
  );
  const isLoading = useAuiState((s) => s.thread.isLoading);

  return (
    <ThreadPrimitive.Root
      className="bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
        ["--composer-radius" as string]: "1.5rem",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className={cn(
          "relative flex flex-1 flex-col overflow-y-scroll scroll-smooth px-4 pt-4",
          centerComposer && "justify-center",
        )}
      >
        {/* Keep the greeting's exact space while history loads, but hide its
            content. An empty conversation can then reveal it without moving
            the composer, while loaded scrollback never flashes the greeting. */}
        {centerComposer && (
          <div
            aria-hidden={isLoading || undefined}
            className={cn(
              "mx-auto mb-6 w-full max-w-(--thread-max-width) text-center",
              isLoading && "invisible",
            )}
          >
            <h1 className="text-primary text-2xl font-semibold">
              What can I help with?
            </h1>
          </div>
        )}

        {/* `gap-y-8` rather than `6` because the assistant's footer strip lives
            *inside* this gap rather than below the message — see
            `AssistantMessageFooter`. The gap therefore has to be at least as
            tall as the strip, or a copy button would sit on top of the next
            message. Everything else about the rhythm is unchanged: one spacing
            between every pair of messages, whoever they are from. */}
        <div className="mb-14 flex flex-col gap-y-8 empty:hidden">
          <ThreadPrimitive.Messages>
            {({ message }) =>
              message.role === "user" ? <UserMessage /> : <AssistantMessage />
            }
          </ThreadPrimitive.Messages>
        </div>

        <ThreadPrimitive.ViewportFooter
          className={cn(
            "bg-background mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-6",
            !centerComposer &&
              "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
          )}
        >
          <ScrollToBottom />
          <Suggestions />
          <ErrorBanner />
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>

      {/* Draws nothing. It registers the renderer for the agent's own files
          with the assistant-wide registry that `GroupedParts` reads — see
          `components/host-file.tsx`. */}
      <HostFilesDataUI />
    </ThreadPrimitive.Root>
  );
};

/**
 * Quick replies offered by a store plugin.
 *
 * `buttons` frames have been carried all the way from the wire, through the
 * store, into the runtime's `suggestions` — and then nothing rendered them, so
 * the whole path was inert. Nothing in the kernel emits `buttons` today, which
 * is exactly why this was easy to leave unfinished and hard to notice.
 */
const Suggestions: FC = () => (
  <AuiIf condition={(s) => s.thread.suggestions.length > 0}>
    <div className="flex flex-wrap gap-2">
      <ThreadPrimitive.Suggestions>
        {/* `send`, not the deprecated `autoSend`: a quick reply is an answer,
            so pressing it submits rather than filling the composer in. */}
        {({ suggestion }) => (
          <ThreadPrimitive.Suggestion asChild prompt={suggestion.prompt} send>
            <Button variant="outline" size="sm" className="rounded-full">
              {suggestion.label || suggestion.prompt}
            </Button>
          </ThreadPrimitive.Suggestion>
        )}
      </ThreadPrimitive.Suggestions>
    </div>
  </AuiIf>
);

const ScrollToBottom: FC = () => (
  <ThreadPrimitive.ScrollToBottom asChild>
    <TooltipIconButton
      tooltip="Scroll to bottom"
      variant="outline"
      // `p-4` used to sit here alongside the icon size, which with a working
      // `size` variant would crush the arrow into a 36px button. The variant
      // supplies the border and background now, so the class list only has to
      // say where it floats.
      className="bg-background absolute -top-12 z-10 size-9 self-center rounded-full shadow-md disabled:invisible"
    >
      <ArrowDownIcon />
    </TooltipIconButton>
  </ThreadPrimitive.ScrollToBottom>
);

const Composer: FC = () => {
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);

  return (
      <ComposerPrimitive.Root className="relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div className="border-primary/25 data-[dragging=true]:border-ring focus-within:border-primary/60 flex w-full flex-col rounded-(--composer-radius) border bg-(--composer-bg) p-2 data-[dragging=true]:border-dashed">
            <ComposerAttachments />
            <ComposerPrimitive.Input
              rows={1}
              autoFocus={finePointer}
              unstable_insertNewlineOnTouchEnter
              placeholder="Message Second Brain"
              className="placeholder:text-muted-foreground mb-2 max-h-40 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
            />
            <div className="relative flex min-w-0 items-center gap-1">
              <div className="flex min-w-0 items-center gap-1">
                <ComposerAddAttachment />
                {/* Beside the paperclip because it produces the same thing: a
                    voice note is an attachment, not a second kind of input. */}
                <VoiceNoteButton />
                <SecurityModePicker />
              </div>
              <div className="ms-auto flex min-w-0 flex-1 items-center justify-end gap-1">
                <ModelSelector />
                <ComposerAction />
              </div>
            </div>
          </div>
        </ComposerPrimitive.AttachmentDropzone>

      </ComposerPrimitive.Root>
  );
};

/**
 * The one control in the composer's corner: Send, or Stop.
 *
 * **What decides between them is the box, not the turn.** It used to be
 * `isRunning` alone — a turn was either yours to start or the agent's to stop,
 * never both — which made the composer useless for as long as the agent was
 * working: the only thing you could do with a thought was interrupt with it.
 * The kernel has always taken a message mid-turn and queued it for the next
 * loop boundary, so the restriction was the client's own.
 *
 * So: an empty box while the agent works can only mean stop, and a box with
 * something in it can only mean send it. Typing is what changes the button,
 * which is the rule people already know from Claude Code, and it costs nothing
 * to discover — nobody types into a composer they meant to press Stop on.
 *
 * `isEmpty` counts attachments too, so a staged file with no caption is a send
 * rather than a stop. See `runtime/provider.tsx`'s `queue` for why the Enter
 * key agrees with this button.
 *
 * **Only text is actually queueable**, and that is a kernel fact rather than a
 * choice made here: the busy guard in `runtime/conversation_runtime.py` queues
 * `send_text` and refuses `send_attachment` with "Still working." So a file
 * sent mid-turn comes back as that sentence in the transcript. It is offered
 * anyway because the alternative — a Send that refuses to appear while a file
 * is staged — hides the composer's own state to prevent one legible refusal.
 */
const ComposerAction: FC = () => {
  const running = useAuiState((s) => s.thread.isRunning);
  const empty = useAuiState((s) => s.composer.isEmpty);

  if (running && empty) {
    return (
      <ComposerPrimitive.Cancel asChild>
        <Button
          type="button"
          variant="default"
          size="icon"
          className="size-7 rounded-full"
          aria-label="Stop generating"
        >
          <SquareIcon className="size-3.5 fill-current" />
        </Button>
      </ComposerPrimitive.Cancel>
    );
  }

  return (
    <ComposerPrimitive.Send asChild>
      <TooltipIconButton
        // Named for what actually happens: mid-turn the kernel holds the
        // message until the agent reaches a loop boundary, and says so with a
        // notification. A button promising "send" and delivering a queue is
        // the sort of small lie that makes people press it twice.
        tooltip={running ? "Queue message" : "Send message"}
        side="bottom"
        type="button"
        variant="default"
        size="icon"
        className="size-7 rounded-full"
      >
        <ArrowUpIcon className="size-4.5" />
      </TooltipIconButton>
    </ComposerPrimitive.Send>
  );
};

const AssistantMessage: FC = () => (
  <MessagePrimitive.Root
    data-role="assistant"
    className="fade-in animate-in relative mx-auto w-full max-w-(--thread-max-width) duration-150"
  >
    {/* `relative` so the footer below can be positioned against the *content*,
        putting its top edge exactly at the last line of the reply. */}
    <div className="text-foreground relative px-2 leading-relaxed wrap-break-word">
      {/* `unstable_showEmptyOnNonTextEnd` defaults to true, which puts the
          working indicator after any message not ending in text — a command
          turn ends on its tool-call part, so it would sit beside a finished
          command forever. An indicator belongs where there is nothing to see,
          not next to a tool block that already reports its own state. */}
      <MessagePrimitive.GroupedParts
        groupBy={groupPartByType({ "tool-call": ["group-tool"] })}
      >
        {({ part, children }) => {
          switch (part.type) {
            case "group-tool":
              return (
                <ToolGroupRoot variant="ghost">
                  <ToolGroupTrigger
                    count={part.indices.length}
                    active={part.status.type === "running"}
                  />
                  <ToolGroupContent>{children}</ToolGroupContent>
                </ToolGroupRoot>
              );
            case "text":
              return <MarkdownText />;
            case "tool-call":
              return part.toolUI ?? <ToolFallback {...part} />;
            case "indicator":
              return <WorkingIndicator />;
            case "data":
              return part.dataRendererUI;
            default:
              return null;
          }
        }}
      </MessagePrimitive.GroupedParts>
      {/* After the parts rather than among them: the ledger records that a turn
          showed you a file, not where in the turn it did. See
          `components/turn-files.tsx`. */}
      <TurnShownFile />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="border-destructive bg-destructive/10 text-destructive mt-2 rounded-md border p-3 text-sm">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
      <AssistantMessageFooter />
    </div>
  </MessagePrimitive.Root>
);

/**
 * Height of the footer strip under an assistant message.
 *
 * Must stay **no taller than the `gap-y` between messages**, which is where it
 * sits. At `h-7` (28px) inside a `gap-y-8` (32px) it clears the next message by
 * four pixels.
 */
const FOOTER_HEIGHT = "h-7";

/**
 * The strip under an assistant message: actions on the left, the time beside
 * them.
 *
 * **It never occupies layout, and it never moves anything.** Two separate
 * problems, with one shape that solves both.
 *
 * The first: `ActionBarPrimitive.Root` does not hide when its own `autohide`
 * decides to, it returns `null` — so keying visibility on that made the row
 * enter and leave the flow, and every message below jumped as the pointer
 * crossed. Hovering a transcript should not move the transcript. So the
 * primitive is told `autohide="never"` and this component decides visibility
 * itself, with opacity.
 *
 * The second: reserving that space in the flow *also* pushed the following
 * message down, so the gap under a reply was the strip plus the gap — more
 * than twice the gap above it, and the transcript read as lopsided. Hence
 * `absolute`: the strip is parented to the message but takes no height, and
 * lands in the gap that was already there. The spacing above and below a reply
 * is then the same single `gap-y`, whether or not any of this is on screen.
 *
 * The constraint that buys is that the strip must not be taller than that gap,
 * or a copy button would sit on top of the next message. See `FOOTER_HEIGHT`.
 *
 * Being its own component is also the point: this is where anything else
 * per-message goes later — a retry, a token count, feedback — and none of it
 * will shift the layout either.
 *
 * Visibility follows the rule people expect from a chat app: the latest reply
 * keeps its actions on show, older ones reveal them on hover. Nothing shows
 * while a reply is still being written, where copying would take half a
 * sentence.
 */
const AssistantMessageFooter: FC = () => {
  const visible = useAuiState(
    (s) =>
      s.message.status?.type !== "running" &&
      (s.message.isLast || s.message.isHovering),
  );

  return (
    <div
      data-slot="assistant-message-footer"
      className={cn(
        // `top-full` is the bottom of the reply; `start-2` matches the padding
        // the text itself sits behind, so the button lines up with the prose
        // rather than with the column edge.
        "absolute start-2 top-full flex items-center gap-2",
        FOOTER_HEIGHT,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 transition-opacity duration-150",
          visible ? "opacity-100" : "pointer-events-none opacity-0",
          // Keyboard users get it back, since an invisible control is still in
          // the tab order and focusing it has to show what was focused.
          "focus-within:pointer-events-auto focus-within:opacity-100",
        )}
      >
        <ActionBarPrimitive.Root
          autohide="never"
          className="text-muted-foreground flex items-center gap-1"
        >
          <ActionBarPrimitive.Copy asChild>
            <TooltipIconButton
              tooltip="Copy"
              side="bottom"
              // `group/copy` names *this* element: assistant-ui puts
              // `data-copied` on the button itself, so the icons below can only
              // see it as a group.
              className="group/copy size-7"
            >
              {/* assistant-ui flips `data-copied` on for a few seconds after a
                  successful copy; these two siblings are what turn that into
                  the tick-then-back feedback every one of these buttons
                  gives. */}
              <CopyIcon className="size-3.5 group-data-[copied]/copy:hidden" />
              <CheckIcon className="hidden size-3.5 group-data-[copied]/copy:block" />
            </TooltipIconButton>
          </ActionBarPrimitive.Copy>
        </ActionBarPrimitive.Root>

        <MessageTime />
        {/* Draws nothing for a turn that touched no files, which is most of
            them. See `FOOTER_HEIGHT` for why nothing here may grow taller. */}
        <TurnFilesButton />
      </div>
    </div>
  );
};

/**
 * When the message was sent.
 *
 * Read from `metadata.custom`, not from assistant-ui's own `createdAt`, because
 * that field is defaulted to the present when a message arrives without one —
 * which would date every message of a re-read conversation to the page load.
 * See `runtime/convert.ts`. A turn with no known time simply shows nothing.
 */
const MessageTime: FC = () => {
  const sentAt = useAuiState((s) => {
    const value = s.message.metadata?.custom?.[SENT_AT];
    return typeof value === "number" ? value : undefined;
  });

  if (sentAt === undefined) return null;
  const moment = new Date(sentAt);
  const full = fullTimestamp(moment);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          dateTime={moment.toISOString()}
          // The visible text is abbreviated by design, so the full moment is
          // what assistive technology should hear — it cannot hover, and this
          // is not a control it can focus either.
          aria-label={full}
          // Not text you would ever want to select, and the I-beam over it
          // reads as an invitation to try. `select-none` also keeps it out of
          // a drag-selection that started in the reply above.
          className="text-muted-foreground cursor-default text-[11px] tabular-nums select-none"
        >
          {shortTimestamp(moment)}
        </time>
      </TooltipTrigger>
      {/* `subtle`, and above rather than below: this is a footnote on text
          already on screen, not a control announcing what it does, and the
          buttons beside it own the louder treatment. */}
      <TooltipContent side="top" variant="subtle">
        {full}
      </TooltipContent>
    </Tooltip>
  );
};

const UserMessage: FC = () => (
  <MessagePrimitive.Root
    data-role="user"
    className="fade-in animate-in mx-auto grid w-full max-w-(--thread-max-width) auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] gap-y-2 px-2 duration-150 [&:where(>*)]:col-start-2"
  >
    <UserMessageAttachments />
    <div className="col-start-2 min-w-0">
      <div className="bg-muted text-foreground rounded-xl px-4 py-2 wrap-break-word empty:hidden">
        <MessagePrimitive.Parts components={userMessageComponents} />
      </div>
    </div>
  </MessagePrimitive.Root>
);
