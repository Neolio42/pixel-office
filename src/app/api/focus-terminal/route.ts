import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { getSession } from '@/lib/store';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sessionId } = body;

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const tty = session.tty; // e.g. /dev/ttys003

  try {
    if (tty) {
      // Match iTerm2 session by tty — this is the exact terminal
      const script = `
tell application "iTerm2"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        set sessionTTY to tty of s
        if sessionTTY is "${tty}" then
          select t
          select s
          set index of w to 1
          return "found"
        end if
      end repeat
    end repeat
  end repeat
end tell
return "not_found"
`;

      const result = execSync('osascript -', {
        input: script,
        encoding: 'utf-8',
        timeout: 3000,
      }).trim();

      if (result === 'found') {
        return NextResponse.json({ ok: true, cwd: session.cwd, tty, matched: true });
      }
    }

    // Fallback: just activate iTerm2
    execSync('osascript -e \'tell application "iTerm2" to activate\'', { timeout: 2000 });
    return NextResponse.json({ ok: true, cwd: session.cwd, tty, matched: false });
  } catch {
    try {
      execSync('osascript -e \'tell application "iTerm2" to activate\'', { timeout: 2000 });
    } catch {
      // iTerm2 not running
    }
    return NextResponse.json({ ok: true, cwd: session.cwd, tty, matched: false });
  }
}
