import { NextRequest, NextResponse } from 'next/server';
import { updateSession, markAwaitingUser } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { parseHookBody } from '@/lib/text-utils';

export async function POST(req: NextRequest) {
  const body = parseHookBody(await req.text());
  const sessionId = String(body.session_id || '');
  if (!sessionId) return NextResponse.json({});
  const message = String(body.message || body.notification || '');

  // Notification = Claude is asking the user something. Worker enters
  // `waiting` and we start the long-wait timer.
  updateSession(sessionId, 'waiting', null);
  const session = markAwaitingUser(sessionId);
  if (session) {
    broadcast({ type: 'session-update', session });
  }

  broadcast({ type: 'notification', sessionId, message });

  return NextResponse.json({ status: 'ok' });
}
