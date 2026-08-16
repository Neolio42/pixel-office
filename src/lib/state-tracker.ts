/**
 * Server-side tick that derives time-sensitive state transitions:
 *
 *   typing|reading + idle for >1.5s   → thinking
 *   thinking + idle for >90s          → idle  (Claude went silent — likely disconnected)
 *   done + 60s                        → idle  (let the worker walk to break room)
 *   waiting + 2min                    → emit `long-wait` for native notification
 *
 * Also: samples each session's current state into the history ring buffer
 * once per minute (for the sparkline UI), and runs the embedded-PTY pane
 * scanner to refine state for sessions we have a stream of.
 *
 * Wired from server.ts. Idempotent — re-running on HMR reuses the same
 * interval via globalThis.
 */
import { getAllSessions, markLongWaitNotified, pushHistorySample } from './store';
import { Session } from './types';
import { broadcast } from './ws-server';
import { scanEmbeddedPtys } from './pane-scanner';

declare global {
  // eslint-disable-next-line no-var
  var __stateTrackerInterval: ReturnType<typeof setInterval> | undefined;
}

const TICK_MS = 1000;
const THINKING_AFTER_MS = 1500;
const THINKING_IDLE_AFTER_MS = 90_000;
const DONE_TO_IDLE_AFTER_MS = 60_000;
const LONG_WAIT_THRESHOLD_MS = 2 * 60_000;

function projectName(cwd: string): string {
  if (!cwd) return '';
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

function tick(): void {
  const now = Date.now();
  const sessions = getAllSessions();
  const dirty: Session[] = [];

  for (const s of sessions) {
    let changed = false;

    // typing/reading → thinking after a quiet beat
    if (
      (s.state === 'typing' || s.state === 'reading') &&
      !s.currentTool &&
      s.lastToolEndedAt &&
      now - s.lastToolEndedAt > THINKING_AFTER_MS
    ) {
      s.state = 'thinking';
      changed = true;
    }

    // thinking → idle if Claude has been silent way too long
    if (
      s.state === 'thinking' &&
      s.lastToolEndedAt &&
      now - s.lastToolEndedAt > THINKING_IDLE_AFTER_MS
    ) {
      s.state = 'idle';
      changed = true;
    }

    // done → idle after a beat so worker walks to break room
    if (s.state === 'done' && s.stoppedAt && now - s.stoppedAt > DONE_TO_IDLE_AFTER_MS) {
      s.state = 'idle';
      s.stoppedAt = undefined;
      changed = true;
    }

    // long-wait escalation
    if (
      s.state === 'waiting' &&
      s.awaitingUserSince &&
      !s.longWaitNotified &&
      now - s.awaitingUserSince > LONG_WAIT_THRESHOLD_MS
    ) {
      markLongWaitNotified(s.sessionId);
      broadcast({
        type: 'long-wait',
        sessionId: s.sessionId,
        project: projectName(s.cwd),
        waitedMs: now - s.awaitingUserSince,
      });
      // Note: longWaitNotified flag flipped — no session-update spam needed.
    }

    // History sampling (once / minute)
    if (pushHistorySample(s.sessionId)) {
      changed = true;
    }

    if (changed) dirty.push(s);
  }

  for (const session of dirty) {
    broadcast({ type: 'session-update', session });
  }

  // Embedded-PTY pane scan can mutate state too (error / thinking confirmation).
  // It broadcasts its own session-update messages.
  scanEmbeddedPtys();
}

export function startStateTracker(): void {
  if (globalThis.__stateTrackerInterval) return;
  globalThis.__stateTrackerInterval = setInterval(tick, TICK_MS);
  console.log('[state-tracker] started (1s tick)');
}
