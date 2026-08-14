/**
 * Second Brain's stored messages, as turns the thread can be seeded with.
 *
 * **The filtering is the important part.** A conversation's rows include
 * `role: "system"` entries carrying the state machine's serialised state —
 * `{"__second_brain_state_machine__": true, ...}` — which is kernel bookkeeping
 * stored in the same table, not anything a person said or was told. Rendering
 * those would put the kernel's internals in the chat window.
 *
 * **Tool calls are rebuilt, not dropped.** A `tool` row is only meaningful
 * beside the assistant row whose `tool_calls` it answers, so the pairing has to
 * be reconstructed from flat rows — done below, because the alternative is a
 * scrollback that quietly disagrees with what you watched happen: tools appear
 * while a turn runs and vanish when the page reloads.
 *
 * That pairing is also why consecutive assistant and tool rows are merged into
 * one turn. The kernel writes an agent turn as several rows — the call, its
 * result, the reply that follows — and the live stream renders exactly that as a
 * single message. One turn per row would split it into two or three.
 *
 * Ported from the AG-UI draft, where this logic was arrived at the hard way. The
 * only thing that changed is where the rows come from.
 */

import { sdk } from "@/lib/client";
import type {
  MessageAttachment,
  ToolPart,
  Turn,
} from "@/runtime/store";

type StoredAttachment = {
  path?: unknown;
  file_name?: unknown;
  modality?: unknown;
  extension?: unknown;
};

/** One row of the `messages` table, as `conv.read` hands it over. */
export type StoredMessage = {
  id: number;
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_name: string | null;
  /** Who actually wrote this row. Non-null means the kernel synthesized it
   *  for the model, even when its role is `user`. */
  author?: string | null;
  /** Files this message carried. New kernels always return a list; optional so
   * conversations from the older row shape remain readable. */
  attachments?: StoredAttachment[] | null;
  /**
   * When the row was stored, as **fractional epoch seconds** — e.g.
   * `1786158850.6803284`.
   *
   * Confirmed against a live `conv.read`, which is worth saying because the
   * protocol document specifies that call's envelope but not its columns, and
   * because the units are the trap here: the conversation rows `conv.list`
   * returns spell their times `created_at`/`updated_at` while message rows
   * spell theirs `timestamp`. Reading seconds as milliseconds dates every
   * message to January 1970.
   */
  timestamp?: number | null;
};

function messageAttachments(
  stored: StoredAttachment[] | null | undefined,
): MessageAttachment[] {
  if (!Array.isArray(stored)) return [];
  const attachments: MessageAttachment[] = [];
  for (const item of stored) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.path !== "string" || !item.path) continue;
    const fileName =
      typeof item.file_name === "string" && item.file_name
        ? item.file_name
        : item.path.split(/[\\/]/).pop() || item.path;
    attachments.push({
      path: item.path,
      fileName,
      modality:
        typeof item.modality === "string" ? item.modality : "unknown",
      extension:
        typeof item.extension === "string" ? item.extension : "",
    });
  }
  return attachments;
}

/** A stored row's time as epoch milliseconds, which is what `Date` wants. */
function momentOf(message: StoredMessage): number | undefined {
  const seconds = message.timestamp;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return seconds * 1000;
}

/** One entry of an assistant row's `tool_calls`, in the provider's shape. */
type StoredToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};

/** A JSON object a row's `content` might be, or null when it is not one. */
function asObject(raw: string): Record<string, unknown> | null {
  if (!raw.trimStart().startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Not JSON after all — a message that merely opens with a brace.
    return null;
  }
}

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
  const parsed = asObject(raw);
  if (parsed) {
    if (typeof parsed.content !== "string") return null;
    text = parsed.content;
  }
  // Reasoning is stripped rather than shown. The live stream does not render it
  // inline either, so leaving it in would make scrollback disagree with what you
  // watched arrive.
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return text === "" ? null : text;
}

/** The calls an assistant row announces, as parts waiting for their answers. */
function toolParts(raw: string): ToolPart[] {
  const calls = asObject(raw)?.tool_calls;
  if (!Array.isArray(calls)) return [];

  const parts: ToolPart[] = [];
  for (const call of calls as StoredToolCall[]) {
    const callId = call?.id;
    if (typeof callId !== "string") continue;
    // Arguments are a *string* of JSON inside the row's JSON — the provider's
    // own double encoding, not a quirk of this table.
    let args: Record<string, unknown> | undefined;
    const raw_args = call.function?.arguments;
    if (typeof raw_args === "string") args = asObject(raw_args) ?? undefined;
    parts.push({
      kind: "tool",
      callId,
      name: call.function?.name ?? "tool",
      isCommand: false,
      // Not stored. The narration lives in `args` regardless, which is where
      // the live path shows it too.
      narration: "",
      summary: "",
      // A stored call is over by definition; whether it worked is decided by
      // the answering row below.
      status: "finished",
      args,
      ok: true,
    });
  }
  return parts;
}

/**
 * Fold one `tool` row into the call it answers.
 *
 * The inverse of the kernel's `_format_tool_result`: a failure is stored as
 * `{"error": "…"}` and anything else is the summary verbatim. Reading a failure
 * as prose would print a JSON object at people, which is the one shape that
 * must not survive the trip.
 */
function answer(part: ToolPart, content: string): void {
  const parsed = asObject(content);
  const error = parsed?.error;
  if (typeof error === "string") {
    part.ok = false;
    part.error = error;
    return;
  }
  part.summary = content;
}

/**
 * Stored rows → turns.
 *
 * A user row always starts a fresh turn. Assistant and tool rows accumulate
 * into the one that is open, because the kernel spreads a single agent turn
 * across several of them — see the note at the top of this file.
 */
export function toTurns(stored: StoredMessage[]): Turn[] {
  const turns: Turn[] = [];
  // The assistant turn being assembled, and the calls inside it still waiting
  // for their result rows. Both are cleared together: a call whose answer never
  // arrives is not going to be answered by the next turn's rows.
  let open: Turn | null = null;
  let pending = new Map<string, ToolPart>();

  for (const message of stored) {
    if (typeof message.content !== "string") continue;

    if (message.role === "tool") {
      const part = message.tool_call_id
        ? pending.get(message.tool_call_id)
        : undefined;
      if (part) answer(part, message.content);
      continue;
    }

    if (message.role === "user") {
      // Kernel notes deliberately wear the user's role because they are
      // addressed to the model. `author` is the wire's attribution; rendering
      // these as something the person said would misrepresent the transcript.
      if (message.author) continue;
      open = null;
      pending = new Map();
      const text = prose(message.content);
      const attachments = messageAttachments(message.attachments);
      if (text === null && attachments.length === 0) continue;
      const parts: Turn["parts"] = [];
      if (attachments.length) {
        parts.push({
          kind: "files",
          paths: attachments.map((attachment) => attachment.path!),
          sent: true,
          attachments,
        });
      }
      if (text !== null) {
        parts.push({
          kind: "text",
          streamId: `stored-${message.id}`,
          text,
          done: true,
        });
      }
      turns.push({
        // Row ids are the database's own and unique within a conversation,
        // which is exactly the stability assistant-ui wants from a message key.
        id: `stored-${message.id}`,
        role: "user",
        parts,
        running: false,
        aborted: false,
        createdAt: momentOf(message),
      });
      continue;
    }

    // Everything else is kernel bookkeeping — `role: "system"` state snapshots
    // above all — and belongs nowhere near the chat window.
    if (message.role !== "assistant") continue;

    const calls = toolParts(message.content);
    const text = prose(message.content);
    if (text === null && calls.length === 0) continue;

    if (open === null) {
      open = {
        id: `stored-${message.id}`,
        role: "assistant",
        parts: [],
        running: false,
        aborted: false,
        // The moment the turn *started*, which is this first row — matching the
        // live path, where a turn is stamped as it opens.
        createdAt: momentOf(message),
      };
      turns.push(open);
    }

    // Text first: a row carrying both is the model saying what it is about to
    // do and then doing it, which is the order the live stream shows too.
    if (text !== null) {
      open.parts.push({
        kind: "text",
        streamId: `stored-${message.id}`,
        text,
        done: true,
      });
    }
    for (const part of calls) {
      open.parts.push(part);
      pending.set(part.callId, part);
    }
  }
  return turns;
}

export type ConversationRead = {
  turns: Turn[];
  /**
   * Whether this conversation's results are announced.
   *
   * **Only `conv.read` knows this.** It is not a column on the conversations
   * table — the kernel derives it from the state machine's latest state — so
   * `conv.list` cannot carry it and there is nowhere cheaper to ask. Null when
   * the answer did not include one, which is a kernel too old to say rather
   * than a conversation that is set to neither value.
   */
  notificationMode: NotificationMode | null;
};

/** The kernel normalises anything else to one of these two, and defaults to
 *  `"on"` — see `runtime/notifications.py`. */
export type NotificationMode = "on" | "off";

/**
 * Read a conversation and turn it into scrollback.
 *
 * The response is unwrapped defensively because `conv.read` is the one Request
 * here whose envelope is not stated in the protocol document — it may hand back
 * the rows directly or nest them under a conversation record. Both are accepted
 * rather than guessed at, since guessing wrong shows an empty history and says
 * nothing about why.
 *
 * `details: true` was already being asked for, and the answer already carried
 * the notification mode; this only stopped throwing it away. The header menu
 * therefore costs no Request of its own — it reads what opening the
 * conversation had already fetched.
 */
export async function readConversation(id: number): Promise<ConversationRead> {
  const data = await sdk<
    | StoredMessage[]
    | { messages?: StoredMessage[]; notification_mode?: string }
    | null
  >("conv.read", { id, details: true });

  if (Array.isArray(data)) return { turns: toTurns(data), notificationMode: null };

  const mode = data?.notification_mode;
  return {
    turns: toTurns(data?.messages ?? []),
    notificationMode: mode === "on" || mode === "off" ? mode : null,
  };
}
