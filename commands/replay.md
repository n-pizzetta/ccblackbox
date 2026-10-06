---
description: Open the Marey dashboard in your browser
argument-hint: "[--port <n>] [--no-open]"
---

Start the Marey dashboard server in the background and open it in the user's browser.

Run this command (it returns immediately; the server keeps running):

```sh
LOG="${TMPDIR:-/tmp}/marey-$$.log"; find "${TMPDIR:-/tmp}" -maxdepth 1 -name "marey*.log" -delete 2>/dev/null
nohup node "${CLAUDE_PLUGIN_ROOT}/scripts/serve.mjs" $ARGUMENTS > "$LOG" 2>&1 &
for i in 1 2 3 4 5 6 7 8 9 10; do grep -qE "listening on|already running|already in use" "$LOG" && break; sleep 1; done; cat "$LOG"
```

Recognized flags (passed through from the user's arguments):

- `--port <n>`: listen on a different port (default 3333)
- `--no-open`: start the server without opening the browser

The log shows one of:

- `listening on http://localhost:<port>`, possibly after `replaced Marey <old> on port <port>`: an older Marey server (left running from before a plugin update) was stopped and this version took its place;
- `Marey <version> is already running at <url>`: the same or a newer version is already serving there, and the browser is opened on it;
- `port <port> is already in use`: something else holds the port; suggest `--port <n>`.

It may also say `status line wrapper updated`: the copy installed by `/marey:limits` was refreshed to this version. Report the URL to the user. The server only listens on 127.0.0.1.
