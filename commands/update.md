---
description: Update Marey to the latest version
---

Update the Marey plugin to the latest published version.

Run this command:

```sh
claude plugin marketplace update marey && claude plugin update marey@marey
```

Then tell the user to run `/reload-plugins`, and `/marey:replay` to open the dashboard: it replaces the dashboard still running from the previous version and refreshes the status line. If the output says Marey is already at the latest version, say so instead. If the marketplace is not named `marey` (an install from before the rename), point to *Upgrading from ccblackbox* in the README.
