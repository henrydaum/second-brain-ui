/**
 * Second Brain's stored messages, as turns the thread can be seeded with.
 *
 * **The filtering is the important part.** A conversation's rows include
 * `role: "system"` entries carrying the state machine's serialised state —
 * `{"__second_brain_state_machine__": true, ...}` — which is kernel bookkeeping
 * stored in the same table, not anything a person said or was told. Rendering
 * those would put the kernel's internals in the chat window.
 *
 * Tool rows are dropped too, for a different reason: a `tool` message is only
 * valid next to the assistant message whose `tool_calls` it answers, and
 * reconstructing that pairing from flat rows is more than history rendering
 * needs to do. The consequence is honest — past tool activity is not shown when
 * scrolling back, though it streams live in the turn that produces it.
 *
 * Ported from the AG-UI draft, where this logic was arrived at the hard way. The
 * only thing that changed is where the rows come from.
 */

import { sdk } from "@/lib/client";
import type { Turn } from "@/runtime/store";

/** One row of the `messages` table, as `conv.read` hands it over. */
export type StoredMessage = {
  id: number;
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_name: string | null;
};

/**
 * The text of one stored row, or null if it holds no prose.
 *
 * **Assistant rows are not plain text.** They hold the provider payload
 * serialised whole — `{"content": "…", "tool_calls": [...]}` — so rendering
 * `content` directly puts raw JSON in the chat window. A row whose `content` is
 * null carries only tool calls and has nothing to show.
 *
 * User rows are plain strings, so the parse is attempted and simply declined.
 */
function prose(raw: string): string | null {
  let text = raw;
  if (raw.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { content?: unknown };
      if (typeof parsed.content !== "string") return null;
      text = parsed.content;
    } catch {
      // Not JSON after all — a message that merely opens with a brace.
    }
  }
  // Reasoning is stripped rather than shown. The live stream does not render it
  // inline either, so leaving it in would make scrollback disagree with what you
  // watched arrive.
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return text === "" ? null : text;
}

/** Stored rows → turns. One row is one turn; scrollback has no tool parts, so
 *  the interleaving `store.ts` cares about does not arise here. */
export function toTurns(stored: StoredMessage[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of stored) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    // An assistant row carrying a tool_call_id is half of a tool exchange.
    if (message.tool_call_id) continue;
    if (typeof message.content !== "string") continue;
    const text = prose(message.content);
    if (text === null) continue;
    turns.push({
      // Row ids are the database's own and unique within a conversation, which
      // is exactly the stability assistant-ui wants from a message key.
      id: `stored-${message.id}`,
      role: message.role,
      parts: [{ kind: "text", streamId: `stored-${message.id}`, text, done: true }],
      running: false,
      aborted: false,
    });
  }
  return turns;
}

/**
 * Read a conversation and turn it into scrollback.
 *
 * The response is unwrapped defensively because `conv.read` is the one Request
 * here whose envelope is not stated in the protocol document — it may hand back
 * the rows directly or nest them under a conversation record. Both are accepted
 * rather than guessed at, since guessing wrong shows an empty history and says
 * nothing about why.
 */
export async function readConversation(id: number): Promise<Turn[]> {
  const data = await sdk<
    StoredMessage[] | { messages?: StoredMessage[] } | null
  >("conv.read", { id, details: true });

  const rows = Array.isArray(data) ? data : (data?.messages ?? []);
  return toTurns(rows);
}
