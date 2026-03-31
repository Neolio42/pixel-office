import { Session, WorkerState } from './types';

const TTY_RE = /^\/dev\/tty[a-zA-Z0-9]+$/;

// Use globalThis so the same sessions Map is shared across
// Next.js App Router module instances and the custom server.ts
declare global {
  // eslint-disable-next-line no-var
  var __sessions: Map<string, Session> | undefined;
  // eslint-disable-next-line no-var
  var __focusUpdateNeeded: Map<string, boolean> | undefined;
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
  return sessions.size % MAX_DESKS;
}

export function addSession(sessionId: string, cwd: string, tty = '', transcriptPath?: string): Session {
  const sessions = getSessions();
  const now = Date.now();
  const session: Session = {
    sessionId,
    deskIndex: getNextDeskIndex(),
    state: 'walking',
    currentTool: null,
    cwd,
    tty: TTY_RE.test(tty) ? tty : '',
    startedAt: now,
    lastSeen: now,
    recentTools: [],
    transcriptPath,
  };
  sessions.set(sessionId, session);
  return session;
}

export function updateSessionTty(sessionId: string, tty: string): boolean {
  const session = getSessions().get(sessionId);
  if (session && TTY_RE.test(tty)) {
    session.tty = tty;
    return true;
  }
  return false;
}

export function updateSessionCwd(sessionId: string, cwd: string): boolean {
  const session = getSessions().get(sessionId);
  if (session && cwd && !session.cwd) {
    session.cwd = cwd;
    return true;
  }
  return false;
}

export function updateSession(sessionId: string, state: WorkerState, tool: string | null): Session | null {
  const session = getSessions().get(sessionId);
  if (!session) return null;
  session.state = state;
  session.currentTool = tool;
  session.lastSeen = Date.now();
  return session;
}

export function cleanupStaleSessions(maxAgeMs = 60_000, isAlivePtyId?: (ptyId: string) => boolean): string[] {
  const sessions = getSessions();
  const cutoff = Date.now() - maxAgeMs;
  const removed: string[] = [];
  for (const [id, session] of sessions) {
    if (session.lastSeen < cutoff) {
      // Don't remove sessions with a live embedded PTY — the terminal is still open
      if (session.ptyId && isAlivePtyId?.(session.ptyId)) continue;
      sessions.delete(id);
      getFocusUpdateNeeded().delete(id);
      removed.push(id);
    }
  }
  return removed;
}

export function removeSession(sessionId: string): boolean {
  getFocusUpdateNeeded().delete(sessionId);
  return getSessions().delete(sessionId);
}

export function getSession(sessionId: string): Session | undefined {
  return getSessions().get(sessionId);
}

export function getAllSessions(): Session[] {
  return [...getSessions().values()];
}

export function setSessionTask(sessionId: string, task: string): Session | null {
  const session = getSessions().get(sessionId);
  if (!session) return null;
  session.task = task;
  return session;
}

export function setSessionFocus(sessionId: string, focus: string): Session | null {
  const session = getSessions().get(sessionId);
  if (!session) return null;
  session.currentFocus = focus;
  return session;
}

export function setSessionPlanMode(sessionId: string, inPlanMode: boolean): Session | null {
  const session = getSessions().get(sessionId);
  if (!session) return null;
  session.inPlanMode = inPlanMode;
  return session;
}

function getToolSummary(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read': {
      const p = toolInput.file_path as string | undefined;
      return p ? `Reading ${p.split('/').pop()}` : 'Reading file';
    }
    case 'Edit':
    case 'Write':
    case 'MultiEdit': {
      const p = toolInput.file_path as string | undefined;
      return p ? `Editing ${p.split('/').pop()}` : 'Editing file';
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
          // For well-known servers, shorten and use toolInput for details
          const shortServer = server.toLowerCase();
          // Browser tools: use the action param (screenshot, left_click, etc.)
          if (shortServer.includes('chrome') || shortServer.includes('browser')) {
            const act = toolInput.action as string | undefined;
            if (act) return `Browser: ${act.replace(/_/g, ' ')}`;
            return `Browser: ${action.replace(/_/g, ' ').slice(0, 30)}`;
          }
          if (shortServer.includes('clickup')) return `ClickUp: ${action.replace(/_/g, ' ').slice(0, 30)}`;
          if (shortServer.includes('calendar')) return `Calendar: ${action.replace(/_/g, ' ').slice(0, 30)}`;
          return `${server}: ${action.replace(/_/g, ' ').slice(0, 30)}`;
        }
      }
      // Generic: grab first string value from input
      const first = Object.values(toolInput).find(v => typeof v === 'string') as string | undefined;
      return first ? `${toolName}: ${first.slice(0, 50)}` : toolName;
    }
  }
}

function getFocusUpdateNeeded(): Map<string, boolean> {
  if (!globalThis.__focusUpdateNeeded) globalThis.__focusUpdateNeeded = new Map();
  return globalThis.__focusUpdateNeeded;
}
export function setNeedsFocusUpdate(sessionId: string, value: boolean) {
  if (value) getFocusUpdateNeeded().set(sessionId, true);
  else getFocusUpdateNeeded().delete(sessionId);
}
export function getNeedsFocusUpdate(sessionId: string): boolean {
  return getFocusUpdateNeeded().get(sessionId) || false;
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
