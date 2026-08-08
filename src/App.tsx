/**
 * The whole app: a status bar and a chat window, inside the provider that owns
 * the connection.
 *
 * The conversations sidebar and the command palette come next; the layout below
 * leaves the left edge free for them. Everything they need — `conv.list`,
 * `command.list` — is an ordinary Request, so neither changes anything here.
 */

import type { FC } from "react";

import { ConversationSidebar } from "@/components/conversation-sidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { SessionBar } from "@/components/session-bar";
import { Thread } from "@/components/thread";
import { SecondBrainProvider } from "@/runtime/provider";

export const App: FC = () => (
  // Outside the provider: a crash while *setting up* the connection is exactly
  // the case a boundary inside it would miss.
  <ErrorBoundary>
    <SecondBrainProvider>
      <div className="flex h-dvh w-full overflow-hidden">
        <ConversationSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <SessionBar />
          <main className="flex-1 overflow-hidden">
            <Thread />
          </main>
        </div>
      </div>
    </SecondBrainProvider>
  </ErrorBoundary>
);
