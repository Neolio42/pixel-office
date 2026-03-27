import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
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

function ensureDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

/** Append a log entry. Fire-and-forget — never throws. */
export function logCommand(entry: CommandLogEntry) {
  try {
    ensureDir();
    appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch {
    // Don't let logging failures affect the main flow
  }
}

/** Convenience: log a tool call that was auto-approved. */
export function logAutoApproved(sessionId: string, toolName: string, toolInput: Record<string, unknown>, classification: ClassificationReason) {
  const command = toolName === 'Bash' || toolName === 'BashOutput'
    ? String(toolInput.command || '').slice(0, 500)
    : `${toolName}(${Object.keys(toolInput).join(', ')})`;

  const pattern = extractPattern(toolName, toolInput);

  logCommand({
    timestamp: new Date().toISOString(),
    sessionId,
    toolName,
    command,
    classification,
    decision: 'auto',
    pattern,
  });
}

/** Convenience: log a tool call that needed boss approval. */
export function logBossDecision(sessionId: string, toolName: string, toolInput: Record<string, unknown>, classification: ClassificationReason, decision: 'allowed' | 'denied') {
  const command = toolName === 'Bash' || toolName === 'BashOutput'
    ? String(toolInput.command || '').slice(0, 500)
    : `${toolName}(${Object.keys(toolInput).join(', ')})`;

  const pattern = extractPattern(toolName, toolInput);

  logCommand({
    timestamp: new Date().toISOString(),
    sessionId,
    toolName,
    command,
    classification,
    decision,
    pattern,
  });
}

function extractPattern(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash' || toolName === 'BashOutput') {
    const cmd = String(toolInput.command || '').trim();
    const args = cmd.split(/\s+/);
    const base = (args[0]?.split('/').pop() || args[0] || 'unknown').toLowerCase();
    const SUBCOMMAND_TOOLS = new Set(['git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'docker', 'brew', 'apt', 'pip']);
    if (SUBCOMMAND_TOOLS.has(base) && args[1] && !args[1].startsWith('-')) {
      return `${base} ${args[1].toLowerCase()}`;
    }
    return base;
  }
  return toolName;
}

/** Read recent log entries for the UI. Returns most recent N entries. */
export function getRecentLogs(limit = 100): CommandLogEntry[] {
  try {
    if (!existsSync(LOG_PATH)) return [];
    const raw = readFileSync(LOG_PATH, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const entries = lines.slice(-limit).map(line => {
      try { return JSON.parse(line) as CommandLogEntry; }
      catch { return null; }
    }).filter((e): e is CommandLogEntry => e !== null);
    return entries;
  } catch {
    return [];
  }
}

/** Get frequency stats — which patterns appear most often and how they're handled. */
export function getPatternStats(): { pattern: string; total: number; auto: number; asked: number; allowed: number; denied: number }[] {
  const entries = getRecentLogs(10000);
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
