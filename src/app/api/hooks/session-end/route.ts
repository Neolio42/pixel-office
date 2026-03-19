import { NextRequest, NextResponse } from 'next/server';
import { getSession, removeSession, updateSession } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { unlinkSessionFromPty, getPtyEntry, killPty } from '@/lib/pty-manager';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = body.session_id;

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
  broadcast({ type: 'session-remove', sessionId });
  console.log(`[Hook] Session ended: ${sessionId}`);
  return NextResponse.json({ status: 'ok' });
}
