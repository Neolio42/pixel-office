import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockAddSession = vi.fn((id, cwd) => ({
  sessionId: id, deskIndex: 0, state: 'walking', currentTool: null,
  cwd, tty: '', startedAt: Date.now(), lastSeen: Date.now(), recentTools: [],
}));
const mockUpdateSession = vi.fn((id, state, tool) => ({
  sessionId: id, state, currentTool: tool,
}));

vi.mock('@/lib/store', () => ({
  getSession: (...a: any[]) => mockGetSession(...a),
  addSession: (...a: any[]) => mockAddSession(...a),
  updateSession: (...a: any[]) => mockUpdateSession(...a),
}));

const mockBroadcast = vi.fn();
vi.mock('@/lib/ws-server', () => ({
  broadcast: (...a: any[]) => mockBroadcast(...a),
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

import { POST } from '../src/app/api/hooks/stop/route';

function createRequest(body: Record<string, unknown>) {
  return { json: () => Promise.resolve(body) } as any;
}

describe('stop route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-creates session if missing and sets idle', async () => {
    mockGetSession.mockReturnValueOnce(undefined).mockReturnValueOnce({
      sessionId: 's-new', state: 'walking', recentTools: [],
    });
    mockUpdateSession.mockReturnValue({
      sessionId: 's-new', state: 'idle', currentTool: null,
    });
    const res = await POST(createRequest({ session_id: 's-new' }));
    expect(mockAddSession).toHaveBeenCalledWith('s-new', '');
    expect(mockUpdateSession).toHaveBeenCalledWith('s-new', 'idle', null);
  });

  it('sets session to idle', async () => {
    mockGetSession.mockReturnValue({ sessionId: 's-1', state: 'typing' });
    mockUpdateSession.mockReturnValue({ sessionId: 's-1', state: 'idle', currentTool: null });
    const res = await POST(createRequest({ session_id: 's-1' }));
    expect(mockUpdateSession).toHaveBeenCalledWith('s-1', 'idle', null);
  });

  it('broadcasts session-update', async () => {
    mockGetSession.mockReturnValue({ sessionId: 's-1', state: 'typing' });
    mockUpdateSession.mockReturnValue({ sessionId: 's-1', state: 'idle', currentTool: null });
    await POST(createRequest({ session_id: 's-1' }));
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session-update' })
    );
  });

  it('returns status ok', async () => {
    mockGetSession.mockReturnValue({ sessionId: 's-1', state: 'idle' });
    mockUpdateSession.mockReturnValue({ sessionId: 's-1', state: 'idle', currentTool: null });
    const res = await POST(createRequest({ session_id: 's-1' }));
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
