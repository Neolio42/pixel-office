# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Pixel Office is a local web app that visualizes Claude Code sessions as pixel art workers in an office. You're the boss — you see what each worker is doing in real-time, approve/deny risky operations from the UI, and click workers to focus their terminal. Each Claude Code terminal registers as a worker at a desk via hooks.

## Commands

```bash
npm run dev          # Dev server (custom Node server with WebSocket, NOT next dev)
npm run build        # Production build
npm start            # Production server
npm run lint         # ESLint
```

No test framework is configured.

## Architecture

**Stack:** Next.js 16 + React 19 + TypeScript + WebSocket (ws) + Canvas rendering + Tailwind CSS 4

**Custom Server (`server.ts`):** Required because Next.js doesn't natively support WebSocket. Initializes WSS, handles stale session cleanup, then delegates HTTP to Next.js.

### Data Flow

```
Claude Code Terminal → hooks (curl POST) → /api/hooks/* routes
  → classify tool risk → auto-approve or create PendingApproval
  → broadcast state via WebSocket → React UI renders on canvas
  → User approves/denies → WebSocket → resolve Promise → hook responds → Claude Code continues
```

### Key Constraint: `globalThis` State

Sessions, pending approvals, and the WebSocket server live on `globalThis` (not module scope) because Next.js App Router re-evaluates modules on HMR. All state access must go through the store/ws-server/approval-queue modules that read from `globalThis`.

### Module Layout

- **`src/app/api/hooks/`** — 6 hook endpoints matching Claude Code hook events (session-start, pre-tool-use, post-tool-use, notification, session-end, stop). PreToolUse is the critical one — it blocks with a Promise until the user decides.
- **`src/lib/`** — Server-side logic: `store.ts` (session CRUD), `ws-server.ts` (WebSocket init/broadcast), `tool-classifier.ts` (risk classification + shfmt AST bash parsing), `approval-queue.ts` (Promise-based approval blocking), `types.ts`.
- **`src/game/`** — Canvas rendering engine: `office-layout.ts` (grid/rooms/furniture), `renderer.ts` (painter's algorithm: floors→walls→furniture→workers→bubbles), `sprites.ts` (character animation frames), `asset-loader.ts` (PNG loading + HSBC colorization), `worker-entity.ts` (position/movement/state machine with L-shaped pathfinding).
- **`src/hooks/usePixelOffice.ts`** — Main game hook: WebSocket connection, asset loading, 60fps game loop, approval state management.
- **`src/components/`** — React overlay components: `OfficeCanvas.tsx` (canvas + mouse/keyboard + demo mode), `ApprovalToast.tsx`, `WorkerPanel.tsx`, `WorkerPopup.tsx`.
- **`public/assets/`** — Sprite sheets (characters, furniture, walls, floors). Characters are 112×96 PNG (7 frames × 3 directions, each frame 16×32).

### Tool Classification Tiers

In `tool-classifier.ts`, tools are classified into three approval tiers:
- **Auto-approve:** Read/Grep/Glob/Edit/Write/safe Bash commands/safe git subcommands/MCP tools
- **Ask boss:** git push, rm, sudo, npm install, unknown Bash commands
- **Bash parsing:** Uses `shfmt --tojson` for AST-based compound command analysis; falls back to whitespace splitting

### Canvas Rendering

- Logical resolution: 1280×960 (20×15 tiles at 16px, 4× scale)
- Painter's algorithm render order: floors, walls, furniture (Y-sorted), workers (Y-sorted), speech bubbles
- Pixelated rendering (`image-rendering: pixelated`)

### Worker State Machine

States: `idle`, `typing`, `reading`, `waiting` (needs approval), `walking`, `leaving`
- Workers animate at desks based on current tool type
- Idle workers walk to break room, return when new tool fires
- Leaving workers walk to the door, then get removed

## Agent Usage

Always use **foreground** agents unless the task is genuinely async (e.g., a long build running while you do something else). Default to foreground.
