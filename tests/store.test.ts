import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---- store tests ----
import {
  addSession,
  updateSession,
  removeSession,
  getSession,
  getAllSessions,
  cleanupStaleSessions,
  addToolCall,
  setSessionTask,
  setSessionFocus,
  setSessionPlanMode,
  updateSessionTty,
} from '../src/lib/store';

describe('store', () => {
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

  describe('addSession', () => {
    it('creates a new session', () => {
      const session = addSession('s-1', '/home/user/project');
      expect(session.sessionId).toBe('s-1');
      expect(session.cwd).toBe('/home/user/project');
      expect(session.state).toBe('walking');
      expect(session.currentTool).toBeNull();
      expect(session.deskIndex).toBeGreaterThanOrEqual(0);
      expect(session.startedAt).toBeGreaterThan(0);
      expect(session.lastSeen).toBeGreaterThan(0);
      expect(session.recentTools).toEqual([]);
    });

    it('assigns different desk indices to different sessions', () => {
      const s1 = addSession('s-desk-1', '/project/a');
      const s2 = addSession('s-desk-2', '/project/b');
      expect(s1.deskIndex).not.toBe(s2.deskIndex);

      removeSession('s-desk-1');
      removeSession('s-desk-2');
    });

    it('wraps desk index when all 5 desks are taken', () => {
      const ids = [];
      for (let i = 0; i < 6; i++) {
        ids.push(addSession(`s-full-${i}`, `/p${i}`).sessionId);
      }
      // 6 sessions, 5 desks — one gets index 0 again
      const sessions = getAllSessions().filter(s => s.sessionId.startsWith('s-full-'));
      const indices = sessions.map(s => s.deskIndex);
      // Should have indices 0-4 and then 0 again (wraps)
      expect(new Set(indices).size).toBeLessThanOrEqual(5);

      for (const id of ids) removeSession(id);
    });

    it('strips non-/dev/ tty values', () => {
      const session = addSession('s-tty-bad', '/project', 'not-a-tty');
      expect(session.tty).toBe('');
      removeSession('s-tty-bad');
    });

    it('keeps valid /dev/ tty values', () => {
      const session = addSession('s-tty-good', '/project', '/dev/ttys001');
      expect(session.tty).toBe('/dev/ttys001');
      removeSession('s-tty-good');
    });
  });

  describe('updateSession', () => {
    it('updates state and tool', () => {
      addSession('s-upd', '/project');
      const updated = updateSession('s-upd', 'typing', 'Edit');
      expect(updated).not.toBeNull();
      expect(updated!.state).toBe('typing');
      expect(updated!.currentTool).toBe('Edit');
    });

    it('updates lastSeen timestamp', () => {
      const session = addSession('s-time', '/project');
      const before = session.lastSeen;
      // Small delay to ensure time difference
      const updated = updateSession('s-time', 'reading', 'Read');
      expect(updated!.lastSeen).toBeGreaterThanOrEqual(before);
    });

    it('returns null for non-existent session', () => {
      const result = updateSession('non-existent', 'typing', 'Edit');
      expect(result).toBeNull();
    });
  });

  describe('removeSession', () => {
    it('removes a session', () => {
      addSession('s-rem', '/project');
      expect(getSession('s-rem')).toBeDefined();
      expect(removeSession('s-rem')).toBe(true);
      expect(getSession('s-rem')).toBeUndefined();
    });

    it('returns false for non-existent session', () => {
      expect(removeSession('non-existent')).toBe(false);
    });
  });

  describe('getSession', () => {
    it('returns the session by id', () => {
      addSession('s-get', '/project');
      const session = getSession('s-get');
      expect(session).toBeDefined();
      expect(session!.sessionId).toBe('s-get');
    });

    it('returns undefined for non-existent', () => {
      expect(getSession('nope')).toBeUndefined();
    });
  });

  describe('getAllSessions', () => {
    it('returns all sessions', () => {
      addSession('s-all-1', '/a');
      addSession('s-all-2', '/b');
      const all = getAllSessions();
      expect(all.length).toBeGreaterThanOrEqual(2);
      expect(all.some(s => s.sessionId === 's-all-1')).toBe(true);
      expect(all.some(s => s.sessionId === 's-all-2')).toBe(true);
    });
  });

  describe('cleanupStaleSessions', () => {
    it('removes sessions older than maxAgeMs', () => {
      addSession('s-stale', '/project');
      const session = getSession('s-stale')!;
      // Manually age the session
      session.lastSeen = Date.now() - 120_000; // 2 minutes ago

      const removed = cleanupStaleSessions(60_000); // 1 minute threshold
      expect(removed).toContain('s-stale');
      expect(getSession('s-stale')).toBeUndefined();
    });

    it('keeps fresh sessions', () => {
      addSession('s-fresh', '/project');
      const removed = cleanupStaleSessions(60_000);
      expect(removed).not.toContain('s-fresh');
      expect(getSession('s-fresh')).toBeDefined();
    });
  });

  describe('addToolCall', () => {
    it('adds a tool call to recentTools', () => {
      addSession('s-tool', '/project');
      addToolCall('s-tool', 'Read', { file_path: '/tmp/test.ts' });

      const session = getSession('s-tool')!;
      expect(session.recentTools.length).toBe(1);
      expect(session.recentTools[0].toolName).toBe('Read');
      expect(session.recentTools[0].summary).toContain('test.ts');
    });

    it('limits recentTools to 10 entries', () => {
      addSession('s-tool-limit', '/project');
      for (let i = 0; i < 15; i++) {
        addToolCall('s-tool-limit', 'Read', { file_path: `/tmp/file${i}.ts` });
      }
      const session = getSession('s-tool-limit')!;
      expect(session.recentTools.length).toBe(10);
    });

    it('ignores non-existent sessions', () => {
      expect(() => addToolCall('non-existent', 'Read', {})).not.toThrow();
    });
  });

  describe('setSessionTask', () => {
    it('sets the task on a session', () => {
      addSession('s-task', '/project');
      const result = setSessionTask('s-task', 'Fix the login bug');
      expect(result).not.toBeNull();
      expect(result!.task).toBe('Fix the login bug');
    });

    it('returns null for non-existent', () => {
      expect(setSessionTask('non-existent', 'task')).toBeNull();
    });
  });

  describe('setSessionFocus', () => {
    it('sets the current focus', () => {
      addSession('s-focus', '/project');
      const result = setSessionFocus('s-focus', 'authentication');
      expect(result!.currentFocus).toBe('authentication');
    });
  });

  describe('setSessionPlanMode', () => {
    it('sets plan mode', () => {
      addSession('s-plan', '/project');
      const result = setSessionPlanMode('s-plan', true);
      expect(result!.inPlanMode).toBe(true);
    });
  });

  describe('updateSessionTty', () => {
    it('updates tty for valid /dev/ paths', () => {
      addSession('s-utty', '/project');
      updateSessionTty('s-utty', '/dev/ttys002');
      expect(getSession('s-utty')!.tty).toBe('/dev/ttys002');
    });

    it('ignores non-/dev/ tty values', () => {
      addSession('s-utty2', '/project', '/dev/ttys001');
      updateSessionTty('s-utty2', 'not-a-tty');
      expect(getSession('s-utty2')!.tty).toBe('/dev/ttys001');
    });
  });
});
