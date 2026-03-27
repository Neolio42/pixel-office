/** Action verbs — things Claude says it's DOING or a user asks to be done. Matches verb roots + suffixes. */
export const ACTION_RE = /\b(fix|add|remove|delet|creat|updat|build|clean|mak|implement|refactor|debug|check|test|writ|mov|renam|chang|set|configur|deploy|push|install|upgrad|migrat|convert|pars|extract|handl|show|hid|enabl|disabl|run|start|stop|appl|us|open|clos|review|audit|verif|ensur|improv|optimiz|rewrit|redesign|simplif|merg|split|connect|wir|hook|scaffold|setup|integrat|strip|display|render|put|read|edit|search|reload|restart|clear|address|increas|bump|simulat|forc|look\s*at|work\s*on|clean\s*up|set\s*up|figure\s*out)\w*\b/i;

const STRIP_ASSISTANT = [
  /^(let me|I'll|I will|I'm going to|I need to|I want to|I should|I can)\s+/i,
  /^(now |first |here's what|okay |ok |sure |right |alright |also )/i,
  /^(let's |we'll |we need to |we should )/i,
  /^(you're right\.?\s*)/i,
  /^(good news:?\s*)/i,
  /^(I'?m sorry\.?\s*)/i,
];

const SKIP_ASSISTANT = /^(here|the |this |that |there |it |I see|I can see|looking at|based on|but |so |and |two |one |a |an |for |with |since |because |if |when |after |before |no |yes |not )/i;

/**
 * Extract a focus title from Claude's assistant response text.
 */
export function extractFocusFromAssistant(text: string): string | null {
  const sentences = text.split(/(?<=[.!?\n])\s+/).slice(0, 8);

  for (const sent of sentences) {
    let s = sent.trim();
    if (s.length < 10) continue;
    if (SKIP_ASSISTANT.test(s) && !ACTION_RE.test(s.slice(0, 40))) continue;

    for (const p of STRIP_ASSISTANT) {
      s = s.replace(p, '');
    }
    s = s.trim();

    if (s.length < 12) continue;
    if (!ACTION_RE.test(s.slice(0, 50))) continue;

    s = s.replace(/[.!:]+$/, '').replace(/\s*[—–\-]\s*$/, '').trim();
    if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);
    if (s.length < 10) continue;
    return s;
  }

  return null;
}

const STRIP_PROMPT = [
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
  const sentences = prompt.split(/(?<=[.!?\n])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 8);

  function isNoise(s: string): boolean {
    if (s.startsWith('```') || s.startsWith('---') || s.startsWith('<')) return true;
    if (!ACTION_RE.test(s)) {
      if (/^(right|ok|okay|yeah|yea|no|yes|sure|dude|honestly|it'?s|that'?s|this is|not|how many|why|what the|I don'?t|we'?re|I'?m|you'?re)\b/i.test(s)) return true;
      if (s.endsWith('?')) return true;
    }
    return false;
  }

  let chosen = sentences.find(s => !isNoise(s) && ACTION_RE.test(s));
  if (!chosen) chosen = sentences.find(s => !isNoise(s));
  if (!chosen) return null;

  for (const p of STRIP_PROMPT) {
    chosen = chosen.replace(p, '');
  }
  chosen = chosen.replace(/[.!:]+$/, '').replace(/\s+(and\s+shit|and\s+stuff|or\s+whatever)$/i, '').trim();

  if (chosen.length < 5) return null;
  chosen = chosen[0].toUpperCase() + chosen.slice(1);
  return chosen;
}
