# Security

Report security issues to maintainers privately. Do not open a public issue or pull
request for a vulnerability.

Use the **Report a vulnerability** button on the [Security tab](https://github.com/n-pizzetta/marey/security/advisories/new). It is the only reporting channel.

## Scope

- Anything that leaks data stored under `~/.claude/` (prompts, tool calls, file
  snapshots, token counts).
- Anything that lets a remote caller read or modify that data.
- Anything that makes the local server accept state-changing requests from an
  origin other than `127.0.0.1`.

## Out of scope

- Data you commit yourself to the repo (Marey does not add, commit or push
  anything on your behalf).
- Third-party tooling outside this repository.

Marey is designed to run locally with no telemetry. Its only network request is
the daily update check (a GET of its own `plugin.json` on GitHub, off with
`{"updateCheck": false}` in `~/.claude/marey/config.json`); a report that shows
Marey sending anything else, or anything about the user, is the most valuable
thing you can send.
