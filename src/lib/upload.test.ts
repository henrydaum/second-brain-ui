import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.fn();

vi.mock("@/lib/client", () => ({
  sdk: (...args: unknown[]) => sdk(...args),
}));

const { attachmentSubmitArgs, uploadToHost } = await import("@/lib/upload");

beforeEach(() => {
  sdk.mockReset();
  sdk.mockImplementation(async (request: string) =>
    request === "fs.temp" ? "/tmp/upload.png" : true,
  );
});

describe("browser attachment uploads", () => {
  it("submits several files as one atomic frontend message", () => {
    expect(
      attachmentSubmitArgs(
        [
          { path: "/tmp/chart.png", name: "Chart.png" },
          { path: "/tmp/notes.pdf", name: "Notes.pdf" },
        ],
        "Compare these",
      ),
    ).toEqual({
      input_kind: "attachment",
      files: [
        {
          path: "/tmp/chart.png",
          file_name: "Chart.png",
          extension: "png",
        },
        {
          path: "/tmp/notes.pdf",
          file_name: "Notes.pdf",
          extension: "pdf",
        },
      ],
      caption: "Compare these",
      ingest: true,
    });
  });

  it("keeps base64 write requests below a four-megabyte gateway limit", async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024 + 1);
    const file = {
      name: "photo.png",
      arrayBuffer: async () => bytes.buffer,
    } as File;

    const progress: number[] = [];
    const upload = uploadToHost(file);
    let step = await upload.next();
    while (!step.done) {
      progress.push(step.value);
      step = await upload.next();
    }

    const writes = sdk.mock.calls.filter(
      ([request]) => request === "fs.write_bytes",
    );
    expect(writes).toHaveLength(2);
    expect(writes[0][1].data.length).toBeLessThan(4 * 1024 * 1024);
    expect(writes.map(([, args]) => args.mode)).toEqual([
      "overwrite",
      "append",
    ]);
    expect(progress.at(-1)).toBe(1);
    expect(step.value).toBe("/tmp/upload.png");
  });
});
