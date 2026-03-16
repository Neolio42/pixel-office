import { PendingApproval } from './types';

// Use globalThis so the same pending Map is shared across
// Next.js App Router module instances and the custom server.ts
declare global {
  // eslint-disable-next-line no-var
  var __pending: Map<string, PendingApproval> | undefined;
  // eslint-disable-next-line no-var
  var __approvalIdCounter: number | undefined;
}

function getPending(): Map<string, PendingApproval> {
  if (!globalThis.__pending) {
    globalThis.__pending = new Map();
  }
  return globalThis.__pending;
}

function nextId(): number {
  if (globalThis.__approvalIdCounter === undefined) {
    globalThis.__approvalIdCounter = 0;
  }
  return ++globalThis.__approvalIdCounter;
}

export function createApproval(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): { approval: PendingApproval; promise: Promise<'allow' | 'deny'> } {
  const pending = getPending();
  const id = `approval-${nextId()}-${Date.now()}`;

  let resolveRef!: (decision: 'allow' | 'deny') => void;
  const promise = new Promise<'allow' | 'deny'>((resolve) => {
    resolveRef = resolve;
  });

  const approval: PendingApproval = {
    id,
    sessionId,
    toolName,
    toolInput,
    createdAt: Date.now(),
    resolve: resolveRef,
  };

  pending.set(id, approval);

  // No timeout — approval stays open until the boss decides.
  // If no browser is connected, the pre-tool-use route handles fallthrough.

  return { approval, promise };
}

export function resolveApproval(id: string, decision: 'allow' | 'deny'): boolean {
  const pending = getPending();
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  entry.resolve(decision);
  return true;
}

export function getPendingApprovals(): PendingApproval[] {
  return [...getPending().values()];
}
