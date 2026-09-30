---
description: Connect ccblackbox to your real Claude usage limits (5h / 7d) via the status line
argument-hint: "[--uninstall]"
---

Install the ccblackbox status line wrapper so the dashboard can show the real 5-hour and 7-day usage limits (the same numbers as `/usage`).

Execute this command:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/install-statusline.mjs" $ARGUMENTS
```

It saves the user's current `statusLine` setting and keeps rendering it, so their existing status line does not change. A backup of `settings.json` is written next to it (`settings.json.ccblackbox.bak`).

With `--uninstall`, the script restores the previous status line and removes the wrapper.

Report the script's output back to the user.
