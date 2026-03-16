# Pixel Office — Plan

Local web app that turns Claude Code sessions into a pixel art office you manage as the boss. Each Claude Code terminal is a worker at a desk. You see what they're doing, get notified when they need you, and approve/deny risky operations from the UI instead of switching terminals.

---

## Core Concept

- **You are the boss.** Top-down view of a pixel art office.
- **Each Claude Code session = one worker.** They animate based on what they're doing.
- **Workers do their thing autonomously.** Low-risk operations auto-approve.
- **When something needs your attention, the worker comes to you.** Speech bubble, notification, you handle it from the UI.
- **Click a worker → opens/focuses their terminal.** For when you need to type a response.

---

## Architecture

```
┌─────────────────────────────────────┐
│         Next.js Web App             │
│         (localhost:3000)            │
│                                     │
│  ┌───────────┐   ┌───────────────┐ │
│  │ Pixel Art  │   │ WebSocket     │ │
│  │ Canvas UI  │   │ Server        │ │
│  │ (React)    │   │ (real-time)   │ │
│  └───────────┘   └───────────────┘ │
│                         ▲           │
│                         │           │
└─────────────────────────┼───────────┘
                          │ HTTP POST events
                          │
            ┌─────────────┴──────────────┐
            │   Claude Code Hooks        │
            │   (~/.claude/settings.json)│
            │                            │
            │  PreToolUse  → POST /event │
            │  PostToolUse → POST /event │
            │  Notification→ POST /event │
            │  Stop        → POST /event │
            └────────────────────────────┘
                          │
            ┌─────────────┴──────────────┐
            │  Claude Code Sessions      │
            │  (regular terminals)       │
            │                            │
            │  Terminal 1 → Worker 1     │
            │  Terminal 2 → Worker 2     │
            │  Terminal 3 → Worker 3     │
            └────────────────────────────┘
```

### How it works

1. You open Claude Code in any terminal — hooks fire, Next.js app registers a new worker
2. As Claude Code does stuff, hooks send events to the app
3. The pixel office UI shows workers animating in real time
4. When a PreToolUse hook fires for something risky, the app holds the decision
5. Worker shows a speech bubble — "Boss, can I push to main?"
6. You click approve/deny in the UI
7. Hook responds with the decision, Claude Code continues or stops

### Key tech decisions

- **Next.js 15** — local dev server, API routes for hook events, React for UI
- **Canvas rendering** — pixel art office, character animations, based on Pixel Agents' approach
- **WebSocket** — real-time updates from server to UI (hooks POST to API route → WebSocket pushes to browser)
- **Claude Code hooks** — the only integration point. No Claude Code modification needed.
- **JSONL transcript reading** — supplement hooks with transcript parsing for richer status (what file they're editing, what they're searching for, etc.)

---

## Smart Approval System

Not blanket auto-approve, not ask-about-everything. Three tiers:

### Auto-approve (worker just does it, no bubble)
- Read operations: Glob, Grep, Read, LS
- File edits within project directory
- Build/test commands: npm test, npm run build, xcodebuild, etc.
- Git: status, log, diff, add, commit
- Node/npx within project

### Boss approval (speech bubble, you decide)
- Git push, force push, reset
- Deleting files outside build artifacts
- Commands touching paths outside project directory
- Installing/removing dependencies (npm install, pip install)
- Network requests to external services
- Any command the worker hasn't run before (learned trust)

### Learned trust
- Track what each worker has done
- First time a worker runs an unfamiliar command → ask boss
- Boss approves → remember it for this worker
- Over time, workers need less supervision
- New workers start strict, earn autonomy

---

## MVP Scope

### Phase 1 — Hook server + basic UI
- Next.js app with API routes receiving hook events
- Register Claude Code sessions as workers
- Basic pixel art office with desks
- Workers show up when sessions start, disappear when they end
- Worker state: idle, typing (writing code), reading (searching), waiting (needs input)

### Phase 2 — Smart approval
- PreToolUse hooks route through the app
- Risk classification (auto/ask/deny)
- Speech bubbles for boss-approval items
- Approve/deny from UI
- Decision sent back to hook

### Phase 3 — Rich status
- Parse JSONL transcripts for detailed status
- Show what file a worker is editing
- Show what they're searching for
- Show recent tool calls in a worker detail panel
- Click worker → focus terminal

### Phase 4 — Gamification (post-MVP)
- XP for shipping (smart — based on meaningful commits, not volume)
- Currency to "hire" more workers
- Office upgrades
- Worker levels (new hire → senior → lead)
- Leaderboard across projects

---

## References

### Pixel Agents (visual layer)
- **Repo:** https://github.com/pablodelucca/pixel-agents
- **What to take:** Character animation system, office layout with tiles/furniture, speech bubbles, canvas rendering approach
- **Sprites:** JIK-A-4 Metro City asset pack — six character options, state-based animations (typing, reading, idle, walking)
- **Architecture:** React + canvas, BFS pathfinding for character movement, character state machine

### Executive (session management)
- **Repo:** https://github.com/ncr5012/executive
- **What to take:** Hook integration pattern, session auto-registration, real-time status tracking, audio notifications
- **Hooks:** PreToolUse, PostToolUse, Notification, Stop — shell scripts in ~/.claude/settings.json that POST to the dashboard
- **Key insight:** Uses Server-Sent Events for real-time browser updates. We'd use WebSocket instead for bidirectional communication (needed for approval responses).

### AgentRoom (standalone app reference)
- **Repo:** https://github.com/liuyixin-louis/agentroom
- **What to take:** Rust file watcher for JSONL transcripts, work room vs break room concept, project-specific filtering
- **Architecture:** Tauri v2 + React 18 + Canvas 2D. We're doing Next.js instead but the transcript parsing logic is reusable.

### Claude Code Hooks Documentation
- Hooks are configured in `~/.claude/settings.json`
- Each hook is a shell command that fires on a lifecycle event
- PreToolUse hooks can return `{"decision": "approve"}` or `{"decision": "deny"}` to control tool execution
- Hook receives event data via stdin as JSON
- This is the entire integration surface — no Claude Code code modification needed

### Get Shit Done (workflow reference, not in MVP)
- **Repo:** https://github.com/gsd-build/get-shit-done
- **What to reference later:** Phase-based execution, parallel agent waves, atomic commits, verification system
- **Relevant for:** Phase 4 gamification — could integrate GSD's workflow as the "how work gets structured" layer

---

## Open Questions

- **Terminal focusing:** How to programmatically focus a specific terminal window from a web app? AppleScript on macOS could work. Need to track terminal PID or window ID.
- **Hook response mechanism:** PreToolUse hooks need to block and wait for the boss's decision. The hook script would need to POST to the app, then poll/wait for the response before returning the JSON decision. Need to figure out timeout behavior.
- **Multiple projects:** If you have workers on different projects, do they share one office or have separate floors?
- **Sprite assets:** Use Pixel Agents' Metro City assets (MIT licensed) or find/make custom ones?
- **Sound:** Executive has audio notifications. Worth adding? Probably yes — audio ping when a worker needs you.

---

## File Structure (proposed)

```
pixel-office/
├── PLAN.md
├── package.json
├── next.config.js
├── src/
│   ├── app/
│   │   ├── page.tsx              # Main office view
│   │   ├── api/
│   │   │   ├── events/route.ts   # Receives hook events
│   │   │   └── approve/route.ts  # Returns approval decisions
│   │   └── layout.tsx
│   ├── components/
│   │   ├── Office.tsx            # Canvas rendering
│   │   ├── Worker.tsx            # Character animations
│   │   ├── SpeechBubble.tsx      # Approval requests
│   │   └── WorkerDetail.tsx      # Side panel with status
│   ├── hooks/
│   │   └── useWebSocket.ts       # Real-time updates
│   ├── lib/
│   │   ├── session-manager.ts    # Track active sessions
│   │   ├── risk-classifier.ts    # Auto/ask/deny logic
│   │   ├── transcript-parser.ts  # JSONL reading
│   │   └── approval-queue.ts     # Pending decisions
│   └── assets/
│       └── sprites/              # Character + office art
├── hooks/
│   ├── pre-tool-use.sh           # Shell script for Claude Code hook
│   ├── post-tool-use.sh
│   ├── notification.sh
│   └── stop.sh
└── public/
```

---

Written: March 15, 2026
