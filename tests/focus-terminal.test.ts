import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process (execSync used for osascript)
vi.mock('child_process', () => ({
  execSync: vi.fn(() => 'found'),
}));

// Mock store
vi.mock('@/lib/store', () => ({
  getSession: vi.fn(),
}));

import { POST } from '../src/app/api/focus-terminal/route';
import { getSession } from '@/lib/store';
import { execSync } from 'child_process';

// Minimal NextRequest mock
function createRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
  } as any;
}

// Minimal NextResponse mock
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

describe('focus-terminal API route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when sessionId is missing', async () => {
    const res = await POST(createRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing sessionId');
  });

  it('returns 404 when session not found', async () => {
    (getSession as any).mockReturnValue(undefined);
    const res = await POST(createRequest({ sessionId: 'nonexistent' }));
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Session not found');
  });

  it('returns ok: true with matched: true when tty matches', async () => {
    const session = {
      sessionId: 's-1',
      tty: '/dev/ttys001',
      cwd: '/home/user/project',
    };
    (getSession as any).mockReturnValue(session);
    (execSync as any).mockReturnValue('found');

    const res = await POST(createRequest({ sessionId: 's-1' }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.matched).toBe(true);
    expect(data.cwd).toBe('/home/user/project');
  });

  it('returns matched: false when tty is not found', async () => {
    const session = {
      sessionId: 's-2',
      tty: '/dev/ttys002',
      cwd: '/project',
    };
    (getSession as any).mockReturnValue(session);
    (execSync as any).mockReturnValue('not_found');

    const res = await POST(createRequest({ sessionId: 's-2' }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.matched).toBe(false);
  });

  it('returns ok: true when no tty (fallback)', async () => {
    const session = {
      sessionId: 's-3',
      tty: '',
      cwd: '/project',
    };
    (getSession as any).mockReturnValue(session);

    const res = await POST(createRequest({ sessionId: 's-3' }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.matched).toBe(false);
  });

  it('handles osascript errors gracefully', async () => {
    const session = {
      sessionId: 's-4',
      tty: '/dev/ttys004',
      cwd: '/project',
    };
    (getSession as any).mockReturnValue(session);
    (execSync as any).mockImplementation(() => { throw new Error('iTerm not running'); });

    const res = await POST(createRequest({ sessionId: 's-4' }));
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.matched).toBe(false);
  });

  it('handles complete osascript failure', async () => {
    const session = {
      sessionId: 's-5',
      tty: '/dev/ttys005',
      cwd: '/project',
    };
    (getSession as any).mockReturnValue(session);
    // First call (script) throws, second call (activate) also throws
    (execSync as any).mockImplementation(() => { throw new Error('fail'); });

    const res = await POST(createRequest({ sessionId: 's-5' }));
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});
