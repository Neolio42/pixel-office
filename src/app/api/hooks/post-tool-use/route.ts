import { NextRequest, NextResponse } from 'next/server';
import { getSession, addSession, updateSession } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = body.session_id;
  const cwd = body.cwd || '';

  // Auto-create session if it doesn't exist (e.g. session-start was missed)
  if (!getSession(sessionId)) {
    addSession(sessionId, cwd);
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
