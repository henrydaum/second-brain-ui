import type { StoredMessage } from "@/lib/api";

/**
 * Second Brain's stored messages, as something assistant-ui can be seeded with.
 *
 * Handed to `HttpAgent`'s `initialMessages`, which is why the output shape is
 * AG-UI's own `Message` rather than an assistant-ui type — the runtime converts
 * from there itself.
 *
 * **The filtering is the important part.** A conversation's rows include
 * `role: "system"` entries carrying the state machine's serialised state —
 * `{"__second_brain_state_machine__": true, ...}` — which is kernel
 * bookkeeping stored in the same table, not anything a person said or was told.
 * Rendering those would put the kernel's internals in the chat window.
 *
 * Tool rows are dropped too, for a different reason: a `tool` message is only
 * valid next to the assistant message whose `tool_calls` it answers, and
 * reconstructing that pairing from flat rows is more than history rendering
 * needs to do. The consequence is honest — past tool activity is not shown when
 * scrolling back, though it streams live in the turn that produces it.
 */
/**
 * The text of one stored row, or null if it holds no prose.
 *
 * **Assistant rows are not plain text.** They hold the provider payload
 * serialised whole — `{"content": "…", "tool_calls": [...]}` — so rendering
 * `content` directly puts raw JSON in the chat window. A row whose `content`
 * is null carries only tool calls and has nothing to show.
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
  // Reasoning is stripped rather than shown. The live stream does not render
  // it inline either (THINKING_* events have their own treatment), so leaving
  // it in would make scrollback disagree with what you watched arrive.
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return text === "" ? null : text;
}

export function toInitialMessages(stored: StoredMessage[]) {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of stored) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    // An assistant row carrying a tool_call_id is half of a tool exchange.
    if (message.tool_call_id !== null) continue;
    if (typeof message.content !== "string") continue;
    const text = prose(message.content);
    if (text === null) continue;
    messages.push({ role: message.role, content: text });
  }
  return messages;
}
