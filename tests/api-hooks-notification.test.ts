import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '../src/app/api/hooks/notification/route';
import {
  getSession,
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
import { updateSession as mockUpdateSession } from '../src/lib/store';
import { broadcast as mockBroadcast } from '@/lib/ws-server';

describe('POST /api/hooks/notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok on success', async () => {
    const req = createRequest({
      session_id: 'session-1',
      message: 'Test notification',
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

  it('extracts message from body.message', async () => {
    const req = createRequest({
      session_id: 'session-1',
      message: 'Tool executed successfully',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'idle',
      currentTool: null,
    };
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockUpdateSession).toHaveBeenCalledWith('session-1', 'idle', null);
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-update',
      session: mockSession,
    });
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'notification',
      sessionId: 'session-1',
      message: 'Tool executed successfully',
    });
  });

  it('extracts message from body.notification when body.message is missing', async () => {
    const req = createRequest({
      session_id: 'session-1',
      notification: 'This is a notification',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'idle',
      currentTool: null,
    };
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'notification',
      sessionId: 'session-1',
      message: 'This is a notification',
    });
  });

  it('uses body.message over body.notification when both are present', async () => {
    const req = createRequest({
      session_id: 'session-1',
      message: 'Priority message',
      notification: 'Ignored notification',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'idle',
      currentTool: null,
    };
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'notification',
      sessionId: 'session-1',
      message: 'Priority message',
    });
  });

  it('uses empty string when neither message nor notification is provided', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'idle',
      currentTool: null,
    };
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'notification',
      sessionId: 'session-1',
      message: '',
    });
  });

  it('broadcasts session-update when updateSession returns a session', async () => {
    const req = createRequest({
      session_id: 'session-1',
      message: 'Test',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'idle',
      currentTool: null,
      cwd: '/project',
    };
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockUpdateSession).toHaveBeenCalledWith('session-1', 'idle', null);
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-update',
      session: mockSession,
    });
  });

  it('handles case when updateSession returns null', async () => {
    const req = createRequest({
      session_id: 'nonexistent-session',
      message: 'Test',
    });

    mockUpdateSession.mockReturnValue(null);

    await POST(req);

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'notification',
      sessionId: 'nonexistent-session',
      message: 'Test',
    });
  });

  it('always broadcasts notification even when session update fails', async () => {
    const req = createRequest({
      session_id: 'session-1',
      message: 'Critical error',
    });

    mockUpdateSession.mockReturnValue(null);

    await POST(req);

    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'notification',
      sessionId: 'session-1',
      message: 'Critical error',
    });
  });

  it('calls updateSession with correct parameters', async () => {
    const req = createRequest({
      session_id: 'session-1',
      message: 'Test',
    });

    const mockSession = {
      sessionId: 'session-1',
      state: 'idle',
      currentTool: null,
    };
    mockUpdateSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockUpdateSession).toHaveBeenCalledWith('session-1', 'idle', null);
  });

  it('always returns status 200', async () => {
    const req = createRequest({
      session_id: 'session-1',
      message: 'Test',
    });

    mockUpdateSession.mockReturnValue(null);

    const response = await POST(req);
    expect(response.status).toBe(200);
  });
});
