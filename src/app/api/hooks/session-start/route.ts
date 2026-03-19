import { NextRequest, NextResponse } from 'next/server';
import { addSession, getAllSessions, removeSession, setSessionTask } from '@/lib/store';
import { broadcast } from '@/lib/ws-server';
import { readTaskFromTranscript } from '@/lib/transcript';
import { findPtyByTty, findPtyByCwd, linkSessionToPty } from '@/lib/pty-manager';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const sessionId = body.session_id;
  const cwd = body.cwd || '';
  const tty = body.tty || '';
  const transcriptPath = body.transcript_path || undefined;

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
