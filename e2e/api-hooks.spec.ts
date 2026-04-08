import { test, expect } from '@playwright/test';

test.describe('API Hook Routes', () => {
  const baseUrl = 'http://localhost:3456';

  test('POST /api/hooks/session-start creates a session', async ({ request }) => {
    const response = await request.post(`${baseUrl}/api/hooks/session-start`, {
      data: {
        session_id: 'test-session-1',
        cwd: '/tmp/test',
        tty: '/dev/ttys001',
        transcript_path: '/tmp/test/transcript.jsonl',
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('POST /api/hooks/session-end removes a session', async ({ request }) => {
    // First create a session
    await request.post(`${baseUrl}/api/hooks/session-start`, {
      data: {
        session_id: 'test-session-end',
        cwd: '/tmp/test',
      },
    });

    // Then end it
    const response = await request.post(`${baseUrl}/api/hooks/session-end`, {
      data: {
        session_id: 'test-session-end',
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('POST /api/hooks/pre-tool-use handles tool calls', async ({ request }) => {
    // First create a session
    await request.post(`${baseUrl}/api/hooks/session-start`, {
      data: {
        session_id: 'test-pre-tool',
        cwd: '/tmp/test',
      },
    });

    // Send a pre-tool-use hook for a non-restricted tool
    // Note: When no browser is connected, the endpoint returns an empty object
    // to allow Claude Code to handle approval in the terminal
    const response = await request.post(`${baseUrl}/api/hooks/pre-tool-use`, {
      data: {
        session_id: 'test-pre-tool',
        tool_name: 'read_file',
        tool_input: { path: '/tmp/test.txt' },
        cwd: '/tmp/test',
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    // When no browser client is connected, returns empty object for terminal approval
    // When browser is connected, would return hookSpecificOutput with permissionDecision
    expect(body).toBeDefined();
  });

  test('POST /api/hooks/post-tool-use updates session state', async ({ request }) => {
    // First create a session
    await request.post(`${baseUrl}/api/hooks/session-start`, {
      data: {
        session_id: 'test-post-tool',
        cwd: '/tmp/test',
      },
    });

    // Send a post-tool-use hook
    const response = await request.post(`${baseUrl}/api/hooks/post-tool-use`, {
      data: {
        session_id: 'test-post-tool',
        cwd: '/tmp/test',
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('POST /api/hooks/user-prompt handles user prompts', async ({ request }) => {
    // First create a session
    await request.post(`${baseUrl}/api/hooks/session-start`, {
      data: {
        session_id: 'test-user-prompt',
        cwd: '/tmp/test',
      },
    });

    // Send a user prompt
    const response = await request.post(`${baseUrl}/api/hooks/user-prompt`, {
      data: {
        session_id: 'test-user-prompt',
        prompt: 'Fix the bug in the login component',
        cwd: '/tmp/test',
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('POST /api/hooks/stop sets session to idle', async ({ request }) => {
    // First create a session
    await request.post(`${baseUrl}/api/hooks/session-start`, {
      data: {
        session_id: 'test-stop',
        cwd: '/tmp/test',
      },
    });

    // Send stop hook
    const response = await request.post(`${baseUrl}/api/hooks/stop`, {
      data: {
        session_id: 'test-stop',
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('POST /api/hooks/notification broadcasts notifications', async ({ request }) => {
    // First create a session
    await request.post(`${baseUrl}/api/hooks/session-start`, {
      data: {
        session_id: 'test-notification',
        cwd: '/tmp/test',
      },
    });

    // Send a notification
    const response = await request.post(`${baseUrl}/api/hooks/notification`, {
      data: {
        session_id: 'test-notification',
        message: 'This is a test notification',
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('POST /api/focus-terminal requires session existence', async ({ request }) => {
    // Try to focus a non-existent session
    const response = await request.post(`${baseUrl}/api/focus-terminal`, {
      data: {
        sessionId: 'non-existent-session',
      },
    });

    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('POST /api/focus-terminal works with existing session', async ({ request }) => {
    // First create a session with a tty
    await request.post(`${baseUrl}/api/hooks/session-start`, {
      data: {
        session_id: 'test-focus-terminal',
        cwd: '/tmp/test',
        tty: '/dev/ttys002',
      },
    });

    // Try to focus the session (may fail on non-macOS, but should return ok:true)
    const response = await request.post(`${baseUrl}/api/focus-terminal`, {
      data: {
        sessionId: 'test-focus-terminal',
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('cwd');
  });

  test('hooks auto-create sessions if they do not exist', async ({ request }) => {
    // Send a pre-tool-use hook for a session that doesn't exist
    const response = await request.post(`${baseUrl}/api/hooks/pre-tool-use`, {
      data: {
        session_id: 'auto-created-session',
        tool_name: 'read_file',
        tool_input: { path: '/tmp/test.txt' },
        cwd: '/tmp/test',
      },
    });

    expect(response.status()).toBe(200);

    // Verify the session was created by checking another hook
    const postResponse = await request.post(`${baseUrl}/api/hooks/post-tool-use`, {
      data: {
        session_id: 'auto-created-session',
        cwd: '/tmp/test',
      },
    });

    expect(postResponse.status()).toBe(200);
  });
});
