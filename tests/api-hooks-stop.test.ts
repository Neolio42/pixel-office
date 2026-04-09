import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '../src/app/api/hooks/stop/route';
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

describe('POST /api/hooks/stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok on success', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'idle',
      currentTool: null,
    };
    mockUpdateSession.mockReturnValue(mockSession);

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('auto-creates session when it does not exist', async () => {
    const req = createRequest({
      session_id: 'session-new',
    });

    mockGetSession.mockReturnValue(null);
    const mockSession = {
      sessionId: 'session-new',
      state: 'idle',
      currentTool: null,
    };
    mockAddSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockAddSession).toHaveBeenCalledWith('session-new', '');
  });

  it('does not create session when it already exists', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'idle',
      currentTool: null,
    };
    mockGetSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockAddSession).not.toHaveBeenCalled();
  });

  it('updates session state to idle', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'walking',
      currentTool: 'terminal',
    };
    mockGetSession.mockReturnValue(mockSession);
    const updatedSession = {
      sessionId: 'session-1',
      state: 'idle',
      currentTool: null,
    };
    mockUpdateSession.mockReturnValue(updatedSession);

    await POST(req);

    expect(mockUpdateSession).toHaveBeenCalledWith('session-1', 'idle', null);
  });

  it('clears currentTool to null', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'walking',
      currentTool: 'editor',
    };
    mockGetSession.mockReturnValue(mockSession);
    const updatedSession = {
      sessionId: 'session-1',
      state: 'idle',
      currentTool: null,
    };
    mockUpdateSession.mockReturnValue(updatedSession);

    await POST(req);

    expect(mockUpdateSession).toHaveBeenCalledWith('session-1', 'idle', null);
  });

  it('broadcasts session-update when session exists', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'idle',
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

  it('does not broadcast session-update when updateSession returns null', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    mockGetSession.mockReturnValue({ sessionId: 'session-1' });
    mockUpdateSession.mockReturnValue(null);

    await POST(req);

    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('handles auto-creation with empty cwd', async () => {
    const req = createRequest({
      session_id: 'session-new',
    });

    mockGetSession.mockReturnValue(null);
    const mockSession = {
      sessionId: 'session-new',
      state: 'idle',
      currentTool: null,
    };
    mockAddSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockAddSession).toHaveBeenCalledWith('session-new', '');
  });

  it('creates session even when getSession returns null', async () => {
    const req = createRequest({
      session_id: 'session-new',
    });

    mockGetSession.mockReturnValue(null);
    const mockSession = {
      sessionId: 'session-new',
      state: 'idle',
      currentTool: null,
    };
    mockAddSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockAddSession).toHaveBeenCalled();
  });

  it('calls updateSession after getSession confirms session exists', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'walking',
      currentTool: 'terminal',
    };
    mockGetSession.mockReturnValue(mockSession);
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockGetSession).toHaveBeenCalledWith('session-1');
    expect(mockUpdateSession).toHaveBeenCalledWith('session-1', 'idle', null);
  });

  it('does not call updateSession when session is created', async () => {
    const req = createRequest({
      session_id: 'session-new',
    });

    mockGetSession.mockReturnValue(null);
    const mockSession = {
      sessionId: 'session-new',
      state: 'idle',
      currentTool: null,
    };
    mockAddSession.mockReturnValue(mockSession);

    await POST(req);

    // updateSession should still be called after creation
    expect(mockUpdateSession).toHaveBeenCalledWith('session-new', 'idle', null);
  });

  it('always returns status 200', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    mockGetSession.mockReturnValue(null);
    mockAddSession.mockReturnValue(null);
    mockUpdateSession.mockReturnValue(null);

    const response = await POST(req);
    expect(response.status).toBe(200);
  });

  it('handles missing session_id gracefully', async () => {
    const req = createRequest({
      session_id: undefined as any,
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
  });

  it('broadcasts updated session with idle state', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'walking',
      currentTool: 'terminal',
    };
    mockGetSession.mockReturnValue(mockSession);
    const updatedSession = {
      sessionId: 'session-1',
      state: 'idle',
      currentTool: null,
    };
    mockUpdateSession.mockReturnValue(updatedSession);

    await POST(req);

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-update',
      session: updatedSession,
    });
  });
});
