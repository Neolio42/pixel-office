import { NextRequest, NextResponse } from 'next/server';
import { getSession, addSession, updateSession } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = body.session_id;

  if (!getSession(sessionId)) {
    addSession(sessionId, '');
  }

  const session = updateSession(sessionId, 'idle', null);
  if (session) {
    broadcast({ type: 'session-update', session });
  }

  return NextResponse.json({ status: 'ok' });
}
