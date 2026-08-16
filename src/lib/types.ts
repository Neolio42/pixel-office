export type WorkerState =
  | 'idle'
  | 'typing'
  | 'reading'
  | 'waiting'
  | 'walking'
  | 'thinking'
  | 'done'
  | 'error';

/** Compact one-letter codes for state history ring buffer. */
export type StateCode = 'i' | 't' | 'r' | 'w' | 'k' | 'h' | 'd' | 'e';

export const STATE_TO_CODE: Record<WorkerState, StateCode> = {
  idle: 'i',
  typing: 't',
  reading: 'r',
  waiting: 'w',
  walking: 'k',
  thinking: 'h',
  done: 'd',
  error: 'e',
};

export interface Session {
  sessionId: string;
  deskIndex: number;
  state: WorkerState;
  currentTool: string | null;
  cwd: string;
  tty: string;
  startedAt: number;
  lastSeen: number;
  recentTools: { toolName: string; summary: string; timestamp: number }[];
  task?: string;
  currentFocus?: string;
  transcriptPath?: string;
  inPlanMode?: boolean;
  /** Present if this session was spawned by Pixel Office's embedded terminal. */
  ptyId?: string;
  /** ms-since-epoch of last post-tool-use event (used to derive `thinking`). */
  lastToolEndedAt?: number;
  /** ms-since-epoch when Stop hook fired (used to derive `done` → `idle`). */
  stoppedAt?: number;
  /** ms-since-epoch when worker entered an input-waiting state (notification or approval). */
  awaitingUserSince?: number;
  /** Set true once a long-wait notification has been broadcast for the current wait window. */
  longWaitNotified?: boolean;
  /** Short error description if state === 'error'. */
  errorHint?: string;
  /** Compact history of state codes, one sample per minute (max 60 = 1h). */
  history?: StateCode[];
  /** ms-since-epoch of the last history sample push. */
  historyLastSampledAt?: number;
}

export interface PendingApproval {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  createdAt: number;
  reason: 'safe' | 'risky' | 'unknown';
  resolve: (decision: { decision: 'allow' | 'deny'; message?: string }) => void;
}

export type WSMessageToClient =
  | { type: 'sessions'; sessions: Session[] }
  | { type: 'session-update'; session: Session }
  | { type: 'session-remove'; sessionId: string }
  | { type: 'approval-request'; approval: { id: string; sessionId: string; toolName: string; toolInput: Record<string, unknown>; createdAt: number; reason: 'safe' | 'risky' | 'unknown' } }
  | { type: 'approval-resolved'; approvalId: string; decision?: 'allow' | 'deny'; message?: string }
  | { type: 'notification'; sessionId: string; message: string }
  | { type: 'long-wait'; sessionId: string; project: string; waitedMs: number }
  | { type: 'terminal-output'; ptyId: string; data: string }
  | { type: 'terminal-scrollback'; ptyId: string; data: string }
  | { type: 'terminal-exited'; ptyId: string; exitCode: number }
  | { type: 'spawn-result'; ptyId: string; success: boolean; error?: string }
  ;

export type WSMessageFromClient =
  | { type: 'approval-response'; approvalId: string; decision: 'allow' | 'deny'; message?: string }
  | { type: 'always-allow'; approvalId: string; pattern: string }
  | { type: 'terminal-input'; ptyId: string; data: string }
  | { type: 'terminal-resize'; ptyId: string; cols: number; rows: number }
  | { type: 'terminal-subscribe'; ptyId: string; cols?: number; rows?: number }
  | { type: 'terminal-unsubscribe'; ptyId: string }
  | { type: 'spawn-session'; cwd: string; prompt?: string }
  | { type: 'dismiss-session'; sessionId: string };

export interface HookPayload {
  session_id: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  transcript_path?: string;
}
