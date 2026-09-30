---
description: Open the ccblackbox dashboard in your browser
argument-hint: "[--port <n>] [--no-open]"
---

Start the ccblackbox dashboard server in the background and open it in the user's browser.

Run this command (it returns immediately; the server keeps running):

```sh
nohup node "${CLAUDE_PLUGIN_ROOT}/scripts/serve.mjs" $ARGUMENTS > "${TMPDIR:-/tmp}/ccblackbox.log" 2>&1 &
sleep 2; cat "${TMPDIR:-/tmp}/ccblackbox.log"
```

Recognized flags (passed through from the user's arguments):

- `--port <n>`: listen on a different port (default 3333)
- `--no-open`: start the server without opening the browser

The log shows either `listening on http://localhost:<port>` or, if the port is taken, that ccblackbox is probably already running there (the browser is opened on it anyway). Report the URL to the user. The server only listens on 127.0.0.1.
