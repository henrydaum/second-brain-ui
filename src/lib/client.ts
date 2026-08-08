/**
 * The outbound half of the bridge: `POST /sdk/<request.type>`.
 *
 * Second Brain exposes exactly two endpoints. This file is one of them; the
 * other is `events.ts`. There is no third way to reach the server, no REST
 * surface beside this and no database — whatever is not expressible as a
 * Request cannot be done from here at all.
 *
 * The body is a Request's arguments as JSON and the answer is its result. That
 * is the whole protocol; the interesting parts are all in what the failures
 * mean.
 */

/**
 * Where the server is, and what proves we are allowed to talk to it.
 *
 * **The browser always talks to its own origin.** In development Vite proxies
 * `/sdk` and `/events` through to the server (see `vite.config.ts`); in
 * production the built app is served by the server itself out of
 * `http_static_dir`. One rule for both, and CORS never enters into it — which
 * matters because the server echoes `http_allowed_origins` into
 * `Access-Control-Allow-Origin` verbatim, and a mismatch as small as a trailing
 * slash fails a preflight that then explains almost nothing.
 *
 * The token is read once at module load. Vite inlines `import.meta.env` at
 * build time, so it is a string literal in the bundle — worth being clear-eyed
 * about: anyone who can open the page can read it. The bearer token is the
 * whole perimeter, and the server is single-user and loopback-bound behind a
 * tunnel. That is the deployment this is for.
 */
const TOKEN = import.meta.env.VITE_SB_TOKEN ?? "";

/**
 * Which session this browser is.
 *
 * `?thread=main` selects the session keyed `http:main`. Two threads are two
 * independent conversations, and this is **the only way** the client names a
 * session — a `session_key`, `token` or `key` in a request body is stripped and
 * replaced by the server, because identity is the server's to state, not ours
 * to claim. So never put one in `args`; it will be silently overwritten.
 *
 * The page's own `?thread=` wins over the configured default, which is what
 * makes a second window a second conversation rather than a fight over the
 * first. **Only one stream may be open per thread** — a second `GET /events`
 * replaces the first — so two tabs on one thread take turns being connected and
 * both sit there reconnecting.
 */
export const THREAD =
  new URLSearchParams(window.location.search).get("thread") ||
  import.meta.env.VITE_SB_THREAD ||
  "main";

/** Bearer auth on every request. `/events` is the one route that also takes a
 *  query token, because `EventSource` cannot send headers. */
export const authHeader = () => `Bearer ${TOKEN}`;

/** Build a URL against the server, with the thread already attached. */
export function serverUrl(path: string): URL {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("thread", THREAD);
  return url;
}

/**
 * A Request that came back with something other than 200.
 *
 * **A refusal is an ordinary answer, not a transport failure.** The kernel
 * classifies every Request the same way it classifies a tool call, and a
 * `403 approval_declined` means either "the person said no" or "nobody was
 * there to ask" — both of which are things to show, not to retry. The `code` is
 * the kernel's own, so callers can distinguish those cases without parsing
 * prose.
 */
export class RequestFailed extends Error {
  /** The Request type that failed, e.g. `"conv.load"`. */
  readonly type: string;
  /** HTTP status: 400 bad args, 403 refused, 404 missing, 499 cancelled,
   *  503 subsystem absent, 504 timed out, 500 anything else. */
  readonly status: number;
  /** The kernel's error code, e.g. `"approval_declined"`. May be empty. */
  readonly code: string;

  // Written out rather than declared as constructor parameter properties: this
  // project compiles with `erasableSyntaxOnly`, which allows only TypeScript
  // syntax that erases to nothing, and parameter properties emit real code.
  constructor(type: string, status: number, code: string, message: string) {
    super(message);
    this.name = "RequestFailed";
    this.type = type;
    this.status = status;
    this.code = code;
  }

  /** True when this was a policy refusal rather than a broken call. The two
   *  causes are indistinguishable from out here on purpose: the difference is
   *  whether anyone was watching, which `attended` on the session answers. */
  get isDeclined() {
    return this.code === "approval_declined";
  }
}

/**
 * Make one Request and hand back its result.
 *
 * **This call can legitimately take as long as a person takes.** Anything
 * consequential — `config.write`, `conv.delete`, a gated `command.call` — does
 * not simply fail: it raises a real approval dialog, which arrives on the
 * *event stream* while this POST is still open, and the POST completes once the
 * dialog is answered. So there is deliberately no timeout here, and callers
 * must not serialise these behind one another — a request blocked on a human
 * would stall every request queued behind it, including the `frontend.resolve`
 * that would unblock it.
 *
 * That also means the event stream must already be open before the first
 * interesting Request goes out. Attendance follows the stream; without one,
 * unsafe Requests come back `403 approval_declined` with nobody having been
 * asked.
 */
export async function sdk<T = unknown>(
  type: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(serverUrl(`/sdk/${type}`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
    },
    body: JSON.stringify(args),
  });

  // A body is not guaranteed on every status, so a parse failure must not
  // become the error the caller sees — the status is the real information.
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: string;
    code?: string;
  };

  if (!response.ok) {
    throw new RequestFailed(
      type,
      response.status,
      body.code ?? "",
      body.error ?? `${type} failed with ${response.status}`,
    );
  }

  return body.data as T;
}
