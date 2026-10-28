import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const NEW_SESSION_LABEL = "(new session)";
const TREE_TEXT_LIMIT = 200;

/**
 * Reproduce $PI/dist/modes/interactive/components/tree-selector.js:730-746
 * (extractContent / extractFullContent).
 */
function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      (block as { type?: string }).type === "text"
    ) {
      out += (block as { text?: string }).text ?? "";
    }
  }
  return out;
}

/** Reproduce tree-selector.js:622 (normalise used by getEntryDisplayText). */
function normalizeRow(s: string): string {
  return s.replace(/[\n\t]/g, " ").trim();
}

/**
 * Flatten a user message's content exactly as `/tree` does, then slice to 200
 * characters *before* normalising whitespace. Returns the visible text and
 * whether the original exceeded the 200-character budget.
 */
export function userRowText(content: unknown): { text: string; truncated: boolean } {
  const full = flattenContent(content);
  const sliced = full.slice(0, TREE_TEXT_LIMIT);
  return { text: normalizeRow(sliced), truncated: full.length > TREE_TEXT_LIMIT };
}

function firstNonBlankLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * Compute the session label from the active branch: the `/tree` row text of
 * the first user message, with the leading `user: ` prefix already omitted,
 * `…` appended when sliced, and `[label] ` prepended when the entry has a user-set
 * label (tree-selector.js:600-608).
 *
 * Deliberate divergence: when the first user message has no text content
 * (e.g. an image-only message), `/tree` renders an empty row after the `user: `
 * prefix, but a blank window/title label is useless. We intentionally fall back
 * to `(new session)` instead; this is documented in README.md.
 *
 * A name set by the user (`/name <name>`, `session_info` entry) always wins over
 * the derived tree label, matching Pi's own footer (`cwd (branch) • <name>`) and
 * terminal title precedence. When the name is cleared the tree label returns.
 */
export function labelForBranch(
  branch: readonly SessionEntry[],
  getLabel?: (id: string) => string | undefined,
  sessionName?: string,
): string {
  const named = normalizeSessionName(sessionName);
  if (named) return named;
  const first = branch.find(
    (e): e is SessionEntry & { type: "message"; message: { role: "user"; content: unknown } } =>
      e.type === "message" && (e as { message?: { role?: string } }).message?.role === "user",
  );
  if (!first) return NEW_SESSION_LABEL;
  const { text, truncated } = userRowText(first.message.content);
  // Keep the (new session) fallback for empty content even if a label exists.
  if (!text) return NEW_SESSION_LABEL;
  const entryLabel = getLabel?.(first.id);
  const prefix = entryLabel ? `[${entryLabel}] ` : "";
  return truncated ? `${prefix}${text}…` : `${prefix}${text}`;
}

/** Trim a user-set session name, treating blank/whitespace-only names as unset. */
export function normalizeSessionName(sessionName: string | undefined): string | undefined {
  if (typeof sessionName !== "string") return undefined;
  const trimmed = sessionName.replace(/[\r\n]+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Compute the title label from the active branch: the first non-blank line of
 * the first user message, sliced to 200 characters, with `…` appended when
 * truncated, and `[label] ` prepended when the entry has a user-set label.
 *
 * Unlike `labelForBranch`, this does not flatten newlines/tabs into spaces; it
 * uses only the first line of the raw text so the terminal title stays short.
 *
 * A user-set session name wins over the derived first line, exactly as in
 * `labelForBranch`.
 */
export function titleLabelForBranch(
  branch: readonly SessionEntry[],
  getLabel?: (id: string) => string | undefined,
  sessionName?: string,
): string {
  const named = normalizeSessionName(sessionName);
  if (named) return named;
  const first = branch.find(
    (e): e is SessionEntry & { type: "message"; message: { role: "user"; content: unknown } } =>
      e.type === "message" && (e as { message?: { role?: string } }).message?.role === "user",
  );
  if (!first) return NEW_SESSION_LABEL;
  const raw = flattenContent(first.message.content);
  const firstLine = firstNonBlankLine(raw);
  if (!firstLine) return NEW_SESSION_LABEL;
  const entryLabel = getLabel?.(first.id);
  const prefix = entryLabel ? `[${entryLabel}] ` : "";
  if (firstLine.length > TREE_TEXT_LIMIT) {
    return `${prefix}${firstLine.slice(0, TREE_TEXT_LIMIT)}…`;
  }
  return `${prefix}${firstLine}`;
}
