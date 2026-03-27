import { randomBytes } from 'crypto';
import { PendingApproval } from './types';

// Use globalThis so the same pending Map is shared across
// Next.js App Router module instances and the custom server.ts
declare global {
  // eslint-disable-next-line no-var
  var __pending: Map<string, PendingApproval> | undefined;
  // eslint-disable-next-line no-var
  var __approvalTimeouts: Map<string, NodeJS.Timeout> | undefined;
}

function getPending(): Map<string, PendingApproval> {
  if (!globalThis.__pending) {
    globalThis.__pending = new Map();
  }
  return globalThis.__pending;
}

function getTimeouts(): Map<string, NodeJS.Timeout> {
  if (!globalThis.__approvalTimeouts) {
    globalThis.__approvalTimeouts = new Map();
  }
  return globalThis.__approvalTimeouts;
}

export function createApproval(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  reason: 'safe' | 'risky' | 'unknown' = 'unknown'
): { approval: PendingApproval; promise: Promise<{ decision: 'allow' | 'deny'; message?: string }> } {
  const pending = getPending();
  const id = `approval-${randomBytes(16).toString('hex')}`;

  let resolveRef!: (decision: { decision: 'allow' | 'deny'; message?: string }) => void;
  const promise = new Promise<{ decision: 'allow' | 'deny'; message?: string }>((resolve) => {
    resolveRef = resolve;
  });

  const approval: PendingApproval = {
    id,
    sessionId,
    toolName,
    toolInput,
    createdAt: Date.now(),
    reason,
    resolve: resolveRef,
  };

  pending.set(id, approval);

  // 10-minute max timeout — prevents permanent hangs if browser crashes
  // without a clean WebSocket close.
  const MAX_TIMEOUT = 10 * 60_000;
  const timeouts = getTimeouts();
  const timeout = setTimeout(() => {
    if (pending.has(id)) {
      console.log(`[Approval] Timed out after 10min: ${toolName} in ${sessionId}`);
      pending.delete(id);
      timeouts.delete(id);
      resolveRef({ decision: 'deny', message: 'Approval timed out (10 min)' });
    }
  }, MAX_TIMEOUT);
  timeouts.set(id, timeout);

  // Clear timeout when resolved normally
  const originalPromise = promise;
  const wrappedPromise = originalPromise.then((result) => {
    clearTimeout(timeouts.get(id));
    timeouts.delete(id);
    return result;
  });

  return { approval, promise: wrappedPromise };
}

export function resolveApproval(id: string, decision: 'allow' | 'deny', message?: string): boolean {
  const pending = getPending();
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  entry.resolve({ decision, message });
  return true;
}

export function getPendingApproval(id: string): PendingApproval | undefined {
  return getPending().get(id);
}

export function getPendingApprovals(): PendingApproval[] {
  return [...getPending().values()];
}
