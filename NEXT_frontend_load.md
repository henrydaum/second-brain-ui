# Next: replace the load-by-command hack with `frontend.load`

## Why

`POST /conversations/{id}/load?thread=X` currently works by *submitting a slash
command as text* into that thread's session:

```python
sdk.frontend.submit_text(key, f"/conversations {_quote(category)} "
                              f"{conversation_id} 'Load conversation'")
```

That is the wrong shape for a programmatic API, and it cost an evening to get
working. `parse_command_line` lexes with `shlex` and fills form steps
**positionally**, so `category=Main` collapsed into one token and failed
validation with "category must be one of: Main" — naming the mangled token it
had been handed. The category has to be looked up first because the form
validates against a live enum. Failures are silent: the route answers 202 and
the effect simply never happens.

It works today, but it is one silent-failure mode away from breaking again.

## The change

Not a widening of `conv.load` — that would let any plugin re-point any session.
The `frontend.*` family already exists for exactly this: a frontend acting on a
session it serves, authorised by its token. `frontend.submit`,
`frontend.resolve` and `frontend.pending` all take an explicit `session_key`.

`_conv_load` already does the real work; the only problem is that it reads the
*ambient* session:

```python
# sandbox/handlers/kernel.py:452
outcome = loader(getattr(ctx, "session_key", None), cid)
```

For a frontend box that is `None`, because `runtime.context.kernel_context()`
names no session. So the new Request is the same call with the session named.

### Files

| file | change |
| --- | --- |
| `sandbox/guest/requests.py` | `FRONTEND_LOAD = "frontend.load"` (near `FRONTEND_RESOLVE`, line ~159) and add to the request list at line ~290 |
| `sandbox/guest/sdk.py` | on the frontend namespace beside `resolve` (line ~991): `def load_conversation(self, session_key, conversation_id)` → `self._ask(FRONTEND_LOAD, token=self._token(), session_key=session_key, id=conversation_id)` |
| `sandbox/handlers/kernel.py` | `_frontend_load(ctx, args)` mirroring `_conv_load` (line 443) but taking the session from `args["session_key"]`; register in the dispatch table beside `FRONTEND_RESOLVE` (line ~3280) |
| `sandbox/policy.py` | add `R.FRONTEND_LOAD` to the frontend group at line ~560 |

Follow the token check the other `frontend.*` handlers do — read
`_frontend_resolve` and match it exactly rather than inventing a check.

### Then, in `frontends/frontend_agui.py`

`_conversation`'s load branch becomes a direct call that knows whether it
worked, so it can answer **200 with the messages** instead of 202-and-hope:

```python
if action == "load" and method == "POST":
    key = self._session_of(request)
    result = sdk.frontend.load_conversation(key, conversation_id)
    if not result.get("ok"):
        return self._reply(sdk, request, 404,
                           {"error": result.get("error") or "no such conversation"})
    return self._reply(sdk, request, 200, {
        "loaded": conversation_id,
        "conversation": sdk.conv.read(conversation_id, details=True)})
```

`_category_of` and `_quote` both delete — they existed only to feed the command.

Keep `POST /conversations?thread=X` as it is. `/new` genuinely creates *and*
activates and has never misbehaved; only loading needed this.

### Client (`Second Brain UI`)

Once the route answers 200 with the conversation attached, `open()` in
`src/App.tsx` loses a round trip: no `awaitBinding` poll, and no separate
`readConversation` call. Keep `awaitBinding` in `src/lib/api.ts` until the new
route is confirmed live, then delete it.

## Verifying

1. `python -c "from sandbox import validator; print(validator.validate_file(r'<installed>/frontends/frontend_agui.py'))"` — expect `conforms.`
2. Restart Second Brain (the watcher refuses to hot-swap a running frontend:
   *"Frontend 'agui' already running"*).
3. In the app, click a conversation started elsewhere. It should open with its
   history, first time, with no polling delay.

## Two traps that cost time tonight

- **`/packages install frontend_agui` reads `origin/store`, not the worktree.**
  An uncommitted fix is silently reverted by a reinstall. Commit *and push* the
  store branch before reinstalling, or just copy the file and restart.
- **Git Bash rewrites `/conversations` to `C:/Program Files/Git/conversations`**
  when it appears as a shell argument. Use a Python client for API probing;
  MSYS path conversion corrupted several diagnoses.
