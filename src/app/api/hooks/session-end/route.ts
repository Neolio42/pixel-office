import { NextRequest, NextResponse } from 'next/server';
import { getSession, removeSession } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { unlinkSessionFromPty } from '@/lib/pty-manager';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = body.session_id;

  const session = getSession(sessionId);
  if (session?.ptyId) {
    // Don't kill the PTY — Claude may restart in the same terminal (e.g., /clear).
    // Just unlink so the next session-start can re-link to it.
    unlinkSessionFromPty(session.ptyId);
  }
  removeSession(sessionId);
  broadcast({ type: 'session-remove', sessionId });

  console.log(`[Hook] Session ended: ${sessionId}`);
  return NextResponse.json({ status: 'ok' });
}
