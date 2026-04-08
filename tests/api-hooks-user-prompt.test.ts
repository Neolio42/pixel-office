import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
const mockAddSession = vi.fn((id, cwd) => ({
  sessionId: id, deskIndex: 0, state: 'walking', currentTool: null,
  cwd, tty: '', startedAt: Date.now(), lastSeen: Date.now(), recentTools: [],
}));
const mockSetSessionFocus = vi.fn((id, focus) => ({
  sessionId: id, currentFocus: focus,
}));
const mockSetSessionTask = vi.fn((id, task) => ({
  sessionId: id, task,
}));

vi.mock('@/lib/store', () => ({
  getSession: (...a: any[]) => mockGetSession(...a),
  addSession: (...a: any[]) => mockAddSession(...a),
  setSessionFocus: (...a: any[]) => mockSetSessionFocus(...a),
  setSessionTask: (...a: any[]) => mockSetSessionTask(...a),
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

import { POST, extractPromptFocus } from '../src/app/api/hooks/user-prompt/route';

function createRequest(body: Record<string, unknown>) {
  return { json: () => Promise.resolve(body) } as any;
}

describe('user-prompt route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok for short prompts (< 5 chars)', async () => {
    const res = await POST(createRequest({
      session_id: 's-1',
      prompt: 'ok',
    }));
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(mockSetSessionFocus).not.toHaveBeenCalled();
  });

  it('returns ok for XML-ish prompts (starts with <)', async () => {
    const res = await POST(createRequest({
      session_id: 's-1',
      prompt: '<error>Something happened</error>',
    }));
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('returns ok for continuation keywords', async () => {
    for (const kw of ['continue', 'yes', 'no', 'ok', 'sure', 'go', 'y', 'n', 'done', 'looks good', 'lgtm']) {
      vi.clearAllMocks();
      const res = await POST(createRequest({
        session_id: 's-1',
        prompt: kw,
      }));
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(mockAddSession).not.toHaveBeenCalled();
    }
  });

  it('auto-creates session if missing', async () => {
    mockGetSession.mockReturnValue(undefined).mockReturnValueOnce(undefined).mockReturnValue({
      sessionId: 's-new', state: 'walking', recentTools: [], cwd: '/project',
    });
    const session = { sessionId: 's-new', state: 'walking', recentTools: [], cwd: '/project' };
    mockGetSession
      .mockReturnValueOnce(undefined) // first call (check)
      .mockReturnValue(session); // second call (after add)
    mockAddSession.mockReturnValue(session);

    const res = await POST(createRequest({
      session_id: 's-new',
      prompt: 'Fix the login bug in auth.ts',
      cwd: '/project',
    }));
    expect(mockAddSession).toHaveBeenCalledWith('s-new', '/project');
  });

  it('sets heuristic focus from prompt', async () => {
    const session = { sessionId: 's-1', state: 'walking', recentTools: [], cwd: '/project', needsFocusUpdate: false };
    mockGetSession.mockReturnValue(session);

    const res = await POST(createRequest({
      session_id: 's-1',
      prompt: 'Add a new login page component',
      cwd: '/project',
    }));
    expect(mockSetSessionFocus).toHaveBeenCalled();
  });

  it('sets needsFocusUpdate on session', async () => {
    const session = { sessionId: 's-1', state: 'walking', recentTools: [], cwd: '/project', needsFocusUpdate: false };
    mockGetSession.mockReturnValue(session);

    await POST(createRequest({
      session_id: 's-1',
      prompt: 'Update the CSS styles for the header',
      cwd: '/project',
    }));
    expect(session.needsFocusUpdate).toBe(true);
  });

  it('sets task from prompt when no task exists', async () => {
    const session = { sessionId: 's-1', state: 'walking', recentTools: [], cwd: '/project', task: undefined };
    mockGetSession.mockReturnValue(session);

    await POST(createRequest({
      session_id: 's-1',
      prompt: 'Refactor the database connection pool',
      cwd: '/project',
    }));
    expect(mockSetSessionTask).toHaveBeenCalled();
  });

  it('broadcasts session update', async () => {
    const session = { sessionId: 's-1', state: 'walking', recentTools: [], cwd: '/project' };
    mockGetSession.mockReturnValue(session);

    await POST(createRequest({
      session_id: 's-1',
      prompt: 'Write unit tests for the API handlers',
      cwd: '/project',
    }));
    expect(mockBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session-update' })
    );
  });

  it('returns ok with missing session_id', async () => {
    const res = await POST(createRequest({ prompt: 'test' }));
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});

describe('extractPromptFocus', () => {
  it('extracts focus from actionable prompt', () => {
    const result = extractPromptFocus('Add a new login page component');
    expect(result).toBeTruthy();
  });

  it('returns null for empty prompt', () => {
    expect(extractPromptFocus('')).toBeNull();
  });

  it('returns null for short prompt', () => {
    expect(extractPromptFocus('ok')).toBeNull();
  });

  it('extracts from "fix the bug" style', () => {
    const result = extractPromptFocus('Fix the authentication module');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('fix');
  });

  it('extracts from "we need to" style', () => {
    const result = extractPromptFocus('We need to update the database schema');
    expect(result).toBeTruthy();
  });

  it('strips filler words', () => {
    const result = extractPromptFocus("Can you please fix the CSS layout issue");
    expect(result).toBeTruthy();
  });

  it('returns null for question-only prompts', () => {
    const result = extractPromptFocus('How does this work? What is the status?');
    expect(result).toBeNull();
  });

  it('returns null for code block prompts', () => {
    const result = extractPromptFocus('```javascript\nconst x = 1;\n```');
    expect(result).toBeNull();
  });

  it('handles multi-sentence prompts', () => {
    const result = extractPromptFocus("I noticed the build is failing. Can you update the CI configuration?");
    expect(result).toBeTruthy();
  });
});
