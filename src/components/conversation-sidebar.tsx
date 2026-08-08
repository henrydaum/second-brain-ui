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
  Trash2Icon,
} from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
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
  } = useSecondBrain();

  // One switch at a time. Each of these is several Requests, and a second click
  // partway through would interleave two loads into one session.
  const [busy, setBusy] = useState(false);
  const locked = busy || state.typing;

  // Read lazily so the stored preference applies on the first paint rather than
  // expanding and then snapping shut.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "true",
  );
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

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
        "bg-sidebar flex h-full shrink-0 flex-col border-e transition-[width] duration-200",
        collapsed ? "w-12" : "w-64",
      )}
    >
      {/* Collapsed, this is a rail: the toggle and New chat stay reachable,
          because a collapsed sidebar that also hides the way to start a
          conversation is just a smaller dead end. */}
      <div
        className={cn(
          "flex items-center gap-1 p-2",
          collapsed && "flex-col px-2",
        )}
      >
        <TooltipIconButton
          tooltip={collapsed ? "Show conversations" : "Hide conversations"}
          side="right"
          variant="ghost"
          className="size-8 shrink-0"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((was) => !was)}
        >
          {collapsed ? (
            <PanelLeftOpenIcon className="size-4" />
          ) : (
            <PanelLeftCloseIcon className="size-4" />
          )}
        </TooltipIconButton>

        {collapsed ? (
          <TooltipIconButton
            tooltip="New chat"
            side="right"
            variant="ghost"
            className="size-8 shrink-0"
            disabled={locked}
            onClick={() => void run(newConversation)}
          >
            <MessageSquarePlusIcon className="size-4" />
          </TooltipIconButton>
        ) : (
          <Button
            variant="outline"
            className="flex-1 justify-start gap-2"
            disabled={locked}
            onClick={() => void run(newConversation)}
          >
            <MessageSquarePlusIcon className="size-4" />
            New chat
          </Button>
        )}
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
    </aside>
  );
};
