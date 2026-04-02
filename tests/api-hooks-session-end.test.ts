import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockRemoveSession = vi.fn();
const mockUpdateSession = vi.fn();

vi.mock('@/lib/store', () => ({
  getSession: (...a: any[]) => mockGetSession(...a),
  removeSession: (...a: any[]) => mockRemoveSession(...a),
  updateSession: (...a: any[]) => mockUpdateSession(...a),
}));

const mockBroadcast = vi.fn();
vi.mock('@/lib/ws-server', () => ({
  broadcast: (...a: any[]) => mockBroadcast(...a),
}));

const mockUnlinkPty = vi.fn(() => true);
const mockGetPtyEntry = vi.fn();
const mockKillPty = vi.fn(() => true);

vi.mock('@/lib/pty-manager', () => ({
  unlinkSessionFromPty: (...a: any[]) => mockUnlinkPty(...a),
  getPtyEntry: (...a: any[]) => mockGetPtyEntry(...a),
  killPty: (...a: any[]) => mockKillPty(...a),
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

import { POST } from '../src/app/api/hooks/session-end/route';

function createRequest(body: Record<string, unknown>) {
  return { json: () => Promise.resolve(body) } as any;
}

describe('session-end route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps session and unlinks PTY when PTY is still alive', async () => {
    const session = { sessionId: 's-1', ptyId: 'pty-1' };
    mockGetSession.mockReturnValue(session);
    mockGetPtyEntry.mockReturnValue({ ptyId: 'pty-1', exited: false });
    mockUpdateSession.mockReturnValue({ sessionId: 's-1', state: 'idle', currentTool: null });

    const res = await POST(createRequest({ session_id: 's-1' }));
    expect(mockUnlinkPty).toHaveBeenCalledWith('pty-1');
    expect(mockUpdateSession).toHaveBeenCalledWith('s-1', 'idle', null);
    expect(mockRemoveSession).not.toHaveBeenCalled();
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session-update' })
    );
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('removes session when PTY has already exited', async () => {
    const session = { sessionId: 's-2', ptyId: 'pty-2' };
    mockGetSession.mockReturnValue(session);
    mockGetPtyEntry.mockReturnValue({ ptyId: 'pty-2', exited: true });

    const res = await POST(createRequest({ session_id: 's-2' }));
    expect(mockKillPty).toHaveBeenCalledWith('pty-2');
    expect(mockRemoveSession).toHaveBeenCalledWith('s-2');
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session-remove', sessionId: 's-2' })
    );
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('removes session when no PTY exists', async () => {
    const session = { sessionId: 's-3', ptyId: undefined };
    mockGetSession.mockReturnValue(session);

    const res = await POST(createRequest({ session_id: 's-3' }));
    expect(mockRemoveSession).toHaveBeenCalledWith('s-3');
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session-remove', sessionId: 's-3' })
    );
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('removes session when no PTY entry found', async () => {
    const session = { sessionId: 's-4', ptyId: 'pty-4' };
    mockGetSession.mockReturnValue(session);
    mockGetPtyEntry.mockReturnValue(undefined);

    const res = await POST(createRequest({ session_id: 's-4' }));
    expect(mockKillPty).toHaveBeenCalledWith('pty-4');
    expect(mockRemoveSession).toHaveBeenCalledWith('s-4');
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session-remove', sessionId: 's-4' })
    );
  });

  it('handles session without ptyId gracefully', async () => {
    const session = { sessionId: 's-5' };
    mockGetSession.mockReturnValue(session);

    const res = await POST(createRequest({ session_id: 's-5' }));
    expect(mockRemoveSession).toHaveBeenCalledWith('s-5');
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
