/**
 * Everything the system has told you that was worth keeping.
 *
 * **Sourced from the table, kept current by the stream.** The frames only ever
 * answer "since you connected", and for a client that was closed while a
 * scheduled agent ran that is none of it — so this list is a read that frames
 * top up, exactly the division `files-drawer.tsx` has with the ledger.
 *
 * A popover rather than a drawer, and that is about the right edge rather than
 * about notifications: `FilesDrawer` already owns it, and two panels taking
 * width from the same side means opening one has to close the other. A list you
 * glance at and dismiss does not need a permanent column.
 *
 * **Not every notification is here.** Transient progress is delivered and never
 * stored, and shows only as a banner. The bell is honest about what it holds:
 * things with a row.
 */

import { useEffect, useRef, type FC } from "react";
import { BellIcon, MessageSquareIcon, Settings2Icon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { CommandMarkdown } from "@/components/command-renderers";
import { LevelIcon } from "@/components/notification-level";
import {
  pageForNotification,
  settingCommand,
} from "@/components/settings-structure";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  atOf,
  isUnread,
  levelOf,
  settingNamesOf,
  type Notification,
} from "@/lib/notifications";
import { fullTimestamp, shortTimestamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  useConversations,
  useNotifications,
  useSession,
  useSettings,
} from "@/runtime/provider";

export const NotificationPanel: FC = () => {
  const {
    notifications,
    unread,
    notificationsFailure,
    notificationsOpen,
    setNotificationsOpen,
    markNotificationsRead,
  } = useNotifications();

  /**
   * Opening the panel settles what is in it.
   *
   * On the opening transition only, hence the ref: `markNotificationsRead`
   * changes identity whenever a notification arrives, and re-running on that
   * would settle a row that landed *while you were looking away from* an
   * already-open panel — which is the one case where the badge is still doing
   * useful work.
   */
  const settled = useRef(false);
  useEffect(() => {
    if (!notificationsOpen) {
      settled.current = false;
      return;
    }
    if (settled.current) return;
    settled.current = true;
    void markNotificationsRead();
  }, [notificationsOpen, markNotificationsRead]);

  return (
    <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
      <PopoverTrigger asChild>
        <TooltipIconButton
          tooltip="Notifications"
          side="bottom"
          className="relative size-8"
        >
          <BellIcon className="size-4" />
          {/* A dot rather than a count, for the reason the Files button's own
              dot carries: how many there are is the panel's business, and
              whether there are any is what decides whether opening it is worth
              doing. */}
          {unread > 0 && !notificationsOpen && (
            <span
              aria-hidden
              className="bg-primary absolute end-1 top-1 size-1.5 rounded-full"
            />
          )}
          {unread > 0 && (
            <span className="sr-only">{unread} unread</span>
          )}
        </TooltipIconButton>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        // Wider than the default 72, and capped against the viewport so it
        // still fits on a phone. The bodies here are prose, sometimes with a
        // table in them.
        className="flex max-h-[70vh] w-96 max-w-[calc(100vw-1rem)] flex-col p-0"
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
          <span className="flex-1 text-sm font-medium">Notifications</span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {notificationsFailure ? (
            <p className="text-muted-foreground p-4 text-xs">
              {notificationsFailure}
            </p>
          ) : notifications.length === 0 ? (
            <p className="text-muted-foreground p-4 text-xs">
              Nothing yet. Plugins registering, scheduled agents finishing and
              settings changing show up here.
            </p>
          ) : (
            <ul className="flex flex-col">
              {notifications.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const Row: FC<{ row: Notification }> = ({ row }) => {
  // Closing the popover is `LinkOut`'s business, not each row's.
  const { conversationId, openConversation } = useConversations();
  const { openSettings } = useSettings();
  const { say } = useSession();
  const level = levelOf(row.level);
  const at = atOf(row.ts);

  /** The section this is about, when it is about one. Null for most rows, which
   *  is what keeps the link off the ones with nowhere to send you. */
  const section = pageForNotification(row.source);

  /**
   * The one setting to drill into, when there is exactly one.
   *
   * **Exactly one, deliberately.** A notification naming several settings gets a
   * single link to the Configuration section instead of a link each: the row is
   * a line of 10px text, and three buttons on it is a menu rather than an
   * answer. Which settings changed is already written in the body directly
   * above, so the links would be repeating it in a less readable form.
   *
   * Null for everything that is not a config notification, which is most of
   * them.
   */
  const settings = section === "config" ? settingNamesOf(row.body) : [];
  const setting = settings.length === 1 ? settings[0] : null;

  /**
   * Open Settings, then drill into the setting.
   *
   * **Both, in that order, and the order is the point.** `openSettings` puts the
   * dialog up now; the command is a round trip away, and a link that did nothing
   * visible until the server answered would read as broken. It also decides
   * where a *failed* submit lands: the Configuration section, rather than
   * nowhere.
   *
   * They do not fight. Once the command is running, Settings' own effect keeps
   * the page on `config` because that is where `/config` belongs, so the eager
   * open and the command agree about the destination.
   */
  const openSetting = (setting: string) => {
    openSettings("config");
    void say(settingCommand(setting));
  };

  /**
   * Somewhere else to be.
   *
   * **Usually not the conversation on screen — that is the point.** It came
   * from a background session, so offering to switch is the whole affordance.
   * `load_hint` on the wire is the same offer pre-rendered as a slash command
   * for surfaces that can only print text; drawing a terminal command here is
   * the failure that field exists to avoid.
   */
  const elsewhere =
    row.conversation_id !== null && row.conversation_id !== conversationId
      ? row.conversation_id
      : null;

  return (
    <li className="border-b px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <LevelIcon level={level} className="mt-0.5" />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {/* Plain text: `title` is the one field guaranteed not to be
                markdown. */}
            <span
              className={cn(
                "min-w-0 flex-1 text-sm leading-snug",
                isUnread(row) && "font-medium",
              )}
            >
              {row.title}
            </span>
            <time
              dateTime={at.toISOString()}
              title={fullTimestamp(at)}
              className="text-muted-foreground shrink-0 text-[11px] tabular-nums"
            >
              {shortTimestamp(at)}
            </time>
          </div>

          {/*
            Rendered as markdown, always.

            Nothing on the wire declares which this is. Most producers send
            plain prose — the plugin watcher sends a file stem — but a
            `source: "session"` notification carries a background agent's final
            answer, which is the model's own GFM, tables and fenced code
            included. Prose survives a markdown renderer unchanged; an agent's
            answer through a plain-text one shows raw `**bold**`. Only one of
            those two mistakes is visible, so this makes the other one.
          */}
          {row.body && (
            <CommandMarkdown
              text={row.body}
              className="text-muted-foreground mt-1 text-xs [&_p]:my-1"
            />
          )}

          {/* Where it came from at one end, where it can take you at the other.
              Two different kinds of thing — an attribution you read and an
              action you press — so they get the ends rather than sitting in one
              run where the eye has to sort them out. */}
          <div className="mt-1.5 flex items-center justify-between gap-3">
            {/* Stamped by the kernel off the live provenance chain, never
                stated by whoever raised it — so a plugin cannot claim to be the
                plugin watcher. Trustworthy enough to show as attribution.

                `truncate` rather than shrink-proof: with three setting links
                beside it, the source is the half worth giving up first. */}
            <span className="text-muted-foreground/70 truncate font-mono text-[11px]">
              {row.source}
            </span>

            {/* Wrapping and end-justified, so a row that runs out of width
                stacks its links against the same edge instead of straggling
                back towards the source. */}
            <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
              {elsewhere !== null && (
                <LinkOut
                  icon={MessageSquareIcon}
                  label="Open chat"
                  onClick={() => void openConversation(elsewhere)}
                />
              )}

              {/* One setting named: straight to its own page, which is the
                  whole reason `/config all <name>` is worth running. Anything
                  else — several settings, or a body that was not setting names
                  at all — lands on the Configuration section, where the body
                  above has already said what to look for. */}
              {section !== null && (
                <LinkOut
                  icon={Settings2Icon}
                  label="Open settings"
                  onClick={() =>
                    setting ? openSetting(setting) : openSettings(section)
                  }
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
};

/**
 * A link out of the panel, to wherever the notification is really about.
 *
 * **Closes the popover first, always.** Both destinations are surfaces of their
 * own — a different conversation, a dialog — and leaving a popover standing over
 * whichever one you just asked for means the first thing you do there is dismiss
 * something. Shared so that stays true of the next one added rather than being
 * remembered twice.
 */
const LinkOut: FC<{
  icon: FC<{ className?: string }>;
  label: string;
  onClick: () => void;
}> = ({ icon: Icon, label, onClick }) => {
  const { setNotificationsOpen } = useNotifications();
  return (
    <button
      type="button"
      onClick={() => {
        setNotificationsOpen(false);
        onClick();
      }}
      // `shrink-0` and `whitespace-nowrap`: the row gives up the source's width
      // before a link's, and a link that wrapped mid-label would read as two.
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex shrink-0 items-center gap-1 rounded whitespace-nowrap text-xs underline underline-offset-2 outline-none focus-visible:ring-2"
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {label}
    </button>
  );
};
