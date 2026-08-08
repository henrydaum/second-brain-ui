"use client";

import { useChat } from "@ai-sdk/react";
import {
  AssistantCloud,
  AssistantRuntimeProvider,
  CloudFileAttachmentAdapter,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  useAui,
  useAuiState,
  WebSpeechDictationAdapter,
  WebSpeechSynthesisAdapter,
  type FeedbackAdapter,
} from "@assistant-ui/react";
import { useRemoteThreadListRuntime } from "@assistant-ui/core/react";
import {
  AssistantChatTransport,
  useAISDKRuntime,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useEffect, useMemo } from "react";
import {
  createBrowserThreadListAdapter,
  type AsyncStorageLike,
} from "@/lib/browser-thread-list-adapter";

const cloudBaseUrl = process.env.NEXT_PUBLIC_ASSISTANT_BASE_URL;

const feedbackAdapter: FeedbackAdapter = {
  submit: async () => {},
};

const browserStorage: AsyncStorageLike = {
  async getItem(key) {
    return globalThis.localStorage?.getItem(key) ?? null;
  },
  async setItem(key, value) {
    globalThis.localStorage?.setItem(key, value);
  },
  async removeItem(key) {
    globalThis.localStorage?.removeItem(key);
  },
};

function useLocalChatRuntime(previewSessionId?: string | null) {
  const adapter = useMemo(
    () =>
      createBrowserThreadListAdapter({
        storage: browserStorage,
        prefix: "xulux-base-assistant-ui:",
      }),
    [],
  );

  return useRemoteThreadListRuntime({
    adapter,
    allowNesting: true,
    runtimeHook: function LocalRuntimeHook() {
      const threadId = useAuiState((s) => s.threadListItem.id);
      const aui = useAui();
      const transport = useMemo(
        () =>
          new AssistantChatTransport({
            api: "/api/chat",
            body: previewSessionId ? { previewSessionId } : undefined,
          }),
        [previewSessionId],
      );
      const adapters = useMemo(
        () => ({
          speech: new WebSpeechSynthesisAdapter(),
          dictation: new WebSpeechDictationAdapter(),
          feedback: feedbackAdapter,
          attachments: new CompositeAttachmentAdapter([
            new SimpleImageAttachmentAdapter(),
            new SimpleTextAttachmentAdapter(),
          ]),
        }),
        [],
      );
      const chat = useChat({ id: threadId, transport });
      const runtime = useAISDKRuntime(chat, {
        adapters,
      });

      useEffect(() => {
        transport.setRuntime(runtime);
        transport.__internal_setGetThreadListItem(() =>
          aui.threadListItem.source ? aui.threadListItem() : undefined,
        );
      }, [aui, runtime, transport]);

      return runtime;
    },
  });
}

function CloudRuntimeProvider({
  children,
  previewSessionId,
}: {
  children: React.ReactNode;
  previewSessionId?: string | null;
}) {
  const cloud = useMemo(
    () =>
      new AssistantCloud({ baseUrl: cloudBaseUrl ?? "", anonymous: true }),
    [],
  );
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/chat",
        body: previewSessionId ? { previewSessionId } : undefined,
      }),
    [previewSessionId],
  );
  const adapters = useMemo(
    () => ({
      speech: new WebSpeechSynthesisAdapter(),
      dictation: new WebSpeechDictationAdapter(),
      feedback: feedbackAdapter,
      attachments: new CloudFileAttachmentAdapter(cloud),
    }),
    [cloud],
  );
  const runtime = useChatRuntime({
    cloud,
    transport,
    adapters,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

function LocalRuntimeProvider({
  children,
  previewSessionId,
}: {
  children: React.ReactNode;
  previewSessionId?: string | null;
}) {
  const localRuntime = useLocalChatRuntime(previewSessionId);

  return (
    <AssistantRuntimeProvider runtime={localRuntime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

export function DemoRuntimeProvider({
  children,
  previewSessionId,
}: {
  children: React.ReactNode;
  previewSessionId?: string | null;
}) {
  if (cloudBaseUrl) {
    return (
      <CloudRuntimeProvider previewSessionId={previewSessionId}>
        {children}
      </CloudRuntimeProvider>
    );
  }

  return (
    <LocalRuntimeProvider previewSessionId={previewSessionId}>
      {children}
    </LocalRuntimeProvider>
  );
}
