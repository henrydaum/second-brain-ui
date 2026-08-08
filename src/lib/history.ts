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
export function toInitialMessages(stored: StoredMessage[]) {
  return stored
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim() !== "" &&
        // An assistant row with a tool_call_id is half of a tool exchange.
        message.tool_call_id === null,
    )
    .map((message) => ({
      id: String(message.id),
      role: message.role as "user" | "assistant",
      content: message.content,
    }));
}
