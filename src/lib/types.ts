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
}

export interface PendingApproval {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  createdAt: number;
  resolve: (decision: 'allow' | 'deny') => void;
}

export type WSMessageToClient =
  | { type: 'sessions'; sessions: Session[] }
  | { type: 'session-update'; session: Session }
  | { type: 'session-remove'; sessionId: string }
  | { type: 'approval-request'; approval: { id: string; sessionId: string; toolName: string; toolInput: Record<string, unknown> } }
  | { type: 'approval-resolved'; approvalId: string }
  | { type: 'notification'; sessionId: string; message: string };

export type WSMessageFromClient =
  | { type: 'approval-response'; approvalId: string; decision: 'allow' | 'deny' };

export interface HookPayload {
  session_id: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
  transcript_path?: string;
}
