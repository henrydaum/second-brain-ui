/**
 * Second Brain's read API — the plain REST that sits beside AG-UI.
 *
 * AG-UI describes a conversation and nothing else, so everything a real client
 * needs *around* the chat (which conversations exist, what the session is doing)
 * arrives here instead. Keep this file to reads and the three thread-binding
 * writes; anything that mutates the system proper goes through the chat as a
 * slash command, which is what earns the server's approval gates.
 */

const BASE = import.meta.env.VITE_AGUI_URL;
const TOKEN = import.meta.env.VITE_AGUI_TOKEN;

/** Every request carries the bearer token — it is the whole perimeter. */
function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const reply = await fetch(`${BASE}${path}`, { ...init, headers: headers() });
  if (!reply.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${reply.status}`);
  }
  return (await reply.json()) as T;
}

// ── Shapes ─────────────────────────────────────────────────────────────────
// Only the fields we actually use. The server sends more; naming everything
// would be a second copy of its schema to keep in sync.

export type Conversation = {
  id: number;
  title: string;
  category: string | null;
  updated_at: number;
  updated_ago: string;
};

export type StoredMessage = {
  id: number;
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_name: string | null;
};

export type Session = {
  key: string;
  conversation_id: number | null;
  phase: string;
  busy: boolean;
  mode: string;
} | null;

/** An interrupt as the server describes it — identical to the streamed shape. */
export type PendingInterrupt = {
  id: string;
  reason: string;
  message?: string;
  responseSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

// ── The thread handle ──────────────────────────────────────────────────────

/**
 * One AG-UI thread per conversation, which is what makes conversations
 * independent rather than one shared session being re-pointed.
 * `frontend_agui.session_key` keys a session on `threadId` and says so
 * outright: "a client with two threads open gets two sessions, which is what
 * makes their conversations independent."
 *
 * **The thread cannot be derived from the id, and that is forced on us.** A new
 * conversation has to be created *on a thread* (`POST /conversations?thread=X`
 * submits `/new` into X's session), so the thread exists before the id does.
 * Re-pointing it afterwards to a tidier name would mean using the load route,
 * which does not currently bind — so the thread a conversation was born on is
 * the thread it keeps.
 *
 * Remembered in localStorage because the mapping is not recoverable from
 * anything the server exposes. `conv-<id>` is the fallback for conversations
 * this browser never created, which is also the only case that needs the load
 * route at all.
 */
const THREAD_MAP_KEY = "second-brain-ui.threads";

function threadMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(THREAD_MAP_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function threadFor(conversationId: number): string {
  return threadMap()[String(conversationId)] ?? `conv-${conversationId}`;
}

export function rememberThread(conversationId: number, thread: string): void {
  const map = threadMap();
  map[String(conversationId)] = thread;
  localStorage.setItem(THREAD_MAP_KEY, JSON.stringify(map));
}

/** A thread name for a conversation that does not exist yet. */
export function mintThread(): string {
  return `t-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Conversations this browser started, newest first.
 *
 * These are the ones that can be opened without the load route, because their
 * session was bound when they were created. Used at boot to pick something
 * that will actually open rather than the globally most recent conversation,
 * which may well be somebody else's — or a leftover from a script.
 */
export function rememberedIds(): number[] {
  return Object.keys(threadMap())
    .map(Number)
    .filter((id) => Number.isFinite(id))
    .sort((a, b) => b - a);
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function listConversations(): Promise<Conversation[]> {
  // Doubly wrapped: {conversations: {items: [...]}}.
  const body = await request<{ conversations: { items?: Conversation[] } }>(
    "/conversations",
  );
  const items = body.conversations?.items ?? [];
  return [...items].sort((a, b) => b.updated_at - a.updated_at);
}

export async function readConversation(id: number): Promise<StoredMessage[]> {
  // Doubly nested again, and differently: {conversation: {conversation, messages}}.
  const body = await request<{
    conversation: { messages?: StoredMessage[] };
  }>(`/conversations/${id}`);
  return body.conversation?.messages ?? [];
}

export async function readSession(
  thread: string,
): Promise<{ session: Session; pending: PendingInterrupt[] }> {
  const body = await request<{
    session: Session;
    pending?: PendingInterrupt[];
  }>(`/session?thread=${encodeURIComponent(thread)}`);
  return { session: body.session ?? null, pending: body.pending ?? [] };
}

// ── The three thread-binding writes ────────────────────────────────────────
// Both answer 202, not 200. The server implements them by *submitting a slash
// command* into the named session rather than calling conv.create/conv.load —
// those act on `ctx.session_key`, which is empty for a frontend box, so they
// would quietly bind nothing. The consequence for us: the effect lands as a
// turn on that thread, not in the response body, so "202" means started and we
// have to go and look.

export async function startConversation(thread: string): Promise<void> {
  await request(`/conversations?thread=${encodeURIComponent(thread)}`, {
    method: "POST",
    body: "{}",
  });
}

export async function loadConversation(
  id: number,
  thread: string,
): Promise<void> {
  await request(
    `/conversations/${id}/load?thread=${encodeURIComponent(thread)}`,
    { method: "POST", body: "{}" },
  );
}

/**
 * Answer an interrupt the runtime never saw, by POSTing the resume ourselves.
 *
 * Only used for interrupts recovered from `/session`'s `pending` after a
 * reload. The live path goes through `useAgUiSubmitInterruptResponses`, which
 * is better because the unblocked turn renders straight into the open stream —
 * but the runtime can only resume interrupts it is holding, and a reloaded page
 * is holding none. The server still is: `_resume` looks the id up in its own
 * `_pending_interrupts`, which survived the reload.
 *
 * The stream is drained and discarded. The turn's output is not lost — it goes
 * into the conversation's history server-side, which is what we re-read
 * afterwards.
 */
export async function resumeDirect(
  thread: string,
  entries: { interruptId: string; status: string; payload?: unknown }[],
): Promise<void> {
  const reply = await fetch(`${BASE}/agui`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      threadId: thread,
      runId: `resume-${Date.now()}`,
      messages: [],
      resume: entries,
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    }),
  });
  // Read to completion so the server sees a well-behaved client and closes its
  // side, rather than the stream being abandoned mid-turn.
  await reply.text();
}

/**
 * Wait until a thread's session actually points at the conversation.
 *
 * Necessary because the bind is asynchronous — see above. Without it we would
 * mount the chat against a session that has not been pointed anywhere yet, and
 * the first message would land in the wrong place or be refused outright.
 * Returns the id it settled on, or null if it never arrived.
 */
export async function awaitBinding(
  thread: string,
  expected?: number,
  attempts = 25,
): Promise<number | null> {
  for (let i = 0; i < attempts; i++) {
    const { session } = await readSession(thread);
    const id = session?.conversation_id ?? null;
    if (id !== null && (expected === undefined || id === expected)) return id;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}
