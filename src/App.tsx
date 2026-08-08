import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HttpAgent } from "@ag-ui/client";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import type { AgUiInterrupt } from "@assistant-ui/react-ag-ui";

import { Thread } from "@/components/thread";
import { ConversationSidebar } from "@/components/conversation-sidebar";
import { SessionBar } from "@/components/session-bar";
import { InterruptDialog, LiveInterrupts } from "@/components/interrupt-dialog";
import { toInitialMessages } from "@/lib/history";
import * as api from "@/lib/api";
import type { Conversation, Session } from "@/lib/api";

/**
 * A thread used only to ask for a new conversation.
 *
 * `POST /conversations?thread=X` works by submitting `/new` into X's session,
 * so it needs a thread to submit *into* — but a brand-new conversation has no
 * id yet, and the id is what names its real thread. This is the scratch session
 * that breaks the circularity. Nothing is ever chatted here.
 */
const BOOTSTRAP_THREAD = "bootstrap";

/**
 * One conversation, live.
 *
 * Remounted whenever the conversation changes (App gives it a `key`), which is
 * what guarantees no state leaks across a switch — a stale stream or a
 * half-finished composer cannot survive a remount. It is also why the `useMemo`
 * below can depend on almost nothing: this component only ever sees one
 * conversation for its whole life.
 */
function ConversationView({
  conversationId,
  initialMessages,
}: {
  conversationId: number;
  initialMessages: ReturnType<typeof toInitialMessages>;
}) {
  const agent = useMemo(
    () =>
      new HttpAgent({
        url: `${import.meta.env.VITE_AGUI_URL}/agui`,
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_AGUI_TOKEN}`,
        },
        // One thread per conversation — this is what makes conversations
        // genuinely independent rather than one session being re-pointed.
        threadId: api.threadFor(conversationId),
        // The past, handed over at construction. Seeding here rather than
        // pushing messages in afterwards means there is never a moment where
        // the thread is mounted but empty.
        initialMessages,
      }),
    [conversationId, initialMessages],
  );

  const runtime = useAgUiRuntime({ agent });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
      <LiveInterrupts />
    </AssistantRuntimeProvider>
  );
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [initialMessages, setInitialMessages] = useState<
    ReturnType<typeof toInitialMessages>
  >([]);
  const [session, setSession] = useState<Session>(null);
  const [reachable, setReachable] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // An approval that was on screen when the page was reloaded. The runtime
  // knows nothing about it; the server still does.
  const [recovered, setRecovered] = useState<AgUiInterrupt | null>(null);

  // Guards React 19 StrictMode's deliberate double-invocation of effects in
  // development from running the whole bind sequence twice — which would
  // create two conversations on a first visit.
  const booted = useRef(false);

  /** Point a thread at a conversation, then load its history and show it. */
  const open = useCallback(async (id: number) => {
    setBusy(true);
    setError(null);
    const thread = api.threadFor(id);
    try {
      // 202 — the bind is a submitted command, so it has *started*, not
      // finished. Waiting for the session to actually point at the
      // conversation is what stops the first message landing nowhere.
      await api.loadConversation(id, thread);
      const bound = await api.awaitBinding(thread, id);
      if (bound === null) {
        // Deliberately fatal for this conversation rather than "carry on
        // anyway". An unbound session still accepts messages — they would land
        // in whatever conversation it does point at, silently, which is far
        // worse than refusing to open. See the note on the load route in
        // README; this is a server-side gap, not a client bug.
        setError(
          `Could not point this window at conversation ${id}. ` +
            `The server's load route is not binding the thread. ` +
            `New chat still works.`,
        );
        setActiveId(null);
        return;
      }
      const stored = await api.readConversation(id);
      setInitialMessages(toInitialMessages(stored));
      const { session: current, pending } = await api.readSession(thread);
      setSession(current);
      setRecovered((pending[0] as AgUiInterrupt | undefined) ?? null);
      setActiveId(id);
      setConversations(await api.listConversations());
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Ask for a new conversation and wait for it to appear.
   *
   * The id is discovered by diffing the conversation list rather than by
   * reading the bootstrap session, because that session points at whatever it
   * created *last* — on a second "New chat" that stale value looks exactly like
   * success and would reopen the previous conversation.
   */
  const startNew = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const before = new Set((await api.listConversations()).map((c) => c.id));
      await api.startConversation(BOOTSTRAP_THREAD);
      for (let attempt = 0; attempt < 25; attempt++) {
        const now = await api.listConversations();
        const fresh = now.find((conversation) => !before.has(conversation.id));
        if (fresh) {
          setConversations(now);
          await open(fresh.id);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      setError("Timed out waiting for the new conversation.");
    } catch (problem) {
      setError(String(problem));
    } finally {
      setBusy(false);
    }
  }, [open]);

  // Boot: show the most recent conversation, or make one. This is also the fix
  // for the "No conversation loaded. Try /new." dead end — a session is created
  // lazily and holds no conversation until something binds one, and sessions do
  // not survive a server restart.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        const listed = await api.listConversations();
        setConversations(listed);
        if (listed.length > 0) await open(listed[0].id);
        else await startNew();
      } catch (problem) {
        setError(String(problem));
        setReachable(false);
        setBusy(false);
      }
    })();
  }, [open, startNew]);

  // Keep the status bar honest about whether the server is still there. Cheap,
  // and it is the difference between "the agent is thinking" and "the terminal
  // running Second Brain was closed".
  useEffect(() => {
    if (activeId === null) return;
    const thread = api.threadFor(activeId);
    const tick = async () => {
      try {
        const { session: current } = await api.readSession(thread);
        setSession(current);
        setReachable(true);
      } catch {
        setReachable(false);
      }
    };
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, [activeId]);

  const answerRecovered = async (entry: {
    interruptId: string;
    status: string;
    payload?: unknown;
  }) => {
    if (activeId === null) return;
    setBusy(true);
    try {
      await api.resumeDirect(api.threadFor(activeId), [entry]);
      setRecovered(null);
      // The unblocked turn rendered into a stream we discarded, so the only
      // place its output exists is the stored conversation. Re-open to see it.
      await open(activeId);
    } finally {
      setBusy(false);
    }
  };

  const title =
    conversations.find((conversation) => conversation.id === activeId)?.title ??
    "Second Brain";

  return (
    <div className="flex h-full">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeId}
        busy={busy}
        onSelect={(id) => void open(id)}
        onNew={() => void startNew()}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <SessionBar title={title} session={session} reachable={reachable} />

        {error ? (
          <p className="text-destructive border-b px-4 py-2 text-sm">{error}</p>
        ) : null}

        <div className="min-h-0 flex-1">
          {activeId === null ? (
            <p className="text-muted-foreground p-8 text-sm">
              {busy ? "Connecting…" : "No conversation."}
            </p>
          ) : (
            // `key` is doing real work: changing it unmounts the old
            // conversation entirely and builds a fresh runtime, rather than
            // trying to mutate one in place.
            <ConversationView
              key={activeId}
              conversationId={activeId}
              initialMessages={initialMessages}
            />
          )}
        </div>
      </div>

      {recovered ? (
        <InterruptDialog
          interrupt={recovered}
          busy={busy}
          onAnswer={(entry) => void answerRecovered(entry)}
          onCancel={() =>
            void answerRecovered({
              interruptId: recovered.id,
              status: "cancelled",
            })
          }
        />
      ) : null}
    </div>
  );
}
