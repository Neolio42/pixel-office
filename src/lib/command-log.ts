import { createWriteStream, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { ClassificationReason } from './tool-classifier';

export interface CommandLogEntry {
  timestamp: string;
  sessionId: string;
  toolName: string;
  /** For Bash: the command string. For others: summary of input. */
  command: string;
  classification: ClassificationReason;
  /** What happened: auto-approved, asked-boss, allowed, denied */
  decision: 'auto' | 'asked' | 'allowed' | 'denied';
  /** Base command pattern (for Bash) or tool name — useful for frequency analysis */
  pattern: string;
}

const LOG_DIR = path.join(process.cwd(), 'data');
const LOG_PATH = path.join(LOG_DIR, 'command-log.jsonl');
const RING_BUFFER_SIZE = 200;
const SUBCOMMAND_TOOLS = new Set(['git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'docker', 'brew', 'apt', 'pip']);

// Use globalThis for HMR survival (same pattern as store.ts, ws-server.ts)
declare global {
  // eslint-disable-next-line no-var
  var __logStream: ReturnType<typeof createWriteStream> | undefined;
  // eslint-disable-next-line no-var
  var __logBuffer: CommandLogEntry[] | undefined;
}

function ensureDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogStream() {
  const s = globalThis.__logStream;
  if (s && !s.destroyed && s.writable) return s;
  ensureDir();
  const stream = createWriteStream(LOG_PATH, { flags: 'a' });
  stream.on('error', (err) => {
    console.error('[command-log] WriteStream error:', err.message);
    stream.destroy();
  });
  globalThis.__logStream = stream;
  return stream;
}

function getLogBuffer(): CommandLogEntry[] {
  if (!globalThis.__logBuffer) {
    globalThis.__logBuffer = [];
  }
  return globalThis.__logBuffer;
}

/** Append a log entry. Fire-and-forget — never throws. */
export function logCommand(entry: CommandLogEntry) {
  try {
    // Write to ring buffer for fast reads
    const buf = getLogBuffer();
    buf.push(entry);
    if (buf.length > RING_BUFFER_SIZE) {
      buf.splice(0, buf.length - RING_BUFFER_SIZE);
    }

    // Async write to disk via stream (non-blocking)
    const stream = getLogStream();
    stream.write(JSON.stringify(entry) + '\n');
  } catch {
    // Don't let logging failures affect the main flow
  }
}

function formatCommand(toolName: string, toolInput: Record<string, unknown>): string {
  return toolName === 'Bash' || toolName === 'BashOutput'
    ? String(toolInput.command || '').slice(0, 500)
    : `${toolName}(${Object.keys(toolInput).join(', ')})`;
}

/** Convenience: log a tool call that was auto-approved. */
export function logAutoApproved(sessionId: string, toolName: string, toolInput: Record<string, unknown>, classification: ClassificationReason) {
  logCommand({
    timestamp: new Date().toISOString(),
    sessionId,
    toolName,
    command: formatCommand(toolName, toolInput),
    classification,
    decision: 'auto',
    pattern: extractPattern(toolName, toolInput),
  });
}

/** Convenience: log a tool call that needed boss approval. */
export function logBossDecision(sessionId: string, toolName: string, toolInput: Record<string, unknown>, classification: ClassificationReason, decision: 'allowed' | 'denied') {
  logCommand({
    timestamp: new Date().toISOString(),
    sessionId,
    toolName,
    command: formatCommand(toolName, toolInput),
    classification,
    decision,
    pattern: extractPattern(toolName, toolInput),
  });
}

function extractPattern(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash' || toolName === 'BashOutput') {
    const cmd = String(toolInput.command || '').trim();
    const args = cmd.split(/\s+/);
    const base = (args[0]?.split('/').pop() || args[0] || 'unknown').toLowerCase();
    if (SUBCOMMAND_TOOLS.has(base) && args[1] && !args[1].startsWith('-')) {
      return `${base} ${args[1].toLowerCase()}`;
    }
    return base;
  }
  return toolName;
}

/** Read recent log entries for the UI. Returns most recent N entries from in-memory buffer. */
export function getRecentLogs(limit = 100): CommandLogEntry[] {
  const buf = getLogBuffer();
  return buf.slice(-limit);
}

/** Get frequency stats — which patterns appear most often and how they're handled. */
export function getPatternStats(): { pattern: string; total: number; auto: number; asked: number; allowed: number; denied: number }[] {
  const entries = getLogBuffer();
  const stats = new Map<string, { total: number; auto: number; asked: number; allowed: number; denied: number }>();

  for (const entry of entries) {
    const key = entry.pattern;
    const s = stats.get(key) || { total: 0, auto: 0, asked: 0, allowed: 0, denied: 0 };
    s.total++;
    if (entry.decision === 'auto') s.auto++;
    else if (entry.decision === 'asked') s.asked++;
    else if (entry.decision === 'allowed') s.allowed++;
    else if (entry.decision === 'denied') s.denied++;
    stats.set(key, s);
  }

  return Array.from(stats.entries())
    .map(([pattern, s]) => ({ pattern, ...s }))
    .sort((a, b) => b.total - a.total);
}
