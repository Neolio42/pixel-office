import { NextRequest, NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { parseHookBody } from '@/lib/text-utils';

export async function POST(req: NextRequest) {
  const body = parseHookBody(await req.text());
  const sessionId = String(body.session_id || '');
  if (!sessionId) return NextResponse.json({});
  const message = String(body.message || body.notification || '');

  // Notification = Claude is asking the user something, worker goes idle
  const session = updateSession(sessionId, 'idle', null);
  if (session) {
    broadcast({ type: 'session-update', session });
  }

  broadcast({ type: 'notification', sessionId, message });

  return NextResponse.json({ status: 'ok' });
}
