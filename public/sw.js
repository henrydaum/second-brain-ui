/**
 * The push worker.
 *
 * **There is no `fetch` listener here, and that is the whole design.** This app
 * deliberately caches nothing — conversations, files and SSE are private and
 * live, and `docs/MACOS_DEPLOYMENT.md` explains why the first PWA release
 * shipped without a worker at all. A worker that registers no `fetch` handler
 * never enters the navigation or request path, so that property is unchanged:
 * this file exists only because iOS refuses to deliver a push to a page, and a
 * push has to land somewhere that can run while the app is closed.
 *
 * Served from `public/`, so Vite copies it verbatim — it is never bundled.
 * **Plain ES5-ish JavaScript with no imports**, therefore, and nothing in here
 * may reference anything from `src/`.
 *
 * Scope is the origin root because the file is served from the origin root. A
 * worker's scope cannot rise above its own path, and the deep link below opens
 * `/`, so it must be able to control it.
 */

/* eslint-env serviceworker */

/** Take over without waiting for every tab to close. A push worker that only
 *  activated after the user quit the app would miss precisely the notifications
 *  it was installed for. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

/**
 * A notification, from the payload the push service delivered.
 *
 * **Every push must show something.** Safari revokes a subscription that
 * receives pushes without a user-visible result, so the catch-all at the end is
 * not defensive tidiness — it is what keeps the subscription alive when a
 * payload arrives malformed. `userVisibleOnly: true` is the promise made at
 * subscribe time and this is where it is kept.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A payload that is not JSON is still a push that must be shown.
    data = {};
  }

  const title = data.title || "Second Brain";
  const options = {
    body: data.body || "A scheduled agent has something for you.",
    icon: "/favicon.png",
    badge: "/favicon.png",
    // Repeat firings of one recurring job replace each other rather than
    // stacking up a lock screen full of yesterday's news. Notifications with no
    // conversation fall back to a constant tag for the same reason.
    tag: data.conversation_id ? `conversation-${data.conversation_id}` : "second-brain",
    renotify: true,
    timestamp: data.sent_at ? Math.round(data.sent_at * 1000) : Date.now(),
    data: {
      conversation_id: data.conversation_id || null,
      notification_id: data.notification_id || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Opening the conversation the notification is about.
 *
 * Focus beats open: a running app is re-pointed with a `postMessage` rather
 * than having a second window put in front of it, which on iOS would be the
 * same window anyway. `openWindow` is the cold-start path, and the conversation
 * travels in the query string because that is the only channel a fresh document
 * has.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const conversationId = (event.notification.data || {}).conversation_id;
  const target = conversationId ? `/?conversation=${conversationId}` : "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (!("focus" in client)) continue;
          if (conversationId) {
            client.postMessage({
              type: "second-brain:open-conversation",
              conversation_id: conversationId,
            });
          }
          return client.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});

/**
 * The browser rotated the subscription behind our back.
 *
 * Safari's support for this event is unreliable, so it is a best-effort
 * top-up rather than the mechanism the app depends on — `refreshPush()` in
 * `src/lib/push.ts` re-posts the subscription on every launch, which is what
 * actually keeps the server's copy correct. Re-subscribing needs the server key
 * and the old subscription carries it, so nothing has to be fetched first.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const previous = event.oldSubscription || {};
  const key = (previous.options || {}).applicationServerKey;
  if (!key) return;

  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then((subscription) =>
        fetch("/sdk/service.call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "push",
            method: "subscribe",
            kwargs: subscriptionArgs(subscription),
          }),
        }),
      )
      .catch(() => {
        // Nothing useful to do from here. The next app launch re-posts it.
      }),
  );
});

/** The wire shape `Push.subscribe` expects. Duplicated from `src/lib/push.ts`
 *  because a worker cannot import from the bundle; keep the two in step. */
function subscriptionArgs(subscription) {
  const json = subscription.toJSON();
  return {
    endpoint: json.endpoint,
    keys: json.keys || {},
    label: "",
  };
}
