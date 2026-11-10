# Approval System Hardening & Production Mode

**Date:** 2026-04-09
**Status:** Draft

## Problem

Pixel Office's approval system has three issues that make it annoying to use daily:

1. **"Always allow" doesn't work.** The whitelist check runs after built-in classifier rules, so whitelisted commands like `python3`, `node`, `git`, `curl` still trigger approval prompts. Out of 31,866 logged tool calls, 1,386 (4.4%) needed manual approval — most were false positives.
2. **Hardcoded port 3000.** Hooks `curl` to `localhost:3000`. If another dev server takes the port, `detect-port` picks a new one but hooks silently fail.
3. **Dev server required.** Running via `npm run dev` — noisy, slow, unnecessary HMR.
4. **iTerm panel missing features.** No way to reply with instructions when approving. No way to manage the allow/deny list from the panel.

## Design

### 1. Unix Socket for Hooks

Replace TCP-based hook communication with a Unix domain socket.

**Server changes (`server.ts`):**
- Create a second HTTP server (or reuse the same one) that listens on `/tmp/pixel-office.sock`
- Remove old socket file on startup if it exists (stale from previous crash)
- Keep TCP listener (default port 3000) for iTerm panel browser access
- Remove `detect-port` dependency — TCP port is best-effort for the browser UI, not critical

**Hook changes (`~/.claude/settings.json`):**
- All hooks change from:
  ```
  curl -sf -X POST http://localhost:3000/api/hooks/pre-tool-use ...
  ```
  to:
  ```
  curl -sf -X POST --unix-socket /tmp/pixel-office.sock http://localhost/api/hooks/pre-tool-use ...
  ```
- Same tempfile + `--data-binary` pattern, just different transport
- `PIXEL_OFFICE_HAIKU` skip logic stays

**Why Unix socket:**
- No port conflicts — ever
- Faster (no TCP overhead)
- Easy to check if server is running: `test -S /tmp/pixel-office.sock`
- If server isn't running, hooks fail fast and silently (existing `; true` ensures Claude Code continues)

### 2. Production Mode

**Build & run:**
- `npm run build` compiles Next.js (already works)
- `npm start` runs `server.ts` in production mode (already supported via `NODE_ENV=production`)
- Verify the production build works end-to-end: hooks, WebSocket, iTerm panel page
- Add `npm run serve` script: `npm run build && npm start` as a convenience

**Optional — launchd auto-start:**
- Provide a `com.pixel-office.plist` template for macOS `launchd`
- Runs on login, restarts on crash
- Logs to `~/Library/Logs/pixel-office.log`
- Users can `launchctl load/unload` to control it

### 3. Pattern-Based Allow/Deny System

Replace the current base-command-only whitelist with a prefix-matching pattern system.

**Data model:**

```typescript
interface PatternRule {
  /** The prefix pattern, e.g. "git push", "python3", "git" */
  pattern: string;
  /** 'allow' or 'deny' */
  action: 'allow' | 'deny';
  /** Human-readable label for the UI */
  label: string;
  /** ISO timestamp */
  addedAt: string;
}
```

Stored in `data/rules.json` (new file, replacing `data/whitelist.json`). Migration: convert existing whitelist entries to allow patterns on first load.

**Matching logic:**

Classification priority: **deny > allow > built-in classifier**

```
1. Normalize the command to a string (e.g., "git push origin develop")
2. Check deny patterns — longest matching prefix wins
   → If match: needs approval (reason from built-in classifier or 'denied')
3. Check allow patterns — longest matching prefix wins
   → If match: auto-approve
4. Fall through to built-in classifier (existing tool-classifier.ts logic)
```

For non-Bash tools, the pattern is the tool name (e.g., `mcp__claude-in-chrome__computer`).

**"Always allow" UI flow:**

When an approval card appears in the iTerm panel, the "Always allow" button expands to show granularity options. The system breaks the command into meaningful levels:

For Bash commands:
```
bash tools/run-keyboard-comparison.sh
├── bash tools/run-keyboard-comparison.sh  (exact)
└── bash                                    (all bash)

git push origin develop
├── git push origin develop  (exact)
├── git push                 (pushes)
└── git                      (all git)

python3 -c "import os; ..."
└── python3                  (all python3)

npm install express
├── npm install express      (this package)
├── npm install              (all installs)
└── npm                      (all npm)
```

The system extracts levels by splitting on whitespace and offering each prefix. For very long commands (inline scripts), only the first 2-3 meaningful tokens are offered.

**"Always deny" option:**

Same granularity picker, but adds to the deny list. Available in the settings page, not on the approval card (to keep the approval flow fast).

**WebSocket "always-allow" message update:**

The current `always-allow` message only sends `{type: 'always-allow', approvalId}`. The new version must also include the chosen pattern:

```typescript
// Client → Server
{ type: 'always-allow', approvalId: string, pattern: string }
```

The server handler in `ws-server.ts` uses the pattern to create the rule, rather than extracting it from the approval's tool input.

### 4. iTerm Panel: Reply With Instructions

The approval plumbing already supports a `message` field — `resolveApproval(id, decision, message)` passes it through. The iTerm panel just doesn't expose it.

**UI change to ApprovalCard:**
- Add a small "Add note" toggle/link below the Allow/Deny buttons
- When expanded, shows a single-line text input
- Typing in it and clicking Allow/Deny sends the text as the `message`
- The message appears in the hook response and Claude Code sees it
- Collapsed by default to keep the common case (just approve) fast

### 5. iTerm Panel: Settings Page

A separate page at `/iterm-panel/settings` for managing patterns.

**Layout:**
- Two sections: Allow Patterns, Deny Patterns
- Each entry shows: pattern, label, date added, delete button
- "Add pattern" input at the top of each section (manual entry)
- Link/tab toggle between main panel and settings at the top of both pages

**Navigation:**
- Small gear icon in the main panel header links to settings
- Back arrow in settings links to main panel

## Files Changed

| File | Change |
|------|--------|
| `server.ts` | Add Unix socket listener, remove `detect-port` |
| `package.json` | Remove `detect-port` dep, add `serve` script |
| `src/lib/tool-classifier.ts` | Insert pattern matching before built-in rules |
| `src/lib/whitelist.ts` | Replace with `src/lib/rules.ts` — new PatternRule model, prefix matching, migration from old format |
| `src/app/api/whitelist/route.ts` | Update to use new rules system |
| `src/app/iterm-panel/page.tsx` | Add "always allow" granularity picker, add "reply with instructions" text input |
| `src/app/iterm-panel/settings/page.tsx` | New — settings page for allow/deny pattern management |
| `src/hooks/useWorkspace.ts` | No changes needed (already supports message) |
| `src/lib/ws-server.ts` | Update always-allow handler to use new rules system with pattern |
| `~/.claude/settings.json` | Update all hook commands to use `--unix-socket` |

## What Stays The Same

- Hook endpoints (`/api/hooks/*`) — same routes, same logic
- WebSocket protocol — same messages
- Approval queue (`approval-queue.ts`) — untouched
- Canvas/game engine — untouched
- Embedded terminals — untouched
- globalThis state pattern — untouched

## Migration

On first startup with the new code:
1. If `data/whitelist.json` exists and `data/rules.json` doesn't, convert all whitelist entries to allow patterns (e.g., `{type: "command", entry: "git"}` → `{pattern: "git", action: "allow", ...}`)
2. Tool whitelist entries convert directly (e.g., `{type: "tool", entry: "RemoteTrigger"}` → `{pattern: "RemoteTrigger", action: "allow", ...}`)
3. Old file is left in place (not deleted) as a backup
