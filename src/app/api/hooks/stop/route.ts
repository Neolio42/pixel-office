import { NextRequest, NextResponse } from 'next/server';
import { getSession, addSession, markStopped } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { parseHookBody } from '@/lib/text-utils';

export async function POST(req: NextRequest) {
  const body = parseHookBody(await req.text());
  const sessionId = String(body.session_id || '');
  if (!sessionId) return NextResponse.json({});

  if (!getSession(sessionId)) {
    addSession(sessionId, '');
  }

  // Promote worker to `done` (state-tracker tick will demote to idle after 60s).
  const session = markStopped(sessionId);
  if (session) {
    broadcast({ type: 'session-update', session });
  }

  return NextResponse.json({ status: 'ok' });
}
