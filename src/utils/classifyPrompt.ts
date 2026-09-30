export type PromptKind = "correction" | "approval" | "clarification" | "new";

const CORRECTION_PREFIXES = [
  "no ", "no,", "no.", "non ", "non,", "non.",
  "stop", "arrête", "arrete",
  "don't", "dont ",
  "ne pas", "pas ça", "pas ca",
  "revert", "undo", "remet", "enlève", "enleve",
];

const APPROVAL_WORDS = [
  "yes", "oui", "ok", "okay", "go", "fais", "parfait",
  "super", "top", "continue", "vas-y", "vasy", "allez",
  "do it", "do-it", "c'est bon", "cest bon", "ca marche",
  "ça marche", "good", "bien", "nice",
];

function stripLeadEmoji(s: string): string {
  return s.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/u, "");
}

export function classifyPrompt(raw: string): PromptKind {
  if (!raw) return "new";
  const text = stripLeadEmoji(raw.trim()).toLowerCase();
  if (!text) return "new";

  for (const p of CORRECTION_PREFIXES) {
    if (text.startsWith(p)) return "correction";
  }

  const trimmed = text.slice(0, 120);
  const endsWithQ = /\?\s*$/.test(raw.trim());
  if (endsWithQ && raw.trim().length < 180) return "clarification";

  if (raw.trim().length < 30) {
    for (const w of APPROVAL_WORDS) {
      if (text === w || text.startsWith(w + " ") || text.startsWith(w + ",") || text.startsWith(w + ".")) {
        return "approval";
      }
    }
  }

  if (trimmed.length < 12) {
    for (const w of APPROVAL_WORDS) {
      if (text === w) return "approval";
    }
  }

  return "new";
}

export const PROMPT_KIND_LABEL: Record<PromptKind, string> = {
  correction: "correction",
  approval: "approval",
  clarification: "clarification",
  new: "new ask",
};

export const PROMPT_KIND_COLOR: Record<PromptKind, string> = {
  correction: "var(--c-red)",
  approval: "var(--c-green)",
  clarification: "var(--c-cyan)",
  new: "var(--c-violet)",
};
