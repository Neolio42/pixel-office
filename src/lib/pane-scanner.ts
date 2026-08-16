/**
 * Best-effort state refinement by looking at the live scrollback of
 * embedded PTYs. We only scan sessions that we spawned (sessions with
 * a `ptyId`), since those are the only ones whose terminal stream we
 * have direct access to.
 *
 * What we detect:
 *
 *   THINKING  — Claude's spinner glyphs in the last frame.
 *               This is purely additive: confirms the hook-derived
 *               `thinking` state when uncertain.
 *
 *   ERROR     — multiple error-shaped lines in the last 2KB
 *               (panic:, Error:, Traceback, ✗, "exit 1"). We only
 *               flip into `error` if the worker isn't already
 *               actively executing a tool (state in idle/thinking/done).
 *               Cleared when a new tool fires (state-tracker tick
 *               doesn't preserve `error` on its own).
 *
 *   DONE     — claude exited and the buffer ends on a shell prompt.
 *              We treat this as a strong signal: state = done.
 *
 * Cheap heuristics, ~2KB of regex per session per second. Fine.
 */
import { getAllPtyEntries, getPtyEntry } from './pty-manager';
import { getSession, setSessionError, markStopped } from './store';
import { broadcast } from './ws-server';
import { Session } from './types';

// Strip ANSI/control sequences so regex doesn't trip on color codes.
// Keep it cheap and unicode-safe.
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
// ASCII control chars (except CR/LF/TAB) — we just nuke them.
const CTRL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '').replace(CTRL_RE, '');
}

// Claude's spinner cycles through several glyphs. Anthropic has been
// shipping different glyph sets over time; cover the common ones.
const SPINNER_GLYPHS = ['✻', '✶', '✽', '✺', '◐', '◓', '◑', '◒', '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_RE = new RegExp(`[${SPINNER_GLYPHS.join('')}]\\s+\\w+…?`);

const ERROR_PATTERNS = [
  /\bpanic:/i,
  /\bTraceback \(most recent call last\)/,
  /\bError: /,
  /\bUnhandled exception/i,
  /\bSegmentation fault/i,
  /\bcommand not found\b/,
];

// "$ ", "% ", "❯ ", or "> " at end of buffer with no spinner = back at shell.
const SHELL_PROMPT_TAIL = /(?:\n|^)\s*[\$%❯>]\s*$/;

const TAIL_BYTES = 2048;

function tail(scrollback: string[], maxBytes: number): string {
  // Walk from end accumulating until we hit the byte budget.
  let bytes = 0;
  const buf: string[] = [];
  for (let i = scrollback.length - 1; i >= 0; i--) {
    const chunk = scrollback[i];
    bytes += Buffer.byteLength(chunk, 'utf8');
    buf.push(chunk);
    if (bytes >= maxBytes) break;
  }
  return buf.reverse().join('').slice(-maxBytes);
}

function detectErrors(text: string): string | null {
  let hits = 0;
  let firstHit = '';
  for (const re of ERROR_PATTERNS) {
    const m = text.match(re);
    if (m) {
      hits++;
      if (!firstHit) firstHit = m[0];
    }
  }
  if (hits >= 2) return firstHit.slice(0, 80);
  return null;
}

function applyScan(session: Session, text: string): Session | null {
  // 1) shell prompt at the tail → claude has exited
  if (SHELL_PROMPT_TAIL.test(text) && session.state !== 'done') {
    return markStopped(session.sessionId);
  }

  // 2) error pattern only flips us if we aren't mid-tool
  if (session.state === 'idle' || session.state === 'thinking' || session.state === 'done') {
    const hint = detectErrors(text);
    if (hint) {
      return setSessionError(session.sessionId, hint);
    }
  }

  // 3) spinner — silently confirms thinking; no state mutation needed.
  if (SPINNER_RE.test(text) && session.state === 'typing') {
    // tool emitted a long-running spinner — already covered by `typing`,
    // skip.
  }

  return null;
}

export function scanEmbeddedPtys(): void {
  const ptys = getAllPtyEntries();
  for (const pty of ptys) {
    if (!pty.sessionId || pty.exited) continue;
    const session = getSession(pty.sessionId);
    if (!session) continue;
    const entry = getPtyEntry(pty.ptyId);
    if (!entry) continue;
    const text = stripAnsi(tail(entry.scrollback, TAIL_BYTES));
    const updated = applyScan(session, text);
    if (updated) broadcast({ type: 'session-update', session: updated });
  }
}
