import { NextRequest, NextResponse } from 'next/server';
import { getSession, removeSession } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { killPty } from '@/lib/pty-manager';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = body.session_id;

  const session = getSession(sessionId);
  const ptyId = session?.ptyId;
  removeSession(sessionId);
  if (ptyId) killPty(ptyId);
  broadcast({ type: 'session-remove', sessionId });

  console.log(`[Hook] Session ended: ${sessionId}`);
  return NextResponse.json({ status: 'ok' });
}
