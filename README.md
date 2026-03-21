# Pixel Office

A real-time pixel art visualization of your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions. Each terminal running Claude Code appears as a worker sitting at a desk in a tiny office. You're the boss — watch them work, approve risky operations, and click workers to see what they're doing.

![Pixel Office](https://img.shields.io/badge/status-alpha-orange) ![License](https://img.shields.io/badge/license-MIT-blue)

## Quick start

```bash
npx @neolio42/pixel-office
```

That's it. First run automatically registers Claude Code hooks, starts the server, and opens your browser. Start a Claude Code session in any terminal — a worker appears at a desk.

## How it works

```
Claude Code Terminal → hooks (curl POST) → Pixel Office server
  → classify tool risk → auto-approve safe ops, block risky ones
  → WebSocket → browser renders workers on canvas
  → you approve/deny → Claude Code continues
```

Each Claude Code session registers as a pixel art worker via [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks). Workers animate at their desks — reading, typing, or waiting for your approval. Risky operations (git push, rm, sudo) require you to approve or deny from the UI before Claude can continue.

## Features

- **Real-time visualization** — workers appear, animate, and leave as Claude Code sessions start and end
- **Approval flow** — risky Bash commands (rm, sudo, git push) block until you approve/deny from the browser
- **Tool classification** — AST-based Bash parsing via `shfmt` to accurately classify compound commands
- **Multi-session** — run multiple Claude Code terminals, each gets their own desk
- **Break room** — idle workers walk to the break room and return when new work arrives
- **Worker panel** — click any worker to see their current tool, session info, and recent activity

## Prerequisites

- **Node.js** 20+
- **Claude Code** CLI installed and working
- **shfmt** (optional, for AST-based Bash command classification — falls back to whitespace splitting)
  ```bash
  brew install shfmt  # macOS
  ```

## Setup from source

If you want to develop or customize Pixel Office:

```bash
git clone https://github.com/Neolio42/pixel-office.git
cd pixel-office
npm install
npm run dev
```

On first `npm start`, hooks are registered automatically. Or manage them manually:

```bash
npm run setup      # Register hooks in ~/.claude/settings.json
npm run uninstall  # Remove all Pixel Office hooks
```

## Commands

```bash
npm run dev        # Dev server (custom Node server with WebSocket)
npm run build      # Production build
npm start          # Start server (auto-registers hooks on first run)
npm run setup      # Manually register hooks
npm run uninstall  # Remove all Pixel Office hooks
npm run lint       # ESLint
```

## Architecture

**Stack:** Next.js 16 · React 19 · TypeScript · WebSocket · Canvas · Tailwind CSS 4

The app uses a custom Node server (`server.ts`) because Next.js doesn't natively support WebSocket. All state lives on `globalThis` to survive HMR re-evaluation.

```
src/
├── app/api/hooks/   # 6 hook endpoints matching Claude Code events
├── lib/             # Server: session store, WebSocket, tool classifier, approval queue
├── game/            # Canvas engine: office layout, renderer, sprites, pathfinding
├── hooks/           # React hooks (game loop, WebSocket, approval state)
└── components/      # React overlays (canvas, approval toasts, worker panel)
```

### Tool classification

Tools are classified into tiers:
- **Auto-approve:** Read, Grep, Glob, Edit, Write, safe Bash commands, safe git subcommands
- **Ask boss:** git push, rm, sudo, npm install, unknown Bash commands
- **Bash parsing:** Uses `shfmt --tojson` for AST-based analysis of compound commands; falls back to whitespace splitting

### Canvas rendering

- Logical resolution: 1280×960 (20×15 tiles, 16px, 4× scale)
- Painter's algorithm: floors → walls → furniture (Y-sorted) → workers (Y-sorted) → speech bubbles
- Pixelated rendering with `image-rendering: pixelated`

### Worker states

`idle` → `typing` → `reading` → `waiting` (needs approval) → `walking` → `leaving`

Workers animate at desks based on current tool type. Idle workers walk to the break room and return when new work arrives. Leaving workers walk to the door, then get removed.

## Hooks reference

Pixel Office uses 7 Claude Code hooks. All are fire-and-forget except `PreToolUse`, which blocks (up to 30s) for approval on risky operations.

| Hook | Endpoint | Blocking | Purpose |
|------|----------|----------|---------|
| `SessionStart` | `/api/hooks/session-start` | No | Register worker at desk |
| `PreToolUse` | `/api/hooks/pre-tool-use` | **Yes (30s)** | Classify tool, block if risky |
| `PostToolUse` | `/api/hooks/post-tool-use` | No | Update worker state |
| `Notification` | `/api/hooks/notification` | No | Show notification bubble |
| `UserPromptSubmit` | `/api/hooks/user-prompt` | No | Update worker's current focus |
| `Stop` | `/api/hooks/stop` | No | Set worker idle |
| `SessionEnd` | `/api/hooks/session-end` | No | Remove worker from office |

## Environment variable

Set `PIXEL_OFFICE_HAIKU=1` in any Claude Code session to skip Pixel Office hooks for that session (useful for lightweight/scripted runs).

## License

[MIT](LICENSE)
