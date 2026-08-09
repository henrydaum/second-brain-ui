/**
 * The conversations list.
 *
 * Switching here is not a view change: `conv.load` re-points the session, so
 * afterwards the agent is genuinely talking about something else. That is why
 * this is disabled mid-turn — swapping the session out from under a running
 * turn would leave the reply landing in a conversation nobody is looking at.
 *
 * Deleting raises a real approval on the server. Nothing special happens here
 * to make that work: the dialog arrives on the event stream and the modal
 * answers it, exactly as it does for anything else consequential.
 */

import { useEffect, useState, type FC } from "react";
import {
  MessageSquarePlusIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { SettingsDialog } from "@/components/settings-dialog";
import { MD_QUERY, useMediaQuery } from "@/lib/media";
import { fullTimestamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useSecondBrain } from "@/runtime/provider";

/** Remembered across reloads. A collapse that undoes itself every time the page
 *  loads is a preference the app keeps overruling. */
const COLLAPSED_KEY = "second-brain:sidebar-collapsed";

export type ConversationSidebarProps = {
  /** Whether the overlay drawer is showing. Only meaningful below `md`, where
   *  this is a drawer rather than an inline rail. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const ConversationSidebar: FC<ConversationSidebarProps> = ({
  open,
  onOpenChange,
}) => {
  const {
    conversations,
    conversationId,
    openConversation,
    newConversation,
    deleteConversation,
    state,
    settingsOpen,
    setSettingsOpen,
  } = useSecondBrain();

  // One switch at a time. Each of these is several Requests, and a second click
  // partway through would interleave two loads into one session.
  const [busy, setBusy] = useState(false);
  const commandRunning = Boolean(
    state.command && state.command.status !== "finished",
  );
  const locked =
    busy ||
    state.typing ||
    state.form !== null ||
    state.approval !== null ||
    commandRunning;

  // Read lazily so the stored preference applies on the first paint rather than
  // expanding and then snapping shut.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "true",
  );
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  /**
   * Two different components sharing one file.
   *
   * Above `md` this is an inline rail that collapses to 48px, which is the
   * behaviour it always had. Below `md` it was *also* that — a fixed 256px
   * column on a 375px phone, leaving about 119px of chat, with no way to get it
   * back except finding and pressing a collapse button inside the thing that
   * was in the way. Below `md` it is now an overlay drawer, which is what every
   * app this one is imitating does.
   *
   * `collapsed` is a rail concept and must not leak into the drawer: a person
   * who collapsed the rail on a laptop should not find an empty drawer on their
   * phone. Hence the media query — the list is unmounted rather than hidden, so
   * this is a genuine behavioural fork that CSS cannot express.
   */
  const isDesktop = useMediaQuery(MD_QUERY);
  const railCollapsed = isDesktop && collapsed;

  // Picking a conversation on a phone means you are done with the drawer.
  const closeDrawer = () => onOpenChange(false);

  // Escape closes it, as it does for every other overlay here.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    const name = state.form?.name ?? state.command?.name;
    if (name) setSettingsOpen(true);
  }, [state.form?.name, state.command?.name, setSettingsOpen]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* The scrim, below `md` only. It is what makes the drawer dismissible by
          pressing the conversation you were reading — the gesture everybody
          tries first. */}
      {open && (
        <div
          aria-hidden
          onClick={closeDrawer}
          className="animate-in fade-in-0 fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}

      <aside
        data-slot="conversation-sidebar"
        data-collapsed={railCollapsed || undefined}
        className={cn(
          "bg-sidebar flex h-full flex-col overflow-hidden border-e",
          // Below `md`: an overlay drawer, off-canvas until asked for.
          "fixed inset-y-0 start-0 z-50 w-64 transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full rtl:translate-x-full",
          // From `md`: back in the flow, and the transition moves to width so
          // collapsing the rail animates rather than sliding the whole panel.
          "md:relative md:z-auto md:shrink-0 md:translate-x-0 md:transition-[width] rtl:md:translate-x-0",
          railCollapsed ? "md:w-12" : "md:w-64",
        )}
      >
      {/* New chat remains pinned to the rail while its label is revealed. The
          drawer toggle follows the moving outer edge, matching the panel it
          opens and closes. */}
      <div className="relative grid grid-cols-[2rem_1fr] gap-x-1 p-2 pt-11">
        {/* Two buttons, not one with a media query in JavaScript: on a phone
            this closes an overlay, on a laptop it collapses a rail, and those
            are different verbs with different icons and different labels. */}
        <TooltipIconButton
          tooltip="Close conversations"
          side="right"
          className="absolute top-2 right-2 size-8 md:hidden"
          onClick={closeDrawer}
        >
          <XIcon className="size-4" />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip={railCollapsed ? "Show conversations" : "Hide conversations"}
          side="right"
          className="absolute top-2 right-2 hidden size-8 md:inline-flex"
          aria-expanded={!railCollapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {railCollapsed ? (
            <PanelLeftOpenIcon className="size-4 translate-x-[0.5px]" />
          ) : (
            <PanelLeftCloseIcon className="size-4 translate-x-[0.5px]" />
          )}
        </TooltipIconButton>

        <TooltipIconButton
          tooltip="New chat"
          side="right"
          className="col-start-1 size-8"
          disabled={locked}
          onClick={() => void run(newConversation).then(closeDrawer)}
        >
          <MessageSquarePlusIcon className="size-4" />
        </TooltipIconButton>
        <button
          type="button"
          disabled={locked}
          tabIndex={railCollapsed ? -1 : undefined}
          aria-hidden={railCollapsed || undefined}
          onClick={() => void run(newConversation).then(closeDrawer)}
          className={cn(
            "text-muted-foreground hover:text-foreground col-start-2 min-w-0 truncate px-1 text-start text-sm transition-opacity disabled:opacity-50",
            railCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          New chat
        </button>
      </div>

      {/* The list itself is the only thing that actually goes away. Unmounted
          rather than hidden, so a long list is not still being laid out behind
          a 48px rail. */}
      {railCollapsed ? null : (
      <nav className="flex-1 overflow-y-auto p-2 pt-0">
        {conversations.length === 0 && (
          <p className="text-muted-foreground px-2 py-4 text-xs">
            No conversations yet.
          </p>
        )}

        {conversations.map((conversation) => {
          const active = conversation.id === conversationId;
          return (
            <div
              key={conversation.id}
              data-slot="conversation"
              data-active={active || undefined}
              className={cn(
                "group flex items-center gap-1 rounded-md",
                active ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  void run(() => openConversation(conversation.id)).then(
                    closeDrawer,
                  )
                }
                className="min-w-0 flex-1 px-2 py-1.5 text-start disabled:opacity-50"
                // The exact moment, for when "2 months ago" is not precise
                // enough. On the row rather than on the relative line, so it
                // answers from anywhere in the row — and the visible wording
                // stays relative, which is what a list ordered by recency
                // wants. `updated_at` is epoch *seconds*.
                title={
                  conversation.updated_at
                    ? fullTimestamp(new Date(conversation.updated_at * 1000))
                    : undefined
                }
              >
                <span className="block truncate text-sm">
                  {conversation.title || "Untitled"}
                </span>
                {conversation.updated_ago && (
                  // The server's own wording, rather than a second notion of
                  // "recent" computed here that could disagree with it.
                  <span className="text-muted-foreground block truncate text-xs">
                    {conversation.updated_ago}
                  </span>
                )}
              </button>

              <TooltipIconButton
                tooltip="Delete"
                side="right"
                className={cn(
                  "me-1 size-7",
                  // Present on hover or focus only — a destructive control
                  // sitting permanently beside every row is one that gets hit
                  // by accident. It stays keyboard-reachable.
                  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
                disabled={locked}
                onClick={() => void run(() => deleteConversation(conversation.id))}
              >
                <Trash2Icon className="size-3.5" />
              </TooltipIconButton>
            </div>
          );
        })}
      </nav>
      )}

      {/* `mt-auto` is what pins this to the bottom in both states — with the
          list unmounted there is nothing else to push it down. Separated by a
          rule, because it is not another conversation. */}
      <div className="mt-auto grid grid-cols-[2rem_1fr] gap-x-1 border-t p-2">
        <TooltipIconButton
          tooltip="Settings"
          side="right"
          className="size-8"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon className="size-4" />
        </TooltipIconButton>
        <button
          type="button"
          tabIndex={railCollapsed ? -1 : undefined}
          aria-hidden={railCollapsed || undefined}
          onClick={() => setSettingsOpen(true)}
          className={cn(
            "text-muted-foreground hover:text-foreground min-w-0 truncate px-1 text-start text-sm transition-opacity",
            railCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          Settings
        </button>
      </div>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      </aside>
    </>
  );
};
