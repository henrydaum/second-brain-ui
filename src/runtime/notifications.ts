/**
 * What the system has told you, and what it is telling you right now.
 *
 * **Deliberately not part of the conversation store**, for the reason
 * `runtime/input-requests.ts` opens with: a notification belongs to the
 * *session*, not to the conversation it happened during. Most of them are not
 * about the open conversation at all — a plugin registering is about the
 * install, and a scheduled agent's report is about a background session with no
 * frontend attached. Routing them through the store would mean a `{type:
 * "history"}` — a cold boot, a conversation switch, a refetch — silently
 * discarded them along with the scrollback.
 *
 * ## Two sets, not two views of one set
 *
 * This is the thing most likely to be got wrong, so it is the shape of the
 * state rather than a rule to remember:
 *
 * - **`banners`** is everything that arrived while you were watching. Transient
 *   progress ("Compacting conversation…") is delivered and deliberately never
 *   stored, because a panel that fills with progress lines is one nobody reads.
 * - **`rows`** is what has a row in the table — the ones with a
 *   `notification_id`, plus whatever the backfill read back from before this
 *   client was connected.
 *
 * So `banners ⊋ rows` in general, and neither is derivable from the other.
 */

import type { NotificationPayload } from "@/lib/events";
import { isUnread, rowFromFrame, type Notification } from "@/lib/notifications";

/**
 * One live banner.
 *
 * **`key` is generated here and is never `notification_id`.** Transient
 * notifications have no id, so keying a React list on that field gives every
 * one of them `key={undefined}` — which collapses them into one and then
 * animates the wrong one out. The row id rides along separately for the cases
 * that want it.
 */
export type Banner = {
  key: string;
  notification: NotificationPayload;
};

export type NotificationState = {
  /** Newest first, so the stack renders nearest-the-corner first. */
  banners: Banner[];
  /** Newest first, matching the order `notification.list` returns. */
  rows: Notification[];
  /** Whether the opening read has come back. Until it has, an empty panel means
   *  "not yet" rather than "nothing", and the two deserve different copy. */
  loaded: boolean;
  /** Why the panel is empty, when the reason is not "nothing happened". Said in
   *  the panel rather than the error banner, for the reason
   *  `FileActivityProvider` gives about a missing `ledger.read`: a kernel
   *  without the Request would otherwise raise a banner on every boot, about a
   *  surface you may never open. */
  failure: string | null;
};

export const initialNotifications: NotificationState = {
  banners: [],
  rows: [],
  loaded: false,
  failure: null,
};

export type NotificationAction =
  /** A `notification` frame off the event stream. */
  | { type: "raised"; notification: NotificationPayload; key: string }
  /** One banner leaving, whether by the close button or its own timer. */
  | { type: "dismissed"; key: string }
  /** Every banner at once — what closing the stack does. */
  | { type: "clearedBanners" }
  /** Rows from `notification.list`: the opening read, or a reconnect top-up. */
  | { type: "backfilled"; rows: Notification[] }
  /** The opening read failed. Distinct from an empty backfill. */
  | { type: "failed"; message: string }
  /** Rows just settled, so the badge drops without waiting for a refetch.
   *  `before` settles everything at or below an id, matching the inclusive
   *  `id <= ?` the handler applies. */
  | { type: "read"; ids?: number[]; before?: number };

export function reduceNotifications(
  state: NotificationState,
  action: NotificationAction,
): NotificationState {
  switch (action.type) {
    case "raised": {
      const banner: Banner = { key: action.key, notification: action.notification };
      const banners = [banner, ...state.banners];

      // **Only the persisted ones reach the panel.** The check is here rather
      // than at the call site so there is one place that knows the two sets
      // differ, and it is the place that holds both.
      const id = action.notification.notification_id;
      if (id === undefined) return { ...state, banners };

      return {
        ...state,
        banners,
        rows: merge(state.rows, [rowFromFrame(action.notification, id)]),
      };
    }

    case "dismissed":
      return {
        ...state,
        banners: state.banners.filter((banner) => banner.key !== action.key),
      };

    case "clearedBanners":
      return state.banners.length ? { ...state, banners: [] } : state;

    case "backfilled":
      return {
        ...state,
        loaded: true,
        failure: null,
        rows: merge(state.rows, action.rows),
      };

    case "failed":
      return { ...state, loaded: true, failure: action.message };

    case "read": {
      const at = Date.now() / 1000;
      const ids = action.ids ? new Set(action.ids) : null;
      let changed = false;
      const rows = state.rows.map((row) => {
        if (!isUnread(row)) return row;
        const settled =
          (ids?.has(row.id) ?? false) ||
          (action.before !== undefined && row.id <= action.before);
        if (!settled) return row;
        changed = true;
        return { ...row, read_at: at };
      });
      return changed ? { ...state, rows } : state;
    }
  }
}

/**
 * Fold incoming rows into the ones already held, newest first.
 *
 * **By id, always.** The same notification reaches this state two ways — as a
 * frame while connected, and again in the backfill that runs on the next
 * reconnect — and a naive concatenation shows it twice. `EventSource` replays
 * from `Last-Event-ID` too, so even the frame alone can arrive more than once.
 *
 * Incoming wins on conflict, because it is the fresher account: a row settled
 * from another client comes back with a `read_at` this side has never seen, and
 * that is exactly the fact worth taking.
 */
function merge(held: Notification[], incoming: Notification[]): Notification[] {
  if (!incoming.length) return held;
  const byId = new Map(held.map((row) => [row.id, row]));
  for (const row of incoming) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

/** How many still want attention. Counted off what is held rather than asked
 *  for with `unread_only`, so the badge answers instantly and the dot never
 *  lags a round trip behind the panel it labels. */
export const unreadCount = (state: NotificationState): number =>
  state.rows.reduce((count, row) => count + (isUnread(row) ? 1 : 0), 0);

/** The highest row id held, which is the `since_id` cursor for the reconnect
 *  top-up and the `before_id` for "mark everything read". Zero when empty —
 *  `notification.list` treats that as "from the beginning". */
export const highestId = (state: NotificationState): number =>
  state.rows.reduce((max, row) => Math.max(max, row.id), 0);
