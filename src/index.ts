import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { buildFooterFactory } from "./footer.ts";
import { labelForBranch, titleLabelForBranch } from "./session-label.ts";

function sanitizeTitle(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, " ").trim();
}

function formatTitle(label: string, cwd: string, isRunning: boolean): string {
  const prefix = isRunning ? "·" : "✳";
  return `${prefix} ${sanitizeTitle(label)} - ${path.basename(cwd)}`;
}

export default function piCustomisations(pi: ExtensionAPI) {
  let isRunning = false;
  let customFooterEnabled = true;
  let lastLabel: string | undefined;
  let lastTitle: string | undefined;
  let requestFooterRender: (() => void) | undefined;
  let isShutdown = false;

  function computeLabel(ctx: ExtensionContext): string {
    return labelForBranch(ctx.sessionManager.getBranch(), (id) => ctx.sessionManager.getLabel(id));
  }

  function computeTitle(ctx: ExtensionContext): string {
    return titleLabelForBranch(ctx.sessionManager.getBranch(), (id) =>
      ctx.sessionManager.getLabel(id),
    );
  }

  function refresh(
    ctx: ExtensionContext,
    { forceTitle = false, forceFooter = false }: { forceTitle?: boolean; forceFooter?: boolean } = {},
  ) {
    if (isShutdown) return;
    const label = computeLabel(ctx);
    const title = formatTitle(computeTitle(ctx), ctx.cwd, isRunning);
    const labelChanged = label !== lastLabel;
    const titleChanged = title !== lastTitle;
    if (labelChanged || titleChanged || forceTitle) {
      lastLabel = label;
      lastTitle = title;
      ctx.ui.setTitle(title);
    }
    if (labelChanged || forceFooter) {
      requestFooterRender?.();
    }
  }

  function installFooter(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    ctx.ui.setFooter(
      buildFooterFactory(
        ctx,
        () => lastLabel ?? computeLabel(ctx),
        (fn) => {
          requestFooterRender = fn;
        },
      ),
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    isRunning = false;
    isShutdown = false;
    lastLabel = undefined;
    lastTitle = undefined;
    if (customFooterEnabled) {
      installFooter(ctx);
    }
    refresh(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    isRunning = true;
    refresh(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    isRunning = false;
    refresh(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => refresh(ctx));
  pi.on("message_end", async (event, ctx) => {
    if (event.message.role === "user") refresh(ctx);
  });
  pi.on("input", async (_event, ctx) => refresh(ctx, { forceTitle: true }));

  pi.on("model_select", async (_event, ctx) => refresh(ctx, { forceFooter: true }));
  pi.on("thinking_level_select", async (_event, ctx) => refresh(ctx, { forceFooter: true }));

  pi.on("session_shutdown", async () => {
    isShutdown = true;
    requestFooterRender = undefined;
  });

  pi.registerCommand("footer", {
    description: "Toggle custom stats footer (cost, context, tps)",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Footer customization is only available in TUI mode", "warning");
        return;
      }
      customFooterEnabled = !customFooterEnabled;
      if (customFooterEnabled) {
        installFooter(ctx);
        ctx.ui.notify("Custom footer enabled", "info");
      } else {
        ctx.ui.setFooter(undefined);
        ctx.ui.notify("Default footer restored", "info");
      }
    },
  });
}
