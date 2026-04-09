import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

export interface PatternRule {
  pattern: string;
  action: 'allow' | 'deny';
  label: string;
  addedAt: string;
}

interface RulesData {
  rules: PatternRule[];
}

const RULES_PATH = path.join(process.cwd(), 'data', 'rules.json');
const OLD_WHITELIST_PATH = path.join(process.cwd(), 'data', 'whitelist.json');

declare global {
  // eslint-disable-next-line no-var
  var __rules: RulesData | undefined;
}

function ensureDir() {
  const dir = path.dirname(RULES_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Migrate old whitelist.json to rules.json on first load */
function migrateFromWhitelist(): RulesData {
  if (!existsSync(OLD_WHITELIST_PATH)) return { rules: [] };
  try {
    const raw = readFileSync(OLD_WHITELIST_PATH, 'utf-8');
    const old = JSON.parse(raw) as { rules: Array<{ type: string; entry: string; label: string; addedAt: string }> };
    const rules: PatternRule[] = old.rules.map(r => ({
      pattern: r.entry,
      action: 'allow' as const,
      label: r.label,
      addedAt: r.addedAt,
    }));
    return { rules };
  } catch {
    return { rules: [] };
  }
}

function load(): RulesData {
  if (globalThis.__rules) return globalThis.__rules;
  try {
    const raw = readFileSync(RULES_PATH, 'utf-8');
    const data = JSON.parse(raw) as RulesData;
    globalThis.__rules = data;
    return data;
  } catch {
    // First load — try migration
    const data = migrateFromWhitelist();
    globalThis.__rules = data;
    if (data.rules.length > 0) {
      save(data); // Persist migrated rules
    }
    return data;
  }
}

function save(data: RulesData) {
  ensureDir();
  globalThis.__rules = data;
  writeFileSync(RULES_PATH, JSON.stringify(data, null, 2) + '\n');
}

export function getRules(): PatternRule[] {
  return load().rules;
}

export function addRule(rule: Omit<PatternRule, 'addedAt'>): boolean {
  const normalized = { ...rule, pattern: rule.pattern.toLowerCase() };
  const data = load();
  if (data.rules.some(r => r.pattern === normalized.pattern && r.action === normalized.action)) {
    return false;
  }
  data.rules.push({ ...normalized, addedAt: new Date().toISOString() });
  save(data);
  return true;
}

export function removeRule(pattern: string, action: 'allow' | 'deny'): boolean {
  const data = load();
  const before = data.rules.length;
  data.rules = data.rules.filter(r => !(r.pattern === pattern && r.action === action));
  if (data.rules.length < before) {
    save(data);
    return true;
  }
  return false;
}

/**
 * Check a command against pattern rules.
 * Returns 'allow', 'deny', or null (no match — fall through to built-in classifier).
 *
 * Priority: deny > allow. Longest matching prefix wins within each action type.
 */
export function matchRule(command: string): 'allow' | 'deny' | null {
  const data = load();
  const normalized = command.toLowerCase().trim();

  let bestDeny: PatternRule | null = null;
  let bestAllow: PatternRule | null = null;

  for (const rule of data.rules) {
    const pat = rule.pattern.toLowerCase();
    // Check full command prefix
    if (normalized === pat || normalized.startsWith(pat + ' ') || normalized.startsWith(pat + '\t')) {
      if (rule.action === 'deny') {
        if (!bestDeny || pat.length > bestDeny.pattern.length) bestDeny = rule;
      } else {
        if (!bestAllow || pat.length > bestAllow.pattern.length) bestAllow = rule;
      }
      continue;
    }
    // Check individual segments of compound commands
    const segments = normalized.split(/\s*(?:&&|\|\||[;|])\s*/);
    for (const seg of segments) {
      const trimmed = seg.trim();
      if (trimmed === pat || trimmed.startsWith(pat + ' ') || trimmed.startsWith(pat + '\t')) {
        if (rule.action === 'deny') {
          if (!bestDeny || pat.length > bestDeny.pattern.length) bestDeny = rule;
        } else {
          if (!bestAllow || pat.length > bestAllow.pattern.length) bestAllow = rule;
        }
        break;
      }
    }
  }

  // Deny wins over allow
  if (bestDeny) return 'deny';
  if (bestAllow) return 'allow';
  return null;
}

/**
 * Match a non-Bash tool name against rules.
 * Tool names are matched exactly (not prefix).
 */
export function matchToolRule(toolName: string): 'allow' | 'deny' | null {
  const data = load();
  // Check deny first
  if (data.rules.some(r => r.action === 'deny' && r.pattern === toolName)) return 'deny';
  if (data.rules.some(r => r.action === 'allow' && r.pattern === toolName)) return 'allow';
  return null;
}
