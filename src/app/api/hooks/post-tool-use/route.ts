import { NextRequest, NextResponse } from 'next/server';
import { getSession, addSession, updateSession, updateSessionCwd } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { parseHookBody } from '@/lib/text-utils';

export async function POST(req: NextRequest) {
  const body = parseHookBody(await req.text());
  const sessionId = String(body.session_id || '');
  if (!sessionId) return NextResponse.json({});
  const cwd = String(body.cwd || '');

  // Auto-create session if it doesn't exist (e.g. session-start was missed)
  if (!getSession(sessionId)) {
    addSession(sessionId, cwd);
  } else if (cwd) {
    // Backfill empty cwd (session-start may have been missed)
    if (updateSessionCwd(sessionId, cwd)) {
      const s = getSession(sessionId);
      if (s) broadcast({ type: 'session-update', session: s });
    }
  }

  // Don't set idle immediately — the next pre-tool-use will come within ms
  // for rapid tool calls. Instead, just update lastSeen and let the client
  // handle the idle transition after a timeout.
  const session = getSession(sessionId);
  if (session) {
    session.lastSeen = Date.now();
    session.currentTool = null;
    broadcast({ type: 'session-update', session });
  }

  return NextResponse.json({ status: 'ok' });
}
