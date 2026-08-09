/**
 * The chat window.
 *
 * Structurally this is the assistant-ui starter template, with everything the
 * server cannot do taken out: no model picker, no regenerate, no message
 * editing, no branch picker. Those are not omissions to fill in later — the
 * kernel has no regenerate and no message tree, and a button that cannot work
 * is worse than no button.
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
import { ApprovalDialog } from "@/components/approval-dialog";
import { HostFiles, HostFilesDataUI } from "@/components/host-file";
import { ErrorBanner } from "@/components/session-bar";
import { SecurityModePicker } from "@/components/security-mode-picker";
import { VoiceNoteButton } from "@/components/voice-note";
import { cn } from "@/lib/utils";
import { HOST_FILES } from "@/runtime/convert";

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
  // Host file paths arrive as a named data part; this is what turns them into
  // something a browser can show. See `components/host-file.tsx`.
  data: { by_name: { [HOST_FILES]: HostFiles } },
} as const;

export const Thread: FC = () => {
  // A conversation with nothing in it centres the composer, the way a new chat
  // does everywhere else. `isLoading` is included so scrollback that is still
  // being read does not flash the welcome screen on its way in.
  const isEmpty = useAuiState(
    (s) => s.thread.messages.length === 0 && !s.thread.isLoading,
  );

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
          isEmpty && "justify-center",
        )}
      >
        {/* `isLoading` matters here as much as it does for `isEmpty` above.
            Keyed on message count alone, this greeting appeared for the moment
            between the page opening and scrollback arriving — so every load and
            every conversation switch flashed "What can I help with?" at
            somebody who was mid-conversation. */}
        <AuiIf
          condition={(s) => s.thread.messages.length === 0 && !s.thread.isLoading}
        >
          <div className="mx-auto mb-6 w-full max-w-(--thread-max-width) text-center">
            <h1 className="text-primary text-2xl font-semibold">
              What can I help with?
            </h1>
          </div>
        </AuiIf>

        <div className="mb-14 flex flex-col gap-y-6 empty:hidden">
          <ThreadPrimitive.Messages>
            {({ message }) =>
              message.role === "user" ? <UserMessage /> : <AssistantMessage />
            }
          </ThreadPrimitive.Messages>
        </div>

        <ThreadPrimitive.ViewportFooter
          className={cn(
            "bg-background mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-3 pb-4 md:pb-6",
            !isEmpty && "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
          )}
        >
          <ScrollToBottom />
          <Suggestions />
          <ErrorBanner />
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>

      {/* Outside the viewport — it is a modal over everything, and it is the one
          thing in this app that must not be scrolled past. */}
      <ApprovalDialog />

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

const Composer: FC = () => (
      <ComposerPrimitive.Root className="relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div className="border-primary/25 data-[dragging=true]:border-ring focus-within:border-primary/60 flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-2 data-[dragging=true]:border-dashed">
            <ComposerAttachments />
            <ComposerPrimitive.Input
              rows={1}
              autoFocus
              placeholder="Message Second Brain"
              className="placeholder:text-muted-foreground max-h-40 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
            />
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-1">
                <ComposerAddAttachment />
                {/* Beside the paperclip because it produces the same thing: a
                    voice note is an attachment, not a second kind of input. */}
                <VoiceNoteButton />
                <SecurityModePicker />
              </div>
              {/* Send and Cancel occupy the same corner: a turn is either yours
                  to start or the agent's to stop, never both. */}
              <AuiIf condition={(s) => !s.thread.isRunning}>
                <ComposerPrimitive.Send asChild>
                  <TooltipIconButton
                    tooltip="Send message"
                    side="bottom"
                    type="button"
                    variant="default"
                    size="icon"
                    className="size-7 rounded-full"
                  >
                    <ArrowUpIcon className="size-4.5" />
                  </TooltipIconButton>
                </ComposerPrimitive.Send>
              </AuiIf>
              <AuiIf condition={(s) => s.thread.isRunning}>
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
              </AuiIf>
            </div>
          </div>
        </ComposerPrimitive.AttachmentDropzone>

      </ComposerPrimitive.Root>
);

const AssistantMessage: FC = () => (
  <MessagePrimitive.Root
    data-role="assistant"
    className="fade-in animate-in relative mx-auto w-full max-w-(--thread-max-width) duration-150"
  >
    <div className="text-foreground px-2 leading-relaxed wrap-break-word">
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
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="border-destructive bg-destructive/10 text-destructive mt-2 rounded-md border p-3 text-sm">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
      <AssistantActionBar />
    </div>
  </MessagePrimitive.Root>
);

/**
 * Copy, and only copy.
 *
 * The other three buttons that live here in every other chat app — regenerate,
 * edit, thumbs — all need a backend that can do the thing, and this one cannot:
 * there is no regenerate and no message tree, which is why the runtime declares
 * no `onReload`, `onEdit` or branch adapter. Copying is different. It is
 * entirely local, it is the affordance people actually reach for, and its
 * absence was conspicuous.
 *
 * `hideWhenRunning` keeps it off a message that is still being written, where
 * copying would take half a sentence.
 */
const AssistantActionBar: FC = () => (
  <ActionBarPrimitive.Root
    hideWhenRunning
    autohide="not-last"
    className="text-muted-foreground mt-2 flex items-center gap-1 data-[floating]:absolute"
  >
    <ActionBarPrimitive.Copy asChild>
      <TooltipIconButton
        tooltip="Copy"
        side="bottom"
        // `group/copy` names *this* element: assistant-ui puts `data-copied` on
        // the button itself, so the icons below can only see it as a group.
        className="group/copy size-8"
      >
        {/* assistant-ui flips `data-copied` on for a few seconds after a
            successful copy; these two siblings are what turn that into the
            tick-then-back feedback every one of these buttons gives. */}
        <CopyIcon className="size-4 group-data-[copied]/copy:hidden" />
        <CheckIcon className="hidden size-4 group-data-[copied]/copy:block" />
      </TooltipIconButton>
    </ActionBarPrimitive.Copy>
  </ActionBarPrimitive.Root>
);

const UserMessage: FC = () => (
  <MessagePrimitive.Root
    data-role="user"
    className="fade-in animate-in mx-auto grid w-full max-w-(--thread-max-width) auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] gap-y-2 px-2 duration-150 [&:where(>*)]:col-start-2"
  >
    <UserMessageAttachments />
    <div className="col-start-2 min-w-0">
      <div className="bg-muted text-foreground rounded-xl px-4 py-2 wrap-break-word empty:hidden">
        <MessagePrimitive.Parts components={messageComponents} />
      </div>
    </div>
  </MessagePrimitive.Root>
);
