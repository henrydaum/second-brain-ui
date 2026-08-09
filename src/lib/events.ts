/**
 * The inbound half of the bridge: `GET /events`.
 *
 * Every frame is one `render` call the kernel made, verbatim. There is no
 * translation layer — these are the same ten payloads a native Python frontend
 * receives, which is why a client that handles all ten can do what the REPL
 * can.
 *
 * **Opening this stream is the attendance signal.** It declares that a person is
 * watching this session, and attendance is what decides whether an unsafe
 * Request raises a dialog or is refused outright. No stream, no dialogs. That is
 * why boot connects here before it POSTs anything.
 */

import { serverUrl } from "@/lib/client";

/* ── The ten kinds ───────────────────────────────────────────────────────
 *
 * Handle what you can show and ignore the rest; a client that only renders
 * `messages` is a working client. These types are transcriptions of the
 * protocol document, so every optional marker below is a real "may be absent",
 * not defensive typing.
 */

/** GitHub-flavoured markdown, including tables and fenced code blocks. This is
 *  the interchange format everywhere in Second Brain and also what the model
 *  emits, so one rendering path covers both. */
export type MessagesPayload = string[];

/** The reply arriving token by token. */
export type StreamDeltaPayload = {
  /** Groups the fragments. This is the message key. */
  stream_id: string;
  /** 1-based, increments per fragment. */
  seq: number;
  /** The fragment. Empty on the final frame. */
  delta: string;
  /** False while running, true exactly once. */
  done: boolean;
  /** The stream was cut off. */
  aborted?: boolean;
  /** **Only when `done` and not `aborted`.** The cleaned text; the deltas agree
   *  with it, so it replaces rather than appends. */
  final_text?: string;
  /** Only alongside `final_text`. Usually `"final"`. */
  kind?: string;
};

/** Fires for tool calls and slash commands alike. */
export type ToolStatusPayload = {
  /** Stable across started/finished — update in place, do not append. */
  call_id: string;
  status: "started" | "progressed" | "finished";
  /** `"command"` for slash commands; absent for tools. */
  kind?: string;
  tool_name?: string;
  command_name?: string;
  args?: Record<string, unknown>;
  /** Short human blurb. Repeated on `finished`, deliberately, so a client
   *  overwriting one line still has it. */
  narration?: string;
  ok?: boolean;
  error?: string | null;
  /**
   * **On `finished` only: what the call amounted to.**
   *
   * The tool's own account of its result — prose, since it is written for the
   * model — capped exactly as the copy the kernel stores, so this and the row
   * `conv.read` hands back are the same bytes.
   *
   * Empty on failure, where `error` is the outcome, and empty for a tool that
   * reported nothing. **Not interchangeable with `narration`**: that is what
   * the agent set out to do, this is what came back.
   */
  summary?: string;
};

/**
 * A question the kernel is blocking a turn on.
 *
 * **A turn is blocked until this is answered**, so a client that ignores this
 * kind will appear to hang.
 *
 * **Not only permission.** One kernel primitive — `runtime.request_input` —
 * raises a sandbox permission gate, a `ui.ask`, and a tool asking the person
 * something, and all three arrive here. `type` may be any of `boolean`,
 * `string`, `integer`, `number`, `array` or `object`. A client that words this
 * as a permission grant will mislabel an ordinary question as one; everything
 * above the wire in this app therefore calls it an *input request*, and only
 * the wire spells it `approval`.
 */
export type ApprovalPayload = {
  /** Answer with this, via `frontend.resolve`. */
  id: string;
  title: string;
  /** Arguments, who is asking, and any extra note. Shown in full. */
  body?: string;
  /** Usually `"boolean"` or `"string"`. */
  type?: string;
  /** Allowed answers. */
  enum?: unknown[] | null;
  /** **Paired with `enum` by index.** May be null even when `enum` is not. */
  enum_labels?: string[] | null;
  default?: unknown;
};

/**
 * A question stopped waiting: answered, cancelled, or denied by timeout.
 *
 * **The counterpart to `approval`, and the only thing that says a dialog may
 * come down.** Another client can answer the same question, and the kernel
 * denies by name after 300s — neither is something this client did, and
 * without this frame neither is something it could learn except by polling.
 *
 * `reason` says how the question ended, not what the answer was: the answer
 * went to whoever was blocked on it and is deliberately not repeated here.
 */
export type ApprovalSettledPayload = {
  /** The `id` of the `approval` this settles. */
  request_id: string;
  reason?: "answered" | "cancelled";
};

/** One step of a command collecting its arguments. */
export type FormFieldPayload = {
  /** The command or tool being filled in. */
  name?: string;
  /** The raw step. `display` is what to actually draw; this is here for the
   *  cases where the raw type matters (numeric inputs, say). */
  field?: {
    name?: string;
    prompt?: string;
    required?: boolean;
    type?: string;
    enum?: unknown[] | null;
    enum_labels?: string[] | null;
    default?: unknown;
    prompt_when_missing?: boolean;
    columns?: number;
  };
  /** Arguments gathered so far. */
  collected?: Record<string, unknown>;
  display?: {
    prompt: string;
    /** Hint text. */
    assist?: string;
    /** Empty for free text. Booleans get True/False. */
    choices?: { value: unknown; label?: string }[];
    /** A hint for the input widget. */
    input_mode?: string;
    allow_skip?: boolean;
    /** Effectively always true. */
    allow_cancel?: boolean;
    /** Only true once a previous step exists. */
    allow_back?: boolean;
  };
};

/** Quick replies. Nothing in the kernel currently emits this; it exists for
 *  store plugins. Submit the `value` as text, same as a form choice. */
export type ButtonsPayload = { value: unknown; label?: string }[];

export type ErrorPayload = {
  code?: string;
  message?: string;
  details?: unknown;
  retry_phase?: unknown;
};

/** Filesystem paths on the host — not URLs, and not bytes. A browser cannot
 *  open these directly; the contents come back through `fs.read_bytes`. */
export type AttachmentsPayload = string[];

/** One frame off the stream, discriminated by `kind`. */
export type Frame =
  | { kind: "messages"; payload: MessagesPayload }
  | { kind: "stream_delta"; payload: StreamDeltaPayload }
  | { kind: "typing"; payload: boolean }
  | { kind: "tool_status"; payload: ToolStatusPayload }
  | { kind: "approval"; payload: ApprovalPayload }
  | { kind: "approval_settled"; payload: ApprovalSettledPayload }
  | { kind: "form_field"; payload: FormFieldPayload }
  | { kind: "buttons"; payload: ButtonsPayload }
  | { kind: "error"; payload: ErrorPayload }
  | { kind: "attachments"; payload: AttachmentsPayload };

/** What the connection itself is doing, for the status line. This is not part
 *  of the protocol — it is the transport's own state, and worth showing because
 *  a silently dropped stream otherwise looks exactly like a hung agent. */
export type StreamStatus = "connecting" | "open" | "reconnecting";

/**
 * Open the render stream. Returns a function that closes it.
 *
 * **`EventSource`, deliberately.** It reconnects on its own and sends back the
 * last `id:` it saw as `Last-Event-ID`, and the server replays from there — so a
 * page refresh resumes instead of losing the turn it happened during. A
 * fetch-based reader would have to reimplement both halves of that.
 *
 * The replay buffer holds the last 500 frames per session, so a long disconnect
 * drops the middle. A client that has been away a while should re-read state
 * rather than trust the replay; that is what `onRefetchThread` is for.
 *
 * One stream per thread: a second `GET /events` for the same thread replaces the
 * first, so mounting this twice silently steals the connection from the first
 * mount. React 19's development StrictMode double-invokes effects, which is
 * exactly that situation — hence the cleanup function, which must actually run.
 */
export function connect(
  onFrame: (frame: Frame) => void,
  onStatus: (status: StreamStatus) => void,
): () => void {
  const url = serverUrl("/events");
  // The one place a token travels in a URL. `EventSource` cannot send headers,
  // so this is the API rather than an oversight — and it is why no other route
  // accepts a query token, since a token in a URL reaches logs and history.
  url.searchParams.set("token", import.meta.env.VITE_SB_TOKEN ?? "");

  const stream = new EventSource(url);
  onStatus("connecting");

  stream.onopen = () => onStatus("open");

  // EventSource reports a dropped connection and a failed connection the same
  // way, and retries either. "reconnecting" is honest about both.
  stream.onerror = () => onStatus("reconnecting");

  stream.onmessage = (event) => {
    let frame: Frame;
    try {
      frame = JSON.parse(event.data) as Frame;
    } catch {
      // A frame we cannot parse is a bug on the wire, not a reason to tear down
      // a working stream — the next frame is probably fine.
      console.error("second brain: unparseable frame", event.data);
      return;
    }
    onFrame(frame);
  };

  return () => stream.close();
}
