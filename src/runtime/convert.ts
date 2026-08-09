/**
 * `Turn` → `ThreadMessageLike`, the shape assistant-ui renders.
 *
 * This is the whole of the translation layer, and it is deliberately dumb: no
 * fetching, no state, no decisions the store did not already make. Anything
 * clever here would be a second interpretation of the protocol competing with
 * `store.ts`.
 *
 * `ExternalStoreRuntime` calls this per message on every render, so it must stay
 * cheap and it must be pure.
 */

import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ReadonlyJSONObject } from "assistant-stream/utils";
import type { Turn } from "@/runtime/store";

/** The `name` on the data part carrying host file paths. `thread.tsx` maps this
 *  name to the component that fetches and renders them. */
export const HOST_FILES = "host-files";

/** Key under `metadata.custom` holding the turn's time in epoch milliseconds.
 *  Only present when the time is actually known — see `timing` below. */
export const SENT_AT = "sentAt";

/** The element type of a message's content, named so the map below can be
 *  annotated — without it TypeScript widens the three branches into a union
 *  full of `undefined` members that no longer matches. */
type Part = Exclude<ThreadMessageLike["content"], string>[number];

export function convertMessage(turn: Turn): ThreadMessageLike {
  const content = turn.parts.map((part): Part => {
    switch (part.kind) {
      case "text":
        return { type: "text" as const, text: part.text };

      case "tool":
        return {
          type: "tool-call" as const,
          toolCallId: part.callId,
          toolName: part.name,
          // The wire types `args` as an open record because that is what JSON
          // is; assistant-ui wants the narrower "this is really JSON" type. The
          // cast is the seam between the two vocabularies, and it is safe
          // because the value came off `JSON.parse`.
          args: (part.args ?? {}) as ReadonlyJSONObject,
          // A tool-call part with no `result` reads as still running, which is
          // exactly what "started"/"progressed" mean. Supplying one on
          // `finished` is what flips it to done — so the narration doubles as
          // the result text, since the kernel repeats it on `finished`
          // deliberately for clients that only keep one line.
          ...(part.status === "finished"
            ? {
                result: part.error ?? part.narration ?? (part.ok ? "ok" : ""),
                isError: part.ok === false,
              }
            : {}),
        };

      case "files":
        // Host paths cannot be rendered without fetching their bytes, and this
        // function is pure. So the paths travel as a data part and the
        // component registered for `HOST_FILES` does the asynchronous half.
        return {
          type: "data" as const,
          name: HOST_FILES,
          data: { paths: part.paths, sent: part.sent === true },
        };
    }
  });

  // **`status` is only legal on an assistant message**, and assistant-ui throws
  // rather than ignoring it on a user one. That is reasonable — a message the
  // person already sent has no run to be in — but it means the field cannot be
  // set unconditionally, which is easy to miss because a user turn is always
  // `running: false` and looks harmless.
  /**
   * The turn's time, said twice, because assistant-ui cannot say "unknown".
   *
   * `fromThreadMessageLike` fills a missing `createdAt` with `new Date()`, so
   * reading `message.createdAt` back can never distinguish a message that
   * genuinely arrived now from one that was read out of the database with no
   * stored time — and the second would be dated to the page load. The real
   * value therefore also travels in `metadata.custom`, where nothing defaults
   * it, and that is the one the UI renders. `createdAt` is still set when known
   * so the library's own view of the message is correct.
   */
  const timing =
    turn.createdAt === undefined
      ? {}
      : {
          createdAt: new Date(turn.createdAt),
          metadata: { custom: { [SENT_AT]: turn.createdAt } },
        };

  if (turn.role !== "assistant") {
    return { id: turn.id, role: turn.role, content, ...timing };
  }

  return {
    id: turn.id,
    role: turn.role,
    content,
    ...timing,
    status: turn.running
      ? { type: "running" }
      : turn.aborted
        ? { type: "incomplete", reason: "cancelled" }
        : { type: "complete", reason: "stop" },
  };
}
