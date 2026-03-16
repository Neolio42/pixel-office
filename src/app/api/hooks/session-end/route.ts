import { NextRequest, NextResponse } from 'next/server';
import { removeSession } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = body.session_id;

  removeSession(sessionId);
  broadcast({ type: 'session-remove', sessionId });

  console.log(`[Hook] Session ended: ${sessionId}`);
  return NextResponse.json({ status: 'ok' });
}
