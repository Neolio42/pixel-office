import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getSession, addSession, updateSession, updateSessionTty, addToolCall } from '@/lib/store';
import { classifyTool } from '@/lib/tool-classifier';
import { createApproval } from '@/lib/approval-queue';
import { broadcast, hasConnectedClients } from '@/lib/ws-server';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = body.session_id;
  const toolName = body.tool_name || 'Unknown';
  const toolInput = body.tool_input || {};
  const cwd = body.cwd || '';
  const tty = body.tty || '';

  // Auto-create session if it doesn't exist (e.g. session-start was missed)
  if (!getSession(sessionId)) {
    addSession(sessionId, cwd, tty);
  } else if (tty) {
    updateSessionTty(sessionId, tty);
  }

  // Record the tool call before classification
  addToolCall(sessionId, toolName, toolInput);

  const { state, needsApproval } = classifyTool(toolName, toolInput);

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

  // Play notification sound so the boss knows
  try {
    execSync('afplay /System/Library/Sounds/Bottle.aiff &', { timeout: 1000 });
  } catch { /* ignore */ }

  // Needs approval — block until boss decides in the browser
  const { approval, promise } = createApproval(sessionId, toolName, toolInput);

  broadcast({
    type: 'approval-request',
    approval: {
      id: approval.id,
      sessionId: approval.sessionId,
      toolName: approval.toolName,
      toolInput: approval.toolInput,
    },
  });

  console.log(`[Hook] Awaiting approval for ${toolName} in session ${sessionId}`);
  const decision = await promise;
  console.log(`[Hook] Decision for ${toolName}: ${decision}`);

  return NextResponse.json({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: decision === 'allow' ? 'Boss approved' : 'Boss denied',
    },
  });
}
