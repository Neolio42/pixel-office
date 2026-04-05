import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAddSession = vi.fn((id, cwd, tty, tp) => ({
  sessionId: id, deskIndex: 0, state: 'walking', currentTool: null,
  cwd, tty: tty || '', startedAt: Date.now(), lastSeen: Date.now(),
  recentTools: [], transcriptPath: tp,
}));
const mockGetAllSessions = vi.fn(() => []);
const mockRemoveSession = vi.fn();
const mockSetSessionTask = vi.fn();

vi.mock('@/lib/store', () => ({
  addSession: (...a: any[]) => mockAddSession(...a),
  getAllSessions: (...a: any[]) => mockGetAllSessions(...a),
  removeSession: (...a: any[]) => mockRemoveSession(...a),
  setSessionTask: (...a: any[]) => mockSetSessionTask(...a),
}));

const mockBroadcast = vi.fn();
vi.mock('@/lib/ws-server', () => ({
  broadcast: (...a: any[]) => mockBroadcast(...a),
}));

vi.mock('@/lib/transcript', () => ({
  readTaskFromTranscript: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/pty-manager', () => ({
  findPtyByTty: vi.fn(() => undefined),
  findPtyByCwd: vi.fn(() => undefined),
  linkSessionToPty: vi.fn(() => true),
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

import { POST } from '../src/app/api/hooks/session-start/route';
import { findPtyByTty, findPtyByCwd, linkSessionToPty } from '@/lib/pty-manager';

function createRequest(body: Record<string, unknown>) {
  return { json: () => Promise.resolve(body) } as any;
}

describe('session-start route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllSessions.mockReturnValue([]);
  });

  it('creates a session with provided fields', async () => {
    const res = await POST(createRequest({
      session_id: 's-start-1',
      cwd: '/home/user/project',
      tty: '/dev/ttys001',
      transcript_path: '/tmp/transcript.jsonl',
    }));
    expect(mockAddSession).toHaveBeenCalledWith('s-start-1', '/home/user/project', '/dev/ttys001', '/tmp/transcript.jsonl');
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('broadcasts sessions snapshot', async () => {
    mockGetAllSessions.mockReturnValue([]);
    await POST(createRequest({
      session_id: 's-start-2',
      cwd: '/project',
    }));
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sessions' })
    );
  });

  it('attempts PTY linking via tty first', async () => {
    await POST(createRequest({
      session_id: 's-start-3',
      cwd: '/project',
      tty: '/dev/ttys005',
    }));
    expect(findPtyByTty).toHaveBeenCalledWith('/dev/ttys005');
  });

  it('falls back to cwd matching when tty match fails', async () => {
    (findPtyByTty as any).mockReturnValue(undefined);
    (findPtyByCwd as any).mockReturnValue(undefined);
    await POST(createRequest({
      session_id: 's-start-4',
      cwd: '/project',
      tty: '',
    }));
    // No tty, so findPtyByTty not called with empty string, findPtyByCwd called
    expect(findPtyByCwd).toHaveBeenCalledWith('/project');
  });

  it('links session to PTY when found', async () => {
    const mockPty = { ptyId: 'pty-1' };
    (findPtyByTty as any).mockReturnValue(mockPty);
    mockGetAllSessions.mockReturnValue([]);
    await POST(createRequest({
      session_id: 's-start-5',
      cwd: '/project',
      tty: '/dev/ttys005',
    }));
    expect(linkSessionToPty).toHaveBeenCalledWith('s-start-5', 'pty-1');
  });

  it('removes orphan sessions from previous /clear cycles', async () => {
    const mockPty = { ptyId: 'pty-1' };
    (findPtyByTty as any).mockReturnValue(mockPty);
    // The route calls getAllSessions() after addSession, and it finds sessions
    // with the same ptyId but different sessionId. The newly added session also
    // has ptyId set on it. We need to return the new session + old orphans.
    const newSession = { sessionId: 's-start-6', ptyId: 'pty-1' };
    mockAddSession.mockReturnValue(newSession);
    mockGetAllSessions.mockReturnValue([
      newSession, // the newly added session (same id, same pty — not an orphan)
      { sessionId: 'old-session', ptyId: 'pty-1' }, // same PTY, different id — orphan
      { sessionId: 'other-session', ptyId: 'pty-2' }, // different PTY — keep
    ]);
    await POST(createRequest({
      session_id: 's-start-6',
      cwd: '/project',
      tty: '/dev/ttys005',
    }));
    expect(mockRemoveSession).toHaveBeenCalledWith('old-session');
    expect(mockRemoveSession).not.toHaveBeenCalledWith('other-session');
  });

  it('handles missing optional fields', async () => {
    const res = await POST(createRequest({ session_id: 's-minimal' }));
    expect(mockAddSession).toHaveBeenCalledWith('s-minimal', '', '', undefined);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
