import { spawn as ptySpawn, IPty } from 'node-pty';
import { execSync } from 'child_process';

/** Resolve full path to claude binary so node-pty can find it regardless of server PATH */
function resolveClaudePath(): string {
  // Try common locations first (fastest, no shell needed)
  const candidates = ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude'];
  for (const c of candidates) {
    try {
      execSync(`test -x "${c}"`, { stdio: 'ignore' });
      return c;
    } catch { /* continue */ }
  }
  // Fall back to shell lookup (may fail if shell doesn't source profile)
  try {
    // Use login shell to source PATH properly
    const shell = process.env.SHELL || '/bin/zsh';
    return execSync(`${shell} -lc "which claude"`, { encoding: 'utf8' }).trim();
  } catch { /* continue */ }
  return 'claude';
}

declare global {
  // eslint-disable-next-line no-var
  var __claudePath: string | undefined;
}

function getClaudePath(): string {
  if (!globalThis.__claudePath) {
    globalThis.__claudePath = resolveClaudePath();
    console.log(`[PTY] Resolved claude binary: ${globalThis.__claudePath}`);
  }
  return globalThis.__claudePath;
}

// Force re-resolve on module reload (HMR)
globalThis.__claudePath = undefined;

export interface PtyEntry {
  ptyId: string;
  pty: IPty;
  ttyPath: string;
  sessionId?: string;
  cwd: string;
  cols: number;
  rows: number;
  scrollback: string[];
  scrollbackBytes: number;
  exited: boolean;
  exitCode?: number;
}

const MAX_SCROLLBACK_BYTES = 1_000_000; // ~1MB cap

declare global {
  // eslint-disable-next-line no-var
  var __ptyRegistry: Map<string, PtyEntry> | undefined;
  // eslint-disable-next-line no-var
  var __ptyCounter: number | undefined;
}

function getRegistry(): Map<string, PtyEntry> {
  if (!globalThis.__ptyRegistry) {
    globalThis.__ptyRegistry = new Map();
  }
  return globalThis.__ptyRegistry;
}

function getPtyCounter(): number {
  if (globalThis.__ptyCounter === undefined) {
    let max = 0;
    for (const entry of getRegistry().values()) {
      const n = parseInt(entry.ptyId.split('-')[1] || '0', 10);
      if (n > max) max = n;
    }
    globalThis.__ptyCounter = max;
  }
  return globalThis.__ptyCounter;
}

/**
 * Callbacks wired by ws-server to send terminal output to subscribers only.
 * Stored on globalThis so HMR doesn't reset them.
 */
declare global {
  // eslint-disable-next-line no-var
  var __ptyOutputHandler: ((ptyId: string, data: string) => void) | undefined;
  // eslint-disable-next-line no-var
  var __ptyExitHandler: ((ptyId: string, exitCode: number) => void) | undefined;
}

export function setPtyOutputHandler(handler: (ptyId: string, data: string) => void) {
  globalThis.__ptyOutputHandler = handler;
}

export function setPtyExitHandler(handler: (ptyId: string, exitCode: number) => void) {
  globalThis.__ptyExitHandler = handler;
}

export function spawnSession(cwd: string, cols = 120, rows = 30): PtyEntry {
  globalThis.__ptyCounter = getPtyCounter() + 1;
  const ptyId = `pty-${globalThis.__ptyCounter}-${Date.now()}`;

  const pty = ptySpawn(getClaudePath(), [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      // Ensure homebrew paths are in PATH for child processes
      PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || '/usr/bin:/bin'}`,
    } as Record<string, string>,
  });

  // Get the tty path from node-pty's internal _pty field (the slave PTY device)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ttyPath: string = (pty as any)._pty || '';

  const entry: PtyEntry = {
    ptyId,
    pty,
    ttyPath,
    cwd,
    cols,
    rows,
    scrollback: [],
    scrollbackBytes: 0,
    exited: false,
  };

  pty.onData((data: string) => {
    // Buffer scrollback
    entry.scrollback.push(data);
    entry.scrollbackBytes += data.length;
    // Trim if over cap
    while (entry.scrollbackBytes > MAX_SCROLLBACK_BYTES && entry.scrollback.length > 0) {
      const removed = entry.scrollback.shift()!;
      entry.scrollbackBytes -= removed.length;
    }
    if (entry.scrollback.length === 0) entry.scrollbackBytes = 0;
    // Send to subscribers
    globalThis.__ptyOutputHandler?.(ptyId, data);
  });

  pty.onExit(({ exitCode }) => {
    entry.exited = true;
    entry.exitCode = exitCode;
    globalThis.__ptyExitHandler?.(ptyId, exitCode);
  });

  getRegistry().set(ptyId, entry);
  console.log(`[PTY] Spawned ${ptyId} (pid=${pty.pid}, tty=${ttyPath}, cwd=${cwd})`);
  return entry;
}

export function writeToPty(ptyId: string, data: string): boolean {
  const entry = getRegistry().get(ptyId);
  if (!entry || entry.exited) return false;
  entry.pty.write(data);
  return true;
}

export function resizePty(ptyId: string, cols: number, rows: number): boolean {
  const entry = getRegistry().get(ptyId);
  if (!entry || entry.exited) return false;
  entry.pty.resize(cols, rows);
  entry.cols = cols;
  entry.rows = rows;
  return true;
}

export function killPty(ptyId: string): boolean {
  const entry = getRegistry().get(ptyId);
  if (!entry) return false;
  if (!entry.exited) {
    entry.pty.kill('SIGHUP');
  }
  getRegistry().delete(ptyId);
  console.log(`[PTY] Killed ${ptyId}`);
  return true;
}

export function linkSessionToPty(sessionId: string, ptyId: string): boolean {
  const entry = getRegistry().get(ptyId);
  if (!entry) return false;
  entry.sessionId = sessionId;
  console.log(`[PTY] Linked session ${sessionId} → ${ptyId}`);
  return true;
}

export function findPtyByTty(ttyPath: string): PtyEntry | undefined {
  if (!ttyPath) return undefined;
  for (const entry of getRegistry().values()) {
    if (!entry.sessionId && entry.ttyPath && entry.ttyPath === ttyPath) {
      return entry;
    }
  }
  // Also try matching just the suffix (e.g., "s012" matches "/dev/ttys012")
  const suffix = ttyPath.replace(/^\/dev\/tty/, '');
  for (const entry of getRegistry().values()) {
    if (!entry.sessionId && entry.ttyPath) {
      const entrySuffix = entry.ttyPath.replace(/^\/dev\/tty/, '');
      if (entrySuffix === suffix) return entry;
    }
  }
  return undefined;
}

/** Find an unlinked PTY by matching cwd — fallback when tty matching fails */
export function findPtyByCwd(cwd: string): PtyEntry | undefined {
  if (!cwd) return undefined;
  for (const entry of getRegistry().values()) {
    if (!entry.sessionId && entry.cwd === cwd) {
      return entry;
    }
  }
  return undefined;
}

export function getPtyEntry(ptyId: string): PtyEntry | undefined {
  return getRegistry().get(ptyId);
}

export function getScrollback(ptyId: string): string {
  const entry = getRegistry().get(ptyId);
  if (!entry) return '';
  return entry.scrollback.join('');
}

export function getAllPtyEntries(): PtyEntry[] {
  return [...getRegistry().values()];
}

export function cleanupOrphanedPtys(activePtyIds: Set<string>): string[] {
  const removed: string[] = [];
  for (const [ptyId, entry] of getRegistry()) {
    if (entry.exited && !activePtyIds.has(ptyId)) {
      getRegistry().delete(ptyId);
      removed.push(ptyId);
    }
  }
  return removed;
}
