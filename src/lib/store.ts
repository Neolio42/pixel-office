import { Session, WorkerState } from './types';

// Use globalThis so the same sessions Map is shared across
// Next.js App Router module instances and the custom server.ts
declare global {
  // eslint-disable-next-line no-var
  var __sessions: Map<string, Session> | undefined;
}

function getSessions(): Map<string, Session> {
  if (!globalThis.__sessions) {
    globalThis.__sessions = new Map();
  }
  return globalThis.__sessions;
}

const MAX_DESKS = 5;

function getNextDeskIndex(): number {
  const sessions = getSessions();
  const taken = new Set([...sessions.values()].map(s => s.deskIndex));
  for (let i = 0; i < MAX_DESKS; i++) {
    if (!taken.has(i)) return i;
  }
  return 0;
}

export function addSession(sessionId: string, cwd: string, tty = ''): Session {
  const sessions = getSessions();
  const now = Date.now();
  const session: Session = {
    sessionId,
    deskIndex: getNextDeskIndex(),
    state: 'walking',
    currentTool: null,
    cwd,
    tty: tty.startsWith('/dev/') ? tty : '',
    startedAt: now,
    lastSeen: now,
    recentTools: [],
  };
  sessions.set(sessionId, session);
  return session;
}

export function updateSessionTty(sessionId: string, tty: string): void {
  const session = getSessions().get(sessionId);
  if (session && tty && tty.startsWith('/dev/')) {
    session.tty = tty;
  }
}

export function updateSession(sessionId: string, state: WorkerState, tool: string | null): Session | null {
  const session = getSessions().get(sessionId);
  if (!session) return null;
  session.state = state;
  session.currentTool = tool;
  session.lastSeen = Date.now();
  return session;
}

export function cleanupStaleSessions(maxAgeMs = 60_000): string[] {
  const sessions = getSessions();
  const cutoff = Date.now() - maxAgeMs;
  const removed: string[] = [];
  for (const [id, session] of sessions) {
    if (session.lastSeen < cutoff) {
      sessions.delete(id);
      removed.push(id);
    }
  }
  return removed;
}

export function removeSession(sessionId: string): boolean {
  return getSessions().delete(sessionId);
}

export function getSession(sessionId: string): Session | undefined {
  return getSessions().get(sessionId);
}

export function getAllSessions(): Session[] {
  return [...getSessions().values()];
}

function getToolSummary(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read': {
      const p = toolInput.file_path as string | undefined;
      return p ? `Reading ${p.split('/').slice(-2).join('/')}` : 'Reading file';
    }
    case 'Edit':
    case 'Write':
    case 'MultiEdit': {
      const p = toolInput.file_path as string | undefined;
      return p ? `Editing ${p.split('/').slice(-2).join('/')}` : 'Editing file';
    }
    case 'Grep': {
      const pattern = toolInput.pattern as string | undefined;
      return pattern ? `Searching: ${pattern.slice(0, 50)}` : 'Searching';
    }
    case 'Glob': {
      const pattern = toolInput.pattern as string | undefined;
      return pattern ? `Globbing: ${pattern.slice(0, 50)}` : 'Globbing';
    }
    case 'Bash': {
      const cmd = toolInput.command as string | undefined;
      return cmd ? `Running: ${cmd.slice(0, 60)}` : 'Running command';
    }
    case 'WebFetch':
    case 'WebSearch': {
      const url = (toolInput.url ?? toolInput.query) as string | undefined;
      return url ? `Fetching: ${url.slice(0, 50)}` : 'Web request';
    }
    case 'Agent': return 'Delegating task';
    case 'TodoWrite': return 'Updating tasks';
    case 'ToolSearch': return 'Loading tools';
    case 'Skill': return 'Running skill';
    default: {
      // Clean up MCP tool names: mcp__server__action → Server: action
      if (toolName.startsWith('mcp__')) {
        const match = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
        if (match) {
          const server = match[1].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const action = match[2].replace(/[-_]+/g, ' ');
          return `${server}: ${action.slice(0, 40)}`;
        }
      }
      // Generic: grab first string value from input
      const first = Object.values(toolInput).find(v => typeof v === 'string') as string | undefined;
      return first ? `${toolName}: ${first.slice(0, 50)}` : toolName;
    }
  }
}

export function addToolCall(sessionId: string, toolName: string, toolInput: Record<string, unknown>): void {
  const session = getSessions().get(sessionId);
  if (!session) return;

  const summary = getToolSummary(toolName, toolInput);
  session.recentTools.push({ toolName, summary, timestamp: Date.now() });
  if (session.recentTools.length > 10) {
    session.recentTools = session.recentTools.slice(-10);
  }
  session.lastSeen = Date.now();
}
