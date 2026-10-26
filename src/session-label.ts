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
 */
export function labelForBranch(
  branch: readonly SessionEntry[],
  getLabel?: (id: string) => string | undefined,
): string {
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
