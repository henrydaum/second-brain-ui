/**
 * Where the stream, the store and assistant-ui meet.
 *
 * `ExternalStoreRuntime` is the right runtime for this server because it does
 * not own the conversation. It renders whatever array of messages it is handed
 * and calls back when the person does something — which is exactly our
 * relationship with the kernel: the server is the source of truth, the event
 * stream is the only thing that moves it, and this app is a projection. The
 * other runtimes all want to own a request/response cycle we do not have.
 *
 * Everything the chat window itself cannot express — the approval modal, the
 * form panel, the connection status — is published through `SecondBrainContext`
 * rather than through the runtime, because assistant-ui has no concept of them.
 */

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type PropsWithChildren,
} from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type AttachmentAdapter,
  type PendingAttachment,
} from "@assistant-ui/react";

import { RequestFailed, sdk } from "@/lib/client";
import { listCommands, type Command } from "@/lib/commands";
import { connect, type StreamStatus } from "@/lib/events";
import { readConversation } from "@/lib/history";
import { uploadToHost } from "@/lib/upload";
import { convertMessage } from "@/runtime/convert";
import { initialState, reduce, type State } from "@/runtime/store";

/* ── Attachments ────────────────────────────────────────────────────────
 *
 * The host path an upload produced, kept beside the attachment rather than
 * inside it. `CompleteAttachment.content` is message content — what the model
 * would see — and a scratch path is not that; it is a detail of how the bytes
 * got across. So it lives here, keyed by attachment id, and `onNew` reads it
 * back when the message is actually sent.
 */
const hostPaths = new Map<string, string>();

const attachmentAdapter: AttachmentAdapter = {
  accept: "*/*",

  async *add({ file }) {
    const id = crypto.randomUUID();
    const base = {
      id,
      type: file.type.startsWith("image/") ? ("image" as const) : ("file" as const),
      name: file.name,
      contentType: file.type,
      file,
    };

    // Uploading here rather than in `send` so the progress bar means something:
    // by the time the person hits send, the bytes are already across and the
    // send is one small Request.
    const upload = uploadToHost(file);
    let step = await upload.next();
    while (!step.done) {
      yield {
        ...base,
        status: { type: "running", reason: "uploading", progress: step.value },
      } satisfies PendingAttachment;
      step = await upload.next();
    }
    hostPaths.set(id, step.value);

    yield {
      ...base,
      status: { type: "requires-action", reason: "composer-send" },
    } satisfies PendingAttachment;
  },

  async send(attachment) {
    // The upload already happened in `add`. All that is left is to promote the
    // chip to complete; the actual `frontend.submit` happens in `onNew`, which
    // is the only place that knows the accompanying text.
    return {
      ...attachment,
      status: { type: "complete" },
      content: [{ type: "text", text: `[attachment: ${attachment.name}]` }],
    };
  },

  async remove(attachment) {
    // The scratch file is left on the host. `fs.delete` is a policy-gated write
    // and would raise a dialog for something the person did not ask about —
    // asking permission to tidy up is worse than the stray temp file.
    hostPaths.delete(attachment.id);
  },
};

/* ── The context the non-chat surfaces read ─────────────────────────── */

export type SecondBrain = {
  status: StreamStatus;
  state: State;
  /** The server's own command catalogue, for the composer's "/" palette. */
  commands: Command[];
  /** Answer an approval. The value goes to the server; the label is the
   *  person's business. */
  resolve: (value: unknown) => Promise<void>;
  /** Send a line of text as if typed — how form steps and quick replies are
   *  answered, since both are plain submissions. */
  say: (text: string) => Promise<void>;
  dismissError: () => void;
};

const SecondBrainContext = createContext<SecondBrain | null>(null);

export function useSecondBrain(): SecondBrain {
  const value = use(SecondBrainContext);
  if (!value) throw new Error("useSecondBrain outside SecondBrainProvider");
  return value;
}

/* ── The provider ───────────────────────────────────────────────────── */

export function SecondBrainProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [status, setStatus] = useState<StreamStatus>("connecting");

  // `isLoading` covers the gap between "the page is up" and "scrollback is on
  // screen", so the thread does not flash an empty-conversation welcome at
  // someone who has a conversation.
  const [loading, setLoading] = useState(true);

  // Read once at boot. The catalogue only changes when a package is installed
  // or removed, which is rare enough that re-reading on every keystroke would
  // be a Request per character for no benefit.
  const [commands, setCommands] = useState<Command[]>([]);

  /**
   * Open the stream, then boot.
   *
   * **Order is the whole point.** Opening `/events` is what declares that
   * somebody is watching; attendance decides whether an unsafe Request raises a
   * dialog or is refused outright. A boot that POSTed first would get silent
   * refusals for anything interesting, so the stream goes up before the first
   * Request goes out.
   *
   * Empty dependencies: one stream for the life of the page. A second
   * `GET /events` on the same thread *replaces* the first, so re-running this
   * effect would quietly steal the connection from itself.
   */
  useEffect(() => {
    // The replay usually carries the real approval frame, and a real one beats
    // the reconstruction below. This records whether one arrived.
    let sawApproval = false;

    const close = connect((frame) => {
      if (frame.kind === "approval") sawApproval = true;
      dispatch({ type: "frame", frame });
    }, setStatus);

    // `cancelled` guards the async boot below: React can unmount between the
    // await and the dispatch, and a dispatch after unmount is a wasted render
    // at best and a stale conversation at worst.
    let cancelled = false;

    void (async () => {
      try {
        const session = await sdk<{ conversation_id?: number | null } | null>(
          "session.get",
          { details: true },
        );

        // A session is made lazily and holds no conversation until something
        // binds one, and **a session with no conversation cannot be talked
        // to** — every submit comes back "No conversation loaded. Try /new."
        // So booting into one is not a convenience, it is what makes the
        // composer work at all.
        //
        // **`conv.create`, never `conv.load`** — and that is a workaround, not
        // a preference. `load_conversation` in the kernel restores
        // `frontend_name` from the conversation's stored marker
        // (`runtime/persistence.py`), so loading a conversation last used from
        // the REPL stamps `frontend_name = "repl"` onto this session. Every
        // Request after that is refused with "session http:… belongs to the
        // repl frontend", permanently, because the bridge runs everything
        // through `frontend.act` and that checks the owner.
        //
        // Creating is unaffected: a new conversation has no prior owner. So the
        // conversations sidebar stays parked until the kernel carries the live
        // binding across a load the way `reset_conversation` already does.
        let conversationId = session?.conversation_id ?? null;
        if (conversationId === null) {
          const created = await sdk<{ id: number }>("conv.create", {
            title: "New chat",
            activate: true,
          });
          conversationId = created?.id ?? null;
        }

        if (conversationId !== null) {
          const turns = await readConversation(conversationId);
          if (!cancelled) dispatch({ type: "history", turns });
        }

        // After the conversation, not before: the palette is useless until
        // there is somewhere to run a command, and scrollback is what the
        // person is waiting to see.
        const catalogue = await listCommands();
        if (!cancelled) setCommands(catalogue);

        // An approval raised before this page existed. The stream replays the
        // last 500 frames, so usually the real `approval` frame arrives on its
        // own and this finds nothing left to do. When it does find something,
        // all the server offers is the id — so the dialog is drawn from the
        // little we have. Worse than the real one, and far better than a turn
        // blocked on a question with nothing on screen.
        const pending = await sdk<string | null>("frontend.pending", {});
        if (pending && !cancelled && !sawApproval) {
          dispatch({
            type: "frame",
            frame: {
              kind: "approval",
              payload: {
                id: pending,
                title: "The agent is waiting on a question",
                body:
                  "This was asked before the page was open, so its details are " +
                  "no longer available. Denying is the safe answer.",
              },
            },
          });
        }
      } catch (error) {
        // A boot that cannot read history is still a usable chat window, so
        // this reports and carries on rather than refusing to start.
        console.error("second brain: could not read history", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      close();
    };
  }, []);

  /* ── What the person can do ─────────────────────────────────────── */

  /**
   * Turn a thrown Request into the error banner.
   *
   * **Nothing below may reject.** assistant-ui calls these from an event
   * handler, and an unhandled rejection there unmounts the tree — the symptom
   * is the whole page going white, with the actual cause (a refusal, a dropped
   * connection) never shown. A failed Request is ordinary news and belongs in
   * the banner, not in a crash.
   */
  const report = useCallback((error: unknown) => {
    const failed = error instanceof RequestFailed;
    dispatch({
      type: "frame",
      frame: {
        kind: "error",
        payload: {
          message: failed
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error),
          code: failed ? error.code : "",
        },
      },
    });
  }, []);

  const say = useCallback(
    async (text: string) => {
      dispatch({ type: "said", text });
      try {
        await sdk("frontend.submit", { input_kind: "text", text });
      } catch (error) {
        report(error);
      }
    },
    [report],
  );

  const resolve = useCallback(
    async (value: unknown) => {
      const id = state.approval?.id;
      // Closed before the answer lands, deliberately: the POST completes only
      // once the *original* blocked Request finishes, which can be a while, and
      // leaving the dialog up in the meantime invites a second click.
      dispatch({ type: "clearApproval" });
      try {
        await sdk("frontend.resolve", { value, request_id: id });
        // A `false` answer means there was nothing left to answer — already
        // resolved elsewhere, or timed out after 300s. That is a stale dialog,
        // not an error, and closing it is the whole response.
      } catch (error) {
        report(error);
      }
    },
    [state.approval?.id, report],
  );

  const dismissError = useCallback(() => dispatch({ type: "clearError" }), []);

  /* ── The runtime ────────────────────────────────────────────────── */

  /** Every callback below is `useCallback` with no dependencies, so the adapter
   *  keeps one identity for the life of the page. They talk to the server and
   *  dispatch; neither needs to read state, and rebuilding them on every frame
   *  would make assistant-ui redo work it does not need to. */
  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();

      // The name travels alongside the path, not derived from it. `fs.temp`
      // makes names like `frontend_http-kr6oyis8.pdf`, and that is what would
      // end up in the attachment cache — so the file the person actually chose
      // has to be named explicitly or it loses its identity on the way in.
      const files = (message.attachments ?? [])
        .map((attachment) => ({
          path: hostPaths.get(attachment.id),
          name: attachment.name,
        }))
        .filter((file): file is { path: string; name: string } =>
          Boolean(file.path),
        );

      dispatch({ type: "said", text, files: files.map((file) => file.name) });

      try {
        if (files.length) {
          // Each attachment is its own submission — there is no "several files
          // and a caption" shape on the wire. The text rides on the last one so
          // it arrives with the file it is about rather than starting a bare
          // turn of its own.
          for (const [index, file] of files.entries()) {
            const last = index === files.length - 1;
            await sdk("frontend.submit", {
              input_kind: "attachment",
              path: file.path,
              file_name: file.name,
              caption: last ? text : "",
              // Into the watched attachment cache, so the file is extracted and
              // indexed rather than left in scratch.
              ingest: true,
            });
          }
          return;
        }

        await sdk("frontend.submit", { input_kind: "text", text });
      } catch (error) {
        report(error);
      }
    },
    [report],
  );

  const onCancel = useCallback(async () => {
    try {
      await sdk("frontend.cancel", {});
    } catch (error) {
      report(error);
    }
  }, [report]);

  /** Re-read the conversation from the server. The escape hatch for a long
   *  disconnect: the replay buffer holds 500 frames per session, so a client
   *  that has been away a while should re-read rather than trust the replay. */
  const onRefetchThread = useCallback(async () => {
    const session = await sdk<{ conversation_id?: number | null } | null>(
      "session.get",
      { details: true },
    );
    const id = session?.conversation_id ?? null;
    if (id === null) return;
    dispatch({ type: "history", turns: await readConversation(id) });
  }, []);

  const runtime = useExternalStoreRuntime({
    messages: state.turns,
    convertMessage,
    isLoading: loading,

    // `typing` is the only end-of-turn signal the server has — `false` means the
    // *logical* turn ended, not each internal drive — so it drives this
    // directly rather than being inferred from the last message's status.
    isRunning: state.typing,

    // A pending approval blocks the turn on the server side. Blocking the
    // composer here as well makes that visible instead of letting someone type
    // into a session that cannot hear them.
    isSendDisabled: state.approval !== null,

    onNew,
    onCancel,
    onRefetchThread,

    // Quick replies from a store plugin. `buttons` carries {value, label} and
    // the value is submitted as text, same as a form choice.
    suggestions: useMemo(
      () =>
        state.buttons.map((button) => ({
          prompt: String(button.value),
          text: button.label ?? String(button.value),
        })),
      [state.buttons],
    ),

    adapters: { attachments: attachmentAdapter },

    // Deliberately absent: `onEdit`, `onReload` and any branch adapter. The
    // server has no regenerate and no message tree, and assistant-ui hides the
    // affordances it has no callback for — which is how the UI stays honest
    // about what this backend can actually do.
  });

  const value = useMemo<SecondBrain>(
    () => ({ status, state, commands, resolve, say, dismissError }),
    [status, state, commands, resolve, say, dismissError],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SecondBrainContext value={value}>{children}</SecondBrainContext>
    </AssistantRuntimeProvider>
  );
}

/** Re-exported so callers can tell a refusal from a broken call without
 *  reaching past this module into the transport. */
export { RequestFailed };
