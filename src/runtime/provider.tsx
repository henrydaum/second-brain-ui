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
 * Everything the chat window itself cannot express — the dialog for a question
 * the kernel is blocking on, the form panel, the connection status — is
 * published through `SecondBrainContext` rather than through the runtime,
 * because assistant-ui has no concept of them.
 *
 * Those questions get their own reducer rather than a slot on the conversation
 * store, and that is the point rather than tidiness: they belong to the
 * *session*, which outlives any one conversation, and living in the
 * conversation store meant a history read threw a live one away. See
 * `runtime/input-requests.ts`.
 */

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Context,
  type PropsWithChildren,
} from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type AttachmentAdapter,
  type PendingAttachment,
  type QueueItemState,
} from "@assistant-ui/react";

// Type-only, deliberately. The sections are the settings dialog's own
// vocabulary and belong beside it; naming one here has to cost nothing at
// runtime, and an erased import is how the dependency stays one-way in the
// bundle even though the *name* points the other way.
import type { SettingsPageId } from "@/components/settings-structure";
import { RequestFailed, sdk } from "@/lib/client";
import { listCommands, looksLikeCommand, type Command } from "@/lib/commands";
import {
  isUnused,
  listConversations,
  type Conversation,
  type LoadResult,
} from "@/lib/conversations";
import { connect, type StreamStatus } from "@/lib/events";
import { readConversation } from "@/lib/history";
import { isPendingInput, type InputRequest } from "@/lib/input-requests";
// `Notification` deliberately shadows the DOM global of that name here. Ours is
// a row in the kernel's table; the browser's is a desktop popup this app does
// not use, and leaving the global reachable under the same spelling is how a
// missing import turns into a type error nobody can read.
import {
  listNotifications,
  markRead,
  type Notification,
} from "@/lib/notifications";
import { extensionOf, uploadToHost } from "@/lib/upload";
import { convertMessage } from "@/runtime/convert";
import {
  initialInputRequests,
  reduceInputRequests,
  unseenRequest,
} from "@/runtime/input-requests";
import {
  highestId,
  initialNotifications,
  reduceNotifications,
  unreadCount,
  type Banner,
} from "@/runtime/notifications";
import { initialState, reduce, type State } from "@/runtime/store";
import {
  forgetStagedPath,
  rememberStagedPath,
  stagedPath,
} from "@/runtime/staged-attachments";

/* ── Attachments ────────────────────────────────────────────────────────
 *
 * The host path an upload produced, kept beside the attachment rather than
 * inside it. `CompleteAttachment.content` is message content — what the model
 * would see — and a scratch path is not that; it is a detail of how the bytes
 * got across. So it lives in the shared staged-attachment registry, keyed by
 * attachment id, and `onNew` reads it back when the message is actually sent.
 */

/** The queue adapter's two lanes, which are always empty — see `queue` in the
 *  provider. One frozen array rather than a fresh literal per render, so the
 *  runtime's own memos over it never see a changed identity. */
const NO_QUEUED_MESSAGES: readonly QueueItemState[] = [];

const attachmentAdapter: AttachmentAdapter = {
  // Everything.
  //
  // **A bare star, not the MIME wildcard.** assistant-ui treats this as a
  // literal, not a pattern: the single star is special-cased as "no filter",
  // and anything else goes through `fileMatchesAccept`, which compares MIME
  // types and extensions against the list. The MIME wildcard matches neither
  // of those, so *every* file was rejected — and `AddAttachment` swallows that
  // rejection, which is why picking a file did nothing rather than saying why.
  // The same string is also handed to the file input's `accept`, so the picker
  // itself was filtering everything out before we were even asked.
  accept: "*",

  async *add({ file }) {
    const id = crypto.randomUUID();
    const base = {
      id,
      type: file.type.startsWith("image/") ? ("image" as const) : ("file" as const),
      name: file.name,
      contentType: file.type,
      file,
    };

    // **Yielded before anything is attempted.** assistant-ui shows the chip on
    // the first yield and, if this throws, marks whatever it last saw as
    // failed — so work done before the first yield fails invisibly. Claiming
    // the chip up front means a refused write shows up as a broken attachment
    // rather than as a click that did nothing.
    yield {
      ...base,
      status: { type: "running", reason: "uploading", progress: 0 },
    } satisfies PendingAttachment;

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
    rememberStagedPath(id, step.value);

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
    forgetStagedPath(attachment.id);
  },
};

/* ── The context the non-chat surfaces read ─────────────────────────── */

export type SecondBrain = {
  status: StreamStatus;
  state: State;
  /** The server's own command catalogue, organized by Settings. */
  commands: Command[];
  /** Every conversation this user owns, newest first. */
  conversations: Conversation[];
  /** The one the session is currently pointing at. */
  conversationId: number | null;
  /** Point the session at another conversation and show it. */
  openConversation: (id: number) => Promise<void>;
  /** Start a fresh conversation and switch to it — or stay where you are, when
   *  the conversation on screen has never been used. */
  newConversation: () => Promise<void>;
  /** Delete one. **Unsafe** — the server raises an approval dialog, which
   *  arrives on the event stream while this is still in flight. */
  deleteConversation: (id: number) => Promise<void>;
  /**
   * Questions the kernel is blocking on, head first.
   *
   * Not part of `state`: a pending question belongs to the *session*, which
   * outlives any one conversation, and living in the conversation store is
   * what used to make a page reload throw one away.
   */
  inputRequests: InputRequest[];
  /** Answer one, by the id it was asked under. The value goes to the server;
   *  the label is the person's business.
   *
   *  **The id is passed rather than read**, because between drawing a dialog
   *  and pressing a button another question can arrive, and "the current one"
   *  is then a different question than the one on screen. */
  resolve: (id: string | null, value: unknown) => Promise<void>;
  /**
   * Back out of one without answering it.
   *
   * **Still an answer, and the conservative one.** `frontend.cancel` in the
   * approving phase pops the question's own phase frame and settles the request
   * as cancelled, which every asker reads as the safe outcome: a sandbox
   * permission gate refuses, `ui.ask` comes back a refusal, a gated command is
   * dropped without running. So this unblocks the turn rather than walking away
   * from it — the distinction the dialog's "no dismissal" rule is really about.
   */
  cancelInputRequest: (id: string | null) => Promise<void>;
  /** Send a line of text as if typed — how form steps and quick replies are
   *  answered, since both are plain submissions. */
  say: (text: string) => Promise<boolean>;
  /** Put something in the error banner. For the surfaces that are not Requests
   *  and so have nowhere else to fail — a refused microphone, say. */
  report: (error: unknown) => void;
  dismissError: () => void;
  /** Put a finished command's panel away. */
  dismissCommand: () => void;
  /** Configured LLM profiles and the global default model. */
  models: LlmProfile[];
  modelName: string | null;
  agentProfile: string;
  modelsLoading: boolean;
  modelsFailure: boolean;
  switchingModel: boolean;
  setModel: (modelName: string) => Promise<void>;

  /**
   * What the system has told you.
   *
   * **`banners` and `notifications` are two sets, not two views of one.**
   * Transient progress banners and is never stored, so it is in the first and
   * not the second; anything from before this page connected is in the second
   * and never was in the first. See `runtime/notifications.ts`.
   *
   * Here rather than in the store for the same reason `inputRequests` is: a
   * notification belongs to the session, and most of them are not about the open
   * conversation at all.
   */
  banners: Banner[];
  /** The persisted ones, newest first. Backfilled on boot, kept current by the
   *  stream. */
  notifications: Notification[];
  /** How many are still unread — what the bell's dot is drawn from. */
  unread: number;
  /** Why the panel is empty, when the reason is not "nothing happened". */
  notificationsFailure: string | null;
  /** Take one banner down. */
  dismissBanner: (key: string) => void;
  /** Settle everything held. What opening the panel does. */
  markNotificationsRead: () => Promise<void>;
  notificationsOpen: boolean;
  setNotificationsOpen: (open: boolean) => void;

  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /**
   * Open Settings, optionally at a particular section.
   *
   * For the surfaces that know *why* they are sending you there — a "Settings
   * changed" notification knows the change was configuration — as opposed to the
   * gear button, which knows nothing and lands on the default page.
   */
  openSettings: (page?: SettingsPageId) => void;
  /** The section Settings was asked to open at, until it has. **One-shot**: the
   *  dialog consumes it and clears it, so navigating away afterwards is not
   *  fought by a request that never expired. */
  settingsRequest: { page: SettingsPageId } | null;
  clearSettingsRequest: () => void;
  securityMode: "lockdown" | "ask" | "yolo";
  setSecurityMode: (mode: "lockdown" | "ask" | "yolo") => Promise<void>;
};

export type LlmProfile = {
  model_name: string;
  loaded?: boolean;
};

const SecondBrainContext = createContext<SecondBrain | null>(null);

type SessionDomain = Pick<
  SecondBrain,
  | "status"
  | "state"
  | "say"
  | "report"
  | "dismissError"
  | "dismissCommand"
>;
type ModelDomain = Pick<
  SecondBrain,
  | "models"
  | "modelName"
  | "agentProfile"
  | "modelsLoading"
  | "modelsFailure"
  | "switchingModel"
  | "setModel"
>;
type ConversationDomain = Pick<
  SecondBrain,
  | "conversations"
  | "conversationId"
  | "openConversation"
  | "newConversation"
  | "deleteConversation"
>;
type ApprovalDomain = Pick<
  SecondBrain,
  "inputRequests" | "resolve" | "cancelInputRequest"
>;
type NotificationDomain = Pick<
  SecondBrain,
  | "banners"
  | "notifications"
  | "unread"
  | "notificationsFailure"
  | "dismissBanner"
  | "markNotificationsRead"
  | "notificationsOpen"
  | "setNotificationsOpen"
>;
type SettingsDomain = Pick<
  SecondBrain,
  | "commands"
  | "settingsOpen"
  | "setSettingsOpen"
  | "openSettings"
  | "settingsRequest"
  | "clearSettingsRequest"
>;
type SecurityDomain = Pick<SecondBrain, "securityMode" | "setSecurityMode">;

const SessionContext = createContext<SessionDomain | null>(null);
const ModelContext = createContext<ModelDomain | null>(null);
const ConversationContext = createContext<ConversationDomain | null>(null);
const ApprovalContext = createContext<ApprovalDomain | null>(null);
const NotificationContext = createContext<NotificationDomain | null>(null);
const SettingsContext = createContext<SettingsDomain | null>(null);
const SecurityContext = createContext<SecurityDomain | null>(null);

function useDomain<T>(context: Context<T | null>, name: string): T {
  const value = use(context);
  if (!value) throw new Error(`${name} outside SecondBrainProvider`);
  return value;
}

export const useSession = () => useDomain(SessionContext, "useSession");
export const useModels = () => useDomain(ModelContext, "useModels");
export const useConversations = () =>
  useDomain(ConversationContext, "useConversations");
export const useApprovals = () => useDomain(ApprovalContext, "useApprovals");
export const useNotifications = () =>
  useDomain(NotificationContext, "useNotifications");
export const useSettings = () => useDomain(SettingsContext, "useSettings");
export const useSecurity = () => useDomain(SecurityContext, "useSecurity");

export function useSecondBrain(): SecondBrain {
  const value = use(SecondBrainContext);
  if (!value) throw new Error("useSecondBrain outside SecondBrainProvider");
  return value;
}

/* ── The provider ───────────────────────────────────────────────────── */

/** How often an idle page re-reads the conversation list. See the effect that
 *  uses it for why a minute is the right number and why a poll is here at all. */
const IDLE_REFRESH_MS = 60_000;

export function SecondBrainProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [inputRequests, askDispatch] = useReducer(
    reduceInputRequests,
    initialInputRequests,
  );
  const [notifications, notifyDispatch] = useReducer(
    reduceNotifications,
    initialNotifications,
  );
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRequest, setSettingsRequest] = useState<{
    page: SettingsPageId;
  } | null>(null);
  const [securityMode, setSecurityModeState] = useState<
    "lockdown" | "ask" | "yolo"
  >("ask");
  const [models, setModels] = useState<LlmProfile[]>([]);
  const [modelName, setModelName] = useState<string | null>(null);
  const [agentProfile, setAgentProfile] = useState("default");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsFailure, setModelsFailure] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);

  // `isLoading` covers the gap between "the page is up" and "scrollback is on
  // screen", so the thread does not flash an empty-conversation welcome at
  // someone who has a conversation.
  const [loading, setLoading] = useState(true);

  // Read once at boot. The catalogue only changes when a package is installed
  // or removed, which is rare enough that re-reading on every keystroke would
  // be a Request per character for no benefit.
  const [commands, setCommands] = useState<Command[]>([]);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);

  /**
   * The catalogue, readable from a callback without becoming a dependency of
   * one.
   *
   * `say` and `onNew` need it to tell a slash command from a message that
   * merely opens with a slash, but every callback the runtime adapter is built
   * from is deliberately dependency-free so the adapter keeps one identity for
   * the life of the page. A ref is how a value can be current without being a
   * reason to rebuild.
   */
  const commandsRef = useRef<Command[]>([]);
  commandsRef.current = commands;

  /**
   * Turn a thrown Request into the error banner.
   *
   * **Nothing that reaches the server may reject.** assistant-ui calls several
   * of these from an event handler, and an unhandled rejection there unmounts
   * the tree — the symptom is the whole page going white, with the actual cause
   * (a refusal, a dropped connection) never shown. A failed Request is ordinary
   * news and belongs in the banner, not in a crash.
   *
   * Declared here, above its callers, rather than beside the other actions: a
   * `useCallback` that lists it as a dependency reads it while the component
   * body is still running, so anything using it has to come after it.
   */
  const report = useCallback((error: unknown) => {
    const failed = error instanceof RequestFailed;
    // **Saying no is not an error.** A declined Request is the answer the
    // person just gave in the dialog; putting "denied: conv.delete" in a banner
    // afterwards is approval fallout escaping the popup — the one thing this
    // surface is supposed to keep contained — and it reads as a malfunction
    // rather than as their own decision being carried out.
    if (failed && error.isDeclined) return;
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
          // The banner reads this to explain a dead session rather than
          // repeating the kernel's wording at somebody who cannot act on it.
          details: failed && error.isSessionTaken ? "session_taken" : undefined,
        },
      },
    });
  }, []);

  /**
   * The two lists the chrome is built from.
   *
   * Together because they fail together: both are ordinary Requests, so a
   * session the server will not act on takes out both at once — which is what
   * makes empty Settings a *symptom* rather than a bug in that surface.
   * Fetching them in one place means one retry brings back both.
   */
  const loadCatalogue = useCallback(async () => {
    try {
      setCommands(await listCommands());
      setConversations(await listConversations());
    } catch (error) {
      // Reported rather than thrown: a chat window with no sidebar is still a
      // chat window, and the banner says why it is empty.
      report(error);
    }
  }, [report]);

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
    const close = connect((frame) => {
      // **Fanned out here, not inside the reducer.** A question the kernel is
      // blocking on belongs to the session; routing it through the
      // conversation store is what let a history read discard one. Keeping the
      // split at the doorway means nothing downstream has to remember it.
      if (frame.kind === "approval") {
        askDispatch({ type: "raised", request: frame.payload });
        return;
      }
      if (frame.kind === "approval_settled") {
        askDispatch({ type: "settled", id: frame.payload.request_id });
        return;
      }
      // Same shape of decision, same reason. A notification is the system
      // speaking, not the agent, and usually not about the conversation on
      // screen at all — so it must not reach the store, whose next history read
      // would drop it.
      if (frame.kind === "notification") {
        notifyDispatch({
          type: "raised",
          notification: frame.payload,
          // Generated here rather than in the reducer so the reducer stays a
          // pure function of its arguments. A transient notification has no
          // `notification_id` to key a list on; this is what it gets instead.
          key: crypto.randomUUID(),
        });
        return;
      }
      dispatch({ type: "frame", frame });
    }, setStatus);

    // `cancelled` guards the async boot below: React can unmount between the
    // await and the dispatch, and a dispatch after unmount is a wasted render
    // at best and a stale conversation at worst.
    let cancelled = false;

    void (async () => {
      try {
        const session = await sdk<{
          conversation_id?: number | null;
          mode?: "lockdown" | "ask" | "yolo" | null;
          busy?: boolean | null;
        } | null>(
          "session.get",
          { details: true },
        );
        if (!cancelled) setSecurityModeState(session?.mode ?? "ask");

        // A session is made lazily and holds no conversation until something
        // binds one, and **a session with no conversation cannot be talked
        // to** — every submit comes back "No conversation loaded. Try /new."
        // So booting into one is not a convenience, it is what makes the
        // composer work at all.
        //
        // Creating rather than loading, because there is nothing to load into
        // yet — and creating is also the one path that has never been able to
        // take the session away from us, since a new conversation has no prior
        // owner to be restored from.
        //
        // **No title**, here and everywhere else this app creates one. See
        // `PLACEHOLDER_TITLE` in `lib/conversations.ts`: a title of ours is one
        // the store's sweep will not replace.
        let bound = session?.conversation_id ?? null;
        if (bound === null) {
          const created = await sdk<{ id: number }>("conv.create", {
            activate: true,
          });
          bound = created?.id ?? null;
        }

        if (bound !== null) {
          const turns = await readConversation(bound);
          if (!cancelled) {
            dispatch({ type: "history", turns });
            setConversationId(bound);
          }
        }

        // **The turn a reload landed in the middle of.**
        //
        // `typing` only ever moves on a `typing` frame, and the one that opened
        // the running turn was sent before this page existed — so a reload
        // mid-turn came up believing the agent was idle. That is not a cosmetic
        // wrong indicator: `isRunning` is what puts Stop in the composer, so the
        // one control that ends a turn disappeared exactly when it was wanted,
        // and reloading became a way to lose the ability to interrupt.
        //
        // The server has always answered this — `session.get` returns `busy`,
        // read here off the response boot already makes. **After the history
        // dispatch**, which resets everything transient and would otherwise wipe
        // it; and dispatched as the frame it stands in for, so the store opens a
        // turn for whatever arrives next exactly as the real frame would have.
        if (!cancelled && session?.busy) {
          dispatch({ type: "frame", frame: { kind: "typing", payload: true } });
        }

        // After the conversation, not before: neither Settings nor the sidebar
        // is useful until there is somewhere to run a command, and scrollback
        // is what the person is actually waiting to see.
        if (!cancelled) await loadCatalogue();

        // Pending questions are reconciled by the effect below, which runs on
        // every stream open rather than once here — see `reconcile`.
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

  /**
   * Come back to life when the connection does.
   *
   * `EventSource` reconnects on its own, so a server restart is invisible to
   * the transport — but everything fetched over `/sdk` was read once at boot
   * and is now stale or, if the boot failed, still empty. Re-reading on the
   * *transition* back to open is what turns "restart Second Brain" into a fix
   * the person sees, rather than one that also requires reloading the page.
   *
   * The ref skips the first open, which boot has already covered.
   */
  const openedBefore = useRef(false);
  useEffect(() => {
    if (status !== "open") return;
    if (!openedBefore.current) {
      openedBefore.current = true;
      return;
    }
    void loadCatalogue();
  }, [status, loadCatalogue]);

  /* ── Questions the kernel is blocking on ────────────────────────── */

  /**
   * Ask the server what it is still waiting for.
   *
   * **This covers the gap a stream cannot: what happened while nobody was
   * connected.** A render is an event, and events are not re-sent because you
   * asked, so a question raised before this page existed — or settled while it
   * was away — has no frame coming. `details` makes the server hand back the
   * question itself rather than its id, which is the difference between the
   * real dialog and a stand-in that can only say "something was asked".
   *
   * Once the stream is up, `approval` and `approval_settled` say the rest, so
   * this runs on connect and not on a timer. It used to poll every minute,
   * which was this client working around a protocol that could announce a
   * question and not its end.
   */
  const reconcile = useCallback(async () => {
    try {
      const pending = await sdk<unknown>("frontend.pending", { details: true });
      if (pending === null || pending === undefined) {
        askDispatch({ type: "reconciled", pending: null });
        return;
      }
      if (isPendingInput(pending)) {
        askDispatch({ type: "reconciled", pending });
        return;
      }
      // A kernel older than `details` answers the bare id, or `true` for "one
      // exists but I cannot name it". Neither describes the question, so all
      // that can be drawn is a stand-in — and `true` must never be used as an
      // id, which the server would stringify into one that matches nothing and
      // then report as already answered.
      askDispatch({
        type: "reconciled",
        pending: {
          kind: "approval",
          payload: unseenRequest(
            typeof pending === "string" && pending ? pending : null,
          ),
        },
      });
    } catch (error) {
      // Reported rather than thrown: this runs from an effect and on a timer,
      // and a failed poll is not worth tearing anything down over.
      report(error);
    }
  }, [report]);

  /** On **every** open, not just reconnections — unlike `loadCatalogue` above,
   *  whose first run boot covers. Boot cannot cover this one: the answer to
   *  "what is pending" is only meaningful once the stream is up, because the
   *  stream is what declares somebody is watching. */
  useEffect(() => {
    if (status !== "open") return;
    void reconcile();
  }, [status, reconcile]);

  const waiting = inputRequests.queue.length > 0;

  /* ── Notifications ──────────────────────────────────────────────── */

  /**
   * Fill the panel from the table.
   *
   * **The stream only ever answers "what happened since you connected."** For a
   * client that was closed while a scheduled agent ran, that is none of it — so
   * the panel needs a read, not just a subscription. Exactly the division
   * `FileActivityProvider` draws for the ledger: renders are events, the table
   * is state.
   *
   * `since_id` on the later calls is an index seek rather than a scan, and the
   * reducer merges by id — so a notification that arrived as a frame *and* comes
   * back in the read lands once.
   */
  const notificationsCursor = useRef(0);
  const backfillNotifications = useCallback(async (since: number) => {
    try {
      const rows = await listNotifications(
        since > 0 ? { since_id: since } : { limit: 50 },
      );
      notifyDispatch({ type: "backfilled", rows });
    } catch {
      // Said in the panel rather than the error banner, for the reason
      // `FileActivityProvider` gives about `ledger.read`: a kernel without the
      // Request would otherwise raise a banner on every boot, about a surface
      // that may never be opened. The banners still work either way — they come
      // off the stream and owe this call nothing.
      notifyDispatch({
        type: "failed",
        message: "Second Brain would not hand back your notifications.",
      });
    }
  }, []);

  /**
   * On **every** open, like `reconcile` and unlike `loadCatalogue`.
   *
   * `EventSource` replays from `Last-Event-ID` and the buffer holds 500 frames
   * per session, so a short drop is covered for free — but a long one loses the
   * middle, and the middle is where the notification you actually wanted is. The
   * cursor makes the repeat calls cheap enough that covering the long case
   * costs nothing in the common one.
   */
  useEffect(() => {
    if (status !== "open") return;
    void backfillNotifications(notificationsCursor.current);
  }, [status, backfillNotifications]);

  // Kept in a ref rather than read from state inside the effect, so topping up
  // does not re-run every time a notification arrives.
  notificationsCursor.current = highestId(notifications);

  /**
   * Settle everything held — what opening the panel does.
   *
   * `before_id` rather than a list of ids: the handler filters `id <= ?`, so the
   * highest id held settles the rows behind it too, including any this client
   * never loaded. Guarded on there being one, because `mark_read` with neither
   * argument is a `400` rather than a no-op.
   *
   * Dispatched before the await, not after. The count is what the bell's dot is
   * drawn from, and a dot that lingers for a round trip after you have opened
   * the panel reads as a failure to notice you.
   */
  const markNotificationsRead = useCallback(async () => {
    const before = highestId(notifications);
    if (before === 0 || unreadCount(notifications) === 0) return;
    notifyDispatch({ type: "read", before });
    try {
      await markRead({ before_id: before });
    } catch {
      // Left as read locally. The next backfill carries the server's own
      // `read_at`, so this corrects itself rather than needing to be undone —
      // and a badge that reappeared under someone who had just cleared it would
      // be worse than one that is briefly optimistic.
    }
  }, [notifications]);

  const dismissBanner = useCallback((key: string) => {
    notifyDispatch({ type: "dismissed", key });
  }, []);

  /**
   * Open Settings, optionally at a section.
   *
   * A fresh object per call rather than a bare page id, so clicking the same
   * link twice is two requests. With the id alone, asking for `config` while
   * already showing `config` — having navigated away in between — would be a
   * state that never changed and therefore an effect that never fired.
   */
  const openSettings = useCallback((page?: SettingsPageId) => {
    if (page) setSettingsRequest({ page });
    setSettingsOpen(true);
  }, []);

  const clearSettingsRequest = useCallback(() => setSettingsRequest(null), []);

  /* ── What the person can do ─────────────────────────────────────── */

  const say = useCallback(
    async (text: string) => {
      dispatch({
        type: "said",
        text,
        isCommand: looksLikeCommand(text, commandsRef.current),
      });
      try {
        await sdk("frontend.submit", { input_kind: "text", text });
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    },
    [report],
  );

  const resolve = useCallback(
    async (id: string | null, value: unknown) => {
      // Closed before the answer lands, deliberately: the POST completes only
      // once the *original* blocked Request finishes, which can be a while, and
      // leaving the dialog up in the meantime invites a second click.
      askDispatch({ type: "answered", id });
      try {
        // **Only a real id travels.** With none, the server answers whatever is
        // next in its own queue, which is exactly what a question we could not
        // name means. Sending a placeholder instead gets it stringified into an
        // id that matches nothing, and the answer comes back "already
        // answered" while the turn stays blocked.
        await sdk("frontend.resolve", id ? { value, request_id: id } : { value });
        // A `false` answer means there was nothing left to answer — already
        // resolved elsewhere, or timed out after 300s. That is a stale dialog,
        // not an error, and closing it is the whole response.
      } catch (error) {
        report(error);
      }
    },
    [report],
  );

  const cancelInputRequest = useCallback(
    async (id: string | null) => {
      // Closed first, for the same reason `resolve` closes first: cancelling
      // drives the state machine, and the POST does not come back until it has.
      askDispatch({ type: "answered", id });
      // The disappearing dialog is the acknowledgement. The kernel also emits
      // a literal "Cancelled." message; mark that one protocol echo so it does
      // not become an assistant line in the conversation.
      dispatch({ type: "suppressNextCancellationNotice" });
      try {
        // **Not `resolve` with a falsy value.** That would be answering "no" to
        // a yes/no question and nonsense to a free-text one; a sandbox gate
        // typed `string` would reject `false` against its enum outright and
        // leave the frame standing. Cancelling is its own action, and the only
        // one that means "back out" regardless of what was asked.
        //
        // It names no request: the kernel cancels the frame on top of the
        // stack, which is the one being shown. If a second question arrived in
        // between, reconciliation is what corrects the drift.
        await sdk("frontend.cancel", {});
      } catch (error) {
        report(error);
      }
    },
    [report],
  );

  const dismissError = useCallback(() => dispatch({ type: "clearError" }), []);
  const dismissCommand = useCallback(
    () => dispatch({ type: "clearCommand" }),
    [],
  );

  /**
   * Whether the agent has the turn, readable without becoming a dependency.
   *
   * `syncSession` below only dispatches when the server disagrees with what is
   * on screen, and a `useCallback` that listed `state.typing` would be rebuilt
   * on every turn — taking the effects that depend on it with it, which for the
   * stream-open effect means re-asking on every frame.
   */
  const typingRef = useRef(false);
  typingRef.current = state.typing;

  /**
   * Re-read what the session itself says, for the two fields a client cannot
   * work out on its own.
   *
   * Both are ephemeral kernel state that no frame will re-announce: the
   * per-conversation security mode is cleared by a backend restart, and `busy`
   * is the answer to "does the agent have the turn *right now*", which the
   * stream only ever states at the moment it changes. One `session.get` answers
   * both, so this is one Request rather than two.
   *
   * The `typing` dispatch is guarded on disagreement rather than sent every
   * time: it is idempotent (a second `typing: true` reuses the open turn) but it
   * rebuilds the turn array, and this runs on every reconnect.
   */
  const syncSession = useCallback(async () => {
    setModelsLoading(true);
    const [sessionResult, modelsResult, defaultModelResult] = await Promise.allSettled([
      sdk<{
        mode?: "lockdown" | "ask" | "yolo" | null;
        busy?: boolean | null;
        agent_profile?: string | null;
      } | null>("session.get", { details: true }),
      sdk<{ profiles?: LlmProfile[] } | null>("llm.list"),
      sdk<string | null>("config.read", { key: "default_llm_profile" }),
    ]);

    if (sessionResult.status === "fulfilled") {
      const session = sessionResult.value;
      setSecurityModeState(session?.mode ?? "ask");
      setAgentProfile(session?.agent_profile || "default");
      const busy = Boolean(session?.busy);
      if (busy !== typingRef.current) {
        dispatch({ type: "frame", frame: { kind: "typing", payload: busy } });
      }
    } else {
      report(sessionResult.reason);
    }

    if (modelsResult.status === "fulfilled") {
      setModels(modelsResult.value?.profiles ?? []);
      setModelsFailure(false);
    } else {
      setModelsFailure(true);
      report(modelsResult.reason);
    }

    if (defaultModelResult.status === "fulfilled") {
      setModelName(defaultModelResult.value || null);
    } else {
      setModelsFailure(true);
      report(defaultModelResult.reason);
    }
    setModelsLoading(false);
  }, [report]);

  // On every stream open. A backend restart clears the mode, and a drop long
  // enough to outrun the replay buffer loses whichever `typing` frame moved the
  // turn — either way the composer would go on showing the pre-drop state, and
  // for `busy` that means offering Send where Stop belongs.
  useEffect(() => {
    if (status === "open") void syncSession();
  }, [status, syncSession]);

  /** Set the per-conversation mode from the dedicated composer control.
   * The kernel treats an attended switch to Ask as Lockdown's narrow escape
   * hatch; YOLO remains unsafe and therefore raises the normal approval. */
  const setSecurityMode = useCallback(
    async (mode: "lockdown" | "ask" | "yolo") => {
      try {
        const selected = await sdk<"lockdown" | "ask" | "yolo">(
          "session.set_mode",
          {
            mode,
            scope: "conversation",
          },
        );
        setSecurityModeState(selected ?? mode);
      } catch (error) {
        report(error);
      }
    },
    [report],
  );

  useEffect(() => {
    if (!state.command?.name) return;
    if (!["mode", "llm", "agent"].includes(state.command.name)) return;
    if (state.command.status !== "finished") return;
    void syncSession();
  }, [state.command?.name, state.command?.status, syncSession]);

  const modelNameRef = useRef<string | null>(null);
  modelNameRef.current = modelName;
  const switchingModelRef = useRef(false);

  /** Change the same global default setting as `/llm`'s Set default action.
   * Optimistic UI keeps the compact control responsive; a failed Request
   * restores the kernel-confirmed value. */
  const setModel = useCallback(
    async (nextModel: string) => {
      if (switchingModelRef.current || nextModel === modelNameRef.current) return;
      const previous = modelNameRef.current;
      switchingModelRef.current = true;
      setSwitchingModel(true);
      setModelName(nextModel);
      try {
        await sdk<boolean>("config.write", {
          key: "default_llm_profile",
          value: nextModel,
          scope: "plugin",
        });
      } catch (error) {
        setModelName(previous);
        await syncSession();
        report(error);
      } finally {
        switchingModelRef.current = false;
        setSwitchingModel(false);
      }
    },
    [report, syncSession],
  );

  /* ── Conversations ──────────────────────────────────────────────── */

  /**
   * Whether the conversation on screen has never been used.
   *
   * Both halves are asked, and they answer different questions. The stored row
   * is the server's fact and is the one that matters; the transcript is the
   * guard against acting on a stale copy of it, since the list is re-read on
   * occasions rather than continuously and a conversation can have earned rows
   * since. Being wrong in the direction of "used" costs one conversation nobody
   * wanted; being wrong the other way silently reuses somebody's conversation.
   *
   * A ref rather than a dependency, for the reason `commandsRef` is one:
   * `newConversation` is handed out through the context and listed as a
   * dependency by `deleteConversation`, and this changes on every frame of
   * every turn.
   */
  const openIsUnused = useRef(false);
  openIsUnused.current =
    state.turns.length === 0 &&
    isUnused(
      conversations.find((conversation) => conversation.id === conversationId),
    );

  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await listConversations());
    } catch (error) {
      report(error);
    }
  }, [report]);

  /**
   * Re-read the list when the agent hands the turn back.
   *
   * The sidebar was only ever refreshed by opening, creating or deleting a
   * conversation — so a list read at boot stayed frozen for the rest of the
   * session: the conversation you were actively talking in never moved to the
   * top, `updated_ago` still claimed "15 seconds ago" an hour later, and a
   * title the kernel assigned after the first exchange never arrived. Once per
   * completed turn is the right cadence: it is when any of that can have
   * changed, and it is far rarer than a frame.
   */
  const wasTyping = useRef(false);
  useEffect(() => {
    if (state.typing) {
      wasTyping.current = true;
      return;
    }
    if (!wasTyping.current) return;
    wasTyping.current = false;
    void refreshConversations();
  }, [state.typing, refreshConversations]);

  /**
   * Ask again while nothing is happening.
   *
   * The refresh above covers everything that changes *because of something
   * done here*. Two things change without that: the store's title sweep runs
   * on its own schedule and renames a conversation minutes after the exchange
   * that earned the name, and `updated_ago` is the server's wording computed
   * when the list was read — so an untouched sidebar goes on claiming "2
   * minutes ago" an hour later. Both are only visible by asking again.
   *
   * A minute, because that is the resolution of the thing being shown: the
   * server's own wording is in minutes once anything is a minute old, so
   * asking more often would re-read the list to render the same sentence.
   *
   * **This is a poll standing in for an event**, and the event exists — the
   * kernel has a `conversation_changed` channel and the sweep emits `retitled`
   * on it — but nothing carries a bus event to a browser: `/events` carries
   * the ten render kinds and the HTTP frontend does not subscribe to anything.
   * Closing that gap is a kernel change (`sandbox/residency.py` wires bus
   * subscriptions for services and not for frontends), and this is what the
   * sidebar needs until it happens.
   *
   * Nothing is asked while a turn is running — the end of it refreshes anyway —
   * and nothing while the tab is hidden, since the answer is only worth having
   * when somebody is looking at it. Coming back to the tab is exactly such a
   * moment, so that asks straight away rather than waiting out the interval.
   */
  useEffect(() => {
    if (status !== "open" || state.typing) return;
    const refreshIfWatched = () => {
      if (!document.hidden) void refreshConversations();
    };
    const timer = window.setInterval(refreshIfWatched, IDLE_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfWatched);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfWatched);
    };
  }, [status, state.typing, refreshConversations]);

  /**
   * Point the session at another conversation.
   *
   * Not a view change — `conv.load` re-points the *session*, so after this the
   * agent is talking about something else. The scrollback is re-read rather
   * than taken from `conv.load`'s own `history`, because `conv.read` hands back
   * whole rows and `history.ts` knows which of those are the kernel's own
   * bookkeeping and must never reach the screen.
   *
   * Requires the kernel fix that keeps a session's frontend across a load
   * (`runtime/persistence.py`). Without it, one switch hands `http:<thread>` to
   * whichever frontend last had that conversation open and every later Request
   * is refused as somebody else's.
   */
  const openConversation = useCallback(
    async (id: number) => {
      try {
        const result = await sdk<LoadResult>("conv.load", { id });
        if (!result?.ok) {
          // "No such conversation." is also what a conversation this user does
          // not own looks like — the server declines to distinguish them, and
          // repeating its wording is more honest than inventing a reason.
          report(new Error(result?.messages?.[0] ?? "Could not open it."));
          return;
        }
        dispatch({ type: "history", turns: await readConversation(id) });
        setConversationId(id);
        await syncSession();
        await refreshConversations();
      } catch (error) {
        report(error);
      }
    },
    [report, refreshConversations, syncSession],
  );

  /** Make a conversation and point the session at it. Unconditional — the
   *  reuse decision belongs to `newConversation`, and the one caller that must
   *  not reuse (deleting the open conversation) needs this directly. */
  const createConversation = useCallback(async () => {
    try {
      const created = await sdk<{ id: number }>("conv.create", {
        activate: true,
      });
      // `activate: true` binds it to this session, so there is nothing to load
      // afterwards — and an empty conversation has no scrollback to read.
      dispatch({ type: "history", turns: [] });
      setConversationId(created?.id ?? null);
      await syncSession();
      await refreshConversations();
    } catch (error) {
      report(error);
    }
  }, [report, refreshConversations, syncSession]);

  const newConversation = useCallback(async () => {
    // **Pressing New chat in a conversation nobody has used is a no-op.** The
    // session is already pointing at an empty conversation; making a second
    // one is what left tens of untouched rows in the sidebar, one per press.
    //
    // This is the shallow half of what other chat apps do by not creating a
    // conversation until the first message is sent. It stops the accumulation
    // without the part that costs something: the session stays bound to a real
    // conversation throughout, so commands, attendance and pushed messages
    // carry on working exactly as they do now.
    if (openIsUnused.current) {
      // Not a `setState` no-op: `history` also clears a half-answered form and
      // a finished command's panel, which is what "start over" means here.
      dispatch({ type: "history", turns: [] });
      return;
    }
    await createConversation();
  }, [createConversation]);

  /**
   * Delete a conversation.
   *
   * **Unsafe, and therefore not a plain call.** The server raises a real
   * approval, which arrives on the event stream while this POST is still open;
   * the modal answers it and only then does this finish. So it may sit here for
   * as long as a person takes, which is the design rather than a hang.
   */
  const deleteConversation = useCallback(
    async (id: number) => {
      try {
        await sdk("conv.delete", { id });
        await refreshConversations();
        // Deleting the one being read leaves the session pointing at nothing,
        // which is the state where every submit answers "No conversation
        // loaded" — so land somewhere real rather than leaving that to be
        // discovered by typing.
        //
        // **`createConversation`, not `newConversation`.** The one just deleted
        // was very possibly unused, and reuse reads a ref that React has had no
        // chance to recompute between the refresh above and this line — so the
        // reuse path would keep the session pointed at a conversation that no
        // longer exists, which is precisely the state this call exists to
        // avoid. There is nothing here to reuse either way.
        if (id === conversationId) await createConversation();
      } catch (error) {
        report(error);
      }
    },
    [conversationId, createConversation, refreshConversations, report],
  );

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
          path: stagedPath(attachment.id),
          name: attachment.name,
        }))
        .filter((file): file is { path: string; name: string } =>
          Boolean(file.path),
        );

      dispatch({
        type: "said",
        text,
        files: files.map((file) => file.name),
        // A message carrying files is a message, whatever it starts with —
        // there is no such thing as a slash command with an attachment.
        isCommand:
          files.length === 0 && looksLikeCommand(text, commandsRef.current),
      });

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
              // What decides the file's modality, and whether the current model
              // accepts it at all — see `extensionOf`.
              extension: extensionOf(file.name),
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

  /**
   * Sending while the agent still has the turn.
   *
   * **The queue is the kernel's, and this adapter holds none of it.** A message
   * submitted mid-turn is queued server-side and drained at the next loop
   * boundary, with a notification saying so — so there is nothing for a client
   * to hold, dispatch, reorder or edit, and `items`/`steerItems` are empty
   * forever. Everything here is `onNew` under two other names.
   *
   * It is declared anyway because assistant-ui gates the *keyboard* on it:
   * `ComposerPrimitive.Input` swallows Enter outright while `isRunning` unless
   * `thread.capabilities.queue` says the runtime can take a message now
   * (`primitives/composer/ComposerInput`). Clicking Send was never gated —
   * `composer.send` checks only `isEditing`, emptiness and `isSendDisabled` —
   * so without this the button and the Enter key would disagree, which is the
   * worst of the three possible states.
   *
   * `steer` and `enqueue` are the same call because we have one lane. The
   * composer picks `steer` while a run is live and `enqueue` otherwise, and the
   * distinction assistant-ui draws — steering *interrupts*, queueing waits — is
   * not one the kernel offers: a queued message never cancels the turn it
   * arrived during. `move` and `edit` are no-ops for the same reason, and
   * nothing can call them, since the lanes they reorder are always empty.
   */
  const queue = useMemo(
    () => ({
      items: NO_QUEUED_MESSAGES,
      steerItems: NO_QUEUED_MESSAGES,
      enqueue: onNew,
      steer: onNew,
      move: () => {},
      edit: () => {},
      remove: () => {},
    }),
    [onNew],
  );

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

    // A pending question blocks the turn on the server side — and worse, the
    // state machine coerces plain text in that phase into the *answer*, so a
    // message typed now would be eaten by the dialog rather than reaching the
    // agent. Blocking the composer makes that visible instead of surprising.
    isSendDisabled: waiting,

    onNew,
    // Every send actually travels through here — `onNew` is unused once a queue
    // adapter is present, and both of its lanes are `onNew` itself. It stays
    // declared because the adapter type requires it and because it is the
    // honest statement of what a send does.
    queue,
    onCancel,
    onRefetchThread,

    // Quick replies from a store plugin. `buttons` carries {value, label} and
    // the value is submitted as text, same as a form choice.
    // `label` is the field assistant-ui exposes as `SuggestionState.label` and
    // therefore the one a chip can render; `text` — what this used to emit —
    // is not part of that shape and arrived as `undefined` on the other side.
    // `prompt` is what gets submitted, which is the wire's `value`.
    suggestions: useMemo(
      () =>
        state.buttons.map((button) => ({
          prompt: String(button.value),
          label: button.label ?? String(button.value),
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
    () => ({
      status,
      state,
      commands,
      conversations,
      conversationId,
      openConversation,
      newConversation,
      deleteConversation,
      inputRequests: inputRequests.queue,
      resolve,
      cancelInputRequest,
      say,
      report,
      dismissError,
      dismissCommand,
      models,
      modelName,
      agentProfile,
      modelsLoading,
      modelsFailure,
      switchingModel,
      setModel,
      banners: notifications.banners,
      notifications: notifications.rows,
      unread: unreadCount(notifications),
      notificationsFailure: notifications.failure,
      dismissBanner,
      markNotificationsRead,
      notificationsOpen,
      setNotificationsOpen,
      settingsOpen,
      setSettingsOpen,
      openSettings,
      settingsRequest,
      clearSettingsRequest,
      securityMode,
      setSecurityMode,
    }),
    [
      status,
      state,
      commands,
      conversations,
      conversationId,
      openConversation,
      newConversation,
      deleteConversation,
      inputRequests.queue,
      resolve,
      cancelInputRequest,
      say,
      report,
      dismissError,
      dismissCommand,
      models,
      modelName,
      agentProfile,
      modelsLoading,
      modelsFailure,
      switchingModel,
      setModel,
      notifications,
      dismissBanner,
      markNotificationsRead,
      notificationsOpen,
      settingsOpen,
      openSettings,
      settingsRequest,
      clearSettingsRequest,
      securityMode,
      setSecurityMode,
    ],
  );

  const sessionValue = useMemo<SessionDomain>(
    () => ({ status, state, say, report, dismissError, dismissCommand }),
    [status, state, say, report, dismissError, dismissCommand],
  );
  const modelValue = useMemo<ModelDomain>(
    () => ({
      models,
      modelName,
      agentProfile,
      modelsLoading,
      modelsFailure,
      switchingModel,
      setModel,
    }),
    [
      models,
      modelName,
      agentProfile,
      modelsLoading,
      modelsFailure,
      switchingModel,
      setModel,
    ],
  );
  const conversationValue = useMemo<ConversationDomain>(
    () => ({
      conversations,
      conversationId,
      openConversation,
      newConversation,
      deleteConversation,
    }),
    [
      conversations,
      conversationId,
      openConversation,
      newConversation,
      deleteConversation,
    ],
  );
  const approvalValue = useMemo<ApprovalDomain>(
    () => ({
      inputRequests: inputRequests.queue,
      resolve,
      cancelInputRequest,
    }),
    [inputRequests.queue, resolve, cancelInputRequest],
  );
  const notificationValue = useMemo<NotificationDomain>(
    () => ({
      banners: notifications.banners,
      notifications: notifications.rows,
      unread: unreadCount(notifications),
      notificationsFailure: notifications.failure,
      dismissBanner,
      markNotificationsRead,
      notificationsOpen,
      setNotificationsOpen,
    }),
    [
      notifications,
      dismissBanner,
      markNotificationsRead,
      notificationsOpen,
    ],
  );
  const settingsValue = useMemo<SettingsDomain>(
    () => ({
      commands,
      settingsOpen,
      setSettingsOpen,
      openSettings,
      settingsRequest,
      clearSettingsRequest,
    }),
    [
      commands,
      settingsOpen,
      openSettings,
      settingsRequest,
      clearSettingsRequest,
    ],
  );
  const securityValue = useMemo<SecurityDomain>(
    () => ({ securityMode, setSecurityMode }),
    [securityMode, setSecurityMode],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SecondBrainContext value={value}>
        <SessionContext value={sessionValue}>
          <ModelContext value={modelValue}>
            <ConversationContext value={conversationValue}>
            <ApprovalContext value={approvalValue}>
              <NotificationContext value={notificationValue}>
                <SettingsContext value={settingsValue}>
                  <SecurityContext value={securityValue}>
                    {children}
                  </SecurityContext>
                </SettingsContext>
              </NotificationContext>
            </ApprovalContext>
            </ConversationContext>
          </ModelContext>
        </SessionContext>
      </SecondBrainContext>
    </AssistantRuntimeProvider>
  );
}

/** Re-exported so callers can tell a refusal from a broken call without
 *  reaching past this module into the transport. */
export { RequestFailed };
