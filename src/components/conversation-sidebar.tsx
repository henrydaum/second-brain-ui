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
} from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { SettingsDialog } from "@/components/settings-dialog";
import { cn } from "@/lib/utils";
import { useSecondBrain } from "@/runtime/provider";

/** Remembered across reloads. A collapse that undoes itself every time the page
 *  loads is a preference the app keeps overruling. */
const COLLAPSED_KEY = "second-brain:sidebar-collapsed";

export const ConversationSidebar: FC = () => {
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
    <aside
      data-slot="conversation-sidebar"
      data-collapsed={collapsed || undefined}
      className={cn(
        "bg-sidebar flex h-full shrink-0 flex-col overflow-hidden border-e transition-[width] duration-200",
        collapsed ? "w-12" : "w-64",
      )}
    >
      {/* New chat remains pinned to the rail while its label is revealed. The
          drawer toggle follows the moving outer edge, matching the panel it
          opens and closes. */}
      <div className="relative grid grid-cols-[2rem_1fr] gap-x-1 p-2 pt-11">
        <TooltipIconButton
          tooltip={collapsed ? "Show conversations" : "Hide conversations"}
          side="right"
          variant="ghost"
          className="absolute top-2 right-2 size-8 shrink-0"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? (
            <PanelLeftOpenIcon className="size-4 translate-x-[0.5px]" />
          ) : (
            <PanelLeftCloseIcon className="size-4 translate-x-[0.5px]" />
          )}
        </TooltipIconButton>

        <TooltipIconButton
          tooltip="New chat"
          side="right"
          variant="ghost"
          className="col-start-1 size-8 shrink-0"
          disabled={locked}
          onClick={() => void run(newConversation)}
        >
          <MessageSquarePlusIcon className="size-4" />
        </TooltipIconButton>
        <button
          type="button"
          disabled={locked}
          tabIndex={collapsed ? -1 : undefined}
          aria-hidden={collapsed || undefined}
          onClick={() => void run(newConversation)}
          className={cn(
            "text-muted-foreground hover:text-foreground col-start-2 min-w-0 truncate px-1 text-start text-sm transition-opacity disabled:opacity-50",
            collapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          New chat
        </button>
      </div>

      {/* The list itself is the only thing that actually goes away. Unmounted
          rather than hidden, so a long list is not still being laid out behind
          a 48px rail. */}
      {collapsed ? null : (
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
                onClick={() => void run(() => openConversation(conversation.id))}
                className="min-w-0 flex-1 px-2 py-1.5 text-start disabled:opacity-50"
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
                variant="ghost"
                className={cn(
                  "mr-1 size-7 shrink-0",
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
          variant="ghost"
          className="size-8 shrink-0"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon className="size-4" />
        </TooltipIconButton>
        <button
          type="button"
          tabIndex={collapsed ? -1 : undefined}
          aria-hidden={collapsed || undefined}
          onClick={() => setSettingsOpen(true)}
          className={cn(
            "text-muted-foreground hover:text-foreground min-w-0 truncate px-1 text-start text-sm transition-opacity",
            collapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          Settings
        </button>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </aside>
  );
};
