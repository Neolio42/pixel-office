import { NextRequest, NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = body.session_id;
  const message = body.message || body.notification || '';

  // Notification = Claude is asking the user something, worker goes idle
  const session = updateSession(sessionId, 'idle', null);
  if (session) {
    broadcast({ type: 'session-update', session });
  }

  broadcast({ type: 'notification', sessionId, message });

  return NextResponse.json({ status: 'ok' });
}
