import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---- approval-queue tests ----
import { createApproval, resolveApproval, getPendingApprovals } from '../src/lib/approval-queue';

describe('approval-queue', () => {
  beforeEach(() => {
    // Clear any pending approvals from previous tests
    const pending = getPendingApprovals();
    for (const a of pending) {
      resolveApproval(a.id, 'deny');
    }
  });

  it('creates an approval with correct properties', () => {
    const { approval, promise } = createApproval(
      'session-1',
      'Bash',
      { command: 'rm -rf /' },
      'risky'
    );

    expect(approval.sessionId).toBe('session-1');
    expect(approval.toolName).toBe('Bash');
    expect(approval.toolInput).toEqual({ command: 'rm -rf /' });
    expect(approval.reason).toBe('risky');
    expect(approval.createdAt).toBeGreaterThan(0);
    expect(approval.id).toMatch(/^approval-/);

    // Resolve to prevent timeout side effects
    resolveApproval(approval.id, 'deny');
  });

  it('resolves an approval with allow', async () => {
    const { approval, promise } = createApproval(
      'session-2',
      'Bash',
      { command: 'npm install' },
      'risky'
    );

    const resolved = resolveApproval(approval.id, 'allow', 'Looks safe');
    expect(resolved).toBe(true);

    const result = await promise;
    expect(result.decision).toBe('allow');
    expect(result.message).toBe('Looks safe');
  });

  it('resolves an approval with deny', async () => {
    const { approval, promise } = createApproval(
      'session-3',
      'Bash',
      { command: 'sudo rm -rf /' },
      'risky'
    );

    const resolved = resolveApproval(approval.id, 'deny');
    expect(resolved).toBe(true);

    const result = await promise;
    expect(result.decision).toBe('deny');
  });

  it('returns false when resolving non-existent approval', () => {
    const result = resolveApproval('non-existent-id', 'allow');
    expect(result).toBe(false);
  });

  it('removes approval from pending after resolution', () => {
    const { approval } = createApproval('session-4', 'Bash', {}, 'unknown');
    
    const before = getPendingApprovals();
    expect(before.some(a => a.id === approval.id)).toBe(true);

    resolveApproval(approval.id, 'allow');

    const after = getPendingApprovals();
    expect(after.some(a => a.id === approval.id)).toBe(false);
  });

  it('generates unique IDs for each approval', () => {
    const { approval: a1 } = createApproval('s1', 'Bash', {}, 'unknown');
    const { approval: a2 } = createApproval('s2', 'Bash', {}, 'unknown');

    expect(a1.id).not.toBe(a2.id);

    resolveApproval(a1.id, 'deny');
    resolveApproval(a2.id, 'deny');
  });

  it('times out after 10 minutes and denies', async () => {
    vi.useFakeTimers();

    const { approval, promise } = createApproval(
      'session-timeout',
      'Bash',
      { command: 'dangerous' },
      'risky'
    );

    // Advance past 10 minute timeout
    vi.advanceTimersByTime(10 * 60_000 + 1);

    const result = await promise;
    expect(result.decision).toBe('deny');
    expect(result.message).toContain('timed out');

    vi.useRealTimers();
  });

  it('getPendingApprovals returns all pending', () => {
    const { approval: a1 } = createApproval('s-a', 'Bash', {}, 'unknown');
    const { approval: a2 } = createApproval('s-b', 'Read', {}, 'safe');

    const pending = getPendingApprovals();
    expect(pending.length).toBeGreaterThanOrEqual(2);
    expect(pending.some(a => a.id === a1.id)).toBe(true);
    expect(pending.some(a => a.id === a2.id)).toBe(true);

    resolveApproval(a1.id, 'deny');
    resolveApproval(a2.id, 'deny');
  });
});
