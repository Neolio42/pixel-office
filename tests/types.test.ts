import { describe, it, expect } from 'vitest';
import type {
  WorkerState,
  Session,
  PendingApproval,
  WSMessageToClient,
  WSMessageFromClient,
  HookPayload,
} from '../src/lib/types';

describe('types.ts — export verification', () => {
  it('WorkerState has all expected values', () => {
    const states: WorkerState[] = ['idle', 'typing', 'reading', 'waiting', 'walking'];
    expect(states).toHaveLength(5);
    for (const s of states) {
      expect(typeof s).toBe('string');
    }
  });

  it('Session interface can be instantiated with required fields', () => {
    const session: Session = {
      sessionId: 's-1',
      deskIndex: 0,
      state: 'idle',
      currentTool: null,
      cwd: '/home/user/project',
      tty: '/dev/ttys001',
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    expect(session.sessionId).toBe('s-1');
    expect(session.state).toBe('idle');
    expect(session.currentTool).toBeNull();
  });

  it('Session can have optional fields', () => {
    const session: Session = {
      sessionId: 's-2',
      deskIndex: 1,
      state: 'typing',
      currentTool: 'Edit',
      cwd: '/project',
      tty: '',
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
      task: 'Fix the login bug',
      currentFocus: 'Fixing authentication',
      transcriptPath: '/tmp/transcript.jsonl',
      inPlanMode: true,
      needsFocusUpdate: false,
      ptyId: 'pty-1-1234567890',
    };
    expect(session.task).toBe('Fix the login bug');
    expect(session.inPlanMode).toBe(true);
    expect(session.ptyId).toBe('pty-1-1234567890');
  });

  it('Session.recentTools has correct shape', () => {
    const session: Session = {
      sessionId: 's-3',
      deskIndex: 0,
      state: 'reading',
      currentTool: 'Read',
      cwd: '/tmp',
      tty: '',
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [
        { toolName: 'Read', summary: 'Reading file.ts', timestamp: Date.now() },
        { toolName: 'Edit', summary: 'Editing file.ts', timestamp: Date.now() },
      ],
    };
    expect(session.recentTools).toHaveLength(2);
    expect(session.recentTools[0].toolName).toBe('Read');
    expect(session.recentTools[1].summary).toBe('Editing file.ts');
  });

  it('PendingApproval has correct shape', () => {
    const approval: PendingApproval = {
      id: 'a-1',
      sessionId: 's-1',
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /tmp/test' },
      createdAt: Date.now(),
      reason: 'risky',
      resolve: (decision) => {
        expect(decision.decision).toBe('allow');
      },
    };
    expect(approval.reason).toBe('risky');
    approval.resolve({ decision: 'allow' });
  });

  it('WSMessageToClient union covers all expected message types', () => {
    const messages: WSMessageToClient[] = [
      { type: 'sessions', sessions: [] },
      { type: 'session-update', session: { sessionId: 's', deskIndex: 0, state: 'idle', currentTool: null, cwd: '/', tty: '', startedAt: 0, lastSeen: 0, recentTools: [] } },
      { type: 'session-remove', sessionId: 's-1' },
      { type: 'approval-request', approval: { id: 'a-1', sessionId: 's-1', toolName: 'Bash', toolInput: {}, createdAt: 0, reason: 'safe' } },
      { type: 'approval-resolved', approvalId: 'a-1' },
      { type: 'notification', sessionId: 's-1', message: 'Hello' },
      { type: 'terminal-output', ptyId: 'pty-1', data: 'output' },
      { type: 'terminal-scrollback', ptyId: 'pty-1', data: 'scrollback' },
      { type: 'terminal-exited', ptyId: 'pty-1', exitCode: 0 },
      { type: 'spawn-result', ptyId: 'pty-1', success: true },
      { type: 'spawn-result', ptyId: '', success: false, error: 'Failed' },
    ];
    expect(messages).toHaveLength(11);
    for (const m of messages) {
      expect(typeof m.type).toBe('string');
    }
  });

  it('WSMessageFromClient union covers all expected message types', () => {
    const messages: WSMessageFromClient[] = [
      { type: 'approval-response', approvalId: 'a-1', decision: 'allow' },
      { type: 'approval-response', approvalId: 'a-1', decision: 'deny', message: 'Not allowed' },
      { type: 'terminal-input', ptyId: 'pty-1', data: 'ls\n' },
      { type: 'terminal-resize', ptyId: 'pty-1', cols: 120, rows: 30 },
      { type: 'terminal-subscribe', ptyId: 'pty-1' },
      { type: 'terminal-subscribe', ptyId: 'pty-1', cols: 80, rows: 24 },
      { type: 'terminal-unsubscribe', ptyId: 'pty-1' },
      { type: 'spawn-session', cwd: '/home/user/project' },
      { type: 'spawn-session', cwd: '/tmp', prompt: 'test prompt' },
    ];
    expect(messages).toHaveLength(9);
    for (const m of messages) {
      expect(typeof m.type).toBe('string');
    }
  });

  it('HookPayload has expected fields', () => {
    const payload: HookPayload = {
      session_id: 's-1',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/test.ts' },
      cwd: '/home/user/project',
      transcript_path: '/tmp/transcript.jsonl',
    };
    expect(payload.session_id).toBe('s-1');
    expect(payload.tool_name).toBe('Read');
  });

  it('HookPayload only requires session_id', () => {
    const minimal: HookPayload = {
      session_id: 's-1',
    };
    expect(minimal.session_id).toBe('s-1');
    expect(minimal.tool_name).toBeUndefined();
    expect(minimal.tool_input).toBeUndefined();
    expect(minimal.cwd).toBeUndefined();
    expect(minimal.transcript_path).toBeUndefined();
  });
});
