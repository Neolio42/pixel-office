import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from '../src/app/api/hooks/session-end/route';
import {
  getSession,
  removeSession,
  updateSession,
} from '../src/lib/store';
import {
  getPtyEntry,
  killPty,
  unlinkSessionFromPty,
} from '../src/lib/pty-manager';

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
  removeSession: vi.fn(),
  updateSession: vi.fn(),
}));

// Mock ws-server
vi.mock('@/lib/ws-server', () => ({
  broadcast: vi.fn(),
}));

// Mock pty-manager
vi.mock('@/lib/pty-manager', () => ({
  getPtyEntry: vi.fn(),
  killPty: vi.fn(),
  unlinkSessionFromPty: vi.fn(),
}));

function createRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
  } as any;
}

// Import the mocked functions
import { getSession as mockGetSession } from '../src/lib/store';
import { removeSession as mockRemoveSession } from '../src/lib/store';
import { updateSession as mockUpdateSession } from '../src/lib/store';
import { broadcast as mockBroadcast } from '@/lib/ws-server';
import { getPtyEntry as mockGetPtyEntry } from '@/lib/pty-manager';
import { killPty as mockKillPty } from '@/lib/pty-manager';
import { unlinkSessionFromPty as mockUnlinkSessionFromPty } from '@/lib/pty-manager';

describe('POST /api/hooks/session-end', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok on success', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    mockGetSession.mockReturnValue(null);

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('removes session when session does not exist', async () => {
    const req = createRequest({
      session_id: 'nonexistent-session',
    });

    mockGetSession.mockReturnValue(null);

    await POST(req);

    expect(mockRemoveSession).toHaveBeenCalledWith('nonexistent-session');
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-remove',
      sessionId: 'nonexistent-session',
    });
  });

  it('keeps PTY alive when session has PTY and PTY is not exited', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      ptyId: 'pty-123',
      cwd: '/project',
    };
    const mockPtyEntry = {
      ptyId: 'pty-123',
      cwd: '/project',
      exited: false,
    };
    const updatedSession = {
      sessionId: 'session-1',
      ptyId: 'pty-123',
      cwd: '/project',
      state: 'idle',
      currentTool: null,
    };

    mockGetSession.mockReturnValue(mockSession);
    mockGetPtyEntry.mockReturnValue(mockPtyEntry);
    mockUpdateSession.mockReturnValue(updatedSession);

    await POST(req);

    expect(mockUnlinkSessionFromPty).toHaveBeenCalledWith('pty-123');
    expect(mockUpdateSession).toHaveBeenCalledWith('session-1', 'idle', null);
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-update',
      session: updatedSession,
    });
    expect(mockKillPty).not.toHaveBeenCalled();
    expect(mockRemoveSession).not.toHaveBeenCalled();
  });

  it('removes session when PTY is exited', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      ptyId: 'pty-123',
      cwd: '/project',
    };
    const mockPtyEntry = {
      ptyId: 'pty-123',
      cwd: '/project',
      exited: true,
    };

    mockGetSession.mockReturnValue(mockSession);
    mockGetPtyEntry.mockReturnValue(mockPtyEntry);

    await POST(req);

    expect(mockKillPty).toHaveBeenCalledWith('pty-123');
    expect(mockRemoveSession).toHaveBeenCalledWith('session-1');
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-remove',
      sessionId: 'session-1',
    });
    expect(mockUnlinkSessionFromPty).not.toHaveBeenCalled();
  });

  it('kills PTY and removes session when PTY entry is null', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      ptyId: 'pty-123',
      cwd: '/project',
    };

    mockGetSession.mockReturnValue(mockSession);
    mockGetPtyEntry.mockReturnValue(null);

    await POST(req);

    expect(mockKillPty).toHaveBeenCalledWith('pty-123');
    expect(mockRemoveSession).toHaveBeenCalledWith('session-1');
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-remove',
      sessionId: 'session-1',
    });
    expect(mockUnlinkSessionFromPty).not.toHaveBeenCalled();
  });

  it('kills PTY and removes session when session has no ptyId', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
    };

    mockGetSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockKillPty).not.toHaveBeenCalled();
    expect(mockRemoveSession).toHaveBeenCalledWith('session-1');
    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-remove',
      sessionId: 'session-1',
    });
    expect(mockGetPtyEntry).not.toHaveBeenCalled();
  });

  it('broadcasts session-remove when removing session', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    mockGetSession.mockReturnValue(null);

    await POST(req);

    expect(mockBroadcast).toHaveBeenCalledWith({
      type: 'session-remove',
      sessionId: 'session-1',
    });
  });

  it('gets PTY entry for session when ptyId exists', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      ptyId: 'pty-123',
      cwd: '/project',
    };

    mockGetSession.mockReturnValue(mockSession);
    mockGetPtyEntry.mockReturnValue(null);

    await POST(req);

    expect(mockGetPtyEntry).toHaveBeenCalledWith('pty-123');
  });

  it('updates session state to idle when keeping PTY alive', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      ptyId: 'pty-123',
      cwd: '/project',
    };
    const mockPtyEntry = {
      ptyId: 'pty-123',
      cwd: '/project',
      exited: false,
    };
    const updatedSession = {
      sessionId: 'session-1',
      ptyId: 'pty-123',
      cwd: '/project',
      state: 'idle',
      currentTool: null,
    };

    mockGetSession.mockReturnValue(mockSession);
    mockGetPtyEntry.mockReturnValue(mockPtyEntry);
    mockUpdateSession.mockReturnValue(updatedSession);

    await POST(req);

    expect(mockUpdateSession).toHaveBeenCalledWith('session-1', 'idle', null);
  });

  it('does not broadcast session-update when updateSession returns null', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      ptyId: 'pty-123',
      cwd: '/project',
    };
    const mockPtyEntry = {
      ptyId: 'pty-123',
      cwd: '/project',
      exited: false,
    };

    mockGetSession.mockReturnValue(mockSession);
    mockGetPtyEntry.mockReturnValue(mockPtyEntry);
    mockUpdateSession.mockReturnValue(null);

    await POST(req);

    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('always returns status 200 even when session does not exist', async () => {
    const req = createRequest({
      session_id: 'nonexistent',
    });

    mockGetSession.mockReturnValue(null);

    const response = await POST(req);
    expect(response.status).toBe(200);
  });

  it('handles session with null ptyId', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      ptyId: null as string | null,
      cwd: '/project',
    };

    mockGetSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockKillPty).not.toHaveBeenCalled();
    expect(mockGetPtyEntry).not.toHaveBeenCalled();
    expect(mockRemoveSession).toHaveBeenCalledWith('session-1');
  });

  it('does not call killPty when session exists but has no ptyId', async () => {
    const req = createRequest({
      session_id: 'session-1',
    });

    const mockSession = {
      sessionId: 'session-1',
      cwd: '/project',
    };

    mockGetSession.mockReturnValue(mockSession);

    await POST(req);

    expect(mockKillPty).not.toHaveBeenCalled();
  });
});
