import { NextRequest, NextResponse } from 'next/server';
import { getSession, addSession, setSessionFocus, setSessionTask } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';

/** Action verbs for finding actionable sentences. */
const ACTION_RE = /\b(fix|add|remove|delet|creat|updat|build|clean|mak|implement|refactor|debug|check|test|writ|mov|renam|chang|set|configur|deploy|push|install|upgrad|migrat|convert|pars|extract|handl|show|hid|enabl|disabl|run|start|stop|appl|open|clos|review|audit|verif|ensur|improv|optimiz|rewrit|redesign|simplif|merg|split|connect|hook|scaffold|setup|integrat|strip|display|render|read|edit|search|reload|restart|clear|increas|look\s*at|work\s*on|clean\s*up|set\s*up|figure\s*out)\w*\b/i;

const STRIP = [
  /^.*?\bhow\s+about\s+(we\s+)?/i,
  /^.*?\blet'?s\s+(just\s+)?/i,
  /^.*?\bwe\s+(need|have|should|could|want)\s+to\s+/i,
  /^.*?\bi\s+(need|want)\s+you\s+to\s+/i,
  /^.*?\b(can|could|would)\s+you\s+(please\s+)?/i,
  /^(right|ok|okay|alright|so|now|first|also|then|next|and|but|like|dude|honestly|basically|well)\s*(,\s*|\s+)/i,
  /^(you\s+know,?\s*)/i,
  /^(we'?re\s+trying\s+to\s+)/i,
  /^(first\s+of\s+all|in\s+addition(\s+to\s+that)?)\s*(,\s*|\s+)/i,
  /^(please\s+)/i,
  /^(make\s+sure\s+(that\s+)?(we\s+)?(don'?t\s+)?)/i,
  /^(I\s+think\s+(we\s+should\s+)?)/i,
  /^(we\s+need\s+to\s+)/i,
  /^(implement\s+the\s+following\s+(plan|task|request):\s*)/i,
];

/** Quick heuristic focus from user prompt — used as fallback until transcript is read. */
export function extractPromptFocus(prompt: string): string | null {
  // Split into sentences
  const sentences = prompt.split(/(?<=[.!?\n])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 8);

  // Skip noise sentences
  function isNoise(s: string): boolean {
    if (s.startsWith('```') || s.startsWith('---') || s.startsWith('<')) return true;
    if (!ACTION_RE.test(s)) {
      if (/^(right|ok|okay|yeah|yea|no|yes|sure|dude|honestly|it'?s|that'?s|this is|not|how many|why|what the|I don'?t|we'?re|I'?m|you'?re)\b/i.test(s)) return true;
      if (s.endsWith('?')) return true;
    }
    return false;
  }

  // Find first actionable sentence
  let chosen = sentences.find(s => !isNoise(s) && ACTION_RE.test(s));
  if (!chosen) chosen = sentences.find(s => !isNoise(s));
  if (!chosen) return null;

  // Clean it
  for (const p of STRIP) {
    chosen = chosen.replace(p, '');
  }
  chosen = chosen.replace(/[.!:]+$/, '').replace(/\s+(and\s+shit|and\s+stuff|or\s+whatever)$/i, '').trim();

  if (chosen.length < 5) return null;
  chosen = chosen[0].toUpperCase() + chosen.slice(1);

  return chosen;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = body.session_id;
  const prompt = body.prompt || '';
  const cwd = body.cwd || '';

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
  session.needsFocusUpdate = true;
  if (promptFocus) {
    setSessionFocus(sessionId, promptFocus);
  } else {
    session.currentFocus = undefined;
  }
  broadcast({ type: 'session-update', session });

  if (!session.task) setSessionTask(sessionId, prompt.slice(0, 120));

  return NextResponse.json({ status: 'ok' });
}
