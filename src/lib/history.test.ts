// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { toTurns, type StoredMessage } from "@/lib/history";

const user = (over: Partial<StoredMessage> = {}): StoredMessage => ({
  id: 1,
  role: "user",
  content: "Compare these",
  tool_call_id: null,
  tool_name: null,
  attachments: [],
  ...over,
});

describe("stored user attachments", () => {
  it("keeps prose clean and turns attachment records into their own part", () => {
    const [turn] = toTurns([
      user({
        attachments: [
          {
            path: "/workspace/attachments/1_chart.png",
            file_name: "chart.png",
            modality: "image",
            extension: "png",
          },
          {
            path: "/workspace/attachments/1_notes.pdf",
            file_name: "notes.pdf",
            modality: "text",
            extension: "pdf",
          },
        ],
      }),
    ]);

    expect(turn?.parts).toEqual([
      {
        kind: "files",
        paths: [
          "/workspace/attachments/1_chart.png",
          "/workspace/attachments/1_notes.pdf",
        ],
        sent: true,
        attachments: [
          {
            path: "/workspace/attachments/1_chart.png",
            fileName: "chart.png",
            modality: "image",
            extension: "png",
          },
          {
            path: "/workspace/attachments/1_notes.pdf",
            fileName: "notes.pdf",
            modality: "text",
            extension: "pdf",
          },
        ],
      },
      {
        kind: "text",
        streamId: "stored-1",
        text: "Compare these",
        done: true,
      },
    ]);
  });

  it("keeps an attachment-only message even when its content is empty", () => {
    const turns = toTurns([
      user({
        content: "",
        attachments: [
          {
            path: "/workspace/voice.wav",
            file_name: "voice.wav",
            modality: "audio",
            extension: "wav",
          },
        ],
      }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.parts).toHaveLength(1);
    expect(turns[0]?.parts[0]).toMatchObject({ kind: "files", sent: true });
  });

  it("leaves pre-column pointer prose untouched instead of guessing", () => {
    const pointer =
      "[Attached image file: old.png (cached at /workspace/old.png)]";
    const [turn] = toTurns([user({ content: pointer })]);

    expect(turn?.parts).toEqual([
      { kind: "text", streamId: "stored-1", text: pointer, done: true },
    ]);
  });
});

describe("stored message authorship", () => {
  it("does not render kernel-authored user-role rows as the person's words", () => {
    const turns = toTurns([
      user({
        content: "[Conversation summary from earlier] not a person",
        author: "compaction",
      }),
      user({ id: 2, content: "Actually from the person", author: null }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ id: "stored-2", role: "user" });
  });

  it("keeps old rows whose author field is absent", () => {
    const turns = toTurns([user({ content: "An old real message" })]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.role).toBe("user");
  });
});
