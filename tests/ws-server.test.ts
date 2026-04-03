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
  });
});
