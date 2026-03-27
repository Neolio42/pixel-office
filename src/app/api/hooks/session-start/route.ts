import { NextRequest, NextResponse } from 'next/server';
import { addSession, getAllSessions, removeSession, setSessionTask } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { readTaskFromTranscript } from '@/lib/transcript';
import { findPtyByTty, findPtyByCwd, linkSessionToPty } from '@/lib/pty-manager';

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    try {
      const raw = await req.text();
      const sanitized = raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
      body = JSON.parse(sanitized);
    } catch {
      body = {};
    }
  }
  const sessionId = String(body.session_id || '');
  if (!sessionId) return NextResponse.json({});
  const cwd = String(body.cwd || '');
  const tty = String(body.tty || '');
  const transcriptPath = body.transcript_path ? String(body.transcript_path) : undefined;

  const session = addSession(sessionId, cwd, tty, transcriptPath);

  // Link to embedded PTY — try tty match first, then cwd match as fallback
  let ptyEntry = tty ? findPtyByTty(tty) : undefined;
  if (!ptyEntry && cwd) {
    ptyEntry = findPtyByCwd(cwd);
  }
  if (ptyEntry) {
    linkSessionToPty(sessionId, ptyEntry.ptyId);
    session.ptyId = ptyEntry.ptyId;
    // Remove orphan sessions from previous /clear cycles on the same PTY
    for (const s of getAllSessions()) {
      if (s.sessionId !== sessionId && s.ptyId === ptyEntry.ptyId) {
        removeSession(s.sessionId);
      }
    }
  }

  broadcast({ type: 'sessions', sessions: getAllSessions() });

  console.log(`[Hook] Session started: ${sessionId}`);

  // Async: read the task from the JSONL transcript (don't block the hook response)
  if (transcriptPath) {
    readTaskFromTranscript(transcriptPath).then((task) => {
      if (task) {
        const updated = setSessionTask(sessionId, task);
        if (updated) broadcast({ type: 'session-update', session: updated });
      }
    }).catch(() => {});
  }

  return NextResponse.json({ status: 'ok' });
}
