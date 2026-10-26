# pi-customisations

A combined Pi extension that replaces two existing customisations:

1. **Custom footer** — replaces the whole footer in Pi's TUI with the cost / context / throughput / model layout from the local `ollama-usage-footer.ts` extension, but with all quota, plan, balance and HTTP calls removed.
2. **Session label / terminal title** — replaces `pi-session-name`'s LLM-generated title with the `/tree` row text of the first user message on the active branch. No network calls, no name file, no `pi.setSessionName()`.

## Required Pi version

Pi **1.4.0** or newer (tested against `1.4.0`). The extension uses the `ExtensionAPI`/`ExtensionContext` surface and `ReadonlyFooterDataProvider` introduced in that release.

## What it does

### Footer (`src/footer.ts`)

On every TUI session start the extension installs a whole-footer replacement via `ctx.ui.setFooter()`:

- **Line 1:** `cwd (branch) • <tree-label>` (collapses home to `~`, shows git branch when available, shows the session label from the active branch).
- **Line 2 (left):** accumulated session cost `$X.XXX`, context usage `NN.N%/window`, and the latest response throughput `X.X t/s` when timing data is available.
- **Line 2 (right, aligned):** current model id, plus thinking level for reasoning models, plus provider name when more than one provider is available.
- **Line 3:** every other extension's `ctx.ui.setStatus()` text, sanitised to one line, sorted alphabetically by key.

Use `/footer` to toggle between the custom footer and Pi's built-in footer.

### Session label & title (`src/session-label.ts`)

The label is computed directly from `ctx.sessionManager.getBranch()`:

- Finds the first entry whose `type === "message"` and `message.role === "user"`.
- Flattens the content exactly as `/tree` does: strings pass through; arrays keep only `type: "text"` blocks, concatenated with `""`.
- Slices to 200 characters **before** replacing `\n`/`\t` with spaces and trimming.
- Appends `…` when the slice truncated the raw text.
- Falls back to `(new session)` when the active branch has no user message yet (or its content is empty).

The same label is used:

- in footer line 1 as `<tree-label>`, and
- in the terminal/window title as `${isRunning ? "·" : "✳"} ${label} - ${basename(cwd)}`.

The title glyph switches between `·` (busy) and `✳` (idle) on `agent_start`/`agent_end`.

### Triggers

The label and title are refreshed on:

- `session_start` / session switch
- `session_tree` (branch navigation inside a file)
- `message_end` when a user message lands
- `input` (restores the title after Pi overwrites it at startup)
- `agent_start` / `agent_end` (busy/idle glyph)

## Files

```
pi-customisations/
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
├── .gitignore
├── src/
│   ├── index.ts          # factory, event wiring, /footer command
│   ├── footer.ts         # setFooter factory and formatting helpers
│   └── session-label.ts  # pure tree-label computation
└── test/
    └── smoke.test.ts     # node --test harness
```

## Install / load

The package lives outside `~/.pi/agent/extensions` (e.g. at `/home/rk/dev/pi-customisations`). To try it during development:

```bash
pi --extension /home/rk/dev/pi-customisations
```

To make it permanent, add it to your Pi settings (`~/.pi/agent/settings.json`) under `packages` or `extensions`. For example, as a local path:

```json
{
  "extensions": ["/home/rk/dev/pi-customisations/src/index.ts"]
}
```

or as a package reference once it is published / installed:

```json
{
  "packages": ["npm:pi-customisations"]
}
```

After adding it, run `pi` (or `/reload` inside Pi). You can then delete/disable:

- `~/.pi/agent/extensions/ollama-usage-footer.ts`
- the `npm:pi-session-name` package entry in settings

## Verification

```bash
npm run typecheck   # npx tsc --noEmit
npm test            # node --experimental-strip-types --test test/*.test.ts
```

## Dependencies

- Runtime: none. The extension makes **zero** network calls, zero LLM calls, and reads no API keys.
- Type-only / host-provided peer dependencies: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`.
- Dev dependencies: the same host packages (for type resolution) plus `typescript`.

`@earendil-works/pi-tui` is imported at runtime only for `visibleWidth`/`truncateToWidth`, which are required to match Pi's own footer width handling.
