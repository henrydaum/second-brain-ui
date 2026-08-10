/**
 * The whole app: a status bar and a chat window, inside the provider that owns
 * the connection.
 *
 * The conversations sidebar and the command palette come next; the layout below
 * leaves the left edge free for them. Everything they need — `conv.list`,
 * `command.list` — is an ordinary Request, so neither changes anything here.
 */

import { Suspense, useEffect, useState, type FC } from "react";

import { ConversationSidebar } from "@/components/conversation-sidebar";
import { ConversationDocumentTitle } from "@/components/conversation-document-title";
import { ErrorBoundary } from "@/components/error-boundary";
import { LazyFilesDrawer } from "@/components/lazy-files-drawer";
import { InputRequestDialog } from "@/components/input-request-dialog";
import { LazyFileViewerDialog } from "@/components/lazy-file-viewer";
import { NotificationBanners } from "@/components/notification-banners";
import { SessionBar } from "@/components/session-bar";
import { Thread } from "@/components/thread";
import {
  FileActivityProvider,
  useFileActivity,
} from "@/runtime/file-activity-provider";
import { SecondBrainProvider } from "@/runtime/provider";

export const App: FC = () => {
  /**
   * Whether the conversations drawer is showing on a narrow screen.
   *
   * It lives here because the two components that need it are siblings: below
   * `md` the sidebar is an overlay that starts off-screen, so the control that
   * opens it cannot be inside it. Above `md` the sidebar is an inline rail and
   * this is simply unused.
   */
  const [navOpen, setNavOpen] = useState(false);

  return (
    // Outside the provider: a crash while *setting up* the connection is
    // exactly the case a boundary inside it would miss.
    <ErrorBoundary>
      <SecondBrainProvider>
        <ConversationDocumentTitle />
        {/* Inside the runtime provider, because it reads which conversation is
            open and whether a turn is running; outside the layout, because all
            three of the surfaces that draw files — the header button, the
            drawer, and the chip under each reply — are in different branches
            of it. */}
        <FileActivityProvider>
          <div className="flex h-dvh w-full overflow-hidden">
            <ConversationSidebar open={navOpen} onOpenChange={setNavOpen} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <SessionBar onOpenNav={() => setNavOpen(true)} />
              <main className="flex-1 overflow-hidden">
                <Thread />
              </main>
            </div>
            {/* The far edge, opposite the conversations. Above `md` it takes
                width from the thread rather than covering it, which is what
                makes it usable while reading. */}
            <FilesDrawerMount />
          </div>

          {/* Directly under the provider, above everything. A blocked question
              belongs to the *session*, not to the thread it happened during —
              Settings raises them too — so it is a sibling of the whole layout
              rather than something nested inside one part of it. */}
          <InputRequestDialog />
          <FileViewerMount />

          {/* Beside the dialog and for the same reason: a notification is the
              system speaking to the *session*, and most of them are not about
              the conversation on screen at all. Fixed-positioned, so where it
              sits in this tree decides only what it stacks above. */}
          <NotificationBanners />
        </FileActivityProvider>
      </SecondBrainProvider>
    </ErrorBoundary>
  );
};

/** Keep the viewer and its file parsers out of the initial bundle. */
const FileViewerMount: FC = () => {
  const { viewing } = useFileActivity();
  if (!viewing) return null;
  return (
    <Suspense fallback={null}>
      <LazyFileViewerDialog />
    </Suspense>
  );
};

const FilesDrawerMount: FC = () => {
  const { filesOpen } = useFileActivity();
  const [hasOpened, setHasOpened] = useState(filesOpen);

  useEffect(() => {
    if (filesOpen) setHasOpened(true);
  }, [filesOpen]);

  if (!hasOpened) return null;
  return (
    <Suspense fallback={null}>
      <LazyFilesDrawer />
    </Suspense>
  );
};
