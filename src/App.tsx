import { useMemo } from "react";
import { HttpAgent } from "@ag-ui/client";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { Thread } from "@/components/thread";

/**
 * The whole client, for now: one agent, one runtime, one thread.
 *
 * The shape here is the entire integration — assistant-ui speaks AG-UI, and
 * Second Brain's ``frontend_agui`` speaks AG-UI, so there is no adapter layer
 * of ours in between and there should never need to be one.
 */
export default function App() {
  // ``useMemo`` with an empty dependency list means "build this once and keep
  // it". Worth understanding rather than copying: React runs a component's
  // function body again on *every* render, so a bare ``new HttpAgent(...)``
  // would construct a fresh agent — abandoning any run streaming through the
  // old one — every time anything on screen changed, including each token
  // arriving. The empty array is the promise that nothing it depends on can
  // change.
  const agent = useMemo(
    () =>
      new HttpAgent({
        url: `${import.meta.env.VITE_AGUI_URL}/agui`,
        // The bearer token is the server's entire perimeter. It is a constructor
        // option rather than something we intercept per-request, so every run
        // this agent places carries it automatically.
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_AGUI_TOKEN}`,
        },
        // Opaque to us: it selects which conversation the server talks about.
        // "default" is the session Second Brain starts with. Choosing between
        // threads is a later step; this pins us to one.
        threadId: "default",
      }),
    [],
  );

  // The runtime owns all conversation state — messages, streaming, who is
  // mid-turn. Deliberately not duplicated into React state anywhere: two
  // sources of truth about a conversation is the bug we are avoiding.
  const runtime = useAgUiRuntime({ agent });

  return (
    // A "provider" hands `runtime` to every component below it without passing
    // it down by hand at each level. <Thread /> reaches back up for it.
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="h-full">
        <Thread />
      </main>
    </AssistantRuntimeProvider>
  );
}
