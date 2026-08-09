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

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import {
  CheckIcon,
  MessageSquarePlusIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SettingsIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { SettingsDialog } from "@/components/settings-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ALL_CONVERSATIONS_FILTER,
  MAIN_CONVERSATIONS_FILTER,
  categoryHue,
  categoryLabel,
  conversationCategory,
  conversationFilterOptions,
  filterIncludes,
  filtersEqual,
  type ConversationFilter,
} from "@/lib/conversation-categories";
import { MD_QUERY, useMediaQuery } from "@/lib/media";
import { cn } from "@/lib/utils";
import { useSecondBrain } from "@/runtime/provider";

/** Remembered across reloads. A collapse that undoes itself every time the page
 *  loads is a preference the app keeps overruling. */
const COLLAPSED_KEY = "second-brain:sidebar-collapsed";
const FILTER_KEY = "second-brain:conversation-filter";

type CategoryColorStyle = CSSProperties & {
  "--conversation-category-hue": string;
};

function categoryColorStyle(category: string): CategoryColorStyle {
  return { "--conversation-category-hue": String(categoryHue(category)) };
}

function readConversationFilter(): ConversationFilter {
  try {
    const stored = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "null") as {
      type?: unknown;
      category?: unknown;
    } | null;
    if (stored?.type === "all") return ALL_CONVERSATIONS_FILTER;
    if (stored?.type === "category") {
      if (stored.category === null) return MAIN_CONVERSATIONS_FILTER;
      if (typeof stored.category === "string") {
        const category = conversationCategory(stored.category);
        return category
          ? { type: "category", category }
          : MAIN_CONVERSATIONS_FILTER;
      }
    }
  } catch {
    // A malformed or unavailable preference is just the default view.
  }
  return MAIN_CONVERSATIONS_FILTER;
}

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
    inputRequests,
    state,
    settingsOpen,
    setSettingsOpen,
  } = useSecondBrain();

  // One switch at a time. Each of these is several Requests, and a second click
  // partway through would interleave two loads into one session.
  const [busy, setBusy] = useState(false);
  const [conversationFilter, setConversationFilter] =
    useState<ConversationFilter>(readConversationFilter);
  const [filterOpen, setFilterOpen] = useState(false);
  const initialFilterChecked = useRef(false);
  const commandRunning = Boolean(
    state.command && state.command.status !== "finished",
  );
  const locked =
    busy ||
    state.typing ||
    state.form !== null ||
    inputRequests.length > 0 ||
    commandRunning;

  // Read lazily so the stored preference applies on the first paint rather than
  // expanding and then snapping shut.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSED_KEY) === "true",
  );
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  const filterOptions = useMemo(
    () => conversationFilterOptions(conversations),
    [conversations],
  );
  const visibleConversations = useMemo(
    () =>
      conversations.filter((conversation) =>
        filterIncludes(conversationFilter, conversation),
      ),
    [conversations, conversationFilter],
  );
  const selectedFilter =
    filterOptions.find((option) =>
      filtersEqual(option.filter, conversationFilter),
    ) ?? filterOptions[1];
  const selectedFilterLabel =
    selectedFilter.filter.type === "all" ? "All" : selectedFilter.label;

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(conversationFilter));
    } catch {
      // Filtering still works for this visit when storage is unavailable.
    }
  }, [conversationFilter]);

  useEffect(() => {
    if (conversations.length === 0) return;

    let next = conversationFilter;
    const savedCategoryExists = filterOptions.some((option) =>
      filtersEqual(option.filter, next),
    );
    if (!savedCategoryExists) next = MAIN_CONVERSATIONS_FILTER;

    if (!initialFilterChecked.current) {
      const active = conversations.find(
        (conversation) => conversation.id === conversationId,
      );
      if (active && !filterIncludes(next, active)) {
        next = {
          type: "category",
          category: conversationCategory(active.category),
        };
      }
      initialFilterChecked.current = true;
    }

    if (!filtersEqual(next, conversationFilter)) {
      setConversationFilter(next);
    }
  }, [conversationFilter, conversationId, conversations, filterOptions]);

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

  useEffect(() => {
    if (railCollapsed) setFilterOpen(false);
  }, [railCollapsed]);

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

  const selectConversationFilter = (filter: ConversationFilter) => {
    initialFilterChecked.current = true;
    setConversationFilter(filter);
  };

  const startNewConversation = () => {
    selectConversationFilter(MAIN_CONVERSATIONS_FILTER);
    void run(newConversation).then(closeDrawer);
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
      <div className="relative grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-1 p-2 pt-11">
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
          onClick={startNewConversation}
        >
          <MessageSquarePlusIcon className="size-4" />
        </TooltipIconButton>
        <button
          type="button"
          disabled={locked}
          tabIndex={railCollapsed ? -1 : undefined}
          aria-hidden={railCollapsed || undefined}
          onClick={startNewConversation}
          className={cn(
            "text-muted-foreground hover:text-foreground col-start-2 min-w-0 truncate px-1 text-start text-sm transition-opacity disabled:opacity-50",
            railCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          New chat
        </button>

        {!railCollapsed && (
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
              aria-label={`Filter conversations: ${selectedFilter.label}`}
              className={cn(
                "col-start-3 flex h-6 min-w-0 max-w-28 self-center items-center rounded-full px-2 text-xs font-medium transition-colors",
                conversationFilter.type === "all"
                  ? "bg-primary/10 text-primary"
                  : conversationFilter.category === null
                    ? "bg-muted text-muted-foreground hover:text-foreground"
                    : "conversation-category-pill",
                )}
                style={
                  conversationFilter.type === "category" &&
                  conversationFilter.category !== null
                    ? categoryColorStyle(conversationFilter.category)
                    : undefined
                }
            >
              <span className="truncate">{selectedFilterLabel}</span>
            </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-60 p-1.5"
            >
              <div
                role="radiogroup"
                aria-label="Conversation category"
                className="space-y-0.5"
              >
                {filterOptions.map((option) => {
                const selected = filtersEqual(
                  option.filter,
                  conversationFilter,
                );
                const category =
                  option.filter.type === "category"
                    ? option.filter.category
                    : null;
                return (
                  <button
                    key={
                      option.filter.type === "all"
                        ? "all"
                        : `category:${JSON.stringify(option.filter.category)}`
                    }
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${option.label}, ${option.count} conversations`}
                    title={option.label}
                    onClick={() => {
                      selectConversationFilter(option.filter);
                      setFilterOpen(false);
                    }}
                    className={cn(
                      "hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm outline-none",
                      selected && "bg-accent/70",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        option.filter.type === "all"
                          ? "bg-primary"
                          : category === null
                            ? "bg-muted-foreground/60"
                            : "conversation-category-dot",
                      )}
                      style={
                        category === null
                          ? undefined
                          : categoryColorStyle(category)
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {option.count}
                    </span>
                    <CheckIcon
                      className={cn(
                        "size-3.5 shrink-0",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </button>
                );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* The list itself is the only thing that actually goes away. Unmounted
          rather than hidden, so a long list is not still being laid out behind
          a 48px rail. */}
      {railCollapsed ? null : (
      <nav className="flex-1 overflow-y-auto p-2 pt-0">
        {visibleConversations.length === 0 && (
          <p className="text-muted-foreground px-2 py-4 text-xs">
            {conversations.length === 0
              ? "No conversations yet."
              : `No ${selectedFilter.label} conversations.`}
          </p>
        )}

        {visibleConversations.map((conversation) => {
          const active = conversation.id === conversationId;
          const category = conversationCategory(conversation.category);
          const showCategory =
            conversationFilter.type === "all" && category !== null;
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
              >
                <span className="block truncate text-sm">
                  {conversation.title || "Untitled"}
                </span>
                {(conversation.updated_ago || showCategory) && (
                  // The server's own wording, rather than a second notion of
                  // "recent" computed here that could disagree with it — and
                  // relative wording rather than a date, because a list read by
                  // recency wants "how recent" answered without arithmetic.
                  <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                    {conversation.updated_ago && (
                      <span className="truncate">
                        {conversation.updated_ago}
                      </span>
                    )}
                    {showCategory && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            role="img"
                            aria-label={`Category: ${categoryLabel(category)}`}
                            className="conversation-category-dot size-2 shrink-0 rounded-full"
                            style={categoryColorStyle(category)}
                          />
                        </TooltipTrigger>
                        <TooltipContent variant="subtle" side="right">
                          {categoryLabel(category)}
                        </TooltipContent>
                      </Tooltip>
                    )}
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
