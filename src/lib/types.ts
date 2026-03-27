export type WorkerState = 'idle' | 'typing' | 'reading' | 'waiting' | 'walking';

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
  | { type: 'approval-resolved'; approvalId: string }
  | { type: 'notification'; sessionId: string; message: string }
  | { type: 'terminal-output'; ptyId: string; data: string }
  | { type: 'terminal-scrollback'; ptyId: string; data: string }
  | { type: 'terminal-exited'; ptyId: string; exitCode: number }
  | { type: 'spawn-result'; ptyId: string; success: boolean; error?: string };

export type WSMessageFromClient =
  | { type: 'approval-response'; approvalId: string; decision: 'allow' | 'deny'; message?: string }
  | { type: 'terminal-input'; ptyId: string; data: string }
  | { type: 'terminal-resize'; ptyId: string; cols: number; rows: number }
  | { type: 'terminal-subscribe'; ptyId: string; cols?: number; rows?: number }
  | { type: 'terminal-unsubscribe'; ptyId: string }
  | { type: 'spawn-session'; cwd: string; prompt?: string };

export interface HookPayload {
  session_id: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  transcript_path?: string;
}
