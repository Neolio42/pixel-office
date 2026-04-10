import { NextRequest, NextResponse } from 'next/server';
import { getSession, addSession, setSessionFocus, setSessionTask, setNeedsFocusUpdate } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { extractPromptFocus, parseHookBody } from '@/lib/text-utils';

export async function POST(req: NextRequest) {
  const body = parseHookBody(await req.text());
  const sessionId = String(body.session_id || '');
  const prompt = String(body.prompt || '');
  const cwd = String(body.cwd || '');

  if (!sessionId || !prompt || prompt.length < 5 || prompt.startsWith('<')) {
    return NextResponse.json({ status: 'ok' });
  }

  if (/^(continue|yes|no|ok|sure|go|y|n|done|looks good|lgtm)\s*[.!?]*$/i.test(prompt.trim())) {
    return NextResponse.json({ status: 'ok' });
  }

  if (!getSession(sessionId)) addSession(sessionId, cwd);

  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ status: 'ok' });

  // Set heuristic focus from prompt as placeholder
  // PreToolUse will try to upgrade this from the transcript
  const promptFocus = extractPromptFocus(prompt);
  setNeedsFocusUpdate(sessionId, true);
  if (promptFocus) {
    setSessionFocus(sessionId, promptFocus);
  } else {
    session.currentFocus = undefined;
  }
  broadcast({ type: 'session-update', session });

  if (!session.task) setSessionTask(sessionId, prompt.slice(0, 120));

  return NextResponse.json({ status: 'ok' });
}
