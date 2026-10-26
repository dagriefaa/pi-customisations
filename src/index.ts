import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { buildFooterFactory } from "./footer.ts";
import { labelForBranch, titleLabelForBranch } from "./session-label.ts";

const SUBAGENT_ASYNC_STARTED_EVENT = "subagent:async-started";
const SUBAGENT_ASYNC_COMPLETE_EVENT = "subagent:async-complete";
const SLASH_SUBAGENT_STARTED_EVENT = "subagent:slash:started";
const SLASH_SUBAGENT_RESPONSE_EVENT = "subagent:slash:response";
const SUBAGENT_RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const SUBAGENT_RPC_REPLY_EVENT_PREFIX = "subagents:rpc:v1:reply:";

const ACTIVE_SUBAGENT_STATES = new Set(["running", "queued", "pending"]);

function sanitizeTitle(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, " ").trim();
}

function formatTitle(label: string, cwd: string, isRunning: boolean): string {
  const prefix = isRunning ? "▶️" : "⏸️";
  return `${prefix} ${sanitizeTitle(label)} - ${path.basename(cwd)}`;
}

function isActiveSubagentState(state: unknown): boolean {
  return typeof state === "string" && ACTIVE_SUBAGENT_STATES.has(state);
}

export default function piCustomisations(pi: ExtensionAPI) {
  let activeCtx: ExtensionContext | undefined;
  let parentStreaming = false;
  const liveRuns = new Set<string>();
  let isRunning = false;
  let customFooterEnabled = true;
  let lastLabel: string | undefined;
  let lastTitle: string | undefined;
  let requestFooterRender: (() => void) | undefined;
  let isShutdown = false;
  let eventUnsubs: Array<() => void> = [];
  let seedUnsub: (() => void) | undefined;

  function computeLabel(ctx: ExtensionContext): string {
    return labelForBranch(ctx.sessionManager.getBranch(), (id) => ctx.sessionManager.getLabel(id));
  }

  function computeTitle(ctx: ExtensionContext): string {
    return titleLabelForBranch(ctx.sessionManager.getBranch(), (id) =>
      ctx.sessionManager.getLabel(id),
    );
  }

  function recomputeRunning(): boolean {
    return parentStreaming || liveRuns.size > 0;
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

  function setRunning(ctx: ExtensionContext, nowRunning: boolean) {
    if (nowRunning === isRunning) return;
    isRunning = nowRunning;
    refresh(ctx);
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

  function subscribeToSubagentEvents() {
    if (!pi.events || eventUnsubs.length > 0) return;

    function handleAsyncStarted(payload: unknown) {
      try {
        const id =
          payload && typeof payload === "object" && "id" in payload && typeof payload.id === "string"
            ? payload.id
            : undefined;
        if (!id) return;
        liveRuns.add(id);
        if (activeCtx && !isShutdown) setRunning(activeCtx, recomputeRunning());
      } catch {
        // Ignore malformed events; never throw inside an event handler.
      }
    }

    function handleAsyncComplete(payload: unknown) {
      try {
        const id =
          payload && typeof payload === "object" && "id" in payload && typeof payload.id === "string"
            ? payload.id
            : undefined;
        if (!id) return;
        liveRuns.delete(id);
        if (activeCtx && !isShutdown) setRunning(activeCtx, recomputeRunning());
      } catch {
        // Ignore malformed events; never throw inside an event handler.
      }
    }

    function handleSlashStarted(payload: unknown) {
      try {
        const requestId =
          payload &&
          typeof payload === "object" &&
          "requestId" in payload &&
          typeof payload.requestId === "string"
            ? payload.requestId
            : undefined;
        if (!requestId) return;
        liveRuns.add(`slash:${requestId}`);
        if (activeCtx && !isShutdown) setRunning(activeCtx, recomputeRunning());
      } catch {
        // Ignore malformed events; never throw inside an event handler.
      }
    }

    function handleSlashResponse(payload: unknown) {
      try {
        const requestId =
          payload &&
          typeof payload === "object" &&
          "requestId" in payload &&
          typeof payload.requestId === "string"
            ? payload.requestId
            : undefined;
        if (!requestId) return;
        liveRuns.delete(`slash:${requestId}`);
        if (activeCtx && !isShutdown) setRunning(activeCtx, recomputeRunning());
      } catch {
        // Ignore malformed events; never throw inside an event handler.
      }
    }

    eventUnsubs = [
      pi.events.on(SUBAGENT_ASYNC_STARTED_EVENT, handleAsyncStarted),
      pi.events.on(SUBAGENT_ASYNC_COMPLETE_EVENT, handleAsyncComplete),
      pi.events.on(SLASH_SUBAGENT_STARTED_EVENT, handleSlashStarted),
      pi.events.on(SLASH_SUBAGENT_RESPONSE_EVENT, handleSlashResponse),
    ];
  }

  function unsubscribeFromSubagentEvents() {
    for (const unsub of eventUnsubs) {
      try {
        unsub();
      } catch {
        // Best-effort cleanup; never throw during shutdown.
      }
    }
    eventUnsubs = [];
  }

  function seedLiveRunsFromRpc(ctx: ExtensionContext) {
    if (!pi.events) return;

    seedUnsub?.();

    const requestId = randomUUID();
    const replyChannel = `${SUBAGENT_RPC_REPLY_EVENT_PREFIX}${requestId}`;

    seedUnsub = pi.events.on(replyChannel, (reply: unknown) => {
      try {
        if (!reply || typeof reply !== "object") return;
        const r = reply as Record<string, unknown>;
        if (r.success !== true) return;
        const data = r.data;
        if (!data || typeof data !== "object") return;
        const snapshot = (data as Record<string, unknown>).asyncSnapshot;
        if (!snapshot || typeof snapshot !== "object") return;
        const runs = (snapshot as Record<string, unknown>).runs;
        if (!Array.isArray(runs)) return;

        for (const run of runs) {
          if (!run || typeof run !== "object") continue;
          const runId = (run as Record<string, unknown>).id;
          const state = (run as Record<string, unknown>).state;
          if (typeof runId === "string" && isActiveSubagentState(state)) {
            liveRuns.add(runId);
          }
        }

        if (activeCtx === ctx && !isShutdown) {
          setRunning(ctx, recomputeRunning());
        }
      } catch {
        // Defensive: ignore malformed RPC replies.
      } finally {
        seedUnsub?.();
        seedUnsub = undefined;
      }
    });

    try {
      pi.events.emit(SUBAGENT_RPC_REQUEST_EVENT, {
        version: 1,
        requestId,
        method: "status",
        params: {},
      });
    } catch {
      // If the bus is broken, clean up the pending listener.
      seedUnsub?.();
      seedUnsub = undefined;
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    activeCtx = ctx;
    parentStreaming = false;
    liveRuns.clear();
    isRunning = false;
    isShutdown = false;
    lastLabel = undefined;
    lastTitle = undefined;
    requestFooterRender = undefined;
    if (customFooterEnabled) {
      installFooter(ctx);
    }
    refresh(ctx);
    subscribeToSubagentEvents();
    seedLiveRunsFromRpc(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    parentStreaming = true;
    activeCtx = ctx;
    setRunning(ctx, recomputeRunning());
  });

  pi.on("agent_end", async (_event, ctx) => {
    parentStreaming = false;
    activeCtx = ctx;
    setRunning(ctx, recomputeRunning());
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
    parentStreaming = false;
    liveRuns.clear();
    isRunning = false;
    activeCtx = undefined;
    requestFooterRender = undefined;
    unsubscribeFromSubagentEvents();
    seedUnsub?.();
    seedUnsub = undefined;
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
