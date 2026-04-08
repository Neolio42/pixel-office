import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApproval, resolveApproval, getPendingApprovals } from './approval-queue';

describe('approval-queue', () => {
  beforeEach(() => {
    // Clear global state before each test
    delete globalThis.__pending;
    delete globalThis.__approvalIdCounter;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.__pending;
    delete globalThis.__approvalIdCounter;
  });

  describe('createApproval', () => {
    it('creates a new approval with unique ID', () => {
      const { approval } = createApproval('session-1', 'Bash', { command: 'ls' }, 'safe');
      expect(approval.id).toMatch(/^approval-\d+-\d+$/);
      expect(approval.sessionId).toBe('session-1');
      expect(approval.toolName).toBe('Bash');
      expect(approval.toolInput).toEqual({ command: 'ls' });
      expect(approval.reason).toBe('safe');
      expect(approval.createdAt).toBeGreaterThan(0);
    });

    it('generates incrementing approval IDs', () => {
      const { approval: approval1 } = createApproval('session-1', 'Bash', { command: 'ls' }, 'safe');
      const { approval: approval2 } = createApproval('session-1', 'Bash', { command: 'pwd' }, 'safe');
      const id1 = approval1.id.split('-')[1];
      const id2 = approval2.id.split('-')[1];
      expect(parseInt(id2, 10)).toBe(parseInt(id1, 10) + 1);
    });

    it('returns a promise that resolves with decision', async () => {
      const { approval, promise } = createApproval('session-1', 'Bash', { command: 'ls' }, 'unknown');
      resolveApproval(approval.id, 'allow', 'Approved');
      const result = await promise;
      expect(result.decision).toBe('allow');
      expect(result.message).toBe('Approved');
    });

    it('includes reason in approval object', () => {
      const { approval: safeApproval } = createApproval('session-1', 'Read', { file_path: '/foo' }, 'safe');
      const { approval: riskyApproval } = createApproval('session-2', 'Bash', { command: 'rm file' }, 'risky');
      const { approval: unknownApproval } = createApproval('session-3', 'UnknownTool', {}, 'unknown');

      expect(safeApproval.reason).toBe('safe');
      expect(riskyApproval.reason).toBe('risky');
      expect(unknownApproval.reason).toBe('unknown');
    });

    it('times out after 10 minutes with deny decision', async () => {
      const { approval, promise } = createApproval('session-1', 'Bash', { command: 'ls' }, 'unknown');
      const resultPromise = promise.then(result => result);

      vi.advanceTimersByTime(10 * 60_000);

      const result = await resultPromise;
      expect(result.decision).toBe('deny');
      expect(result.message).toBe('Approval timed out (10 min)');
    });

    it('removes timed out approval from pending list', async () => {
      const { approval, promise } = createApproval('session-1', 'Bash', { command: 'ls' }, 'unknown');
      expect(getPendingApprovals()).toHaveLength(1);

      vi.advanceTimersByTime(10 * 60_000);
      await promise;

      expect(getPendingApprovals()).toHaveLength(0);
    });

    it('does not time out before 10 minutes', () => {
      const { approval } = createApproval('session-1', 'Bash', { command: 'ls' }, 'unknown');
      expect(getPendingApprovals()).toHaveLength(1);

      vi.advanceTimersByTime(10 * 60_000 - 1);

      expect(getPendingApprovals()).toHaveLength(1);
    });

    it('clears timeout when resolved normally', async () => {
      const { approval, promise } = createApproval('session-1', 'Bash', { command: 'ls' }, 'unknown');
      resolveApproval(approval.id, 'allow');
      await promise;

      vi.advanceTimersByTime(10 * 60_000);

      // Should not cause any issues if timeout was cleared
      expect(getPendingApprovals()).toHaveLength(0);
    });
  });

  describe('resolveApproval', () => {
    it('resolves pending approval with allow decision', async () => {
      const { approval, promise } = createApproval('session-1', 'Bash', { command: 'ls' }, 'unknown');
      const resolved = resolveApproval(approval.id, 'allow', 'Go ahead');
      expect(resolved).toBe(true);

      const result = await promise;
      expect(result.decision).toBe('allow');
      expect(result.message).toBe('Go ahead');
    });

    it('resolves pending approval with deny decision', async () => {
      const { approval, promise } = createApproval('session-1', 'Bash', { command: 'rm file' }, 'risky');
      const resolved = resolveApproval(approval.id, 'deny', 'Not allowed');
      expect(resolved).toBe(true);

      const result = await promise;
      expect(result.decision).toBe('deny');
      expect(result.message).toBe('Not allowed');
    });

    it('removes approval from pending list after resolution', () => {
      const { approval } = createApproval('session-1', 'Bash', { command: 'ls' }, 'unknown');
      expect(getPendingApprovals()).toHaveLength(1);

      resolveApproval(approval.id, 'allow');

      expect(getPendingApprovals()).toHaveLength(0);
    });

    it('returns false for non-existent approval ID', () => {
      const result = resolveApproval('non-existent-id', 'allow');
      expect(result).toBe(false);
    });

    it('returns false for already resolved approval', () => {
      const { approval } = createApproval('session-1', 'Bash', { command: 'ls' }, 'unknown');
      resolveApproval(approval.id, 'allow');

      const result = resolveApproval(approval.id, 'deny');
      expect(result).toBe(false);
    });

    it('handles resolution without message', async () => {
      const { approval, promise } = createApproval('session-1', 'Bash', { command: 'ls' }, 'unknown');
      resolveApproval(approval.id, 'allow');

      const result = await promise;
      expect(result.decision).toBe('allow');
      expect(result.message).toBeUndefined();
    });
  });

  describe('getPendingApprovals', () => {
    it('returns empty array when no approvals pending', () => {
      const pending = getPendingApprovals();
      expect(pending).toEqual([]);
    });

    it('returns all pending approvals', () => {
      const { approval: approval1 } = createApproval('session-1', 'Bash', { command: 'ls' }, 'safe');
      const { approval: approval2 } = createApproval('session-2', 'Read', { file_path: '/foo' }, 'safe');
      const { approval: approval3 } = createApproval('session-3', 'Bash', { command: 'rm file' }, 'risky');

      const pending = getPendingApprovals();
      expect(pending).toHaveLength(3);
      expect(pending.map(p => p.id)).toContain(approval1.id);
      expect(pending.map(p => p.id)).toContain(approval2.id);
      expect(pending.map(p => p.id)).toContain(approval3.id);
    });

    it('does not include resolved approvals', () => {
      const { approval: approval1 } = createApproval('session-1', 'Bash', { command: 'ls' }, 'safe');
      const { approval: approval2 } = createApproval('session-2', 'Bash', { command: 'pwd' }, 'safe');

      resolveApproval(approval1.id, 'allow');

      const pending = getPendingApprovals();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(approval2.id);
    });

    it('returns a copy of the approvals array', () => {
      const { approval } = createApproval('session-1', 'Bash', { command: 'ls' }, 'safe');
      const pending1 = getPendingApprovals();
      const pending2 = getPendingApprovals();

      expect(pending1).not.toBe(pending2);
      expect(pending1).toEqual(pending2);
    });
  });

  describe('global state persistence', () => {
    it('shares approvals across module instances', () => {
      const { approval: approval1 } = createApproval('session-1', 'Bash', { command: 'ls' }, 'safe');
      const pending = getPendingApprovals();

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(approval1.id);
    });

    it('initializes pending map on first access', () => {
      expect(globalThis.__pending).toBeUndefined();
      getPendingApprovals();
      expect(globalThis.__pending).toBeInstanceOf(Map);
    });

    it('initializes approval ID counter on first access', () => {
      expect(globalThis.__approvalIdCounter).toBeUndefined();
      const { approval } = createApproval('session-1', 'Bash', { command: 'ls' }, 'safe');
      expect(globalThis.__approvalIdCounter).toBe(1);
    });
  });

  describe('concurrent approvals', () => {
    it('handles multiple concurrent approvals independently', async () => {
      const { approval: approval1, promise: promise1 } = createApproval('session-1', 'Bash', { command: 'ls' }, 'safe');
      const { approval: approval2, promise: promise2 } = createApproval('session-2', 'Bash', { command: 'pwd' }, 'safe');

      resolveApproval(approval1.id, 'allow', 'Approved 1');
      resolveApproval(approval2.id, 'deny', 'Denied 2');

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1.decision).toBe('allow');
      expect(result1.message).toBe('Approved 1');
      expect(result2.decision).toBe('deny');
      expect(result2.message).toBe('Denied 2');
    });

    it('resolves approvals in any order', async () => {
      const { approval: approval1, promise: promise1 } = createApproval('session-1', 'Bash', { command: 'ls' }, 'safe');
      const { approval: approval2, promise: promise2 } = createApproval('session-2', 'Bash', { command: 'pwd' }, 'safe');

      resolveApproval(approval2.id, 'allow');
      resolveApproval(approval1.id, 'allow');

      await Promise.all([promise1, promise2]);

      expect(getPendingApprovals()).toHaveLength(0);
    });
  });
});
