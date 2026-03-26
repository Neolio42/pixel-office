import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { getSession, addSession, updateSession, updateSessionTty, addToolCall, setSessionPlanMode, setSessionTask, setSessionFocus } from '@/lib/store';
import { classifyTool } from '@/lib/tool-classifier';
import { createApproval } from '@/lib/approval-queue';
import { broadcast, hasConnectedClients } from '@/lib/ws-server';
import { readTaskFromTranscript, readLatestAssistantMessage } from '@/lib/transcript';

/**
 * Extract a focus title from Claude's assistant response text.
 * Claude's first sentence typically states what it's going to do:
 *   "Let me fix the heuristic extraction..." → "Fix the heuristic extraction"
 *   "I'll update the WorkerPanel component" → "Update the WorkerPanel component"
 */
/** Action verbs — things Claude says it's DOING. Matches verb roots + suffixes (fixing, edited, etc). */
const ACTION_RE = /\b(fix|add|remove|delet|creat|updat|build|clean|mak|implement|refactor|debug|check|test|writ|mov|renam|chang|set|configur|deploy|push|install|upgrad|migrat|convert|pars|extract|handl|show|hid|enabl|disabl|run|start|stop|appl|us|open|clos|review|audit|verif|ensur|improv|optimiz|rewrit|redesign|simplif|merg|split|connect|wir|hook|scaffold|setup|integrat|strip|display|render|put|read|edit|search|reload|restart|clear|address|increas|bump|simulat|forc)\w*\b/i;

function extractFocusFromAssistant(text: string): string | null {
  // Split into sentences (by newlines and punctuation), scan first ~8
  const sentences = text.split(/(?<=[.!?\n])\s+/).slice(0, 8);

  const STRIP = [
    /^(let me|I'll|I will|I'm going to|I need to|I want to|I should|I can)\s+/i,
    /^(now |first |here's what|okay |ok |sure |right |alright |also )/i,
    /^(let's |we'll |we need to |we should )/i,
    /^(you're right\.?\s*)/i,
    /^(good news:?\s*)/i,
    /^(I'?m sorry\.?\s*)/i,
  ];

  // Skip patterns — observations, not actions
  const SKIP = /^(here|the |this |that |there |it |I see|I can see|looking at|based on|but |so |and |two |one |a |an |for |with |since |because |if |when |after |before |no |yes |not )/i;

  for (const sent of sentences) {
    let s = sent.trim();
    if (s.length < 10) continue;
    if (SKIP.test(s) && !ACTION_RE.test(s.slice(0, 40))) continue;

    // Strip assistant-style prefixes
    for (const p of STRIP) {
      s = s.replace(p, '');
    }
    s = s.trim();

    if (s.length < 12) continue;
    // After stripping, must contain an action verb
    if (!ACTION_RE.test(s.slice(0, 50))) continue;

    // Clean up
    s = s.replace(/[.!:]+$/, '').replace(/\s*[—–\-]\s*$/, '').trim();

    // Capitalize
    if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);

    if (s.length < 10) continue;
    return s;
  }

  return null;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  const raw = await req.text();
  try {
    body = JSON.parse(raw);
  } catch {
    // Hook payload may contain control characters in tool_input (e.g. tabs in heredocs).
    // eslint-disable-next-line no-control-regex
    const cleaned = raw.replace(/[\x00-\x1f\x7f]/g, (ch) => {
      if (ch === '\n') return '\\n';
      if (ch === '\r') return '\\r';
      if (ch === '\t') return '\\t';
      return '';
    });
    try {
      body = JSON.parse(cleaned);
    } catch {
      console.error('[Hook] Unparseable body, first 300 chars:', raw.slice(0, 300));
      return NextResponse.json({});
    }
  }
  const sessionId = String(body.session_id || '');
  const toolName = String(body.tool_name || 'Unknown');
  const toolInput = (body.tool_input || {}) as Record<string, unknown>;
  const cwd = String(body.cwd || '');
  const tty = String(body.tty || '');
  const transcriptPath = body.transcript_path ? String(body.transcript_path) : undefined;

  // Auto-create session if it doesn't exist (e.g. session-start was missed)
  if (!getSession(sessionId)) {
    addSession(sessionId, cwd, tty, transcriptPath);
  } else if (tty) {
    updateSessionTty(sessionId, tty);
  }

  // Fallback: if session has no task yet and transcript_path exists, try reading it
  const existingSession = getSession(sessionId);
  if (existingSession && !existingSession.task && (transcriptPath || existingSession.transcriptPath)) {
    const tp = transcriptPath || existingSession.transcriptPath;
    if (tp) {
      if (!existingSession.transcriptPath) existingSession.transcriptPath = tp;
      readTaskFromTranscript(tp).then((task) => {
        if (task) {
          const updated = setSessionTask(sessionId, task);
          if (updated) broadcast({ type: 'session-update', session: updated });
        }
      }).catch(() => {});
    }
  }

  // If UserPromptSubmit flagged a focus update, read the latest assistant message
  if (existingSession?.needsFocusUpdate && (transcriptPath || existingSession.transcriptPath)) {
    existingSession.needsFocusUpdate = false;
    const tp = transcriptPath || existingSession.transcriptPath;
    if (tp) {
      readLatestAssistantMessage(tp).then((text) => {
        if (!text) return;
        const focus = extractFocusFromAssistant(text);
        if (focus) {
          const updated = setSessionFocus(sessionId, focus);
          if (updated) broadcast({ type: 'session-update', session: updated });
        }
      }).catch(() => {});
    }
  }

  // Handle plan mode transitions
  if (toolName === 'EnterPlanMode') {
    const updated = setSessionPlanMode(sessionId, true);
    if (updated) broadcast({ type: 'session-update', session: updated });
    return NextResponse.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Auto-approved by Pixel Office',
      },
    });
  }
  if (toolName === 'ExitPlanMode') {
    const updated = setSessionPlanMode(sessionId, false);
    if (updated) broadcast({ type: 'session-update', session: updated });
    return NextResponse.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Auto-approved by Pixel Office',
      },
    });
  }

  // Record the tool call before classification
  addToolCall(sessionId, toolName, toolInput);

  const { state, needsApproval, reason } = classifyTool(toolName, toolInput);

  // Update worker state
  const session = updateSession(sessionId, state, toolName);
  if (session) {
    broadcast({ type: 'session-update', session });
  }

  if (!needsApproval) {
    return NextResponse.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'Auto-approved by Pixel Office',
      },
    });
  }

  // No browser connected — fall through so Claude Code handles approval in terminal
  if (!hasConnectedClients()) {
    console.log(`[Hook] No browser connected, falling through for ${toolName}`);
    return NextResponse.json({});
  }

  // Play notification sound so the boss knows (non-blocking)
  try {
    spawn('afplay', ['/System/Library/Sounds/Bottle.aiff'], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* ignore — not macOS or sound not found */ }

  // Needs approval — block until boss decides in the browser
  const { approval, promise } = createApproval(sessionId, toolName, toolInput, reason);

  broadcast({
    type: 'approval-request',
    approval: {
      id: approval.id,
      sessionId: approval.sessionId,
      toolName: approval.toolName,
      toolInput: approval.toolInput,
      createdAt: approval.createdAt,
      reason,
    },
  });

  console.log(`[Hook] Awaiting approval for ${toolName} (${reason}) in session ${sessionId}`);
  const result = await promise;
  console.log(`[Hook] Decision for ${toolName}: ${result.decision}${result.message ? ` — "${result.message}"` : ''}`);

  // Always broadcast resolution — covers timeout, disconnect-denial, and normal paths.
  // Without this, timeout/disconnect resolutions leave ghost toasts in the UI.
  broadcast({ type: 'approval-resolved', approvalId: approval.id });

  const hookResponse: Record<string, unknown> = {
    hookEventName: 'PreToolUse',
    permissionDecision: result.decision,
    permissionDecisionReason: result.message || (result.decision === 'allow' ? 'Boss approved' : 'Boss denied'),
  };

  // additionalContext goes at the TOP level (not inside hookSpecificOutput)
  // so Claude actually sees the boss's instructions
  if (result.message) {
    hookResponse.additionalContext = `[Boss says] ${result.message}`;
  }

  return NextResponse.json({
    hookSpecificOutput: hookResponse,
    ...(result.message ? { additionalContext: `[Boss says] ${result.message}` } : {}),
  });
}
