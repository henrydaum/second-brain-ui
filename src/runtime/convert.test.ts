import { describe, expect, it } from "vitest";

import { convertMessage, SENT_ATTACHMENTS } from "@/runtime/convert";
import type { Turn } from "@/runtime/store";

describe("user attachment conversion", () => {
  it("places files in message metadata above prose instead of rendering data text", () => {
    const turn: Turn = {
      id: "u1",
      role: "user",
      parts: [
        {
          kind: "files",
          paths: ["/workspace/chart.png"],
          sent: true,
          attachments: [
            {
              path: "/workspace/chart.png",
              fileName: "chart.png",
              modality: "image",
              extension: "png",
            },
          ],
        },
        { kind: "text", streamId: "u1", text: "Compare this", done: true },
      ],
      running: false,
      aborted: false,
    };

    const converted = convertMessage(turn);
    expect(converted.content).toEqual([{ type: "text", text: "Compare this" }]);
    expect(converted.metadata?.custom?.[SENT_ATTACHMENTS]).toEqual([
      {
        path: "/workspace/chart.png",
        fileName: "chart.png",
        modality: "image",
        extension: "png",
      },
    ]);
  });
});
