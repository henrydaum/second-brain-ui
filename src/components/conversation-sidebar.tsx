import { PlusIcon } from "lucide-react";
import type { Conversation } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The conversation rail.
 *
 * This is the first thing to live outside the chat, and it is the seam the
 * administrative surfaces will grow into later — commands, config, tools. It
 * holds only conversations today; the shape is what matters.
 *
 * Presentational: it renders what it is handed and reports clicks. All the
 * binding work lives in App, so there is one place where "which conversation
 * are we in" is decided.
 */
export function ConversationSidebar({
  conversations,
  activeId,
  busy,
  onSelect,
  onNew,
}: {
  conversations: Conversation[];
  activeId: number | null;
  busy: boolean;
  onSelect: (id: number) => void;
  onNew: () => void;
}) {
  return (
    <aside className="bg-sidebar flex h-full w-64 shrink-0 flex-col border-r">
      <div className="p-3">
        <Button
          className="w-full justify-start gap-2"
          disabled={busy}
          onClick={onNew}
        >
          <PlusIcon className="size-4" />
          New chat
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="text-muted-foreground px-2 py-4 text-sm">
            No conversations yet.
          </p>
        ) : (
          conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              disabled={busy}
              onClick={() => onSelect(conversation.id)}
              className={cn(
                "hover:bg-accent mb-1 w-full rounded-md px-2 py-2 text-left text-sm disabled:opacity-50",
                conversation.id === activeId && "bg-accent font-medium",
              )}
            >
              <span className="block truncate">{conversation.title}</span>
              <span className="text-muted-foreground block truncate text-xs">
                {conversation.updated_ago}
              </span>
            </button>
          ))
        )}
      </nav>

      {/* Deleting is deliberately absent, and should stay absent. `conv.delete`
          is UNSAFE, and this client's chain is unattended — so calling it would
          be *silently refused* rather than asked. Deleting goes through the
          chat as `/conversations`, which is the only path that earns the
          approval gate and asks the person first. */}
    </aside>
  );
}
