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

import { useMemo, type FC } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClockIcon,
  MessageSquareIcon,
  SettingsIcon,
  SlashIcon,
  SquareIcon,
  WrenchIcon,
} from "lucide-react";
import {
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useSlashCommandAdapter,
  useAuiState,
  type Unstable_SlashCommand,
} from "@assistant-ui/react";

import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { ComposerTriggerPopover } from "@/components/assistant-ui/composer-trigger-popover";
import { DotMatrix } from "@/components/assistant-ui/dot-matrix";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { ApprovalDialog } from "@/components/approval-dialog";
import { FormPanel } from "@/components/form-panel";
import { HostFiles } from "@/components/host-file";
import { ErrorBanner } from "@/components/session-bar";
import { describeForm } from "@/lib/commands";
import { cn } from "@/lib/utils";
import { HOST_FILES } from "@/runtime/convert";
import { useSecondBrain } from "@/runtime/provider";

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
    <span className="text-muted-foreground inline-flex items-center gap-2">
      <DotMatrix state="connecting" aria-hidden />
      <span className="text-sm">Thinking</span>
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
        <AuiIf condition={(s) => s.thread.messages.length === 0}>
          <div className="mx-auto mb-6 w-full max-w-(--thread-max-width) text-center">
            <h1 className="text-primary text-2xl font-semibold">Second Brain</h1>
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
          <ErrorBanner />
          {/* Above the composer, deliberately: a form step is answered by
              submitting text, so the composer stays live beside it. */}
          <FormPanel />
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>

      {/* Outside the viewport — it is a modal over everything, and it is the one
          thing in this app that must not be scrolled past. */}
      <ApprovalDialog />
    </ThreadPrimitive.Root>
  );
};

const ScrollToBottom: FC = () => (
  <ThreadPrimitive.ScrollToBottom asChild>
    <TooltipIconButton
      tooltip="Scroll to bottom"
      variant="outline"
      className="dark:bg-background absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
    >
      <ArrowDownIcon />
    </TooltipIconButton>
  </ThreadPrimitive.ScrollToBottom>
);

/** Category name → icon, for the palette. Falls back to a slash. */
const commandIcons: Record<string, FC<{ className?: string }>> = {
  System: SettingsIcon,
  Conversation: MessageSquareIcon,
  Capabilities: WrenchIcon,
  Automation: ClockIcon,
};

const Composer: FC = () => {
  const { commands, say } = useSecondBrain();

  /**
   * The "/" palette, built from the server's own catalogue.
   *
   * **Running a command is submitting its text.** There is no separate
   * invocation path to write and no argument parsing to get wrong: the state
   * machine works out what the line was, and a command that needs arguments
   * starts asking for them as `form_field` frames, which `FormPanel` already
   * draws. `command.call` exists for structured invocation, but going through
   * the same door a typed line uses means the palette can never drift from what
   * typing would have done.
   */
  const slash = unstable_useSlashCommandAdapter({
    commands: useMemo(
      () =>
        commands.map<Unstable_SlashCommand>((command) => ({
          id: command.name,
          description: [command.description, describeForm(command)]
            .filter(Boolean)
            .join(" · "),
          // The adapter looks icons up by this key; categories are what the
          // server groups by, so they are what the icons key off.
          icon: command.category,
          execute: () => void say(`/${command.name}`),
        })),
      [commands, say],
    ),
    // Strip the half-typed "/conf" once it has been run, or the composer keeps
    // text the person did not mean to send next.
    removeOnExecute: true,
    iconMap: commandIcons,
    fallbackIcon: SlashIcon,
  });

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div className="border-primary/25 data-[dragging=true]:border-ring focus-within:border-primary/60 flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-2 data-[dragging=true]:border-dashed">
            <ComposerAttachments />
            <ComposerPrimitive.Input
              rows={1}
              autoFocus
              placeholder="Message, or press / for commands"
              className="placeholder:text-muted-foreground max-h-40 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none"
            />
            <div className="relative flex items-center justify-between">
              <ComposerAddAttachment />
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

        {/* Anchored to the composer, opening upward — see the popover's own
            positioning. It renders nothing until "/" is typed. */}
        <ComposerTriggerPopover
          char="/"
          {...slash}
          emptyItemsLabel="No matching commands"
        />
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
};

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
      <MessagePrimitive.Parts
        components={messageComponents}
        unstable_showEmptyOnNonTextEnd={false}
      />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="border-destructive bg-destructive/10 text-destructive mt-2 rounded-md border p-3 text-sm">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
    </div>
  </MessagePrimitive.Root>
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
