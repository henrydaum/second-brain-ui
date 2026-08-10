/**
 * Notifications as they arrive, in the corner, briefly.
 *
 * **Everything banners — including what the panel will never show.** Transient
 * progress ("Compacting conversation…") is delivered and deliberately never
 * stored, so this is the only surface it ever gets. That is the whole reason the
 * banner set is the larger of the two: if this filtered to persisted
 * notifications, the ones with nowhere else to go would go nowhere.
 *
 * Floating rather than in the flow. The composer is sticky and the thread scrolls
 * under it; a banner that took layout height would push the composer down under
 * somebody mid-sentence, and do it again for the next one.
 *
 * ## What auto-dismisses, and what does not
 *
 * `info` and `success` go away on their own — a plugin registering is worth
 * seeing and not worth acknowledging. `warning` and `error` stay until
 * dismissed, because they are the ones where the correct next action is
 * something other than "keep reading". Both kinds are in the panel afterwards if
 * they were persisted, so nothing here is the last chance to see anything.
 */

import { useEffect, type FC } from "react";
import { XIcon } from "lucide-react";

import { LevelIcon } from "@/components/notification-level";
import { levelOf } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/runtime/provider";
import type { Banner } from "@/runtime/notifications";

/** How long a dismissible banner stays. Long enough to read a title and a line
 *  of body; short enough that three arriving together do not become furniture. */
const LINGER_MS = 6000;

/** How many are drawn at once. The rest are still in state and still counted —
 *  they simply wait their turn as the ones in front go away, which keeps a burst
 *  of registrations from covering the conversation. */
const AT_ONCE = 3;

const STAYS = new Set(["warning", "error"]);

export const NotificationBanners: FC = () => {
  const { banners, dismissBanner, notificationsOpen } = useNotifications();

  // Nothing to say out here while the panel is open — every persisted one is in
  // the list being read, and a banner about a row three inches away is noise.
  // Transient ones are the honest loss here, and they are the ones that matter
  // least: progress that will be over by the time the panel closes.
  if (notificationsOpen || banners.length === 0) return null;

  return (
    <div
      data-slot="notification-banners"
      // `end-4` rather than `right-4`: the drawers and the sidebar are all
      // written for both directions, and a stack pinned to the physical right
      // would sit under the sidebar in RTL.
      className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {banners.slice(0, AT_ONCE).map((banner) => (
        // `dismissBanner` is passed through rather than closed over here. An
        // inline `() => dismissBanner(banner.key)` is a new function on every
        // render of this list — and this list re-renders whenever *any*
        // notification arrives — which restarted every card's linger timer. A
        // steady trickle of notifications meant nothing ever auto-dismissed.
        <BannerCard key={banner.key} banner={banner} onDismiss={dismissBanner} />
      ))}
    </div>
  );
};

const BannerCard: FC<{
  banner: Banner;
  /** Stable across renders — see the call site. */
  onDismiss: (key: string) => void;
}> = ({ banner, onDismiss }) => {
  const { title, body, source } = banner.notification;
  const level = levelOf(banner.notification.level);
  const stays = STAYS.has(level);
  const key = banner.key;

  useEffect(() => {
    if (stays) return;
    const timer = setTimeout(() => onDismiss(key), LINGER_MS);
    return () => clearTimeout(timer);
    // Every dependency here is stable for the life of one banner, which is what
    // makes this a single clock rather than one restarted on each render.
  }, [stays, key, onDismiss]);

  const dismiss = () => onDismiss(key);

  return (
    <div
      // The stack is `pointer-events-none` so it never eats a click aimed at the
      // conversation underneath; the cards themselves take them back, which is
      // what leaves the gaps between them transparent to the thread.
      className={cn(
        "bg-popover text-popover-foreground pointer-events-auto rounded-lg border p-3 shadow-lg",
        "animate-in fade-in-0 slide-in-from-bottom-2",
        level === "error" && "border-destructive/50",
      )}
      // An error interrupts; everything else waits its turn in the queue. The
      // same distinction `SessionBar` draws for the transport's own state.
      role={level === "error" ? "alert" : "status"}
    >
      <div className="flex items-start gap-2">
        <LevelIcon level={level} className="mt-0.5" />

        <div className="min-w-0 flex-1">
          {/* Plain text, always — `title` is the one field the wire guarantees
              is not markdown. */}
          <p className="text-sm leading-snug font-medium">{title}</p>

          {/* Two lines, and not markdown. Out here the body is a hint that
              there is more to read, and the full thing — which for a background
              agent's report is its whole answer, tables included — belongs in
              the panel where there is room for it. */}
          {body && (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">
              {body}
            </p>
          )}

          {/* Worth showing: it is stamped by the kernel off the provenance
              chain, so a plugin cannot claim to be the plugin watcher. */}
          <p className="text-muted-foreground/70 mt-1 font-mono text-[11px]">
            {source}
          </p>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="focus-visible:ring-ring shrink-0 rounded-md opacity-60 outline-none hover:opacity-100 focus-visible:ring-2"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
};
