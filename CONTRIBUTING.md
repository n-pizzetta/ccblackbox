# Contributing to ccblackbox

Thanks for helping. ccblackbox is a small local tool: a parser for Claude Code's own files, a local API and a React dashboard. Issues and pull requests are welcome.

## Setup

Requirements: Node 20+ and pnpm.

```sh
git clone https://github.com/n-pizzetta/ccblackbox && cd ccblackbox
pnpm install
pnpm dev            # dashboard on http://localhost:5173, reading your ~/.claude
```

### Work on synthetic data

You don't need to expose your own sessions to develop, take screenshots or file a bug. Generate a fake Claude config dir and point the app at it:

```sh
pnpm seed:demo                                   # writes .demo-claude/ (git-ignored)
CLAUDE_CONFIG_DIR="$PWD/.demo-claude" pnpm dev   # or pnpm serve
```

`CLAUDE_CONFIG_DIR` is Claude Code's own variable for relocating `~/.claude`; the parser, API, hook and status line all honor it. Extend [`scripts/seed-demo.mjs`](scripts/seed-demo.mjs) when you need a new shape of data (a tool, a model, an edge case).

## Before opening a pull request

```sh
pnpm lint
pnpm typecheck
pnpm build
```

All three must pass. There are no automated tests yet: say in the PR how you checked the change (demo data, a specific transcript shape, a screenshot for UI changes).

- **`dist/` is committed.** The Claude Code plugin ships the prebuilt UI straight from the repo. If you change anything under `src/`, run `pnpm build` and commit `dist/` in a separate `build: rebuild dist` commit.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): message`, lowercase, imperative, no period (`fix(parser): skip synthetic messages`).
- **Keep PRs focused.** One fix or feature per PR; a refactor goes in its own PR.

## Where things live

[`ARCHITECTURE.md`](ARCHITECTURE.md) covers the data flow, the parser, pricing, the API and its security checks, and the front-end map. The short version:

| Area | Files |
|---|---|
| Reading Claude Code's data | `scripts/parse-sessions.mjs` |
| Model names and prices | `scripts/models.mjs` |
| Local API (prod and dev) | `scripts/api.mjs`, mounted by `scripts/serve.mjs` and `vite.config.ts` |
| Plugin | `.claude-plugin/`, `commands/`, `hooks/capture.mjs`, `scripts/statusline.mjs` |
| Dashboard | `src/` |

### Updating model prices

When Anthropic ships a model or changes a price, edit the table in `scripts/models.mjs` and link the source (the pricing page) in the PR. Unknown models still work: they are priced like the latest model of their family and marked `~` in the UI until they get a row.

### Claude Code format changes

Claude Code's files are not a public API and change between versions. If a parse breaks, open an issue with your Claude Code version (`claude --version`) and a **redacted** sample of the relevant lines: keep the structure (`type`, `message.usage`, `content[].type`…) and replace prompts, paths and outputs with placeholders.

## Privacy rules

This tool reads people's prompts, code and file snapshots. Contributions must keep it local and private:

- Never commit real data from `~/.claude`: no transcripts, session dumps, screenshots of real sessions, or absolute paths from your machine. Use `pnpm seed:demo`.
- No network calls, telemetry or remote assets (fonts and icons are bundled).
- The server listens on `127.0.0.1` only and rejects cross-site requests; keep new endpoints behind the same checks in `scripts/api.mjs`, and don't add endpoints that write outside `~/.claude/ccblackbox/` without a clear user action.

## Security issues

Please don't open a public issue for a vulnerability. Report it privately through GitHub's **Security → Report a vulnerability** on the repository.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
