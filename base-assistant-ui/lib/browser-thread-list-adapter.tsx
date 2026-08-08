"use client";

import { createAssistantStream } from "assistant-stream";
import { RuntimeAdapterProvider, useAui } from "@assistant-ui/react";
import type {
  ExportedMessageRepository,
  ExportedMessageRepositoryItem,
  GenericThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatItem,
  MessageStorageEntry,
  RemoteThreadListAdapter,
  RemoteThreadListResponse,
  RemoteThreadMetadata,
  ThreadHistoryAdapter,
  ThreadMessage,
} from "@assistant-ui/core";
import { useMemo, type FC, type PropsWithChildren } from "react";

export type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type StoredThreadMetadata = {
  remoteId: string;
  externalId?: string;
  status: "regular" | "archived";
  title?: string;
  lastMessageAt?: string;
  custom?: Record<string, unknown>;
};

type StoredFormattedRepository<TStorageFormat extends Record<string, unknown>> =
  {
    headId?: string | null;
    messages: MessageStorageEntry<TStorageFormat>[];
  };

const truncateTitle = (text: string) =>
  text.length > 50 ? `${text.slice(0, 47)}...` : text;

const generateLocalTitle = (messages: readonly ThreadMessage[]) => {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const textPart = firstUserMessage?.content.find(
    (part) => part.type === "text",
  );
  if (!textPart || textPart.type !== "text") return "New Thread";
  const text = textPart.text.trim();
  return text ? truncateTitle(text) : "New Thread";
};

class BrowserThreadHistoryAdapter implements ThreadHistoryAdapter {
  constructor(
    private storage: AsyncStorageLike,
    private aui: ReturnType<typeof useAui>,
    private prefix: string,
  ) {}

  private messagesKey(remoteId: string) {
    return `${this.prefix}messages:${remoteId}`;
  }

  private formattedMessagesKey(remoteId: string, format: string) {
    return `${this.prefix}messages:${format}:${remoteId}`;
  }

  async load(): Promise<ExportedMessageRepository> {
    const remoteId = this.aui.threadListItem().getState().remoteId;
    if (!remoteId) return { messages: [] };

    const raw = await this.storage.getItem(this.messagesKey(remoteId));
    return raw ? (JSON.parse(raw) as ExportedMessageRepository) : { messages: [] };
  }

  async append(item: ExportedMessageRepositoryItem): Promise<void> {
    const { remoteId } = await this.aui.threadListItem().initialize();
    const key = this.messagesKey(remoteId);
    const raw = await this.storage.getItem(key);
    const repo: ExportedMessageRepository = raw
      ? (JSON.parse(raw) as ExportedMessageRepository)
      : { messages: [] };

    const index = repo.messages.findIndex(
      (entry) => entry.message.id === item.message.id,
    );
    if (index >= 0) {
      repo.messages[index] = item;
    } else {
      repo.messages.push(item);
    }
    repo.headId = item.message.id;

    await this.storage.setItem(key, JSON.stringify(repo));
  }

  withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
    formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
  ): GenericThreadHistoryAdapter<TMessage> {
    return {
      load: async () => {
        const remoteId = this.aui.threadListItem().getState().remoteId;
        if (!remoteId) return { messages: [] };

        const raw = await this.storage.getItem(
          this.formattedMessagesKey(remoteId, formatAdapter.format),
        );
        if (!raw) return { messages: [] };

        const repo = JSON.parse(
          raw,
        ) as StoredFormattedRepository<TStorageFormat>;
        return {
          headId: repo.headId ?? null,
          messages: repo.messages
            .filter((entry) => entry.format === formatAdapter.format)
            .map((entry) => formatAdapter.decode(entry)),
        };
      },
      append: async (item: MessageFormatItem<TMessage>) => {
        const { remoteId } = await this.aui.threadListItem().initialize();
        const key = this.formattedMessagesKey(remoteId, formatAdapter.format);
        const raw = await this.storage.getItem(key);
        const repo: StoredFormattedRepository<TStorageFormat> = raw
          ? (JSON.parse(raw) as StoredFormattedRepository<TStorageFormat>)
          : { messages: [] };
        const id = formatAdapter.getId(item.message);
        const entry: MessageStorageEntry<TStorageFormat> = {
          id,
          parent_id: item.parentId,
          format: formatAdapter.format,
          content: formatAdapter.encode(item),
        };

        const index = repo.messages.findIndex((message) => message.id === id);
        if (index >= 0) {
          repo.messages[index] = entry;
        } else {
          repo.messages.push(entry);
        }
        repo.headId = id;

        await this.storage.setItem(key, JSON.stringify(repo));
      },
      update: async (item, localMessageId) => {
        const remoteId = this.aui.threadListItem().getState().remoteId;
        if (!remoteId) return;

        const key = this.formattedMessagesKey(remoteId, formatAdapter.format);
        const raw = await this.storage.getItem(key);
        if (!raw) return;

        const repo = JSON.parse(
          raw,
        ) as StoredFormattedRepository<TStorageFormat>;
        const index = repo.messages.findIndex(
          (message) => message.id === localMessageId,
        );
        if (index < 0) return;

        repo.messages[index] = {
          id: localMessageId,
          parent_id: item.parentId,
          format: formatAdapter.format,
          content: formatAdapter.encode(item),
        };

        await this.storage.setItem(key, JSON.stringify(repo));
      },
      delete: async (items) => {
        const remoteId = this.aui.threadListItem().getState().remoteId;
        if (!remoteId) return;

        const key = this.formattedMessagesKey(remoteId, formatAdapter.format);
        const raw = await this.storage.getItem(key);
        if (!raw) return;

        const ids = new Set(
          items.map((item) => formatAdapter.getId(item.message)),
        );
        const repo = JSON.parse(
          raw,
        ) as StoredFormattedRepository<TStorageFormat>;
        repo.messages = repo.messages.filter((message) => !ids.has(message.id));
        if (repo.headId && ids.has(repo.headId)) {
          repo.headId = repo.messages.at(-1)?.id ?? null;
        }

        await this.storage.setItem(key, JSON.stringify(repo));
      },
    };
  }
}

const createHistoryProvider = (
  storage: AsyncStorageLike,
  prefix: string,
): FC<PropsWithChildren> => {
  const Provider: FC<PropsWithChildren> = ({ children }) => {
    const aui = useAui();
    const history = useMemo(
      () => new BrowserThreadHistoryAdapter(storage, aui, prefix),
      [aui, storage, prefix],
    );
    const adapters = useMemo(() => ({ history }), [history]);

    return (
      <RuntimeAdapterProvider adapters={adapters}>
        {children}
      </RuntimeAdapterProvider>
    );
  };

  return Provider;
};

export function createBrowserThreadListAdapter({
  storage,
  prefix = "xulux-base-assistant-ui:",
}: {
  storage: AsyncStorageLike;
  prefix?: string;
}): RemoteThreadListAdapter {
  const threadsKey = `${prefix}threads`;
  const messagesKey = (threadId: string) => `${prefix}messages:${threadId}`;
  const formattedMessagesPrefix = `${prefix}messages:`;

  const loadThreadMetadata = async (): Promise<StoredThreadMetadata[]> => {
    const raw = await storage.getItem(threadsKey);
    return raw ? (JSON.parse(raw) as StoredThreadMetadata[]) : [];
  };

  const saveThreadMetadata = async (threads: StoredThreadMetadata[]) => {
    await storage.setItem(threadsKey, JSON.stringify(threads));
  };

  return {
    unstable_Provider: createHistoryProvider(storage, prefix),

    async list(): Promise<RemoteThreadListResponse> {
      const threads = await loadThreadMetadata();
      return {
        threads: threads.map((thread) => ({
          remoteId: thread.remoteId,
          externalId: thread.externalId,
          status: thread.status,
          title: thread.title,
          lastMessageAt: thread.lastMessageAt
            ? new Date(thread.lastMessageAt)
            : undefined,
          custom: thread.custom,
        })),
      };
    },

    async initialize(threadId) {
      const remoteId = threadId;
      const threads = await loadThreadMetadata();
      if (!threads.some((thread) => thread.remoteId === remoteId)) {
        threads.unshift({
          remoteId,
          status: "regular",
          lastMessageAt: new Date().toISOString(),
        });
        await saveThreadMetadata(threads);
      }

      return { remoteId, externalId: undefined };
    },

    async rename(remoteId, newTitle) {
      const threads = await loadThreadMetadata();
      const thread = threads.find((item) => item.remoteId === remoteId);
      if (!thread) return;
      thread.title = newTitle;
      await saveThreadMetadata(threads);
    },

    async updateCustom(remoteId, custom) {
      const threads = await loadThreadMetadata();
      const thread = threads.find((item) => item.remoteId === remoteId);
      if (!thread) return;
      thread.custom = custom;
      await saveThreadMetadata(threads);
    },

    async archive(remoteId) {
      const threads = await loadThreadMetadata();
      const thread = threads.find((item) => item.remoteId === remoteId);
      if (!thread) return;
      thread.status = "archived";
      await saveThreadMetadata(threads);
    },

    async unarchive(remoteId) {
      const threads = await loadThreadMetadata();
      const thread = threads.find((item) => item.remoteId === remoteId);
      if (!thread) return;
      thread.status = "regular";
      await saveThreadMetadata(threads);
    },

    async delete(remoteId) {
      const threads = await loadThreadMetadata();
      await saveThreadMetadata(
        threads.filter((thread) => thread.remoteId !== remoteId),
      );
      await storage.removeItem(messagesKey(remoteId));
      await storage.removeItem(`${formattedMessagesPrefix}ai-sdk-v6:${remoteId}`);
    },

    async fetch(threadId): Promise<RemoteThreadMetadata> {
      const threads = await loadThreadMetadata();
      const thread = threads.find((item) => item.remoteId === threadId);
      if (!thread) throw new Error("Thread not found");
      return {
        remoteId: thread.remoteId,
        externalId: thread.externalId,
        status: thread.status,
        title: thread.title,
        lastMessageAt: thread.lastMessageAt
          ? new Date(thread.lastMessageAt)
          : undefined,
        custom: thread.custom,
      };
    },

    async generateTitle(remoteId, messages) {
      const title = generateLocalTitle(messages);
      const threads = await loadThreadMetadata();
      const thread = threads.find((item) => item.remoteId === remoteId);
      if (thread) {
        thread.title = title;
        thread.lastMessageAt = new Date().toISOString();
        await saveThreadMetadata(threads);
      }

      return createAssistantStream((controller) => {
        controller.appendText(title);
      });
    },
  };
}
