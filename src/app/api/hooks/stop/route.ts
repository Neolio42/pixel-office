import { NextRequest, NextResponse } from 'next/server';
import { getSession, addSession, updateSession } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { parseHookBody } from '@/lib/text-utils';

export async function POST(req: NextRequest) {
  const body = parseHookBody(await req.text());
  const sessionId = String(body.session_id || '');
  if (!sessionId) return NextResponse.json({});

  if (!getSession(sessionId)) {
    addSession(sessionId, '');
  }

  const session = updateSession(sessionId, 'idle', null);
  if (session) {
    broadcast({ type: 'session-update', session });
  }

  return NextResponse.json({ status: 'ok' });
}
