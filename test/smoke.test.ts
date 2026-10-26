import { describe, it } from "node:test";
import assert from "node:assert/strict";

import extension from "../src/index.ts";
import {
  labelForBranch,
  userRowText,
  NEW_SESSION_LABEL,
} from "../src/session-label.ts";
import { buildFooterFactory } from "../src/footer.ts";

describe("session-label", () => {
  function userEntry(text: string) {
    return {
      type: "message" as const,
      message: { role: "user" as const, content: text },
    };
  }

  function systemEntry() {
    return {
      type: "message" as const,
      message: { role: "system" as const, content: "ignored" },
    };
  }

  it("returns the first user message text", () => {
    const branch = [systemEntry(), userEntry("hello world")];
    assert.equal(labelForBranch(branch as any), "hello world");
  });

  it("prepends [label] when the first user entry has a user-set label", () => {
    const entry = {
      type: "message" as const,
      message: { role: "user" as const, content: "hello world" },
      id: "entry-1",
    };
    const branch = [entry];
    const getLabel = (id: string) => (id === "entry-1" ? "bookmark" : undefined);
    assert.equal(labelForBranch(branch as any, getLabel), "[bookmark] hello world");
  });

  it("keeps the (new session) fallback for an image-only message even with a label", () => {
    const entry = {
      type: "message" as const,
      message: { role: "user" as const, content: [{ type: "image" }] },
      id: "entry-1",
    };
    const branch = [entry];
    const getLabel = (id: string) => (id === "entry-1" ? "bookmark" : undefined);
    assert.equal(labelForBranch(branch as any, getLabel), NEW_SESSION_LABEL);
  });

  it("flattens newlines and tabs to spaces before truncating", () => {
    const branch = [userEntry("line1\nline2\tline3")];
    assert.equal(labelForBranch(branch as any), "line1 line2 line3");
  });

  it("truncates at 200 raw characters and appends an ellipsis", () => {
    const long = "a".repeat(250);
    const branch = [userEntry(long)];
    const expected = "a".repeat(200) + "…";
    assert.equal(labelForBranch(branch as any), expected);
  });

  it("counts raw length before whitespace normalisation for truncation", () => {
    // 150 newlines + 100 letters = 250 raw chars; slice to 200 keeps 150 newlines + 50 letters.
    // After normalisation those 150 newlines become spaces, then trim() removes the leading
    // whitespace, leaving only the 50 letters.
    const text = "\n".repeat(150) + "b".repeat(100);
    const branch = [userEntry(text)];
    const result = labelForBranch(branch as any);
    assert.equal(result, "b".repeat(50) + "…");
  });

  it("returns (new session) when the branch has no user message", () => {
    const branch = [systemEntry()];
    assert.equal(labelForBranch(branch as any), NEW_SESSION_LABEL);
  });

  it("returns (new session) for an empty branch", () => {
    assert.equal(labelForBranch([]), NEW_SESSION_LABEL);
  });

  it("returns (new session) when the first user message has no text content", () => {
    const branch = [
      { type: "message" as const, message: { role: "user" as const, content: [{ type: "image" }] } },
    ];
    assert.equal(labelForBranch(branch as any), NEW_SESSION_LABEL);
  });

  it("follows a branch switch to a different first user message", () => {
    const branchA = [userEntry("first on A"), { type: "message" as const, message: { role: "assistant" as const, content: "ok" } }];
    const branchB = [userEntry("first on B"), { type: "message" as const, message: { role: "assistant" as const, content: "ok" } }];
    assert.equal(labelForBranch(branchA as any), "first on A");
    assert.equal(labelForBranch(branchB as any), "first on B");
  });

  it("strips nothing because it computes the content, not the prefixed row text", () => {
    // The /tree row would be "user: hello". labelForBranch returns just "hello".
    const branch = [userEntry("user: hello")];
    assert.equal(labelForBranch(branch as any), "user: hello");
  });
});

describe("footer renderer", () => {
  function makeTheme() {
    return {
      fg: (_color: string, text: string) => text,
    };
  }

  function makeFooterData(branch = "main", statuses: [string, string][] = []) {
    return {
      getGitBranch: () => branch,
      getAvailableProviderCount: () => 1,
      getExtensionStatuses: () => new Map(statuses),
      onBranchChange: () => () => {},
    };
  }

  function makeCtx(options: {
    cwd?: string;
    cost?: number;
    tps?: number;
    contextPercent?: number | null;
    contextWindow?: number;
    modelId?: string;
    provider?: string;
    reasoning?: boolean;
    thinkingLevel?: string;
  } = {}) {
    const entries: any[] = [];
    if (options.cost !== undefined || options.tps !== undefined) {
      entries.push({
        type: "message",
        message: {
          role: "assistant",
          usage: {
            output: options.tps ? 100 : 0,
            cost: { total: options.cost ?? 0 },
          },
          durationMs: options.tps ? (100 / options.tps) * 1000 : undefined,
        },
      });
    }
    return {
      mode: "tui" as const,
      cwd: options.cwd ?? "/home/rk/dev/nova",
      sessionManager: {
        getCwd: () => options.cwd ?? "/home/rk/dev/nova",
        getBranch: () => [],
        getEntries: () => entries,
      },
      getContextUsage: () =>
        options.contextPercent !== undefined
          ? {
              tokens: 1000,
              contextWindow: options.contextWindow ?? 200000,
              percent: options.contextPercent,
            }
          : undefined,
      model: options.modelId
        ? {
            id: options.modelId,
            provider: options.provider ?? "test-provider",
            contextWindow: options.contextWindow ?? 200000,
            reasoning: options.reasoning ?? false,
          }
        : undefined,
      thinkingLevel: options.thinkingLevel as any,
      ui: {
        setStatus: () => {},
        setFooter: () => {},
        setTitle: () => {},
        notify: () => {},
      },
    };
  }

  it("renders line 1 with cwd, branch, and label", () => {
    const ctx = makeCtx({ cwd: "/home/rk/dev/nova" }) as any;
    const factory = buildFooterFactory(ctx, () => "my-label", () => {}, "/home/rk");
    const component = factory({ requestRender: () => {} }, makeTheme() as any, makeFooterData("main"));
    const lines = component.render(80);
    assert.equal(lines[0], "~/dev/nova (main) • my-label");
  });

  it("renders line 2 with cost, context, and tps", () => {
    const ctx = makeCtx({ cost: 1.234, tps: 42.5, contextPercent: 25.5, contextWindow: 200000, modelId: "claude" }) as any;
    const factory = buildFooterFactory(ctx, () => "label", () => {}, "/home/rk");
    const component = factory({ requestRender: () => {} }, makeTheme() as any, makeFooterData());
    const lines = component.render(120);
    assert.match(lines[1], /\$1\.234/);
    assert.match(lines[1], /25\.5%\/200k/);
    assert.match(lines[1], /42\.5 t\/s/);
    assert.match(lines[1], /claude$/);
  });

  it("renders the model with thinking level when reasoning is true", () => {
    const ctx = makeCtx({ modelId: "o3", reasoning: true, thinkingLevel: "high" }) as any;
    const factory = buildFooterFactory(ctx, () => "label", () => {}, "/home/rk");
    const component = factory({ requestRender: () => {} }, makeTheme() as any, makeFooterData());
    const lines = component.render(120);
    assert.match(lines[1], /o3 • high$/);
  });

  it("renders extension statuses on line 3, sorted alphabetically and sanitised", () => {
    const ctx = makeCtx() as any;
    const factory = buildFooterFactory(ctx, () => "label", () => {}, "/home/rk");
    const component = factory(
      { requestRender: () => {} },
      makeTheme() as any,
      makeFooterData("main", [
        ["zeta", "zeta\nstatus"],
        ["alpha", "alpha status"],
      ]),
    );
    const lines = component.render(120);
    assert.equal(lines[2], "alpha status zeta status");
  });

  it("adapts line 2 layout to narrow, exact-fit and wide widths", () => {
    const ctx = makeCtx({
      modelId: "m",
      contextWindow: 200000,
    }) as any;
    const factory = buildFooterFactory(ctx, () => "label", () => {}, "/home/rk");
    const component = factory({ requestRender: () => {} }, makeTheme() as any, makeFooterData());
    // statsLeft = "$0.000 ?/200k" (13 chars), right = "m" (1 char), minPadding = 2.
    assert.equal(component.render(20)[1], "$0.000 ?/200k      m");
    assert.equal(component.render(16)[1], "$0.000 ?/200k  m");
    assert.equal(component.render(14)[1], "$0.000 ?/200k");
  });

  it("prefixes the model with the provider name when more than one provider is available", () => {
    const ctx = makeCtx({
      modelId: "m",
      provider: "p",
      contextWindow: 200000,
    }) as any;
    const factory = buildFooterFactory(ctx, () => "label", () => {}, "/home/rk");
    const component = factory(
      { requestRender: () => {} },
      makeTheme() as any,
      {
        getGitBranch: () => null,
        getAvailableProviderCount: () => 2,
        getExtensionStatuses: () => new Map(),
        onBranchChange: () => () => {},
      },
    );
    const lines = component.render(20);
    assert.equal(lines[1], "$0.000 ?/200k  (p) m");
  });
});

describe("extension wiring", () => {
  function createMockPi() {
    const handlers = new Map<string, any>();
    const commands = new Map<string, any>();
    const calls = {
      setFooter: [] as any[],
      setTitle: [] as string[],
      setStatus: [] as any[],
      notify: [] as any[],
    };

    const ui = {
      setFooter: (factory: any) => calls.setFooter.push(factory),
      setTitle: (title: string) => calls.setTitle.push(title),
      setStatus: (key: string, text: any) => calls.setStatus.push([key, text]),
      notify: (message: string, type?: any) => calls.notify.push([message, type]),
    };

    const pi = {
      on: (event: string, handler: any) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      },
      registerCommand: (name: string, options: any) => {
        commands.set(name, options);
      },
      handlers,
      commands,
      calls,
      ui,
    };
    return pi;
  }

  function makeCtx(pi: ReturnType<typeof createMockPi>) {
    return {
      mode: "tui" as const,
      cwd: "/home/rk/dev/nova",
      sessionManager: {
        getCwd: () => "/home/rk/dev/nova",
        getBranch: () => [],
        getEntries: () => [],
        getLabel: (_id: string) => undefined,
      },
      getContextUsage: () => undefined,
      model: undefined,
      ui: pi.ui,
    };
  }

  it("registers the /footer command and session lifecycle handlers", () => {
    const pi = createMockPi();
    extension(pi as any);
    assert.ok(pi.commands.has("footer"));
    assert.ok(pi.handlers.has("session_start"));
    assert.ok(pi.handlers.has("agent_start"));
    assert.ok(pi.handlers.has("agent_end"));
    assert.ok(pi.handlers.has("session_tree"));
    assert.ok(pi.handlers.has("message_end"));
    assert.ok(pi.handlers.has("input"));
    assert.ok(pi.handlers.has("model_select"));
    assert.ok(pi.handlers.has("thinking_level_select"));
  });

  it("installs the custom footer on session_start and sets the title", async () => {
    const pi = createMockPi();
    extension(pi as any);
    const ctx = makeCtx(pi);
    await pi.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);
    assert.equal(pi.calls.setFooter.length, 1);
    assert.match(pi.calls.setTitle[0], /✳ \(new session\) - nova/);
  });

  it("/footer toggles the custom footer off and back on", async () => {
    const pi = createMockPi();
    extension(pi as any);
    const ctx = makeCtx(pi);
    await pi.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);
    assert.equal(pi.calls.setFooter.length, 1);

    const footerCommand = pi.commands.get("footer");
    await footerCommand.handler("", ctx);
    assert.equal(pi.calls.setFooter.length, 2);
    assert.equal(pi.calls.setFooter[1], undefined);
    assert.equal(pi.calls.notify.at(-1)[0], "Default footer restored");

    await footerCommand.handler("", ctx);
    assert.equal(pi.calls.setFooter.length, 3);
    assert.equal(typeof pi.calls.setFooter[2], "function");
    assert.equal(pi.calls.notify.at(-1)[0], "Custom footer enabled");
  });

  it("switches the title glyph on agent_start and agent_end", async () => {
    const pi = createMockPi();
    extension(pi as any);
    const ctx = makeCtx(pi);
    await pi.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);
    pi.calls.setTitle.length = 0;

    await pi.handlers.get("agent_start")({ type: "agent_start" }, ctx);
    assert.match(pi.calls.setTitle[0], /^· /);

    await pi.handlers.get("agent_end")({ type: "agent_end", messages: [] }, ctx);
    assert.match(pi.calls.setTitle[1], /^✳ /);
  });

  it("does not request footer render after session_shutdown", async () => {
    const pi = createMockPi();
    extension(pi as any);
    const ctx = makeCtx(pi);
    await pi.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

    const factory = pi.calls.setFooter[0];
    const renders: string[] = [];
    const theme = { fg: (_color: string, text: string) => text };
    const footerData = {
      getGitBranch: () => null,
      getAvailableProviderCount: () => 1,
      getExtensionStatuses: () => new Map(),
      onBranchChange: () => () => {},
    };
    factory({ requestRender: () => renders.push("render") }, theme as any, footerData as any);

    await pi.handlers.get("session_shutdown")({ type: "session_shutdown" }, ctx);

    await pi.handlers.get("message_end")(
      { type: "message_end", message: { role: "user", content: "hi" } as any },
      ctx,
    );
    await pi.handlers.get("input")({ type: "input" } as any, ctx);

    assert.equal(renders.length, 0);
  });

  it("input restores the title without re-rendering the footer when the label is unchanged", async () => {
    const pi = createMockPi();
    extension(pi as any);
    const ctx = makeCtx(pi);
    await pi.handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);

    const factory = pi.calls.setFooter[0];
    const renders: string[] = [];
    const theme = { fg: (_color: string, text: string) => text };
    const footerData = {
      getGitBranch: () => null,
      getAvailableProviderCount: () => 1,
      getExtensionStatuses: () => new Map(),
      onBranchChange: () => () => {},
    };
    factory({ requestRender: () => renders.push("render") }, theme as any, footerData as any);

    pi.calls.setTitle.length = 0;
    renders.length = 0;

    await pi.handlers.get("input")({ type: "input" } as any, ctx);

    assert.equal(pi.calls.setTitle.length, 1);
    assert.equal(renders.length, 0);
  });
});
