import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { getSession, addSession, updateSession, updateSessionTty, addToolCall, setSessionPlanMode, setSessionTask, setSessionFocus, getNeedsFocusUpdate, setNeedsFocusUpdate } from '@/lib/store';
import { classifyTool } from '@/lib/tool-classifier';
import { createApproval, resolveApproval } from '@/lib/approval-queue';
import { broadcast, hasConnectedClients } from '@/lib/ws-server';
import { readTaskFromTranscript, readLatestAssistantMessage } from '@/lib/transcript';
import { extractFocusFromAssistant } from '@/lib/text-utils';
import { logAutoApproved, logBossDecision } from '@/lib/command-log';

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
  if (existingSession && getNeedsFocusUpdate(sessionId) && (transcriptPath || existingSession.transcriptPath)) {
    setNeedsFocusUpdate(sessionId, false);
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
    logAutoApproved(sessionId, toolName, toolInput, reason);
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
    logBossDecision(sessionId, toolName, toolInput, reason, 'allowed');
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
  let orphanInterval: ReturnType<typeof setInterval>;
  const orphanCheck = new Promise<{ decision: 'deny'; message: string }>((resolve) => {
    orphanInterval = setInterval(() => {
      if (!hasConnectedClients()) {
        clearInterval(orphanInterval);
        resolveApproval(approval.id, 'deny', 'No browser connected');
        resolve({ decision: 'deny', message: 'No browser connected' });
      }
    }, 3000);
  });
  const result = await Promise.race([promise, orphanCheck]);
  clearInterval(orphanInterval!);
  console.log(`[Hook] Decision for ${toolName}: ${result.decision}${result.message ? ` — "${result.message}"` : ''}`);
  logBossDecision(sessionId, toolName, toolInput, reason, result.decision === 'allow' ? 'allowed' : 'denied');

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
