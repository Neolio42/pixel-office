import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---- Additional edge case tests for store ----
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

describe('store - edge cases', () => {
  beforeEach(() => {
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

  describe('addSession edge cases', () => {
    it('handles empty cwd', () => {
      const session = addSession('s-empty-cwd', '');
      expect(session.cwd).toBe('');
      removeSession('s-empty-cwd');
    });

    it('handles session with transcript path', () => {
      const session = addSession('s-tp', '/project', '', '/path/to/transcript.jsonl');
      expect(session.transcriptPath).toBe('/path/to/transcript.jsonl');
      removeSession('s-tp');
    });

    it('handles same sessionId being added twice (overwrites)', () => {
      addSession('s-dup', '/project/a');
      const second = addSession('s-dup', '/project/b');
      expect(second.cwd).toBe('/project/b');
      // Should only have one session with this ID
      const all = getAllSessions().filter(s => s.sessionId === 's-dup');
      expect(all.length).toBe(1);
      removeSession('s-dup');
    });
  });

  describe('cleanupStaleSessions edge cases', () => {
    it('respects isAlivePtyId callback to keep sessions with live PTYs', () => {
      addSession('s-alive-pty', '/project');
      const session = getSession('s-alive-pty')!;
      session.lastSeen = Date.now() - 120_000;
      session.ptyId = 'pty-alive-123';

      const isAlivePtyId = (ptyId: string) => ptyId === 'pty-alive-123';

      const removed = cleanupStaleSessions(60_000, isAlivePtyId);
      expect(removed).not.toContain('s-alive-pty');
      expect(getSession('s-alive-pty')).toBeDefined();
    });

    it('removes stale sessions with dead PTYs', () => {
      addSession('s-dead-pty', '/project');
      const session = getSession('s-dead-pty')!;
      session.lastSeen = Date.now() - 120_000;
      session.ptyId = 'pty-dead-456';

      const isAlivePtyId = (ptyId: string) => ptyId !== 'pty-dead-456';

      const removed = cleanupStaleSessions(60_000, isAlivePtyId);
      expect(removed).toContain('s-dead-pty');
      expect(getSession('s-dead-pty')).toBeUndefined();
    });

    it('removes stale sessions without ptyId when no callback provided', () => {
      addSession('s-no-pty', '/project');
      const session = getSession('s-no-pty')!;
      session.lastSeen = Date.now() - 120_000;

      const removed = cleanupStaleSessions(60_000);
      expect(removed).toContain('s-no-pty');
    });

    it('returns empty array when no stale sessions', () => {
      addSession('s-fresh-2', '/project');
      const removed = cleanupStaleSessions(60_000);
      expect(removed).toEqual([]);
      removeSession('s-fresh-2');
    });
  });

  describe('addToolCall edge cases', () => {
    it('generates correct summary for Read tool', () => {
      addSession('s-sum', '/project');
      addToolCall('s-sum', 'Read', { file_path: '/tmp/myfile.ts' });
      const session = getSession('s-sum')!;
      expect(session.recentTools[0].summary).toContain('myfile.ts');
      expect(session.recentTools[0].summary).toContain('Reading');
    });

    it('generates correct summary for Write tool', () => {
      addSession('s-sum2', '/project');
      addToolCall('s-sum2', 'Write', { file_path: '/tmp/newfile.ts' });
      const session = getSession('s-sum2')!;
      expect(session.recentTools[0].summary).toContain('Editing');
      expect(session.recentTools[0].summary).toContain('newfile.ts');
    });

    it('generates correct summary for Grep tool', () => {
      addSession('s-sum3', '/project');
      addToolCall('s-sum3', 'Grep', { pattern: 'TODO' });
      const session = getSession('s-sum3')!;
      expect(session.recentTools[0].summary).toContain('Searching');
      expect(session.recentTools[0].summary).toContain('TODO');
    });

    it('generates correct summary for Bash tool', () => {
      addSession('s-sum4', '/project');
      addToolCall('s-sum4', 'Bash', { command: 'npm test' });
      const session = getSession('s-sum4')!;
      expect(session.recentTools[0].summary).toContain('Running');
      expect(session.recentTools[0].summary).toContain('npm test');
    });

    it('generates correct summary for Agent tool', () => {
      addSession('s-sum5', '/project');
      addToolCall('s-sum5', 'Agent', {});
      const session = getSession('s-sum5')!;
      expect(session.recentTools[0].summary).toBe('Delegating task');
    });

    it('generates correct summary for MCP tools', () => {
      addSession('s-mcp', '/project');
      addToolCall('s-mcp', 'mcp__github__create_issue', { owner: 'test' });
      const session = getSession('s-mcp')!;
      expect(session.recentTools[0].summary).toContain('Github');
    });

    it('generates summary for unknown tool using first string value', () => {
      addSession('s-unk', '/project');
      addToolCall('s-unk', 'MyCustomTool', { description: 'do something' });
      const session = getSession('s-unk')!;
      expect(session.recentTools[0].summary).toContain('MyCustomTool');
      expect(session.recentTools[0].summary).toContain('do something');
    });

    it('updates lastSeen when adding tool call', () => {
      addSession('s-ls', '/project');
      const session = getSession('s-ls')!;
      const before = session.lastSeen;
      // Small delay
      addToolCall('s-ls', 'Read', { file_path: '/tmp/test.ts' });
      expect(getSession('s-ls')!.lastSeen).toBeGreaterThanOrEqual(before);
    });

    it('keeps only last 10 entries (FIFO)', () => {
      addSession('s-fifo', '/project');
      for (let i = 0; i < 15; i++) {
        addToolCall('s-fifo', 'Read', { file_path: `/tmp/file${i}.ts` });
      }
      const session = getSession('s-fifo')!;
      expect(session.recentTools.length).toBe(10);
      // Should have the latest 10 (files 5-14)
      expect(session.recentTools[0].summary).toContain('file5.ts');
      expect(session.recentTools[9].summary).toContain('file14.ts');
    });

    it('tool timestamps are sequential', () => {
      addSession('s-ts', '/project');
      addToolCall('s-ts', 'Read', { file_path: '/tmp/a.ts' });
      addToolCall('s-ts', 'Read', { file_path: '/tmp/b.ts' });
      const session = getSession('s-ts')!;
      expect(session.recentTools[1].timestamp).toBeGreaterThanOrEqual(session.recentTools[0].timestamp);
    });
  });

  describe('setSessionFocus edge cases', () => {
    it('returns null for non-existent session', () => {
      expect(setSessionFocus('non-existent', 'focus')).toBeNull();
    });

    it('can set and update focus', () => {
      addSession('s-focus2', '/project');
      setSessionFocus('s-focus2', 'auth module');
      expect(getSession('s-focus2')!.currentFocus).toBe('auth module');
      setSessionFocus('s-focus2', 'database layer');
      expect(getSession('s-focus2')!.currentFocus).toBe('database layer');
    });
  });

  describe('setSessionPlanMode edge cases', () => {
    it('returns null for non-existent session', () => {
      expect(setSessionPlanMode('non-existent', true)).toBeNull();
    });

    it('can toggle plan mode', () => {
      addSession('s-plan2', '/project');
      setSessionPlanMode('s-plan2', true);
      expect(getSession('s-plan2')!.inPlanMode).toBe(true);
      setSessionPlanMode('s-plan2', false);
      expect(getSession('s-plan2')!.inPlanMode).toBe(false);
    });
  });

  describe('updateSessionTty edge cases', () => {
    it('ignores empty tty', () => {
      addSession('s-tty-empty', '/project', '/dev/ttys001');
      updateSessionTty('s-tty-empty', '');
      expect(getSession('s-tty-empty')!.tty).toBe('/dev/ttys001');
    });

    it('ignores non-/dev/ tty on update', () => {
      addSession('s-tty-no', '/project', '/dev/ttys001');
      updateSessionTty('s-tty-no', 'pts/0');
      expect(getSession('s-tty-no')!.tty).toBe('/dev/ttys001');
    });

    it('updates to a new valid tty', () => {
      addSession('s-tty-upd', '/project', '/dev/ttys001');
      updateSessionTty('s-tty-upd', '/dev/ttys002');
      expect(getSession('s-tty-upd')!.tty).toBe('/dev/ttys002');
    });

    it('does nothing for non-existent session', () => {
      expect(() => updateSessionTty('non-existent', '/dev/ttys003')).not.toThrow();
    });
  });
});
