import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setPtyOutputHandler,
  setPtyExitHandler,
  spawnSession,
  writeToPty,
  resizePty,
  killPty,
  unlinkSessionFromPty,
  linkSessionToPty,
  findPtyByTty,
  findPtyByCwd,
  getPtyEntry,
  getScrollback,
  getAllPtyEntries,
  cleanupOrphanedPtys,
} from '../src/lib/pty-manager';

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    onData: vi.fn((cb) => {
      (globalThis as any).__mockPtyDataCb = cb;
    }),
    onExit: vi.fn((cb) => {
      (globalThis as any).__mockPtyExitCb = cb;
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _pty: '/dev/ttys099',
  })),
}));

describe('pty-manager', () => {
  beforeEach(() => {
    // Reset global state
    globalThis.__ptyRegistry = undefined;
    globalThis.__ptyCounter = undefined;
    globalThis.__ptyOutputHandler = undefined;
    globalThis.__ptyExitHandler = undefined;
    globalThis.__claudePath = undefined;
  });

  afterEach(() => {
    // Clean up any spawned PTYs
    globalThis.__ptyRegistry = undefined;
    globalThis.__ptyCounter = undefined;
  });

  describe('setPtyOutputHandler', () => {
    it('sets the global output handler', () => {
      const handler = vi.fn();
      setPtyOutputHandler(handler);
      expect(globalThis.__ptyOutputHandler).toBe(handler);
    });
  });

  describe('setPtyExitHandler', () => {
    it('sets the global exit handler', () => {
      const handler = vi.fn();
      setPtyExitHandler(handler);
      expect(globalThis.__ptyExitHandler).toBe(handler);
    });
  });

  describe('spawnSession', () => {
    it('spawns a session and returns PtyEntry', () => {
      const entry = spawnSession('/home/user/project');
      expect(entry.ptyId).toMatch(/^pty-\d+-\d+$/);
      expect(entry.cwd).toBe('/home/user/project');
      expect(entry.cols).toBe(120);
      expect(entry.rows).toBe(30);
      expect(entry.exited).toBe(false);
      expect(entry.scrollback).toEqual([]);
      expect(entry.scrollbackBytes).toBe(0);
    });

    it('spawns with custom cols and rows', () => {
      const entry = spawnSession('/tmp', 80, 24);
      expect(entry.cols).toBe(80);
      expect(entry.rows).toBe(24);
    });

    it('registers the PTY in the global registry', () => {
      const entry = spawnSession('/test');
      const retrieved = getPtyEntry(entry.ptyId);
      expect(retrieved).toBe(entry);
    });

    it('increments counter for each spawn', () => {
      const e1 = spawnSession('/a');
      const e2 = spawnSession('/b');
      const c1 = parseInt(e1.ptyId.split('-')[1], 10);
      const c2 = parseInt(e2.ptyId.split('-')[1], 10);
      expect(c2).toBeGreaterThan(c1);
    });
  });

  describe('writeToPty', () => {
    it('returns false for non-existent PTY', () => {
      expect(writeToPty('non-existent', 'data')).toBe(false);
    });

    it('writes data to a live PTY', () => {
      const entry = spawnSession('/test');
      expect(writeToPty(entry.ptyId, 'ls\n')).toBe(true);
      expect(entry.pty.write).toHaveBeenCalledWith('ls\n');
    });

    it('returns false for exited PTY', () => {
      const entry = spawnSession('/test');
      entry.exited = true;
      expect(writeToPty(entry.ptyId, 'data')).toBe(false);
    });
  });

  describe('resizePty', () => {
    it('returns false for non-existent PTY', () => {
      expect(resizePty('non-existent', 80, 24)).toBe(false);
    });

    it('resizes a live PTY', () => {
      const entry = spawnSession('/test');
      expect(resizePty(entry.ptyId, 80, 24)).toBe(true);
      expect(entry.pty.resize).toHaveBeenCalledWith(80, 24);
      expect(entry.cols).toBe(80);
      expect(entry.rows).toBe(24);
    });

    it('returns false for exited PTY', () => {
      const entry = spawnSession('/test');
      entry.exited = true;
      expect(resizePty(entry.ptyId, 80, 24)).toBe(false);
    });
  });

  describe('killPty', () => {
    it('returns false for non-existent PTY', () => {
      expect(killPty('non-existent')).toBe(false);
    });

    it('kills a live PTY and removes from registry', () => {
      const entry = spawnSession('/test');
      expect(killPty(entry.ptyId)).toBe(true);
      expect(getPtyEntry(entry.ptyId)).toBeUndefined();
    });

    it('kills an already-exited PTY (no kill call, just removes)', () => {
      const entry = spawnSession('/test');
      entry.exited = true;
      expect(killPty(entry.ptyId)).toBe(true);
      expect(entry.pty.kill).not.toHaveBeenCalled();
      expect(getPtyEntry(entry.ptyId)).toBeUndefined();
    });
  });

  describe('linkSessionToPty / unlinkSessionFromPty', () => {
    it('links a session to a PTY', () => {
      const entry = spawnSession('/test');
      expect(linkSessionToPty('session-1', entry.ptyId)).toBe(true);
      expect(entry.sessionId).toBe('session-1');
    });

    it('returns false for non-existent PTY', () => {
      expect(linkSessionToPty('session-1', 'non-existent')).toBe(false);
    });

    it('unlinks a session from a PTY', () => {
      const entry = spawnSession('/test');
      entry.sessionId = 'session-1';
      expect(unlinkSessionFromPty(entry.ptyId)).toBe(true);
      expect(entry.sessionId).toBeUndefined();
    });

    it('returns false for non-existent PTY on unlink', () => {
      expect(unlinkSessionFromPty('non-existent')).toBe(false);
    });
  });

  describe('findPtyByTty', () => {
    it('returns undefined for empty tty', () => {
      expect(findPtyByTty('')).toBeUndefined();
    });

    it('finds PTY by tty path', () => {
      const entry = spawnSession('/test');
      // The mock sets _pty to '/dev/ttys099'
      const found = findPtyByTty('/dev/ttys099');
      expect(found).toBe(entry);
    });

    it('returns undefined if PTY has a linked session', () => {
      const entry = spawnSession('/test');
      entry.sessionId = 'session-1';
      expect(findPtyByTty(entry.ttyPath)).toBeUndefined();
    });

    it('returns undefined if PTY has exited', () => {
      const entry = spawnSession('/test');
      entry.exited = true;
      expect(findPtyByTty(entry.ttyPath)).toBeUndefined();
    });
  });

  describe('findPtyByCwd', () => {
    it('returns undefined for empty cwd', () => {
      expect(findPtyByCwd('')).toBeUndefined();
    });

    it('finds PTY by cwd within 30 seconds', () => {
      const entry = spawnSession('/test/project');
      const found = findPtyByCwd('/test/project');
      expect(found).toBe(entry);
    });

    it('returns undefined if PTY has a linked session', () => {
      const entry = spawnSession('/test');
      entry.sessionId = 'session-1';
      expect(findPtyByCwd('/test')).toBeUndefined();
    });

    it('returns undefined if PTY has exited', () => {
      const entry = spawnSession('/test');
      entry.exited = true;
      expect(findPtyByCwd('/test')).toBeUndefined();
    });

    it('returns undefined if PTY was spawned more than 30s ago', () => {
      const entry = spawnSession('/old');
      entry.spawnedAt = Date.now() - 60000; // 60s ago
      expect(findPtyByCwd('/old')).toBeUndefined();
    });
  });

  describe('getScrollback', () => {
    it('returns empty string for non-existent PTY', () => {
      expect(getScrollback('non-existent')).toBe('');
    });

    it('returns concatenated scrollback', () => {
      const entry = spawnSession('/test');
      entry.scrollback = ['hello ', 'world'];
      entry.scrollbackBytes = 11;
      expect(getScrollback(entry.ptyId)).toBe('hello world');
    });
  });

  describe('getAllPtyEntries', () => {
    it('returns all entries', () => {
      const e1 = spawnSession('/a');
      const e2 = spawnSession('/b');
      const all = getAllPtyEntries();
      expect(all.length).toBeGreaterThanOrEqual(2);
      expect(all.some(e => e.ptyId === e1.ptyId)).toBe(true);
      expect(all.some(e => e.ptyId === e2.ptyId)).toBe(true);
    });
  });

  describe('cleanupOrphanedPtys', () => {
    it('removes exited PTYs not in active set', () => {
      const entry = spawnSession('/test');
      entry.exited = true;
      const removed = cleanupOrphanedPtys(new Set());
      expect(removed).toContain(entry.ptyId);
      expect(getPtyEntry(entry.ptyId)).toBeUndefined();
    });

    it('keeps exited PTYs that are in active set', () => {
      const entry = spawnSession('/test');
      entry.exited = true;
      const removed = cleanupOrphanedPtys(new Set([entry.ptyId]));
      expect(removed).not.toContain(entry.ptyId);
      expect(getPtyEntry(entry.ptyId)).toBeDefined();
    });

    it('keeps non-exited PTYs', () => {
      const entry = spawnSession('/test');
      const removed = cleanupOrphanedPtys(new Set());
      expect(removed).not.toContain(entry.ptyId);
      expect(getPtyEntry(entry.ptyId)).toBeDefined();
    });
  });
});
