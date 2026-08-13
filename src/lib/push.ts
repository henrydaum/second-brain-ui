/**
 * Device push notifications, for scheduled agents only.
 *
 * **The one thing worth being interrupted by.** Every other notification is
 * already handled well enough by the banner and the bell — you see it when you
 * next look. A scheduled job reporting back is the case where "when you next
 * look" is the wrong answer: the whole point of asking for the news at 07:00 is
 * to be told at 07:00. The filter that decides which notifications qualify is
 * server-side, in the store's `service_push.py`, because it needs the
 * conversation's category and this side has no business guessing.
 *
 * **This module owns the browser half and nothing else**: permission, the
 * worker registration, the subscription, and keeping the server's copy of that
 * subscription current. It reaches the service through `service.call`, which is
 * an ordinary Request — so there is no new transport here, no new route in the
 * Caddyfile, and no change to `frontend_http.py`.
 *
 * **iOS will only do this for an installed app.** `PushManager` is simply
 * absent in a Safari tab on iOS, which is why `pushSupported` is a real check
 * and not a formality: the UI hangs off it, and the honest answer on a phone
 * that has not added the app to its home screen is to show nothing at all.
 */

import { sdk } from "@/lib/client";

/** Where the worker lives. Root scope, because it must control `/` to hand a
 *  cold-started window the conversation a notification was about. */
const WORKER_URL = "/sw.js";

/**
 * What the toggle draws.
 *
 * `blocked` is terminal from here — a page cannot re-prompt once permission is
 * denied, and saying so is better than a control that silently does nothing.
 *
 * `unconfigured` earns its place the hard way. The server had no VAPID key, so
 * `subscribe` was handed an empty application server key, threw, and the toggle
 * caught it and re-read itself as plain "off" — permission granted, nothing
 * subscribed, no error anywhere. Every layer behaved, and the only symptom was
 * a phone that never buzzed. A state that names the cause is the difference
 * between reading one row of Settings and bisecting the whole feature.
 */
export type PushState =
  | "unsupported"
  | "off"
  | "on"
  | "blocked"
  | "unconfigured";

/** One call into the store's push service. `service.call` gates on the
 *  service's own `exports` list, so a method name that is not public there
 *  comes back as a refusal rather than running. */
const call = <T>(method: string, kwargs: Record<string, unknown> = {}) =>
  sdk<T>("service.call", { name: "push", method, kwargs });

/**
 * Whether this browser can do any of it.
 *
 * All three checks earn their place. `serviceWorker` is absent in a private
 * window; `PushManager` is absent in an iOS Safari *tab* and appears only once
 * the app is installed to the home screen; `Notification` is absent in a few
 * embedded webviews that have the other two.
 */
export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * A VAPID public key as `subscribe` wants it.
 *
 * The server hands over standard base64url and `applicationServerKey` takes
 * bytes, and the conversion between them is the single most reliable way to get
 * this feature wrong: a key that is merely *wrong* produces a subscription that
 * looks fine and never delivers anything. Hence one helper, tested directly,
 * rather than four lines inlined at the only call site.
 *
 * Base64url differs from base64 in two characters and in dropping the padding,
 * so both have to be put back before `atob` will look at it.
 */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.padEnd(
    base64url.length + ((4 - (base64url.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  // Backed by an explicit `ArrayBuffer` rather than the `new Uint8Array(n)`
  // shorthand: that spelling widens to `ArrayBufferLike`, which includes
  // `SharedArrayBuffer` and so is not a `BufferSource` that `subscribe` will
  // accept. Same bytes, a type the DOM signature agrees with.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** The subscription in the shape `Push.subscribe` expects. Mirrored in
 *  `public/sw.js`, which cannot import this. */
function subscriptionArgs(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint ?? "",
    keys: json.keys ?? {},
    label: deviceLabel(),
  };
}

/** Something recognisable in a list of subscriptions. Not identifying and not
 *  meant to be — it exists so "which of these is my phone" has an answer. */
function deviceLabel(): string {
  const agent = navigator.userAgent || "";
  if (/iPhone/i.test(agent)) return "iPhone";
  if (/iPad/i.test(agent)) return "iPad";
  if (/Android/i.test(agent)) return "Android";
  if (/Macintosh/i.test(agent)) return "Mac";
  if (/Windows/i.test(agent)) return "Windows";
  return "Browser";
}

/**
 * Register the worker, or reuse the registration already there.
 *
 * `getRegistration` first so that a reload does not churn the worker, and
 * `ready` afterwards because `subscribe` needs an *active* worker — a
 * registration that is still installing will reject.
 */
async function worker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) await navigator.serviceWorker.register(WORKER_URL);
  return navigator.serviceWorker.ready;
}

/**
 * What the toggle should be showing.
 *
 * Read from the browser rather than from the server: the browser is where the
 * truth is after the user revokes permission in iOS Settings, and a control
 * that trusted the server's row would then claim to be on while delivering
 * nothing. Deliberately does *not* register the worker — asking a question
 * should not install anything.
 */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "on" : "off";
}

/**
 * Turn it on. **Must be called from a user gesture** — every browser requires
 * one for `requestPermission`, and iOS is the strictest about it.
 *
 * Ordered so that nothing is installed before it is wanted: permission first,
 * then the worker, then the key, then the subscription. A refusal at the first
 * step leaves the browser exactly as it was.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return permission === "denied" ? "blocked" : "off";
  }

  const registration = await worker();

  // Reuse before re-subscribing. A second `subscribe` with the same key
  // returns the same subscription, but asking for the existing one keeps the
  // common "already on, just re-confirming" path off the push service.
  const existing = await registration.pushManager.getSubscription();

  if (!existing) {
    // **Checked before subscribing, not left to fail inside it.** An empty key
    // decodes to zero bytes and `subscribe` rejects with a message that names
    // neither the key nor the service — which is how a missing VAPID setting
    // spent an evening looking like a broken service worker.
    const key = (await call<string>("public_key")) || "";
    if (!key.trim()) return "unconfigured";

    return await registration.pushManager
      .subscribe({
        // Non-negotiable, and not merely required by the type: a subscription
        // that takes silent pushes is one Safari will revoke.
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(key),
      })
      .then(async (subscription) => {
        await call("subscribe", subscriptionArgs(subscription));
        return "on" as const;
      });
  }

  const subscription = existing;

  await call("subscribe", subscriptionArgs(subscription));
  return "on";
}

/**
 * Turn it off, browser-side first.
 *
 * The order matters on a flaky link: dropping the browser's subscription is
 * what actually stops the notifications, and the server's row is bookkeeping
 * that a `410` from the push service would eventually clean up anyway. Doing it
 * the other way round leaves a toggle that says "off" and a phone that still
 * buzzes.
 */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return "off";

  const { endpoint } = subscription;
  await subscription.unsubscribe();
  try {
    await call("unsubscribe", { endpoint });
  } catch {
    // The subscription is gone from this browser either way, which is the part
    // the user asked for. A row the server keeps is one the next `410` removes.
  }
  return "off";
}

/**
 * Re-post the current subscription, quietly, on launch.
 *
 * **This is what actually keeps push working**, rather than the
 * `pushsubscriptionchange` handler in the worker — Safari fires that event
 * unreliably, and a subscription the browser has silently rotated is
 * indistinguishable from a working one until a push fails to arrive. Re-posting
 * an unchanged subscription is an idempotent upsert server-side, so the cost of
 * being wrong about whether it changed is one cheap Request per launch.
 *
 * Registers nothing and asks for nothing. If push was never turned on, this
 * returns having done exactly nothing, which is what makes it safe to call
 * unconditionally at boot.
 */
export async function refreshPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  try {
    await call("subscribe", subscriptionArgs(subscription));
  } catch {
    // Best effort. The service may not be loaded, which is not this app's
    // problem to report — the toggle still reads the browser's own truth.
  }
}
