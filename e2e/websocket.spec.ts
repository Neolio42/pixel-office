import { test, expect } from '@playwright/test';

test.describe('WebSocket Connection', () => {
  const wsUrl = 'ws://localhost:3456/ws';

  test('WebSocket connection establishes successfully', async ({ page }) => {
    await page.goto('/');

    // Inject WebSocket connection script
    const wsConnected = await page.evaluate(async (url) => {
      return new Promise<{ connected: boolean; error: string | null }>((resolve) => {
        try {
          const ws = new WebSocket(url);

          ws.onopen = () => {
            ws.close();
            resolve({ connected: true, error: null });
          };

          ws.onerror = (error) => {
            resolve({ connected: false, error: 'WebSocket error' });
          };

          // Timeout after 5 seconds
          setTimeout(() => {
            if (ws.readyState === WebSocket.CONNECTING) {
              ws.close();
              resolve({ connected: false, error: 'Connection timeout' });
            }
          }, 5000);
        } catch (e) {
          resolve({ connected: false, error: String(e) });
        }
      });
    }, wsUrl);

    expect(wsConnected.connected).toBe(true);
    expect(wsConnected.error).toBeNull();
  });

  test('WebSocket sends and receives messages', async ({ page }) => {
    await page.goto('/');

    // Inject WebSocket communication script
    const result = await page.evaluate(async (url) => {
      return new Promise<{ success: boolean; messageReceived: boolean; error: string | null }>((resolve) => {
        try {
          const ws = new WebSocket(url);

          let messageReceived = false;

          ws.onopen = () => {
            // Send a spawn-session message
            ws.send(JSON.stringify({
              type: 'spawn-session',
              cwd: '/tmp',
            }));
          };

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              // Check if we received a message
              if (data.type === 'spawn-result' || data.type === 'sessions') {
                messageReceived = true;
                ws.close();
                resolve({ success: true, messageReceived, error: null });
              }
            } catch (e) {
              // Ignore parse errors for other messages
            }
          };

          ws.onerror = (error) => {
            resolve({ success: false, messageReceived, error: 'WebSocket error' });
          };

          // Timeout after 10 seconds
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
            resolve({ success: false, messageReceived, error: 'Connection timeout' });
          }, 10000);
        } catch (e) {
          resolve({ success: false, messageReceived: false, error: String(e) });
        }
      });
    }, wsUrl);

    expect(result.success).toBe(true);
    expect(result.messageReceived).toBe(true);
    expect(result.error).toBeNull();
  });

  test('WebSocket receives session state on connection', async ({ page }) => {
    await page.goto('/');

    // First create a session via API
    await page.evaluate(async () => {
      await fetch('/api/hooks/session-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: 'ws-test-session',
          cwd: '/tmp/test',
        }),
      });
    });

    // Now connect via WebSocket and check if we receive the session
    const sessionsReceived = await page.evaluate(async (url) => {
      return new Promise<{ sessions: any[] | null; error: string | null }>((resolve) => {
        try {
          const ws = new WebSocket(url);

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'sessions') {
                ws.close();
                resolve({ sessions: data.sessions, error: null });
              }
            } catch (e) {
              // Ignore parse errors
            }
          };

          ws.onerror = (error) => {
            resolve({ sessions: null, error: 'WebSocket error' });
          };

          // Timeout after 5 seconds
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
            resolve({ sessions: null, error: 'Connection timeout' });
          }, 5000);
        } catch (e) {
          resolve({ sessions: null, error: String(e) });
        }
      });
    }, wsUrl);

    expect(sessionsReceived.sessions).not.toBeNull();
    expect(sessionsReceived.error).toBeNull();

    // Check that we received the session we created
    const testSession = sessionsReceived.sessions?.find((s: any) => s.sessionId === 'ws-test-session');
    expect(testSession).toBeDefined();
  });

  test('WebSocket handles terminal-subscribe messages', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async (url) => {
      return new Promise<{ subscribed: boolean; error: string | null }>((resolve) => {
        try {
          const ws = new WebSocket(url);
          let receivedMessage = false;

          ws.onopen = () => {
            // Try to subscribe to a terminal (may not exist, but should not error)
            ws.send(JSON.stringify({
              type: 'terminal-subscribe',
              ptyId: 'test-pty-id',
              cols: 80,
              rows: 24,
            }));
          };

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              // We should get some response (terminal-exited or scrollback)
              if (['terminal-exited', 'terminal-scrollback'].includes(data.type)) {
                receivedMessage = true;
                ws.close();
                resolve({ subscribed: true, error: null });
              }
            } catch (e) {
              // Ignore parse errors
            }
          };

          ws.onerror = (error) => {
            resolve({ subscribed: false, error: 'WebSocket error' });
          };

          // Timeout after 5 seconds
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
            resolve({ subscribed: false, error: 'Timeout waiting for response' });
          }, 5000);
        } catch (e) {
          resolve({ subscribed: false, error: String(e) });
        }
      });
    }, wsUrl);

    expect(result.error).toBeNull();
    // We should receive a message (either scrollback or terminal-exited)
    expect(result.subscribed).toBe(true);
  });

  test('WebSocket connection can be closed cleanly', async ({ page }) => {
    await page.goto('/');

    const closedCleanly = await page.evaluate(async (url) => {
      return new Promise<{ closed: boolean; error: string | null }>((resolve) => {
        try {
          const ws = new WebSocket(url);

          ws.onopen = () => {
            ws.close();
          };

          ws.onclose = (event) => {
            // Accept any clean close (1000 = normal, 1005 = no status received)
            resolve({
              closed: event.code === 1000 || event.code === 1005,
              error: null,
            });
          };

          ws.onerror = (error) => {
            resolve({ closed: false, error: 'WebSocket error' });
          };

          // Timeout after 5 seconds
          setTimeout(() => {
            resolve({ closed: false, error: 'Timeout' });
          }, 5000);
        } catch (e) {
          resolve({ closed: false, error: String(e) });
        }
      });
    }, wsUrl);

    expect(closedCleanly.error).toBeNull();
    expect(closedCleanly.closed).toBe(true);
  });
});
