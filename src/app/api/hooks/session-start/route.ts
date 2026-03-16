import { NextRequest, NextResponse } from 'next/server';
import { addSession, getAllSessions } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = body.session_id;
  const cwd = body.cwd || '';
  const tty = body.tty || '';

  const session = addSession(sessionId, cwd, tty);
  broadcast({ type: 'sessions', sessions: getAllSessions() });

  console.log(`[Hook] Session started: ${sessionId}`);
  return NextResponse.json({ status: 'ok' });
}
