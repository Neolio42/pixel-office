#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFile } from 'child_process';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const CLAUDE_DIR = join(homedir(), '.claude');
const SOCKET_PATH = '/tmp/pixel-office.sock';
const MARKER = 'pixel-office';
// Old hooks used PIXEL_OFFICE_HAIKU (underscores) before the unix-socket migration
const OLD_MARKER = 'PIXEL_OFFICE_HAIKU';

// ---------- Hook registration (inlined from scripts/setup.ts) ----------

function curlCmd(endpoint: string, maxTime: number, enrichTty: boolean): string {
  const curlBase = `curl -sf -X POST --unix-socket ${SOCKET_PATH} http://localhost/api/hooks/${endpoint} -H 'Content-Type: application/json'`;
  if (enrichTty) {
    // Write stdin to tempfile to avoid echo/printf mangling backslash sequences (zsh XSI mode).
    // jq enriches with tty; falls back to raw file if jq fails (e.g. control chars in bash commands).
    return [
      '[ "$PIXEL_OFFICE_HAIKU" = "1" ] && exit 0',
      'T=$(mktemp)',
      `RAW_TTY=$(ps -o tty= -p $PPID 2>/dev/null | tr -d ' ')`,
      `[ -n "$RAW_TTY" ] && [ "$RAW_TTY" != "??" ] && TTY="/dev/$RAW_TTY" || TTY=""`,
      'cat>"$T"',
      `(jq -c --arg tty "$TTY" '. + {tty: $tty}' <"$T" 2>/dev/null || cat "$T") | ${curlBase} --data-binary @- --max-time ${maxTime} 2>/dev/null`,
      'rm -f "$T"',
      'true',
    ].join('; ');
  }
  return [
    '[ "$PIXEL_OFFICE_HAIKU" = "1" ] && exit 0',
    'T=$(mktemp)',
    'cat>"$T"',
    `${curlBase} --data-binary @"$T" --max-time ${maxTime} 2>/dev/null`,
    'rm -f "$T"',
    'true',
  ].join('; ');
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

function isPixelOfficeHook(command: string): boolean {
  return command.includes(MARKER) || command.includes(OLD_MARKER);
}

function hooksRegistered(): boolean {
  if (!existsSync(SETTINGS_PATH)) return false;
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    const hooks = settings.hooks ?? {};
    return Object.values(hooks).some((entries) =>
      (entries as HookEntry[]).some((entry) =>
        entry.hooks?.some((h) => typeof h.command === 'string' && isPixelOfficeHook(h.command))
      )
    );
  } catch {
    return false;
  }
}

function hooksNeedUpdate(): boolean {
  if (!existsSync(SETTINGS_PATH)) return false;
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    const hooks = settings.hooks ?? {};
    return Object.values(hooks).some((entries) =>
      (entries as HookEntry[]).some((entry) =>
        entry.hooks?.some((h) =>
          typeof h.command === 'string' &&
          isPixelOfficeHook(h.command) &&
          h.command.includes('localhost:3000') &&
          !h.command.includes('--unix-socket')
        )
      )
    );
  } catch {
    return false;
  }
}

function removeOldHooks(): void {
  if (!existsSync(SETTINGS_PATH)) return;
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    const hooks = settings.hooks ?? {};

    for (const [event, entries] of Object.entries(hooks)) {
      hooks[event] = (entries as HookEntry[]).filter((entry) =>
        !entry.hooks?.some((h) =>
          typeof h.command === 'string' &&
          isPixelOfficeHook(h.command) &&
          h.command.includes('localhost:3000')
        )
      );
    }

    settings.hooks = hooks;
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  } catch {
    return;
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
  execFile(cmd, [url], () => {});
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
  } else if (hooksNeedUpdate()) {
    console.log('  Updating hooks to use Unix socket...');
    removeOldHooks();
    registerHooks();
    console.log('  ✓ Hooks updated in ~/.claude/settings.json');
    console.log('');
  }

  // Start the server
  const { createServer } = await import('http');
  const next = (await import('next')).default;
  const { initWSS } = await import('./src/lib/ws-server');
  const { startStaleSessionCleanup } = await import('./src/lib/cleanup');

  const dev = process.env.NODE_ENV !== 'production';
  const port = parseInt(process.env.PORT || '3000', 10);

  const app = next({ dev, dir: __dirname });
  const handle = app.getRequestHandler();

  await app.prepare();

  const server = createServer((req, res) => {
    handle(req, res);
  });

  initWSS(server);

  startStaleSessionCleanup();

  server.listen(port, '127.0.0.1', () => {
    console.log(`  ✓ Ready on http://localhost:${port}`);
    console.log('  Open a Claude Code terminal — a worker will appear.');
    console.log('');
    openBrowser(`http://localhost:${port}`);
  });

  // Unix socket for hooks
  const hookServer = createServer((req, res) => { handle(req, res); });
  if (existsSync(SOCKET_PATH)) {
    try { unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
  }
  hookServer.listen(SOCKET_PATH, () => {
    console.log(`  ✓ Hook socket at ${SOCKET_PATH}`);
  });

  function cleanup() {
    try { unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
    process.exit(0);
  }
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('Failed to start Pixel Office:', err);
  process.exit(1);
});
