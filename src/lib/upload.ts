/**
 * Getting a file from the browser onto the host.
 *
 * **There is no upload endpoint.** `frontend.submit` with
 * `input_kind: "attachment"` takes a *path on the host* — not bytes, not a URL —
 * which is fine for a Python frontend that downloaded the file itself and
 * useless to a browser holding a `File`. So the path is built out of ordinary
 * Requests: ask for a scratch path, write the bytes into it a window at a time,
 * then submit the path.
 *
 * `ingest: true` on the submit is the part worth not losing. It moves the file
 * into the attachment cache — a watched directory — so the extraction and
 * indexing pipeline treats it like any other incoming file. Leaving it in temp
 * skips all of that, and the agent gets a path it can read rather than a
 * document the system knows about.
 */

import { sdk } from "@/lib/client";

/**
 * How much of the file goes in one Request.
 *
 * One answer has to fit in one wire message, and base64 costs a third on top of
 * the raw bytes. Two megabytes stays below gateways with a 4 MB request-body
 * limit after base64 and the JSON envelope are added. Smaller than it could be
 * on a direct connection, deliberately: remote gateways vary, the progress bar
 * moves more often, and a retry costs less.
 */
const CHUNK_BYTES = 2 * 1024 * 1024;

/** `btoa` takes a string, so the bytes have to become one first. Done in small
 *  slices because `String.fromCharCode(...bytes)` with a multi-megabyte spread
 *  overflows the call stack. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  const STRIDE = 8192;
  for (let i = 0; i < bytes.length; i += STRIDE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STRIDE));
  }
  return btoa(binary);
}

/** The extension, with its dot, or "" — `fs.temp` wants a suffix so the file it
 *  makes is recognisable to whatever opens it later. */
function suffixOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/**
 * The extension without its dot, which is what `frontend.submit` calls
 * `extension`.
 *
 * The kernel would work this out from the file name on its own, but the
 * extension is what decides the file's *modality* — whether it is offered to an
 * image parser, an audio parser, or none — and which extensions the current
 * model will accept at all. Saying it explicitly, as the Telegram frontend
 * does, keeps that decision on something we chose rather than on how a path
 * happened to be spelled.
 */
export function extensionOf(name: string): string {
  return suffixOf(name).replace(/^\./, "");
}

/**
 * Write a file to host scratch and answer with its path.
 *
 * **A generator, so that progress can be shown.** It yields the fraction
 * written after each window and finally *returns* the path. The caller drives it
 * with `.next()` and turns each yielded fraction into a redraw of the
 * attachment chip — which is the only way to report progress out of a loop
 * without a callback that cannot itself cause a render.
 */
export async function* uploadToHost(
  file: File,
): AsyncGenerator<number, string, void> {
  // `fs.temp` is always allowed — it is the one filesystem call that never
  // raises a dialog, which is what makes this chain usable at all.
  const answer = await sdk<string | { path?: string }>("fs.temp", {
    suffix: suffixOf(file.name),
  });
  const path = typeof answer === "string" ? answer : (answer?.path ?? "");
  if (!path) throw new Error("fs.temp did not answer with a path");

  const bytes = new Uint8Array(await file.arrayBuffer());

  // An empty file still needs creating, hence the do/while shape: one write
  // always happens, even at length zero.
  let offset = 0;
  do {
    const window = bytes.subarray(offset, offset + CHUNK_BYTES);
    await sdk("fs.write_bytes", {
      path,
      data: base64(window),
      // The first window creates the file; the rest extend it. Getting this
      // backwards silently keeps only the last chunk.
      mode: offset === 0 ? "overwrite" : "append",
    });
    offset += CHUNK_BYTES;
    yield Math.min(1, offset / Math.max(1, bytes.length));
  } while (offset < bytes.length);

  return path;
}

/**
 * Read a host file back out, for the `attachments` frames the agent produces.
 *
 * A whole-file read is capped well below the sizes a UI deals in, so this asks
 * for successive windows and joins them. **A short read means the end**, so the
 * loop terminates without having to learn the size first — which is the only
 * reason this does not need an `fs.stat` round trip.
 */
export async function downloadFromHost(
  path: string,
): Promise<Uint8Array<ArrayBuffer>> {
  // Spelled `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`, whose
  // buffer could in principle be shared — `Blob` will not take one of those.
  const windows: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (;;) {
    const encoded = await sdk<string>("fs.read_bytes", {
      path,
      offset,
      length: CHUNK_BYTES,
    });
    if (!encoded) break;

    const binary = atob(encoded);
    const window = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) window[i] = binary.charCodeAt(i);
    windows.push(window);

    offset += window.length;
    if (window.length < CHUNK_BYTES) break;
  }

  const total = windows.reduce((sum, window) => sum + window.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const window of windows) {
    joined.set(window, at);
    at += window.length;
  }
  return joined;
}
