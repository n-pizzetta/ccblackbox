---
name: update
description: Update the Marey plugin installed in Codex when the user asks to upgrade Marey or get its latest version.
---

Use Codex's plugin manager for this installation:

1. Check `codex plugin --help` and `codex plugin marketplace --help` for the installed client's supported commands. For clients supporting `marketplace upgrade` and `plugin add`, run:

   ```sh
   codex plugin marketplace upgrade marey
   codex plugin add marey@marey
   ```

   Run the second command only after the refresh succeeds. If the marketplace has a different name, use the matching entry from `codex plugin marketplace list`.
2. If this client lacks those commands or the CLI is unavailable, direct the user to refresh/update Marey in Codex's plugin management UI. Do not substitute another host's plugin manager or edit the plugin cache by hand.
3. Report what the manager actually updated. Restart Codex or start a fresh session if the available skills still reflect the old package. Then invoke Marey's `replay` skill from the refreshed skill list to open the dashboard with the installed version.
