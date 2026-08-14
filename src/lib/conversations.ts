/**
 * The conversation list.
 *
 * A Second Brain *conversation* is a stored thread of messages; the session is
 * what points at one. Switching is therefore not a client-side view change but
 * a real `conv.load`, after which the session is talking about something else
 * and the scrollback has to be re-read.
 */

import { sdk } from "@/lib/client";

export type Conversation = {
  id: number;
  title: string;
  /** "user" for a person's conversations; subagents get their own kinds. */
  kind?: string;
  category?: string | null;
  /** **Fractional epoch seconds**, e.g. `1786239258.642228` — not milliseconds.
   *  Confirmed against a live `conv.list`. Note that message rows spell the
   *  same idea `timestamp` (see `lib/history.ts`); the two tables disagree
   *  about the name but not the units. */
  created_at?: number;
  updated_at?: number;
  /** Pre-formatted by the server, e.g. "15 seconds ago". Rendering the server's
   *  own wording avoids a second, disagreeing notion of "recent" — and relative
   *  wording is the right idiom for a list read by recency, which is why this
   *  is shown rather than a date. The date is on the row's `title`. */
  updated_ago?: string;
};

/** One bucket and how many conversations are in it, counted by the server over
 *  the whole table rather than over the page it sent. `null` is Main. */
export type CategoryCount = { category: string | null; count: number };

export type ConversationPage = {
  items: Conversation[];
  /** Whether asking for the next offset would return anything. */
  hasMore: boolean;
  categories: CategoryCount[];
};

/** How many conversations a page holds. Also how many the sidebar shows before
 *  it offers to fetch more. */
export const CONVERSATION_PAGE = 50;

/**
 * One page of this user's conversations, newest first.
 *
 * **`category` has three meanings and the middle one is the point.** Omitted is
 * every conversation; `""` is the Main bucket, meaning the server's NULL *or*
 * empty; a name is an exact match. Without the `""` case there is no way to ask
 * for your own conversations except to read every row and filter here, which is
 * exactly what stopped working once background runs outnumbered them.
 *
 * **The envelope depends on `details`.** With it the answer is an object;
 * without, a bare array. Both are accepted rather than guessed at, because
 * guessing wrong shows an empty sidebar and explains nothing — and the bare
 * array is also what a kernel too old to page answers, which this degrades to
 * rather than failing on.
 */
export async function listConversations(
  options: {
    limit?: number;
    offset?: number;
    /** `undefined` for every conversation, `null` for Main, or a name. */
    category?: string | null;
  } = {},
): Promise<ConversationPage> {
  const { limit = CONVERSATION_PAGE, offset = 0, category } = options;
  const data = await sdk<
    | Conversation[]
    | {
        items?: Conversation[];
        has_more?: boolean;
        categories?: (CategoryCount | string | null)[];
      }
    | null
  >("conv.list", {
    details: true,
    limit,
    offset,
    ...(category === undefined ? {} : { category: category ?? "" }),
  });

  if (Array.isArray(data)) {
    return { items: sortByRecency(data), hasMore: false, categories: [] };
  }

  return {
    items: sortByRecency(data?.items ?? []),
    hasMore: Boolean(data?.has_more),
    categories: (data?.categories ?? []).map((entry) =>
      // A kernel older than the counts answers bare names. Reporting zero is
      // better than reporting a wrong number, and the sidebar hides a count it
      // cannot vouch for.
      typeof entry === "object" && entry !== null
        ? entry
        : { category: entry ?? null, count: 0 },
    ),
  };
}

/** The server orders by `updated_at` already; this is the guard against a page
 *  that disagrees, and it is what the sidebar has always relied on. */
const sortByRecency = (items: Conversation[]) =>
  [...items].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));

/**
 * A title the kernel supplied rather than one the conversation earned.
 *
 * **This pattern is the store's, not ours.** `task_update_titles` replaces
 * exactly the titles matching `^new conversation` and never touches anything
 * else, on the reasoning that a real title — whether it wrote it or a person
 * did — is not its to overwrite. Which means a title *this app* invents is a
 * real title as far as the sweep is concerned: sending `"New chat"` on
 * `conv.create` is what kept every conversation made here from ever being
 * named. So nothing here sends a title at all, and the kernel's own
 * "New conversation" is translated for display below.
 */
const PLACEHOLDER_TITLE = /^new conversation\b/i;

/**
 * What to call a conversation on screen.
 *
 * "New chat" rather than the kernel's wording, because it is the same thing
 * the button that made it says. A `(cleared)` title is left alone on purpose —
 * the sweep may replace it, but until it does, that suffix is telling you
 * something a placeholder is not.
 */
export function conversationTitle(conversation: Conversation): string {
  const title = conversation.title?.trim() ?? "";
  return !title || PLACEHOLDER_TITLE.test(title) ? "New chat" : title;
}

/**
 * Whether nothing has ever been said in this conversation.
 *
 * Read from the timestamps because there is no message count to read: the rows
 * `conv.list` hands back are the `conversations` table verbatim, which counts
 * nothing. The kernel stamps `created_at` and `updated_at` with one value when
 * it makes the row and only `save_message` moves `updated_at` afterwards — so
 * the two being equal is exactly "no message was ever stored here". Retitling
 * deliberately does not bump it, which is what makes this still true of a
 * conversation the title sweep has already been over.
 *
 * A row with no timestamps answers `false`: the caller uses this to decide
 * whether it may skip creating a conversation, and the safe way to be wrong is
 * to create one.
 */
export function isUnused(conversation: Conversation | undefined): boolean {
  const created = conversation?.created_at;
  const updated = conversation?.updated_at;
  if (typeof created !== "number" || typeof updated !== "number") return false;
  return updated <= created;
}

/* ── Changing one ──────────────────────────────────────────────────────
 *
 * Both are `ALWAYS_SAFE` in the kernel's policy, so neither raises an approval
 * dialog — unlike `conv.delete`, which does. Editing what a conversation is
 * *called* or *filed under* changes nothing the person cannot see and undo, and
 * the kernel scopes each one to the calling user in SQL.
 */

/** Name it. **Permanent, in a way the placeholder is not** — the kernel's title
 *  sweep only ever replaces titles matching `PLACEHOLDER_TITLE` above, so a
 *  title set here is one it will never overwrite. */
export function setConversationTitle(id: number, title: string) {
  return sdk<boolean>("conv.set_title", { id, title });
}

/** File it. `null` puts it back in Main, which the server stores as an empty
 *  category rather than as a named one. */
export function setConversationCategory(id: number, category: string | null) {
  return sdk<boolean>("conv.set_category", { id, category });
}

/** What `conv.load` answers: a command-shaped result rather than a bare value.
 *  `ok: false` with "No such conversation." is how a conversation this user
 *  does not own is reported — deliberately indistinguishable from one that does
 *  not exist, so the list cannot be probed for other people's rows. */
export type LoadResult = {
  ok: boolean;
  messages?: string[];
  error?: string | null;
};
