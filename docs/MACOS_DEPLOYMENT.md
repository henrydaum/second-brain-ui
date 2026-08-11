# macOS production deployment

The production deployment has two local services:

```text
Browser -> Caddy (127.0.0.1:4173) -> frontend_http (127.0.0.1:8787)
              |                              |
              +-- compiled React files       +-- Second Brain HTTP/SSE API
```

Caddy serves a tested, compiled release and supplies the Second Brain bearer
token only on its loopback request to `frontend_http`. Production JavaScript
contains no token. Vite is used for development and builds, not as a long-lived
production server.

## Prerequisites

- Second Brain is already running as a user LaunchAgent.
- The `frontend_http` store frontend is installed and enabled.
- [Homebrew](https://brew.sh/) and Node.js are installed.
- The repository is cloned under the same macOS user that runs Second Brain.

Configure `frontend_http` through Second Brain's configuration UI or REPL:

| Setting | Value |
| --- | --- |
| `http_port` | `8787` |
| `secret_http_token` | A long random token |
| `http_static_dir` | Empty |
| `http_allowed_origins` | Empty |

The token must be the same one entered during frontend installation. The HTTP
frontend remains bound to loopback; do not expose port 8787.

Use a long token made from letters, digits, and the conventional token punctuation
`. _ ~ + / = -`. The installer rejects whitespace and configuration syntax so
the value can be substituted into Caddy safely.

## Install

From the repository root:

```bash
sh deploy/macos/install.sh
```

The installer:

1. Installs Caddy with Homebrew if necessary.
2. Prompts for `secret_http_token` without echoing it.
3. Stores it in `~/Library/Application Support/Second Brain UI/runtime.env`
   with mode `0600`.
4. Runs tests, lint, type-checking, and the production build.
5. Activates the build atomically under the application-support directory.
6. Installs and starts `~/Library/LaunchAgents/com.secondbrain.ui.plist`.

Open <http://127.0.0.1:4173>. Caddy starts at login and restarts if it exits.
It may start before Second Brain; requests return `502` until `frontend_http`
is ready, then recover without restarting Caddy.

The installer first probes port 8787 without credentials. A working
`frontend_http` answers `401`; `503` means the kernel listener exists but no
frontend owns it, and a connection failure means Second Brain is not listening.

For unattended installation, supply the token in the process environment. Do
not put it on the command line, where it would enter shell history:

```bash
read -s SB_HTTP_TOKEN
export SB_HTTP_TOKEN
sh deploy/macos/install.sh
unset SB_HTTP_TOKEN
```

## Operate and update

All operational commands run from the repository clone:

```bash
# Show launchd state and probe Caddy
sh deploy/macos/manage.sh status

# Restart Caddy
sh deploy/macos/manage.sh restart

# Test, build, and atomically activate the checked-out source
sh deploy/macos/manage.sh update

# Swap the current and previous successful releases
sh deploy/macos/manage.sh rollback

# Replace the gateway token after changing secret_http_token in Second Brain
sh deploy/macos/manage.sh set-token
```

Updating source remains explicit and reviewable:

```bash
git status --short
git pull --ff-only
sh deploy/macos/manage.sh update
```

A failed test, lint, type-check, or build never changes the active release.
Successful updates retain the immediately previous release for rollback.

Logs are written to:

```text
~/Library/Logs/Second Brain UI/caddy.stdout.log
~/Library/Logs/Second Brain UI/caddy.stderr.log
```

## Uninstall

```bash
sh deploy/macos/manage.sh uninstall
```

This stops and removes only the Caddy LaunchAgent. It deliberately preserves
the private token, releases, and logs under `~/Library` so uninstall is
recoverable. Remove those directories manually only if their contents are no
longer needed.

## Security boundary

- Caddy and `frontend_http` listen only on `127.0.0.1`.
- Caddy overwrites, rather than trusts, a browser-supplied Authorization header.
- Static files and the browser contain no backend bearer token.
- `http_allowed_origins` stays empty because the browser uses one origin.
- Do not bind port 4173 to the LAN or forward it through a router.

For a later Tailscale deployment, point persistent Tailscale Serve at
`http://127.0.0.1:4173`. For Cloudflare, put Access in front of the tunnel before
forwarding to the same address. Neither requires changing the frontend build.

## Port 8787 troubleshooting

If Second Brain reports that `frontend_http` could not take port 8787, identify
the listener before changing any ports:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
curl -i --max-time 3 http://127.0.0.1:8787/events
```

- One Second Brain process plus `HTTP/1.1 401` means the listener is healthy;
  the error may be from a second, manually launched Second Brain process or an
  older log entry.
- Two Second Brain processes means the LaunchAgent copy and a manual copy are
  competing. Keep the LaunchAgent instance and stop the manually started one.
- `503` means the kernel has the socket but `frontend_http` failed to claim it.
  Use `/frontends` to disable any duplicate HTTP-serving frontend, then restart
  Second Brain so ownership is established cleanly.
- A different process name means that application owns 8787. Stop it or move
  `frontend_http` with `http_port`; if the backend port changes, update all three
  Caddy upstreams to match before reinstalling.
