/** @vitest-environment jsdom */

// jsdom for `atob` and for the `window` that `lib/client.ts` reads at import
// time, not because anything here touches the DOM.

import { describe, expect, it } from "vitest";

import { applicationServerKey } from "@/lib/push";

/**
 * **The failure this guards against is silent.** A VAPID key decoded wrongly
 * still produces a `PushSubscription` — the browser does not validate it — and
 * the only symptom is that pushes never arrive, on a device you cannot attach a
 * debugger to. So the conversion is tested directly rather than trusted.
 */
describe("the VAPID application server key", () => {
  /** A real 65-byte uncompressed P-256 point is what a VAPID public key is, and
   *  its base64url form is 87 characters — which is 3 short of a multiple of 4
   *  and therefore exercises the padding branch. */
  const key =
    "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

  it("decodes to the 65 bytes of an uncompressed P-256 point", () => {
    const bytes = applicationServerKey(key);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toHaveLength(65);
    // 0x04 is the uncompressed-point marker. Getting the alphabet or the
    // padding wrong shifts every byte, so this first one is a sharp check.
    expect(bytes[0]).toBe(0x04);
  });

  it("translates the two characters base64url does differently", () => {
    // "-" and "_" stand where "+" and "/" would, and a decoder that forgot
    // either produces plausible-looking bytes rather than throwing.
    const viaUrlAlphabet = applicationServerKey("-_-_");
    const viaStandard = Uint8Array.from(atob("+/+/"), (c) => c.charCodeAt(0));
    expect([...viaUrlAlphabet]).toEqual([...viaStandard]);
  });

  it("restores padding for every remainder length", () => {
    // Lengths ≡ 2 and ≡ 3 (mod 4) need two "=" and one "=" respectively;
    // ≡ 0 needs none. A length ≡ 1 is not valid base64 and cannot occur.
    expect(applicationServerKey("AQ")).toHaveLength(1);
    expect(applicationServerKey("AQI")).toHaveLength(2);
    expect(applicationServerKey("AQID")).toHaveLength(3);
  });
});
