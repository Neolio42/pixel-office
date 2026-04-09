import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { POST } from '../src/app/api/hooks/user-prompt/route';
import { extractPromptFocus } from '../src/app/api/hooks/user-prompt/route';
import {
  getSession,
  addSession,
  setSessionFocus,
  setSessionTask,
  getAllSessions,
  removeSession,
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

// Mock ws-server
vi.mock('@/lib/ws-server', () => ({
  broadcast: vi.fn(),
}));

function createRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
  } as any;
}

describe('POST /api/hooks/user-prompt', () => {
  beforeEach(() => {
    // Clean up any leftover sessions
    const sessions = getAllSessions();
    for (const s of sessions) {
      removeSession(s.sessionId);
    }
  });

  afterEach(() => {
    const sessions = getAllSessions();
    for (const s of sessions) {
      removeSession(s.sessionId);
    }
  });

  it('returns ok when session_id is missing', async () => {
    const req = createRequest({
      session_id: '',
      prompt: 'Fix the bug',
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('returns ok when prompt is missing', async () => {
    const req = createRequest({
      session_id: 'session-123',
      prompt: '',
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('returns ok when prompt is too short', async () => {
    const req = createRequest({
      session_id: 'session-123',
      prompt: 'fix',
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('returns ok when prompt starts with <', async () => {
    const req = createRequest({
      session_id: 'session-123',
      prompt: '<test>fix the bug</test>',
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('returns ok for confirmation prompts like "continue"', async () => {
    const req = createRequest({
      session_id: 'session-123',
      prompt: 'continue',
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('returns ok for confirmation prompts like "yes"', async () => {
    const req = createRequest({
      session_id: 'session-123',
      prompt: 'yes',
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('returns ok for confirmation prompts like "done"', async () => {
    const req = createRequest({
      session_id: 'session-123',
      prompt: 'done',
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('auto-creates session when it does not exist', async () => {
    const req = createRequest({
      session_id: 'session-new',
      prompt: 'Fix the login bug',
      cwd: '/home/user/project',
    });

    expect(getSession('session-new')).toBeUndefined();

    const response = await POST(req);
    expect(response.status).toBe(200);

    const session = getSession('session-new');
    expect(session).toBeDefined();
    expect(session!.sessionId).toBe('session-new');
    expect(session!.cwd).toBe('/home/user/project');
  });

  it('updates session focus when focus is extracted', async () => {
    addSession('session-1', '/project');

    const req = createRequest({
      session_id: 'session-1',
      prompt: 'Fix the login bug in auth.ts',
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    const session = getSession('session-1');
    expect(session!.currentFocus).toBeTruthy();
    expect(session!.currentFocus).toContain('Fix');
    expect(session!.needsFocusUpdate).toBe(true);
  });

  it('clears focus when no focus is extracted', async () => {
    addSession('session-1', '/project');

    const req = createRequest({
      session_id: 'session-1',
      prompt: 'hi',  // Too short - filtered out by sentence length check
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    const session = getSession('session-1');
    expect(session!.currentFocus).toBeUndefined();
  });

  it('sets session task if task is not already set', async () => {
    addSession('session-1', '/project');

    const req = createRequest({
      session_id: 'session-1',
      prompt: 'Create a new API endpoint for user authentication',
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    const session = getSession('session-1');
    expect(session!.task).toBeTruthy();
    expect(session!.task).toContain('Create');
    expect(session!.task!.length).toBeLessThanOrEqual(120);
  });

  it('does not overwrite existing task', async () => {
    addSession('session-1', '/project');
    setSessionTask('session-1', 'Original task');

    const req = createRequest({
      session_id: 'session-1',
      prompt: 'New prompt that should not overwrite',
    });

    const response = await POST(req);
    expect(response.status).toBe(200);

    const session = getSession('session-1');
    expect(session!.task).toBe('Original task');
  });

  it('uses cwd when auto-creating session', async () => {
    const req = createRequest({
      session_id: 'session-cwd',
      prompt: 'Fix the bug',
      cwd: '/custom/path',
    });

    await POST(req);

    const session = getSession('session-cwd');
    expect(session).toBeDefined();
    expect(session!.cwd).toBe('/custom/path');
  });

  it('handles missing cwd gracefully', async () => {
    const req = createRequest({
      session_id: 'session-no-cwd',
      prompt: 'Fix the bug',
    });

    await POST(req);

    const session = getSession('session-no-cwd');
    expect(session!.cwd).toBe('');
  });

  it('returns ok for all valid requests', async () => {
    const req = createRequest({
      session_id: 'session-valid',
      prompt: 'Add error handling to the API',
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });
});

describe('extractPromptFocus (re-exported from route)', () => {
  it('is exported from the route module', () => {
    expect(typeof extractPromptFocus).toBe('function');
  });

  it('extracts focus from a simple action prompt', () => {
    const result = extractPromptFocus('Fix the login bug in auth.ts');
    expect(result).toBeTruthy();
    expect(result).toContain('Fix');
  });

  it('extracts focus from a prompt with multiple sentences', () => {
    const result = extractPromptFocus('The app is slow. Let\'s optimize the database queries.');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('optimiz');
  });

  it('returns null for questions', () => {
    expect(extractPromptFocus('What is the status of the project?')).toBeNull();
  });

  it('strips "let\'s" prefix', () => {
    const result = extractPromptFocus("Let's refactor the database layer");
    expect(result).toBeTruthy();
    expect(result).toContain('Refactor');
  });

  it('strips "can you" prefix', () => {
    const result = extractPromptFocus('Can you please fix the tests');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('fix');
  });

  it('returns null for very short prompts', () => {
    expect(extractPromptFocus('hi')).toBeNull();
    expect(extractPromptFocus('ok')).toBeNull();
  });

  it('capitalizes first letter', () => {
    const result = extractPromptFocus('fix the bug');
    if (result) {
      expect(result[0]).toBe(result[0].toUpperCase());
    }
  });
});
