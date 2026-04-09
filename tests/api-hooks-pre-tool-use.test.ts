import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { POST } from '../src/app/api/hooks/pre-tool-use/route';
import {
  getSession,
  addSession,
  getAllSessions,
  removeSession,
} from '../src/lib/store';

// Mock NextRequest/NextResponse
vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, opts?: { status?: number }) => ({
      json: () => Promise.resolve(data),
      status: opts?.status ?? 200,
      data,
    }),
  },
  NextRequest: class {},
}));

// Mock store
vi.mock('@/lib/store', () => ({
  getSession: vi.fn(),
  addSession: vi.fn(),
  updateSession: vi.fn(),
  updateSessionTty: vi.fn(),
  addToolCall: vi.fn(),
  setSessionPlanMode: vi.fn(),
  setSessionTask: vi.fn(),
  setSessionFocus: vi.fn(),
  getAllSessions: vi.fn(() => []),
  removeSession: vi.fn(),
}));

// Mock ws-server
vi.mock('@/lib/ws-server', () => ({
  broadcast: vi.fn(),
  hasConnectedClients: vi.fn(() => false),
}));

// Mock tool-classifier
vi.mock('@/lib/tool-classifier', () => ({
  classifyTool: vi.fn(),
}));

// Mock approval-queue
vi.mock('@/lib/approval-queue', () => ({
  createApproval: vi.fn(),
}));

// Mock transcript
vi.mock('@/lib/transcript', () => ({
  readTaskFromTranscript: vi.fn(),
  readLatestAssistantMessage: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

function createRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: () => Promise.resolve(json),
    json: () => Promise.resolve(body),
  } as any;
}

// Import the mocked functions
import {
  getSession as mockGetSession,
  addSession as mockAddSession,
  updateSession as mockUpdateSession,
  updateSessionTty as mockUpdateSessionTty,
  addToolCall as mockAddToolCall,
  setSessionPlanMode as mockSetSessionPlanMode,
  setSessionTask as mockSetSessionTask,
  setSessionFocus as mockSetSessionFocus,
} from '../src/lib/store';
import { classifyTool as mockClassifyTool } from '../src/lib/tool-classifier';
import { createApproval as mockCreateApproval } from '../src/lib/approval-queue';
import { hasConnectedClients as mockHasConnectedClients } from '@/lib/ws-server';
import { readTaskFromTranscript as mockReadTaskFromTranscript } from '@/lib/transcript';
import { readLatestAssistantMessage as mockReadLatestAssistantMessage } from '@/lib/transcript';
import { spawn as mockSpawn } from 'child_process';

describe('POST /api/hooks/pre-tool-use', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty object for unparseable JSON body', async () => {
    const req = {
      text: () => Promise.resolve('invalid json{{{'),
    } as any;

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({});
  });

  it('cleans control characters from body and parses successfully', async () => {
    const body = {
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'echo "hello\tworld"' }, // Contains tab
    };

    // Mock tab character
    const jsonWithTab = JSON.stringify(body).replace('hello', 'hello\tworld');

    const req = {
      text: () => Promise.resolve(jsonWithTab),
    } as any;

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('hookSpecificOutput');
  });

  it('auto-creates session when it does not exist', async () => {
    const req = createRequest({
      session_id: 'session-new',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      cwd: '/project',
      tty: '/dev/pts/0',
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = { sessionId: 'session-new', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false, tty: '/dev/pts/0', transcriptPath: '/transcript.jsonl' };
    mockGetSession.mockReturnValue(null);
    mockAddSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockAddSession).toHaveBeenCalledWith('session-new', '/project', '/dev/pts/0', '/transcript.jsonl');
  });

  it('updates session TTY when provided', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tty: '/dev/pts/1',
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockUpdateSessionTty).toHaveBeenCalledWith('session-1', '/dev/pts/1');
  });

  it('reads task from transcript when session has no task', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false, task: null };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockReadTaskFromTranscript.mockResolvedValue('Fix the login bug');

    await POST(req);

    expect(mockReadTaskFromTranscript).toHaveBeenCalledWith('/transcript.jsonl');
  });

  it('extracts focus from assistant message when needsFocusUpdate is true', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: true, transcriptPath: '/transcript.jsonl' };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockReadLatestAssistantMessage.mockResolvedValue('Let me fix the login bug in auth.ts');

    await POST(req);

    expect(mockReadLatestAssistantMessage).toHaveBeenCalledWith('/transcript.jsonl');
    expect(mockSession.needsFocusUpdate).toBe(false);
    expect(mockSetSessionFocus).toHaveBeenCalledWith('session-1', expect.stringContaining('Fix'));
  });

  it('handles EnterPlanMode tool and returns auto-approve', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'EnterPlanMode',
      tool_input: {},
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockSetSessionPlanMode.mockReturnValue(mockSession);

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(mockSetSessionPlanMode).toHaveBeenCalledWith('session-1', true);
    expect(data).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Auto-approved by Pixel Office',
      },
    });
  });

  it('handles ExitPlanMode tool and returns auto-approve', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'ExitPlanMode',
      tool_input: {},
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockSetSessionPlanMode.mockReturnValue(mockSession);

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(mockSetSessionPlanMode).toHaveBeenCalledWith('session-1', false);
    expect(data).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Auto-approved by Pixel Office',
      },
    });
  });

  it('records tool call before classification', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockAddToolCall).toHaveBeenCalledWith('session-1', 'Bash', { command: 'ls -la' });
  });

  it('updates session state based on classification', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Read',
      tool_input: { path: 'file.txt' },
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'reading', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockClassifyTool).toHaveBeenCalledWith('Read', { path: 'file.txt' });
    expect(mockUpdateSession).toHaveBeenCalledWith('session-1', 'reading', 'Read');
  });

  it('returns auto-approve for safe tools', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Read',
      tool_input: { path: 'file.txt' },
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'reading', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Auto-approved by Pixel Office',
      },
    });
  });

  it('returns empty response when tool needs approval but no clients connected', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'waiting', needsApproval: true, reason: 'risky' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockHasConnectedClients.mockReturnValue(false);

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toEqual({});
    expect(mockCreateApproval).not.toHaveBeenCalled();
  });

  it('creates approval and awaits decision when clients are connected', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'waiting', needsApproval: true, reason: 'risky' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockHasConnectedClients.mockReturnValue(true);

    const approvalPromise = Promise.resolve({ decision: 'allow', message: 'Looks good' });
    const mockApproval = { id: 'approval-123', sessionId: 'session-1', toolName: 'Bash', toolInput: { command: 'rm -rf /' }, reason: 'risky', createdAt: Date.now() };
    mockCreateApproval.mockReturnValue({ approval: mockApproval, promise: approvalPromise });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(mockCreateApproval).toHaveBeenCalledWith('session-1', 'Bash', { command: 'rm -rf /' }, 'risky');
    expect(data).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Looks good',
        additionalContext: '[Boss says] Looks good',
      },
      additionalContext: '[Boss says] Looks good',
    });
  });

  it('handles denied approval', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'waiting', needsApproval: true, reason: 'risky' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockHasConnectedClients.mockReturnValue(true);

    const approvalPromise = Promise.resolve({ decision: 'deny', message: 'Too risky' });
    const mockApproval = { id: 'approval-123', sessionId: 'session-1', toolName: 'Bash', toolInput: { command: 'rm -rf /' }, reason: 'risky', createdAt: Date.now() };
    mockCreateApproval.mockReturnValue({ approval: mockApproval, promise: approvalPromise });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Too risky',
        additionalContext: '[Boss says] Too risky',
      },
      additionalContext: '[Boss says] Too risky',
    });
  });

  it('plays notification sound on macOS when approval is needed', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'waiting', needsApproval: true, reason: 'risky' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockHasConnectedClients.mockReturnValue(true);

    const approvalPromise = Promise.resolve({ decision: 'allow', message: '' });
    const mockApproval = { id: 'approval-123', sessionId: 'session-1', toolName: 'Bash', toolInput: { command: 'rm -rf /' }, reason: 'risky', createdAt: Date.now() };
    mockCreateApproval.mockReturnValue({ approval: mockApproval, promise: approvalPromise });

    const mockChild = { unref: vi.fn() };
    mockSpawn.mockReturnValue(mockChild as any);

    await POST(req);

    expect(mockSpawn).toHaveBeenCalledWith('afplay', ['/System/Library/Sounds/Bottle.aiff'], { detached: true, stdio: 'ignore' });
    expect(mockChild.unref).toHaveBeenCalled();
  });

  it('handles approval with no message', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: false };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'waiting', needsApproval: true, reason: 'risky' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockHasConnectedClients.mockReturnValue(true);

    const approvalPromise = Promise.resolve({ decision: 'allow', message: '' });
    const mockApproval = { id: 'approval-123', sessionId: 'session-1', toolName: 'Bash', toolInput: { command: 'rm -rf /' }, reason: 'risky', createdAt: Date.now() };
    mockCreateApproval.mockReturnValue({ approval: mockApproval, promise: approvalPromise });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Boss approved',
      },
    });
    expect(data).not.toHaveProperty('additionalContext');
  });

  it('extracts focus from assistant message - simple action', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: true, transcriptPath: '/transcript.jsonl' };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockReadLatestAssistantMessage.mockResolvedValue('I\'ll update the WorkerPanel component to fix the rendering issue');

    await POST(req);

    expect(mockSetSessionFocus).toHaveBeenCalledWith('session-1', expect.stringContaining('Update'));
  });

  it('extracts focus from assistant message - strips "I\'ll" prefix', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: true, transcriptPath: '/transcript.jsonl' };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockReadLatestAssistantMessage.mockResolvedValue('I\'ll fix the authentication bug');

    await POST(req);

    expect(mockSetSessionFocus).toHaveBeenCalledWith('session-1', expect.stringContaining('Fix'));
  });

  it('extracts focus from assistant message - handles "let me" prefix', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: true, transcriptPath: '/transcript.jsonl' };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockReadLatestAssistantMessage.mockResolvedValue('Let me refactor the database queries for better performance');

    await POST(req);

    expect(mockSetSessionFocus).toHaveBeenCalledWith('session-1', expect.stringContaining('Refactor'));
  });

  it('does not set focus when no focus is extracted from assistant message', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: true, transcriptPath: '/transcript.jsonl' };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockReadLatestAssistantMessage.mockResolvedValue('This is a statement without an action verb');

    await POST(req);

    expect(mockSetSessionFocus).not.toHaveBeenCalled();
  });

  it('handles newlines in assistant messages', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: true, transcriptPath: '/transcript.jsonl' };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockReadLatestAssistantMessage.mockResolvedValue('I\'ll update the config\n\nNow let me fix the bug');

    await POST(req);

    expect(mockSetSessionFocus).toHaveBeenCalledWith('session-1', expect.stringContaining('Update'));
  });

  it('uses existing transcriptPath when transcript_path not provided', async () => {
    const req = createRequest({
      session_id: 'session-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });

    const mockSession = { sessionId: 'session-1', cwd: '/project', state: 'walking', currentTool: null, startedAt: Date.now(), lastSeen: Date.now(), recentTools: [], needsFocusUpdate: true, transcriptPath: '/existing-transcript.jsonl' };
    mockGetSession.mockReturnValue(mockSession);
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    mockUpdateSession.mockReturnValue(mockSession);
    mockReadLatestAssistantMessage.mockResolvedValue('I\'ll fix the bug');

    await POST(req);

    expect(mockReadLatestAssistantMessage).toHaveBeenCalledWith('/existing-transcript.jsonl');
  });
});
