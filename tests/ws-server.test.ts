import { describe, it, expect, vi, beforeEach } from 'vitest';
import { broadcast, hasConnectedClients } from '../src/lib/ws-server';

// ws-server depends heavily on actual WebSocket connections.
// We test what we can: broadcast and hasConnectedClients with no WSS.

describe('ws-server (no WSS initialized)', () => {
  beforeEach(() => {
    globalThis.__wss = undefined;
    globalThis.__wsClientMeta = undefined;
  });

  describe('hasConnectedClients', () => {
    it('returns false when WSS is not initialized', () => {
      expect(hasConnectedClients()).toBe(false);
    });
  });

  describe('broadcast', () => {
    it('does not throw when WSS is not initialized', () => {
      expect(() =>
        broadcast({ type: 'sessions', sessions: [] })
      ).not.toThrow();
    });

    it('does not throw for session-update', () => {
      expect(() =>
        broadcast({
          type: 'session-update',
          session: {
            sessionId: 's-1',
            deskIndex: 0,
            state: 'idle',
            currentTool: null,
            cwd: '/tmp',
            tty: '',
            startedAt: Date.now(),
            lastSeen: Date.now(),
            recentTools: [],
          },
        })
      ).not.toThrow();
    });

    it('does not throw for notification', () => {
      expect(() =>
        broadcast({ type: 'notification', sessionId: 's-1', message: 'hello' })
      ).not.toThrow();
    });

    it('does not throw for approval-request', () => {
      expect(() =>
        broadcast({
          type: 'approval-request',
          approval: {
            id: 'a-1',
            sessionId: 's-1',
            toolName: 'Bash',
            toolInput: {},
            createdAt: Date.now(),
            reason: 'risky',
          },
        })
      ).not.toThrow();
    });

    it('does not throw for approval-resolved', () => {
      expect(() =>
        broadcast({ type: 'approval-resolved', approvalId: 'a-1' })
      ).not.toThrow();
    });

    it('does not throw for session-remove', () => {
      expect(() =>
        broadcast({ type: 'session-remove', sessionId: 's-1' })
      ).not.toThrow();
    });
  });
});
