/**
 * Known causes of failed tool calls, read by scripts/recommendations.mjs.
 *
 * Each cause matches the error text (noise stripped first) and comes with a
 * fix: Marey only suggests it, it never edits a config itself.
 */

/** Text a tool appends to every failure, whatever its cause. Stripped first, so it never hides the real error. */
export const NOISE = [
  {
    id: "zoxide-doctor",
    re: /zoxide: detected a possible configuration issue\.[\s\S]*?_ZO_DOCTOR=0\.\s*/,
    title: "A shell warning buries real errors",
    why: "zoxide's doctor message was appended to failed commands. It causes none of them, but the agent reads it before the real error, and it costs tokens. Claude Code's shell snapshot doesn't load zoxide's hooks, so the doctor fires there.",
    fix: {
      text: "Silence the doctor (your interactive shells are fine), and keep the plain `cd` for agents so an unknown path fails instead of jumping elsewhere.",
      snippet: 'export _ZO_DOCTOR=0\n[[ -z "$CLAUDECODE" ]] && alias cd="z"',
      where: "~/.zshrc, before `zoxide init`",
    },
  },
];

/** Failures that say nothing about the setup: the agent's own retries, or a choice the user made. */
export const IGNORED = [
  /has not been read yet/i,
  /modified since read/i,
  /exceeds maximum allowed tokens/i,
  /tool use was rejected|doesn't want to proceed with this tool use/i,
];

export const CAUSES = [
  {
    id: "zsh-nomatch",
    kind: "setup",
    match: /no matches found:/i,
    title: "Unmatched zsh globs fail whole commands",
    why: "zsh aborts a command when a glob such as `*.pyc` matches nothing; bash passes it through. Agents write bash-style commands, so cleanups and finds fail on empty matches.",
    fix: {
      text: "Let globs that match nothing pass through in agent shells only (Claude Code sets CLAUDECODE there).",
      snippet: '[[ -n "$CLAUDECODE" ]] && setopt nonomatch',
      where: "~/.zshrc",
    },
  },
  {
    id: "rtk-unsupported",
    kind: "setup",
    match: /\brtk: |\brtk \w+ does not support/i,
    title: "The rtk rewrite hook rejects some commands",
    why: "A hook rewrites shell commands for rtk, which refuses some forms (for example `find` with `-not` or `-exec`). Each refusal costs a failed call and a retry.",
    fix: { text: "Have the hook leave the forms rtk refuses untouched, or tell the agent to run them as `rtk proxy <command>`." },
  },
  {
    id: "sandbox-write",
    kind: "setup",
    match: /requested permissions to write to/i,
    title: "The sandbox blocks writes outside its paths",
    why: "Commands that write to a cache or temp directory outside the sandbox's writable paths fail, then get retried another way.",
    fix: {
      text: "Add the directory from the sample to the sandbox's writable paths, or point the tool's cache inside the project.",
      docs: "https://code.claude.com/docs/en/sandboxing",
    },
  },
  {
    id: "playwright-profile",
    kind: "setup",
    match: /browser is already in use for/i,
    title: "Parallel sessions fight over one Playwright browser",
    why: "The Playwright MCP server keeps one persistent browser profile, which a single browser can use at a time. A second session driving a browser fails until the first lets go.",
    fix: {
      text: "Start the Playwright MCP server with `--isolated` (an in-memory profile per client).",
      snippet: '"args": ["@playwright/mcp@latest", "--isolated"]',
      where: "the MCP server config",
      docs: "https://github.com/microsoft/playwright-mcp",
    },
  },
  {
    id: "playwright-roots",
    kind: "habit",
    match: /file access denied: .* is outside allowed roots/i,
    title: "Playwright can't save files outside the project",
    why: "The Playwright MCP server only writes inside the workspace roots (the session's directory). Screenshots sent to a scratch or temp directory fail, then get retried.",
    fix: {
      text: "Save screenshots under the project (for example `.playwright-mcp/`, kept out of git), or give a bare file name. Avoid `--allow-unrestricted-file-access`: the restriction is a guardrail.",
      docs: "https://github.com/microsoft/playwright-mcp",
    },
  },
  {
    id: "wrong-directory",
    kind: "habit",
    match: /file does not exist\. note: your current working directory is/i,
    title: "Files looked up from the wrong directory",
    why: "Reads and edits on paths that don't exist where Claude Code is running: sessions started outside the project, or paths from another worktree.",
    fix: { text: "Start sessions from the project root, and give worktree paths explicitly in the prompt. The sample shows the directory Claude Code was in." },
  },
  {
    id: "worktree-isolation",
    kind: "habit",
    match: /isolated in the worktree/i,
    title: "Sub-agents reach outside their worktree",
    why: "Isolated sub-agents can only touch their own worktree, yet they were sent paths from the main checkout.",
    fix: { text: "Give isolated sub-agents paths relative to their worktree, not absolute paths into the main checkout." },
  },
  {
    id: "mcp-reconnect",
    kind: "setup",
    match: /mcp server .*(session expired|needs? (re-?)?auth|not connected)/i,
    title: "An MCP server needs reconnecting",
    why: "Calls to an MCP server failed because its session or token expired.",
    fix: { text: "Run `/mcp` and reconnect the server.", docs: "https://code.claude.com/docs/en/mcp" },
  },
];

/** Strips NOISE; returns the text left and the ids of the noise found. */
export function stripNoise(text) {
  let out = text;
  const noise = [];
  for (const n of NOISE) {
    if (n.re.test(out)) {
      out = out.replace(n.re, "");
      noise.push(n.id);
    }
  }
  return { text: out, noise };
}

/** A stable key for "the same error": paths, ids and numbers stripped. Null when nothing is left to compare. */
export function errorKey(text) {
  // Paths first: cutting before replacing them would split one error into several keys.
  const key = text
    // "Exit code 1" or "command exited with code 1" alone says nothing about the cause.
    .replace(/^(?:error: )?(?:command exited with )?(?:exit )?code \d+\s*/i, "")
    .toLowerCase()
    .replace(/\/[^\s:'"`),]+/g, "<path>")
    .replace(/0x[0-9a-f]+|\b[0-9a-f]{8,}\b/g, "<id>")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return key.length >= 8 ? key : null;
}

/** "gh pr merge 78 --squash" → "gh pr merge": the command itself, without leading cd / env, flags or arguments. */
export function commandHead(command) {
  if (!command) return null;
  const parts = command.split(/&&|;|\|\|/).map((p) => p.trim()).filter(Boolean);
  const main = parts.find((p) => !/^(cd|export|source|\.)\s/.test(p) && !/^\w+=[^\s$`]*$/.test(p)) ?? parts[0] ?? "";
  // `T=$(gcloud auth …)`: the command is the one inside the substitution.
  const words = main.replace(/\$\(|`|\)/g, " ").split(/\s+/).filter((w) => w && !/^\w+=/.test(w));
  const head = [];
  for (const w of words) {
    if (head.length >= 3 || /^[-"'$<>|(]|[/=.]|^\d+$/.test(w)) break;
    head.push(w);
  }
  return head.join(" ") || words[0] || null;
}

/** Denials that protect the user rather than slow them down: never suggest allowing these. */
export const PROTECTIVE = /(\bmerge\b|--force|\breset --hard\b|\brm -rf?\b|\bdelete\b|\bdrop\b|\bdestroy\b|--no-verify|\bpush\b|token|secret|credential|password|\.env\b)/i;

/** "mcp__plugin_playwright_playwright__browser_take_screenshot" → "playwright · browser_take_screenshot". */
export function toolLabel(tool) {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool ?? "");
  if (!m) return tool ?? null;
  const server = m[1].replace(/^plugin_/, "").split("_").filter((w, i, a) => a.indexOf(w) === i).join("-");
  return `${server} · ${m[2]}`;
}
