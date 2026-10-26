import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

export function formatCwdForFooter(cwd: string, home?: string): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const rel = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (!isInsideHome) return cwd;
  return rel === "" ? "~" : `~${sep}${rel}`;
}

export function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

const usageCost = (u: { cost?: { total?: number } } | undefined) => u?.cost?.total ?? 0;

export function sessionCost(ctx: { sessionManager: { getEntries(): SessionEntryLike[] } }): number {
  let cost = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "usage") {
      cost += usageCost(entry.usage);
    } else if (entry.type === "message" && entry.message?.role === "assistant") {
      cost += usageCost(entry.message.usage);
    } else if (entry.type === "message" && entry.message?.role === "toolResult") {
      cost += usageCost(entry.message.usage);
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      cost += usageCost(entry.usage);
    }
  }
  return cost;
}

export function lastResponseTps(ctx: {
  sessionManager: { getEntries(): SessionEntryLike[] };
}): number | undefined {
  let tps: number | undefined;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    const output = entry.message.usage?.output;
    const durationMs = entry.message.durationMs;
    if (typeof output !== "number" || output <= 0) continue;
    if (typeof durationMs !== "number" || durationMs <= 0) continue;
    tps = output / (durationMs / 1000);
  }
  return tps;
}

export function formatTps(tps: number): string {
  return `${tps >= 100 ? Math.round(tps) : tps.toFixed(1)} t/s`;
}

export function colorForPercent(
  theme: Theme,
  pct: number | undefined,
  text: string,
  warnAt = 70,
  errorAt = 90,
): string {
  if (pct !== undefined && pct > errorAt) return theme.fg("error", text);
  if (pct !== undefined && pct > warnAt) return theme.fg("warning", text);
  return theme.fg("dim", text);
}

/** Minimal SessionEntry shape used by the helpers above. */
export interface SessionEntryLike {
  type: string;
  usage?: { cost?: { total?: number } };
  message?: {
    role?: string;
    usage?: { output?: number; cost?: { total?: number } };
    durationMs?: number;
  };
}

export function buildFooterFactory(
  ctx: ExtensionContext,
  getLabel: () => string,
  setRequestRender?: (requestRender: (() => void) | undefined) => void,
  home = process.env.HOME || process.env.USERPROFILE,
) {
  return (tui: { requestRender(): void }, theme: Theme, footerData: FooterDataLike) => {
    const unsub = footerData.onBranchChange(() => tui.requestRender());
    setRequestRender?.(() => tui.requestRender());

    return {
      dispose() {
        unsub();
        setRequestRender?.(undefined);
      },
      invalidate() {},
      render(width: number): string[] {
        let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), home);
        const branch = footerData.getGitBranch();
        if (branch) pwd = `${pwd} (${branch})`;
        const label = getLabel();
        pwd = `${pwd} • ${label}`;

        const parts: string[] = [];
        parts.push(theme.fg("dim", `$${sessionCost(ctx).toFixed(3)}`));

        const cu = ctx.getContextUsage();
        const contextWindow = cu?.contextWindow ?? ctx.model?.contextWindow ?? 0;
        const contextText =
          cu?.percent != null
            ? `${cu.percent.toFixed(1)}%/${formatTokens(contextWindow)}`
            : `?/${formatTokens(contextWindow)}`;
        parts.push(colorForPercent(theme, cu?.percent ?? undefined, contextText, 20));

        const tps = lastResponseTps(ctx);
        if (tps !== undefined) parts.push(theme.fg("dim", formatTps(tps)));

        let statsLeft = parts.join(" ");

        const modelName = ctx.model?.id || "no-model";
        let right = modelName;
        if (ctx.model?.reasoning) {
          const level = ctx.thinkingLevel || "off";
          right = level === "off" ? `${modelName} • thinking off` : `${modelName} • ${level}`;
        }
        if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
          const withProvider = `(${ctx.model.provider}) ${right}`;
          if (visibleWidth(statsLeft) + 2 + visibleWidth(withProvider) <= width) {
            right = withProvider;
          }
        }

        let statsLeftWidth = visibleWidth(statsLeft);
        if (statsLeftWidth > width) {
          statsLeft = truncateToWidth(statsLeft, width, "...");
          statsLeftWidth = visibleWidth(statsLeft);
        }
        const minPadding = 2;
        const rightWidth = visibleWidth(right);
        let statsLine: string;
        if (statsLeftWidth + minPadding + rightWidth <= width) {
          const padding = " ".repeat(width - statsLeftWidth - rightWidth);
          statsLine = statsLeft + padding + theme.fg("dim", right);
        } else {
          const availableForRight = width - statsLeftWidth - minPadding;
          if (availableForRight > 0) {
            const truncatedRight = truncateToWidth(right, availableForRight, "");
            const padding = " ".repeat(
              Math.max(0, width - statsLeftWidth - visibleWidth(truncatedRight)),
            );
            statsLine = statsLeft + padding + theme.fg("dim", truncatedRight);
          } else {
            statsLine = statsLeft;
          }
        }

        const lines = [
          truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
          statsLine,
        ];

        const statuses = footerData.getExtensionStatuses();
        if (statuses.size > 0) {
          const statusLine = Array.from(statuses.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, text]) => sanitizeStatusText(text))
            .join(" ");
          lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
        }

        return lines;
      },
    };
  };
}

/** Minimal FooterDataProvider shape used by the renderer. */
export interface FooterDataLike {
  getGitBranch(): string | null;
  getAvailableProviderCount(): number;
  getExtensionStatuses(): ReadonlyMap<string, string>;
  onBranchChange(cb: () => void): () => void;
}
