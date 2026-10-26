import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { buildFooterFactory } from "./footer.ts";
import { labelForBranch } from "./session-label.ts";

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
  let requestFooterRender: (() => void) | undefined;

  function computeLabel(ctx: ExtensionContext): string {
    return labelForBranch(ctx.sessionManager.getBranch());
  }

  function refresh(ctx: ExtensionContext) {
    const label = computeLabel(ctx);
    lastLabel = label;
    ctx.ui.setTitle(formatTitle(label, ctx.cwd, isRunning));
    requestFooterRender?.();
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
  pi.on("input", async (_event, ctx) => refresh(ctx));

  pi.on("session_shutdown", async () => {
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
