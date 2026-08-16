import { NextRequest, NextResponse } from 'next/server';
import { getSession, addSession, updateSessionCwd, markToolEnded } from '@/lib/store';
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

  // Stamp the tool-end time. The state-tracker tick will promote this to
  // `thinking` after ~1.5s of silence, or it'll be replaced by the next
  // pre-tool-use.
  const session = markToolEnded(sessionId);
  if (session) {
    broadcast({ type: 'session-update', session });
  }

  return NextResponse.json({ status: 'ok' });
}
