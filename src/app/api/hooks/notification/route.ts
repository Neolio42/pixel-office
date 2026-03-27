import { NextRequest, NextResponse } from 'next/server';
import { getSession, updateSession } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';

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
  const message = String(body.message || body.notification || '');

  // Notification = Claude is asking the user something, worker goes idle
  const session = updateSession(sessionId, 'idle', null);
  if (session) {
    broadcast({ type: 'session-update', session });
  }

  broadcast({ type: 'notification', sessionId, message });

  return NextResponse.json({ status: 'ok' });
}
