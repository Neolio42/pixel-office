import { createServer } from 'http';
import next from 'next';
import { initWSS, broadcast } from './src/lib/ws-server';
import { cleanupStaleSessions } from './src/lib/store';

// Use globalThis to avoid duplicate intervals across module re-evaluations.
declare global {
  // eslint-disable-next-line no-var
  var __staleSessionCleanup: ReturnType<typeof setInterval> | undefined;
}

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  initWSS(server);

  // Stale session cleanup is a safety net only — normal cleanup happens via
  // SessionEnd hooks when terminals close. This catches crashed/force-killed
  // sessions that never sent SessionEnd. 30 min timeout, checks every 5 min.
  if (!globalThis.__staleSessionCleanup) {
    globalThis.__staleSessionCleanup = setInterval(() => {
      const removed = cleanupStaleSessions(30 * 60_000);
      for (const sessionId of removed) {
        console.log(`[cleanup] Removed stale session (no activity for 30min): ${sessionId}`);
        broadcast({ type: 'session-remove', sessionId });
      }
    }, 5 * 60_000);
  }

  server.listen(port, () => {
    console.log(`> Pixel Office ready on http://localhost:${port}`);
  });
});
