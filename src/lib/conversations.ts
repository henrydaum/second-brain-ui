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
  created_at?: number;
  updated_at?: number;
  /** Pre-formatted by the server, e.g. "15 seconds ago". Rendering the server's
   *  own wording avoids a second, disagreeing notion of "recent". */
  updated_ago?: string;
};

/**
 * Every conversation this user owns, newest first.
 *
 * **The envelope depends on `details`.** With it the answer is `{items: [...]}`;
 * without, a bare array. Both are accepted rather than guessed at, because
 * guessing wrong shows an empty sidebar and explains nothing.
 */
export async function listConversations(limit = 50): Promise<Conversation[]> {
  const data = await sdk<Conversation[] | { items?: Conversation[] } | null>(
    "conv.list",
    { details: true, limit },
  );
  const items = Array.isArray(data) ? data : (data?.items ?? []);
  return [...items].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
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
