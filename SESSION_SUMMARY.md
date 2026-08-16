# Session Summary — agent-visualization layer

## What shipped

### 1. WorkerState extended from 5 → 8 states

`src/lib/types.ts`

```
'idle' | 'typing' | 'reading' | 'waiting' | 'walking'
       + 'thinking' | 'done' | 'error'
```

New per-session bookkeeping fields on `Session`:

- `lastToolEndedAt`     — stamped by post-tool-use, drives the typing/reading → thinking flip
- `stoppedAt`           — stamped by Stop hook, drives done → idle demotion
- `awaitingUserSince`   — when the worker started blocking on the user (notification OR approval)
- `longWaitNotified`    — single-shot flag so the 2-min notification fires once per wait window
- `errorHint`           — short string when pane-scanner flags an error
- `history` + `historyLastSampledAt` — ring buffer of one `StateCode` per minute, capped at 60 (1h)

`StateCode` is a single-letter encoding (`i t r w k h d e`) so the history payload over WS stays tiny.

### 2. Server tick loop — `src/lib/state-tracker.ts`

Single 1-second `setInterval` on `globalThis` (HMR-safe). On each tick, for every session:

| Transition                          | Condition                                                              |
|-------------------------------------|------------------------------------------------------------------------|
| `typing\|reading` → `thinking`      | `currentTool === null` AND `now - lastToolEndedAt > 1500ms`            |
| `thinking` → `idle`                 | `now - lastToolEndedAt > 90s` (Claude went silent)                     |
| `done` → `idle`                     | `now - stoppedAt > 60s` (lets the worker walk to break room)           |
| `waiting` + `>2min` → emit long-wait| `awaitingUserSince` set, `!longWaitNotified`, threshold crossed         |
| sample history                      | once per minute, push `StateCode` and broadcast                        |

Then calls `scanEmbeddedPtys()` which refines state for sessions whose stream we own.

### 3. Hook routes updated

- `post-tool-use` no longer clears state inline. Calls `markToolEnded()` — the tick promotes to `thinking`.
- `stop` no longer flips straight to `idle`. Calls `markStopped()` → `done`. Tick demotes after 60s.
- `notification` calls `markAwaitingUser()` so the 2-min clock starts.
- `pre-tool-use` marks awaiting when `state === 'waiting'`, clears on approval resolution (regardless of outcome).

### 4. Pane scanner for embedded PTYs — `src/lib/pane-scanner.ts`

Embedded PTYs are sessions Pixel Office itself spawned via `pty-manager.ts`. We already have their full scrollback in memory, so no `tmux capture-pane` is needed — we read the tail directly.

Each tick scans the last ~2KB of each linked, non-exited PTY's scrollback after ANSI/control-char stripping. Three detectors:

- **shell-prompt-tail** (`(^|\n)\s*[$%❯>]\s*$`) → claude exited back to shell → `done`
- **error-pattern** (panic / Traceback / Error: / Unhandled exception / Segfault / "command not found" — needs ≥2 distinct matches) → `error` with the first match as `errorHint`. Only fires from `idle | thinking | done` so we never overwrite an in-flight tool's state.
- **spinner glyphs** (`✻ ✶ ✽ ✺ ◐ ◓ ◑ ◒` + braille spinner `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) — informational; not used to mutate state today since the hook-derived `thinking` is already correct.

Cost: one regex pass over ≤2KB per session per second. Negligible.

### 5. Long-wait notification — `src/hooks/useWorkspace.ts`

When the server broadcasts `long-wait`, the client requests `Notification.permission` (once, lazily) and posts a native browser notification: "`<project>` — worker blocked / `<n>m` waiting for you. Click to focus." Clicking focuses the window. Tag dedupes per session so repeated emissions don't spam.

### 6. iterm-panel UI

- `src/lib/ui-constants.ts` is the single source of truth for `STATE_COLORS`, `STATE_ICONS`, and a new `STATE_LABEL` map. The duplicate `STATE_ICONS` in `iterm-panel/page.tsx` is gone.
- New icons / colors:
  - thinking → `✻` `#d6c14a` (yellow-gold)
  - done    → `✓` `#5a8a9a` (slate-cyan)
  - error   → `✗` `#bf4a4a` (red), bounce-animated
- Worker rows now render:
  - "Thinking…" subtitle when state === thinking
  - "Finished — walking off" when state === done
  - red error chip with `errorHint` when state === error
  - "Blocked Xm" chip in red (instead of "Needs approval") once the 2-min threshold is crossed
- Each worker row also gets a 60-cell pixel sparkline of the last hour of state samples (`src/components/WorkerSparkline.tsx`). Bar height encodes activity intensity (idle/done = 2px, waiting/error = 8px, active = full); colour matches `STATE_COLORS`.

### 7. Pixel-art canvas layer

The canvas uses a narrower `AnimState` (5 sprite animations). I did NOT extend sprites. Instead added `toAnimState(WorkerState): AnimState` in `src/game/sprites.ts` and wired it through `setWorkerState` in `worker-entity.ts`:

- `thinking` → `reading` animation (subtle look-around reads as "pondering")
- `done`     → `idle` animation, but routing treats them like idle so the worker walks to the break room
- `error`    → `waiting` animation (concerned pose)

This means the pixel office picks up the new states for free without needing new sprite frames.

## State-detection patterns I tried and discarded

- **`thinking` via spinner glyph alone.** Reliable for embedded PTYs only. Doesn't help externally-launched sessions. The hook-timing rule (`post-tool-use + 1.5s of silence with currentTool === null`) covers both cases. Spinner detection is kept in the scanner but currently informational.
- **Reading transcript JSONL for thinking blocks.** Too slow per tick and depends on hook providing `transcript_path`. Cheaper to derive from hook timing.
- **Single-line error detection.** Way too noisy — `Error: ...` shows up in stdout/stderr of normal tool calls. Required ≥2 distinct patterns in 2KB before flipping.
- **`done` via "Total cost: $..." line.** Brittle across Claude UI changes. Replaced with shell-prompt-tail (more durable) + Stop hook (authoritative).

## What I did NOT do

- **PaneContainer / SplitPane wiring.** Both files are well-written and complete, but they're not yet referenced from anything (the app still renders `OfficeCanvas` at `/`). Wiring them required design decisions about workspace layout that are orthogonal to the visualization layer — left untouched. Pre-existing React lint errors live there (`set-state-in-effect`).
- **OfficeCanvas sprite work.** Memory says the iTerm Toolbelt panel is your primary surface; new states route through `toAnimState` to existing sprites instead.
- **Native Notification permission UX flow.** I request lazily on first long-wait emission. If you want a "Enable notifications" toggle in settings, that's separate.

## Verification

```
npx tsc --noEmit                                    # clean
npx eslint <every file I touched>                   # 0 errors, 4 pre-existing warnings
npm run lint                                        # remaining errors are pre-existing
                                                    # (PaneContainer / WhitelistPanel / settings page)
```

## Files

New:
- `src/lib/state-tracker.ts`
- `src/lib/pane-scanner.ts`
- `src/components/WorkerSparkline.tsx`

Modified:
- `src/lib/types.ts`                — WorkerState + new fields + long-wait WS message
- `src/lib/ui-constants.ts`         — STATE_ICONS + STATE_LABEL added
- `src/lib/store.ts`                — markToolEnded / markStopped / markAwaitingUser / clearAwaitingUser / setSessionError / pushHistorySample
- `src/app/api/hooks/post-tool-use/route.ts`
- `src/app/api/hooks/stop/route.ts`
- `src/app/api/hooks/notification/route.ts`
- `src/app/api/hooks/pre-tool-use/route.ts`
- `src/hooks/useWorkspace.ts`       — `long-wait` handler, native Notification
- `src/app/iterm-panel/page.tsx`    — new state rendering + sparkline + long-wait badge
- `src/game/sprites.ts`             — toAnimState mapping
- `src/game/worker-entity.ts`       — route done-like-idle, use toAnimState
- `server.ts`                       — startStateTracker()
