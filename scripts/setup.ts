import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const CLAUDE_DIR = join(homedir(), '.claude');
const BASE_URL = 'http://localhost:3000/api/hooks';
const MARKER = 'pixel-office'; // used to identify our hooks

// TTY enrichment prefix — detects the terminal device for session linking
const TTY_PREFIX = [
  '[ "$PIXEL_OFFICE_HAIKU" = "1" ] && exit 0',
  'RAW_TTY=$(ps -o tty= -p $PPID 2>/dev/null | tr -d \' \')',
  '[ -n "$RAW_TTY" ] && [ "$RAW_TTY" != "??" ] && TTY="/dev/$RAW_TTY" || TTY=""',
  'INPUT=$(cat)',
].join('; ');

// Simple prefix — just read stdin and bail if disabled
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
  SessionStart: {
    hooks: [{ type: 'command', command: curlCmd('session-start', 5, true), timeout: 5 }],
  },
  PreToolUse: {
    hooks: [{ type: 'command', command: curlCmd('pre-tool-use', 300, true), timeout: 300 }],
  },
  PostToolUse: {
    hooks: [{ type: 'command', command: curlCmd('post-tool-use', 5, false), timeout: 5 }],
  },
  Notification: {
    hooks: [{ type: 'command', command: curlCmd('notification', 5, false), timeout: 5 }],
  },
  UserPromptSubmit: {
    hooks: [{ type: 'command', command: curlCmd('user-prompt', 5, false), timeout: 5 }],
  },
  Stop: {
    hooks: [{ type: 'command', command: curlCmd('stop', 5, false), timeout: 5 }],
  },
  SessionEnd: {
    hooks: [{ type: 'command', command: curlCmd('session-end', 5, false), timeout: 5 }],
  },
};

function readSettings(): Record<string, unknown> {
  if (!existsSync(SETTINGS_PATH)) {
    mkdirSync(CLAUDE_DIR, { recursive: true });
    return {};
  }
  return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
}

function writeSettings(settings: Record<string, unknown>): void {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}

function hasPixelOfficeHook(entries: HookEntry[]): boolean {
  return entries.some((entry) =>
    entry.hooks?.some((h) => typeof h.command === 'string' && h.command.includes(MARKER))
  );
}

// --- Install ---
function install(): void {
  const settings = readSettings();
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  let added = 0;
  let updated = 0;

  for (const [event, entry] of Object.entries(PIXEL_OFFICE_HOOKS)) {
    const existing = hooks[event] ?? [];
    if (hasPixelOfficeHook(existing)) {
      // Replace existing pixel-office hook with the latest version
      hooks[event] = [...existing.filter(
        (e) => !e.hooks?.some((h) => typeof h.command === 'string' && h.command.includes(MARKER))
      ), entry];
      console.log(`  ↻  ${event} — updated`);
      updated++;
      continue;
    }
    hooks[event] = [...existing, entry];
    console.log(`  ✓  ${event}`);
    added++;
  }

  settings.hooks = hooks;
  writeSettings(settings);

  if (added === 0 && updated === 0) {
    console.log('\nAll hooks already up to date. Nothing to do.');
  } else {
    if (added > 0) console.log(`\n${added} hook(s) added`);
    if (updated > 0) console.log(`${updated} hook(s) updated`);
    console.log(`Written to ${SETTINGS_PATH}`);
  }

  console.log('\nStart Pixel Office:  npm run dev');
  console.log('Open:                http://localhost:3000');
  console.log('Then start any Claude Code session — a worker will appear.\n');
}

// --- Uninstall ---
function uninstall(): void {
  if (!existsSync(SETTINGS_PATH)) {
    console.log('No settings file found. Nothing to remove.');
    return;
  }

  const settings = readSettings();
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  let removed = 0;

  for (const event of Object.keys(hooks)) {
    const before = hooks[event].length;
    hooks[event] = hooks[event].filter(
      (entry) => !entry.hooks?.some((h) => typeof h.command === 'string' && h.command.includes(MARKER))
    );
    const diff = before - hooks[event].length;
    if (diff > 0) {
      console.log(`  ✓  ${event} — removed`);
      removed += diff;
    }
    // Clean up empty arrays
    if (hooks[event].length === 0) {
      delete hooks[event];
    }
  }

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooks;
  }

  writeSettings(settings);

  if (removed === 0) {
    console.log('No Pixel Office hooks found. Nothing to remove.');
  } else {
    console.log(`\n${removed} hook(s) removed from ${SETTINGS_PATH}`);
  }
}

// --- CLI ---
const cmd = process.argv[2];

console.log('\n  Pixel Office — Hook Manager\n');

if (cmd === 'uninstall') {
  uninstall();
} else {
  install();
}
