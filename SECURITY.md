# Security

Report security issues to maintainers privately. Do not open a public issue or pull
request for a vulnerability.

Use the **Report a vulnerability** button on the [Security tab](https://github.com/n-pizzetta/ccblackbox/security/advisories/new), or email the maintainer directly.

## Scope

- Anything that leaks data stored under `~/.claude/` (prompts, tool calls, file
  snapshots, token counts).
- Anything that lets a remote caller read or modify that data.
- Anything that makes the local server accept state-changing requests from an
  origin other than `127.0.0.1`.

## Out of scope

- Data you commit yourself to the repo (ccblackbox does not add, commit or push
  anything on your behalf).
- Third-party tooling outside this repository.

ccblackbox is designed to run locally with no network calls and no telemetry; a
report that demonstrates a way around that property is the most valuable thing
you can send.
