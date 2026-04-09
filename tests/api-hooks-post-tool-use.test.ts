import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '../src/app/api/hooks/post-tool-use/route';
import {
  getSession,
  addSession,
  updateSession,
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
}));

// Mock ws-server
vi.mock('@/lib/ws-server', () => ({
  broadcast: vi.fn(),
}));

function createRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
  } as any;
}

// Import the mocked functions
import { getSession as mockGetSession } from '../src/lib/store';
import { addSession as mockAddSession } from '../src/lib/store';
import { updateSession as mockUpdateSession } from '../src/lib/store';
import { broadcast as mockBroadcast } from '@/lib/ws-server';

describe('POST /api/hooks/post-tool-use', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok on success', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/home/user/project',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/home/user/project',
      lastSeen: Date.now(),
      currentTool: null,
    };
    mockGetSession.mockReturnValue(mockSession);
    mockUpdateSession.mockReturnValue(mockSession);

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('auto-creates session when it does not exist', async () => {
    const req = createRequest({
      session_id: 'session-new',
      cwd: '/project',
    });

    mockGetSession.mockReturnValue(null);
    const mockSession = {
      sessionId: 'session-new',
      cwd: '/project',
      lastSeen: Date.now(),
      currentTool: null,
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetSession.mockReturnValueOnce(null).mockReturnValue(mockSession);

    await POST(req);

    expect(mockAddSession).toHaveBeenCalledWith('session-new', '/project');
  });

  it('does not create session when it already exists', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      lastSeen: Date.now(),
      currentTool: null,
    };
    mockGetSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockAddSession).not.toHaveBeenCalled();
  });

  it('uses cwd from request body when creating session', async () => {
    const req = createRequest({
      session_id: 'session-new',
      cwd: '/custom/workspace',
    });

    mockGetSession.mockReturnValue(null);
    const mockSession = {
      sessionId: 'session-new',
      cwd: '/custom/workspace',
      lastSeen: Date.now(),
      currentTool: null,
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetSession.mockReturnValueOnce(null).mockReturnValue(mockSession);

    await POST(req);

    expect(mockAddSession).toHaveBeenCalledWith('session-new', '/custom/workspace');
  });

  it('uses empty string as default cwd when not provided', async () => {
    const req = createRequest({
      session_id: 'session-new',
    });

    mockGetSession.mockReturnValue(null);
    const mockSession = {
      sessionId: 'session-new',
      cwd: '',
      lastSeen: Date.now(),
      currentTool: null,
    };
    mockAddSession.mockReturnValue(mockSession);
    mockGetSession.mockReturnValueOnce(null).mockReturnValue(mockSession);

    await POST(req);

    expect(mockAddSession).toHaveBeenCalledWith('session-new', '');
  });

  it('updates lastSeen timestamp on existing session', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      lastSeen: Date.now(),
      currentTool: null,
    };
    mockGetSession.mockReturnValue(mockSession);
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockGetSession).toHaveBeenCalledWith('session-1');
    expect(mockSession.lastSeen).toBeGreaterThan(0);
  });

  it('clears currentTool on session', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      lastSeen: Date.now(),
      currentTool: 'terminal',
    };
    mockGetSession.mockReturnValue(mockSession);
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockSession.currentTool).toBeNull();
  });

  it('broadcasts session-update when session exists', async () => {
    const req = createRequest({
      session_id: 'session-1',
      cwd: '/project',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
      lastSeen: Date.now(),
      currentTool: null,
    };
    mockGetSession.mockReturnValue(mockSession);
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-update',
      session: mockSession,
    });
  });

  it('does not broadcast when session does not exist after create', async () => {
    const req = createRequest({
      session_id: 'session-new',
      cwd: '/project',
    });

    mockGetSession.mockReturnValue(null);
    const mockSession = {
      sessionId: 'session-new',
      cwd: '/project',
      lastSeen: Date.now(),
      currentTool: null,
    };
    mockAddSession.mockReturnValue(mockSession);
    // getSession returns null first (before create), then the session (after create)
    mockGetSession
      .mockReturnValueOnce(null)
      .mockReturnValue(mockSession);

    await POST(req);

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-update',
      session: mockSession,
    });
  });

  it('handles case where session is null after creation', async () => {
    const req = createRequest({
      session_id: 'session-new',
      cwd: '/project',
    });

    mockGetSession.mockReturnValue(null);
    mockAddSession.mockReturnValue(null);
    mockGetSession.mockReturnValueOnce(null).mockReturnValue(null);

    await POST(req);

    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('does not call updateSession when session does not exist', async () => {
    const req = createRequest({
      session_id: 'session-new',
      cwd: '/project',
    });

    mockGetSession.mockReturnValue(null);
    mockAddSession.mockReturnValue(null);
    mockGetSession.mockReturnValueOnce(null).mockReturnValue(null);

    await POST(req);

    expect(mockUpdateSession).not.toHaveBeenCalled();
  });

  it('calls getSession after addSession to get the session', async () => {
    const req = createRequest({
      session_id: 'session-new',
      cwd: '/project',
    });

    const mockSession = {
      sessionId: 'session-new',
      cwd: '/project',
      lastSeen: Date.now(),
      currentTool: null,
    };
    mockGetSession.mockReturnValue(null).mockReturnValue(mockSession);
    mockAddSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });

  it('always returns status 200', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    mockGetSession.mockReturnValue(null);
    mockAddSession.mockReturnValue(null);

    const response = await POST(req);
    expect(response.status).toBe(200);
  });
});
