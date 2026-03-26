#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const CLAUDE_DIR = join(homedir(), '.claude');
const BASE_URL = 'http://localhost:3000/api/hooks';
const MARKER = 'pixel-office';

// ---------- Hook registration (inlined from scripts/setup.ts) ----------

const TTY_PREFIX = [
  '[ "$PIXEL_OFFICE_HAIKU" = "1" ] && exit 0',
  'RAW_TTY=$(ps -o tty= -p $PPID 2>/dev/null | tr -d \' \')',
  '[ -n "$RAW_TTY" ] && [ "$RAW_TTY" != "??" ] && TTY="/dev/$RAW_TTY" || TTY=""',
  'INPUT=$(cat)',
].join('; ');

const SIMPLE_PREFIX = '[ "$PIXEL_OFFICE_HAIKU" = "1" ] && exit 0; INPUT=$(cat)';

function curlCmd(endpoint: string, maxTime: number, enrichTty: boolean): string {
  if (enrichTty) {
    const body = `$(echo "$INPUT" | jq -c --arg tty "$TTY" '. + {tty: $tty}' 2>/dev/null || echo "$INPUT")`;
    return `${TTY_PREFIX}; curl -sf -X POST ${BASE_URL}/${endpoint} -H 'Content-Type: application/json' -d "${body}" --max-time ${maxTime} 2>/dev/null || true`;
  }
  return `${SIMPLE_PREFIX}; curl -sf -X POST ${BASE_URL}/${endpoint} -H 'Content-Type: application/json' -d "$INPUT" --max-time ${maxTime} 2>/dev/null || true`;
}

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string; timeout: number }[];
}

const PIXEL_OFFICE_HOOKS: Record<string, HookEntry> = {
  SessionStart: { hooks: [{ type: 'command', command: curlCmd('session-start', 5, true), timeout: 5 }] },
  PreToolUse: { hooks: [{ type: 'command', command: curlCmd('pre-tool-use', 300, true), timeout: 300 }] },
  PostToolUse: { hooks: [{ type: 'command', command: curlCmd('post-tool-use', 5, false), timeout: 5 }] },
  Notification: { hooks: [{ type: 'command', command: curlCmd('notification', 5, false), timeout: 5 }] },
  UserPromptSubmit: { hooks: [{ type: 'command', command: curlCmd('user-prompt', 5, false), timeout: 5 }] },
  Stop: { hooks: [{ type: 'command', command: curlCmd('stop', 5, false), timeout: 5 }] },
  SessionEnd: { hooks: [{ type: 'command', command: curlCmd('session-end', 5, false), timeout: 5 }] },
};

function hooksRegistered(): boolean {
  if (!existsSync(SETTINGS_PATH)) return false;
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    const hooks = settings.hooks ?? {};
    return Object.values(hooks).some((entries) =>
      (entries as HookEntry[]).some((entry) =>
        entry.hooks?.some((h) => typeof h.command === 'string' && h.command.includes(MARKER))
      )
    );
  } catch {
    return false;
  }
}

function registerHooks(): void {
  mkdirSync(CLAUDE_DIR, { recursive: true });
  const settings = existsSync(SETTINGS_PATH)
    ? JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
    : {};
  const hooks = settings.hooks ?? {};

  for (const [event, entry] of Object.entries(PIXEL_OFFICE_HOOKS)) {
    const existing = hooks[event] ?? [];
    const alreadyHas = existing.some((e: HookEntry) =>
      e.hooks?.some((h: { command: string }) => h.command.includes(MARKER))
    );
    if (!alreadyHas) {
      hooks[event] = [...existing, entry];
    }
  }

  settings.hooks = hooks;
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

// ---------- Main ----------

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} ${url}`);
}

async function main(): Promise<void> {
  console.log('');
  console.log('  ┌──────────────────────────┐');
  console.log('  │      Pixel Office         │');
  console.log('  └──────────────────────────┘');
  console.log('');

  // Auto-register hooks on first run
  if (!hooksRegistered()) {
    console.log('  First run — registering Claude Code hooks...');
    registerHooks();
    console.log('  ✓ Hooks registered in ~/.claude/settings.json');
    console.log('');
  }

  // Start the server
  const { createServer } = await import('http');
  const next = (await import('next')).default;
  const { initWSS, broadcast } = await import('./src/lib/ws-server');
  const { cleanupStaleSessions, getAllSessions } = await import('./src/lib/store');
  const { getAllPtyEntries, killPty } = await import('./src/lib/pty-manager');

  const dev = process.env.NODE_ENV !== 'production';
  const port = parseInt(process.env.PORT || '3000', 10);

  const app = next({ dev, dir: __dirname });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = createServer((req, res) => {
    handle(req, res);
  });

  initWSS(server);

  // Stale session cleanup (same as server.ts)
  if (!globalThis.__staleSessionCleanup) {
    globalThis.__staleSessionCleanup = setInterval(() => {
      const isAlivePty = (ptyId: string) => {
        const e = getAllPtyEntries().find((p) => p.ptyId === ptyId);
        return !!e && !e.exited;
      };
      const removed = cleanupStaleSessions(30 * 60_000, isAlivePty);
      for (const sessionId of removed) {
        console.log(`[cleanup] Removed stale session: ${sessionId}`);
        broadcast({ type: 'session-remove', sessionId });
      }
      const activePtyIds = new Set(
        getAllSessions()
          .filter((s) => s.ptyId)
          .map((s) => s.ptyId!)
      );
      for (const entry of getAllPtyEntries()) {
        if (!activePtyIds.has(entry.ptyId) && entry.exited) {
          killPty(entry.ptyId);
          console.log(`[cleanup] Removed orphaned PTY: ${entry.ptyId}`);
        }
      }
    }, 5 * 60_000);
  }

  server.listen(port, () => {
    console.log(`  ✓ Ready on http://localhost:${port}`);
    console.log('  Open a Claude Code terminal — a worker will appear.');
    console.log('');
    openBrowser(`http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start Pixel Office:', err);
  process.exit(1);
});
