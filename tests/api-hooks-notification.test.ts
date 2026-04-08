import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockUpdateSession = vi.fn();

vi.mock('@/lib/store', () => ({
  getSession: (...a: any[]) => mockGetSession(...a),
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

import { POST } from '../src/app/api/hooks/notification/route';

function createRequest(body: Record<string, unknown>) {
  return { json: () => Promise.resolve(body) } as any;
}

describe('notification route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateSession.mockReturnValue({
      sessionId: 's-1', state: 'idle', currentTool: null,
    });
  });

  it('sets session to idle and broadcasts update', async () => {
    const res = await POST(createRequest({
      session_id: 's-1',
      message: 'Claude is asking a question',
    }));
    expect(mockUpdateSession).toHaveBeenCalledWith('s-1', 'idle', null);
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session-update' })
    );
  });

  it('broadcasts notification message', async () => {
    const res = await POST(createRequest({
      session_id: 's-1',
      message: 'Test notification',
    }));
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'notification', message: 'Test notification' })
    );
  });

  it('uses notification field as fallback for message', async () => {
    const res = await POST(createRequest({
      session_id: 's-1',
      notification: 'fallback message',
    }));
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'notification', message: 'fallback message' })
    );
  });

  it('returns status ok', async () => {
    const res = await POST(createRequest({ session_id: 's-1', message: 'hi' }));
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('handles missing message', async () => {
    const res = await POST(createRequest({ session_id: 's-1' }));
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
