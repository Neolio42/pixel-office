import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { POST } from '../src/app/api/hooks/session-start/route';
import {
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
  addSession: vi.fn(),
  getAllSessions: vi.fn(() => []),
  removeSession: vi.fn(),
  setSessionTask: vi.fn(),
}));

// Mock ws-server
vi.mock('@/lib/ws-server', () => ({
  broadcast: vi.fn(),
}));

// Mock pty-manager
vi.mock('@/lib/pty-manager', () => ({
  findPtyByTty: vi.fn(),
  findPtyByCwd: vi.fn(),
  linkSessionToPty: vi.fn(),
}));

// Mock transcript
vi.mock('@/lib/transcript', () => ({
  readTaskFromTranscript: vi.fn(),
}));

function createRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
  } as any;
}

// Import the mocked functions
import { addSession as mockAddSession } from '../src/lib/store';
import { getAllSessions as mockGetAllSessions } from '../src/lib/store';
import { removeSession as mockRemoveSession } from '../src/lib/store';
import { setSessionTask as mockSetSessionTask } from '../src/lib/store';
import { findPtyByTty as mockFindPtyByTty } from '@/lib/pty-manager';
import { findPtyByCwd as mockFindPtyByCwd } from '@/lib/pty-manager';
import { linkSessionToPty as mockLinkSessionToPty } from '@/lib/pty-manager';
import { readTaskFromTranscript as mockReadTaskFromTranscript } from '@/lib/transcript';
import { broadcast as mockBroadcast } from '@/lib/ws-server';

describe('POST /api/hooks/session-start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new session with provided parameters', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/home/user/project',
      tty: '/dev/pts/0',
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/home/user/project',
      tty: '/dev/pts/0',
      transcriptPath: '/transcript.jsonl',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);
    mockReadTaskFromTranscript.mockResolvedValue(null);

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });

    expect(mockAddSession).toHaveBeenCalledWith('session-1', '/home/user/project', '/dev/pts/0', '/transcript.jsonl');
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'sessions',
      sessions: [mockSession],
    });
  });

  it('creates session with defaults when tty and transcript_path are not provided', async () => {
    const req = createRequest({
      session_id: 'session-2',
      cwd: '/project',
    });

    const mockSession = {
      sessionId: 'session-2',
      cwd: '/project',
      tty: '',
      transcriptPath: undefined,
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);

    await POST(req);

    expect(mockAddSession).toHaveBeenCalledWith('session-2', '/project', '', undefined);
  });

  it('links session to PTY when found by tty', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
      tty: '/dev/pts/5',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      tty: '/dev/pts/5',
      ptyId: 'pty-123',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    const mockPtyEntry = { ptyId: 'pty-123', cwd: '/project', ttyPath: '/dev/pts/5' };

    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(mockPtyEntry);

    await POST(req);

    expect(mockFindPtyByTty).toHaveBeenCalledWith('/dev/pts/5');
    expect(mockLinkSessionToPty).toHaveBeenCalledWith('session-1', 'pty-123');
    expect(mockSession.ptyId).toBe('pty-123');
  });

  it('links session to PTY by cwd when tty match fails', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      tty: '',
      ptyId: 'pty-456',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    const mockPtyEntry = { ptyId: 'pty-456', cwd: '/project', ttyPath: '/dev/pts/0' };

    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);
    mockFindPtyByCwd.mockReturnValue(mockPtyEntry);

    await POST(req);

    expect(mockFindPtyByTty).not.toHaveBeenCalled();
    expect(mockFindPtyByCwd).toHaveBeenCalledWith('/project');
    expect(mockLinkSessionToPty).toHaveBeenCalledWith('session-1', 'pty-456');
    expect(mockSession.ptyId).toBe('pty-456');
  });

  it('removes orphan sessions from the same PTY', async () => {
    const req = createRequest({
      session_id: 'session-new',
      cwd: '/project',
      tty: '/dev/pts/0',
    });

    const mockNewSession = {
      sessionId: 'session-new',
      cwd: '/project',
      tty: '/dev/pts/0',
      ptyId: 'pty-1',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    const mockOldSession = {
      sessionId: 'session-old',
      cwd: '/project',
      tty: '/dev/pts/0',
      ptyId: 'pty-1',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    const mockPtyEntry = { ptyId: 'pty-1', cwd: '/project', ttyPath: '/dev/pts/0' };

    mockAddSession.mockReturnValue(mockNewSession);
    mockGetAllSessions.mockReturnValue([mockNewSession, mockOldSession]);
    mockFindPtyByTty.mockReturnValue(mockPtyEntry);

    await POST(req);

    expect(mockRemoveSession).toHaveBeenCalledWith('session-old');
  });

  it('does not remove sessions with different PTY', async () => {
    const req = createRequest({
      session_id: 'session-new',
      cwd: '/project',
      tty: '/dev/pts/0',
    });

    const mockNewSession = {
      sessionId: 'session-new',
      cwd: '/project',
      tty: '/dev/pts/0',
      ptyId: 'pty-1',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    const mockOtherSession = {
      sessionId: 'session-other',
      cwd: '/other-project',
      tty: '/dev/pts/1',
      ptyId: 'pty-2',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    const mockPtyEntry = { ptyId: 'pty-1', cwd: '/project', ttyPath: '/dev/pts/0' };

    mockAddSession.mockReturnValue(mockNewSession);
    mockGetAllSessions.mockReturnValue([mockNewSession, mockOtherSession]);
    mockFindPtyByTty.mockReturnValue(mockPtyEntry);

    await POST(req);

    expect(mockRemoveSession).not.toHaveBeenCalledWith('session-other');
  });

  it('reads task from transcript when transcript_path is provided', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      transcriptPath: '/transcript.jsonl',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);
    mockReadTaskFromTranscript.mockResolvedValue('Fix the login bug');

    await POST(req);

    expect(mockReadTaskFromTranscript).toHaveBeenCalledWith('/transcript.jsonl');
  });

  it('sets session task when task is read from transcript', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      transcriptPath: '/transcript.jsonl',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
      task: 'Fix the login bug',
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);
    mockReadTaskFromTranscript.mockResolvedValue('Fix the login bug');
    mockSetSessionTask.mockReturnValue(mockSession);

    await POST(req);

    // The async task reading happens in the background
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockSetSessionTask).toHaveBeenCalledWith('session-1', 'Fix the login bug');
  });

  it('broadcasts session update after setting task from transcript', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      transcriptPath: '/transcript.jsonl',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
      task: 'Fix the login bug',
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);
    mockReadTaskFromTranscript.mockResolvedValue('Fix the login bug');
    mockSetSessionTask.mockReturnValue(mockSession);

    await POST(req);

    // Wait for async task reading
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-update',
      session: mockSession,
    });
  });

  it('handles errors when reading from transcript', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      transcriptPath: '/transcript.jsonl',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);
    mockReadTaskFromTranscript.mockRejectedValue(new Error('File not found'));

    const response = await POST(req);

    // Should not throw, just continue
    expect(response.status).toBe(200);

    // Wait for async error handling
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockSetSessionTask).not.toHaveBeenCalled();
  });

  it('does not set task when transcript reading returns null', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
      transcript_path: '/transcript.jsonl',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      transcriptPath: '/transcript.jsonl',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);
    mockReadTaskFromTranscript.mockResolvedValue(null);

    await POST(req);

    // Wait for async task reading
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockSetSessionTask).not.toHaveBeenCalled();
  });

  it('does not read from transcript when transcript_path is not provided', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);

    await POST(req);

    expect(mockReadTaskFromTranscript).not.toHaveBeenCalled();
  });

  it('always returns status ok on success', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('handles missing cwd gracefully', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);

    await POST(req);

    expect(mockAddSession).toHaveBeenCalledWith('session-1', '', '', undefined);
  });

  it('does not try to link PTY when no tty or cwd', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '',
      state: 'walking',
      currentTool: null,
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetAllSessions.mockReturnValue([mockSession]);
    mockFindPtyByTty.mockReturnValue(null);

    await POST(req);

    expect(mockFindPtyByTty).not.toHaveBeenCalled();
    expect(mockFindPtyByCwd).not.toHaveBeenCalled();
    expect(mockLinkSessionToPty).not.toHaveBeenCalled();
  });
});
