import { NextRequest, NextResponse } from 'next/server';
import { getSession, removeSession, updateSession } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { unlinkSessionFromPty, getPtyEntry, killPty } from '@/lib/pty-manager';
import { resolveApproval, getPendingApprovals } from '@/lib/approval-queue';

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    try {
      const raw = await req.text();
      const sanitized = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
      body = JSON.parse(sanitized);
    } catch {
      body = {};
    }
  }
  const sessionId = String(body.session_id || '');
  if (!sessionId) return NextResponse.json({});

  const session = getSession(sessionId);
  if (session?.ptyId) {
    const ptyEntry = getPtyEntry(session.ptyId);
    if (ptyEntry && !ptyEntry.exited) {
      // PTY is still alive — keep the session but mark it idle and unlink.
      // The terminal is still usable (user can type new prompts).
      // A new session-start will re-link when Claude restarts.
      unlinkSessionFromPty(session.ptyId);
      const updated = updateSession(sessionId, 'idle', null);
      if (updated) broadcast({ type: 'session-update', session: updated });
      console.log(`[Hook] Session ended (PTY alive, keeping): ${sessionId}`);
      return NextResponse.json({ status: 'ok' });
    }
  }

  // No PTY or PTY already exited — fully remove
  if (session?.ptyId) killPty(session.ptyId);
  removeSession(sessionId);

  // Deny any orphaned approvals for this session.
  // Only resolve — pre-tool-use will broadcast approval-resolved when its await unblocks.
  const orphaned = getPendingApprovals().filter(a => a.sessionId === sessionId);
  for (const approval of orphaned) {
    resolveApproval(approval.id, 'deny', 'Session ended');
  }

  broadcast({ type: 'session-remove', sessionId });
  console.log(`[Hook] Session ended: ${sessionId}${orphaned.length > 0 ? ` (${orphaned.length} orphan approval(s) denied)` : ''}`);
  return NextResponse.json({ status: 'ok' });
}
