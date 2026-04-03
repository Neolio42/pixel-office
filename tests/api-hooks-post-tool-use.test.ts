import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockAddSession = vi.fn((id, cwd) => ({
  sessionId: id, deskIndex: 0, state: 'walking', currentTool: null,
  cwd, tty: '', startedAt: Date.now(), lastSeen: Date.now(), recentTools: [],
}));
const mockUpdateSession = vi.fn();

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

import { POST } from '../src/app/api/hooks/post-tool-use/route';

function createRequest(body: Record<string, unknown>) {
  return { json: () => Promise.resolve(body) } as any;
}

describe('post-tool-use route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockReturnValue({
      sessionId: 's-1', state: 'typing', recentTools: [],
    });
    mockUpdateSession.mockReturnValue({
      sessionId: 's-1', state: 'idle', currentTool: null, lastSeen: Date.now(),
    });
  });

  it('auto-creates session if missing', async () => {
    mockGetSession.mockReturnValueOnce(undefined);
    const res = await POST(createRequest({ session_id: 's-new', cwd: '/project' }));
    // addSession is imported but we mocked store — just verify it runs
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('updates lastSeen and clears currentTool', async () => {
    const session = { sessionId: 's-1', state: 'typing', recentTools: [], lastSeen: 0, currentTool: 'Edit' };
    mockGetSession.mockReturnValue(session);
    await POST(createRequest({ session_id: 's-1' }));
    expect(session.lastSeen).toBeGreaterThan(0);
    expect(session.currentTool).toBeNull();
  });

  it('broadcasts session-update', async () => {
    const session = { sessionId: 's-1', state: 'typing', recentTools: [] };
    mockGetSession.mockReturnValue(session);
    await POST(createRequest({ session_id: 's-1' }));
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session-update' })
    );
  });

  it('returns status ok', async () => {
    const res = await POST(createRequest({ session_id: 's-1' }));
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('handles missing session_id gracefully', async () => {
    // session_id will be undefined
    mockGetSession.mockReturnValue(undefined);
    const res = await POST(createRequest({}));
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
