import { cleanupStaleSessions, getAllSessions } from './store';
import { getAllPtyEntries, killPty } from './pty-manager';
import { broadcast } from './ws-server';

declare global {
  // eslint-disable-next-line no-var
  var __staleSessionCleanup: ReturnType<typeof setInterval> | undefined;
}

export function startStaleSessionCleanup(): void {
  if (!globalThis.__staleSessionCleanup) {
    globalThis.__staleSessionCleanup = setInterval(() => {
      const isAlivePty = (ptyId: string) => { const e = getAllPtyEntries().find(p => p.ptyId === ptyId); return !!e && !e.exited; };
      const removed = cleanupStaleSessions(30 * 60_000, isAlivePty);
      for (const sessionId of removed) {
        console.log(`[cleanup] Removed stale session: ${sessionId}`);
        broadcast({ type: 'session-remove', sessionId });
      }

      const activePtyIds = new Set(getAllSessions().filter(s => s.ptyId).map(s => s.ptyId!));
      for (const entry of getAllPtyEntries()) {
        if (!activePtyIds.has(entry.ptyId) && entry.exited) {
          killPty(entry.ptyId);
          console.log(`[cleanup] Removed orphaned PTY: ${entry.ptyId}`);
        }
      }
    }, 5 * 60_000);
  }
}
