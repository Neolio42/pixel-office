import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

const mockGetSession = vi.fn();
const mockAddSession = vi.fn((id, cwd, tty) => ({
  sessionId: id, deskIndex: 0, state: 'walking', currentTool: null,
  cwd: cwd || '', tty: tty || '', startedAt: Date.now(), lastSeen: Date.now(),
  recentTools: [],
}));
const mockUpdateSession = vi.fn((id, state, tool) => ({
  sessionId: id, state, currentTool: tool, lastSeen: Date.now(),
}));
const mockUpdateSessionTty = vi.fn();
const mockAddToolCall = vi.fn();
const mockSetSessionPlanMode = vi.fn((id, val) => ({
  sessionId: id, inPlanMode: val,
}));
const mockSetSessionTask = vi.fn();
const mockSetSessionFocus = vi.fn();

vi.mock('@/lib/store', () => ({
  getSession: (...a: any[]) => mockGetSession(...a),
  addSession: (...a: any[]) => mockAddSession(...a),
  updateSession: (...a: any[]) => mockUpdateSession(...a),
  updateSessionTty: (...a: any[]) => mockUpdateSessionTty(...a),
  addToolCall: (...a: any[]) => mockAddToolCall(...a),
  setSessionPlanMode: (...a: any[]) => mockSetSessionPlanMode(...a),
  setSessionTask: (...a: any[]) => mockSetSessionTask(...a),
  setSessionFocus: (...a: any[]) => mockSetSessionFocus(...a),
}));

const mockClassifyTool = vi.fn(() => ({
  state: 'typing',
  needsApproval: false,
  reason: 'safe',
}));

vi.mock('@/lib/tool-classifier', () => ({
  classifyTool: (...a: any[]) => mockClassifyTool(...a),
}));

const mockCreateApproval = vi.fn(() => ({
  approval: { id: 'a-1', sessionId: 's-1', toolName: 'Bash', toolInput: {}, createdAt: Date.now(), reason: 'risky' },
  promise: new Promise(() => {}), // never resolves
}));

vi.mock('@/lib/approval-queue', () => ({
  createApproval: (...a: any[]) => mockCreateApproval(...a),
}));

const mockBroadcast = vi.fn();
const mockHasClients = vi.fn(() => true);

vi.mock('@/lib/ws-server', () => ({
  broadcast: (...a: any[]) => mockBroadcast(...a),
  hasConnectedClients: () => mockHasClients(),
}));

vi.mock('@/lib/transcript', () => ({
  readTaskFromTranscript: vi.fn(() => Promise.resolve(null)),
  readLatestAssistantMessage: vi.fn(() => Promise.resolve(null)),
}));

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

import { POST, extractFocusFromAssistant } from '../src/app/api/hooks/pre-tool-use/route';

function createRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as any;
}

describe('pre-tool-use route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockReturnValue({
      sessionId: 's-1', state: 'idle', recentTools: [], task: 'test',
    });
    mockUpdateSession.mockReturnValue({
      sessionId: 's-1', state: 'typing', currentTool: 'Edit', deskIndex: 0,
      cwd: '/project', tty: '', startedAt: Date.now(), lastSeen: Date.now(),
      recentTools: [],
    });
    mockSetSessionPlanMode.mockReturnValue({
      sessionId: 's-1', inPlanMode: true,
    });
  });

  it('auto-creates session if it does not exist', async () => {
    mockGetSession.mockReturnValueOnce(undefined).mockReturnValueOnce({
      sessionId: 's-1', state: 'idle', recentTools: [], task: 'test',
    });
    const res = await POST(createRequest({
      session_id: 's-new',
      tool_name: 'Read',
      tool_input: { file_path: '/test.ts' },
      cwd: '/project',
    }));
    expect(mockAddSession).toHaveBeenCalledWith('s-new', '/project', '', undefined);
  });

  it('classifies tool and updates session state', async () => {
    mockClassifyTool.mockReturnValue({ state: 'reading', needsApproval: false, reason: 'safe' });
    const res = await POST(createRequest({
      session_id: 's-1',
      tool_name: 'Read',
      tool_input: { file_path: '/test.ts' },
    }));
    expect(mockClassifyTool).toHaveBeenCalledWith('Read', { file_path: '/test.ts' });
    expect(mockUpdateSession).toHaveBeenCalledWith('s-1', 'reading', 'Read');
    expect(mockBroadcast).toHaveBeenCalled();
  });

  it('auto-approves non-approval tools', async () => {
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    const res = await POST(createRequest({
      session_id: 's-1',
      tool_name: 'Edit',
      tool_input: { file_path: '/test.ts' },
    }));
    const data = await res.json();
    expect(data.hookSpecificOutput.permissionDecision).toBe('allow');
  });

  it('handles EnterPlanMode', async () => {
    const res = await POST(createRequest({
      session_id: 's-1',
      tool_name: 'EnterPlanMode',
    }));
    const data = await res.json();
    expect(data.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(mockSetSessionPlanMode).toHaveBeenCalledWith('s-1', true);
  });

  it('handles ExitPlanMode', async () => {
    const res = await POST(createRequest({
      session_id: 's-1',
      tool_name: 'ExitPlanMode',
    }));
    const data = await res.json();
    expect(data.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(mockSetSessionPlanMode).toHaveBeenCalledWith('s-1', false);
  });

  it('records tool call via addToolCall', async () => {
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    await POST(createRequest({
      session_id: 's-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    }));
    expect(mockAddToolCall).toHaveBeenCalledWith('s-1', 'Bash', { command: 'ls' });
  });

  it('falls through when no browser connected and approval needed', async () => {
    mockClassifyTool.mockReturnValue({ state: 'waiting', needsApproval: true, reason: 'risky' });
    mockHasClients.mockReturnValue(false);
    const res = await POST(createRequest({
      session_id: 's-1',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    }));
    const data = await res.json();
    // Falls through — empty response
    expect(data).toEqual({});
  });

  it('handles control characters in body', async () => {
    // Body with tab in tool_input
    const rawBody = '{"session_id":"s-1","tool_name":"Bash","tool_input":{"command":"echo\ttest"}}';
    const req = {
      json: () => Promise.reject(new Error('bad json')),
      text: () => Promise.resolve(rawBody),
    } as any;
    // Should not throw
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('broadcasts on session update', async () => {
    mockClassifyTool.mockReturnValue({ state: 'typing', needsApproval: false, reason: 'safe' });
    await POST(createRequest({
      session_id: 's-1',
      tool_name: 'Write',
      tool_input: { file_path: '/test.ts' },
    }));
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session-update' })
    );
  });
});

describe('extractFocusFromAssistant', () => {
  it('extracts focus from action sentence', () => {
    expect(extractFocusFromAssistant("Let me fix the rendering bug")).toContain('Fix');
  });

  it('returns null for empty text', () => {
    expect(extractFocusFromAssistant('')).toBeNull();
  });

  it('returns null for observation-only text', () => {
    expect(extractFocusFromAssistant("The sky is blue. Water is wet.")).toBeNull();
  });

  it('extracts from multi-sentence text', () => {
    const result = extractFocusFromAssistant("I see the issue. Let me update the config file now.");
    expect(result).toContain('Update');
  });
});
