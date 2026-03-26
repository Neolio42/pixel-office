import { createServer } from 'http';
import { execSync } from 'child_process';
import next from 'next';
import { initWSS, broadcast } from './src/lib/ws-server';
import { cleanupStaleSessions, getAllSessions } from './src/lib/store';
import { getAllPtyEntries, killPty } from './src/lib/pty-manager';

// Use globalThis to avoid duplicate intervals across module re-evaluations.
declare global {
  // eslint-disable-next-line no-var
  var __staleSessionCleanup: ReturnType<typeof setInterval> | undefined;
}

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

// Check shfmt availability — needed for AST-based bash command classification
try {
  execSync('shfmt --version', { stdio: 'pipe' });
} catch {
  console.warn('⚠  shfmt not found — compound bash commands will default to "needs approval"');
  console.warn('   Install: brew install shfmt (macOS) or go install mvdan.cc/sh/v3/cmd/shfmt@latest');
}

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
      const isAlivePty = (ptyId: string) => { const e = getAllPtyEntries().find(p => p.ptyId === ptyId); return !!e && !e.exited; };
      const removed = cleanupStaleSessions(30 * 60_000, isAlivePty);
      for (const sessionId of removed) {
        console.log(`[cleanup] Removed stale session: ${sessionId}`);
        broadcast({ type: 'session-remove', sessionId });
      }

      // Clean up orphaned PTYs — exited PTYs with no active session
      // Don't kill live unlinked PTYs — they may be waiting for re-link after /clear
      const activePtyIds = new Set(getAllSessions().filter(s => s.ptyId).map(s => s.ptyId!));
      for (const entry of getAllPtyEntries()) {
        if (!activePtyIds.has(entry.ptyId) && entry.exited) {
          killPty(entry.ptyId);
          console.log(`[cleanup] Removed orphaned PTY: ${entry.ptyId}`);
        }
      }
    }, 5 * 60_000);
  }

  server.listen(port, () => {
    console.log(`> Pixel Office ready on http://localhost:${port}`);
  });
});
