import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

export interface WhitelistRule {
  /** 'command' for Bash commands, 'tool' for non-Bash tools */
  type: 'command' | 'tool';
  /** Exact entry — e.g. 'maestro test', 'npx tsc', 'git commit', or full tool name */
  entry: string;
  /** Human-readable label shown in the UI */
  label: string;
  /** ISO timestamp */
  addedAt: string;
}

interface WhitelistData {
  rules: WhitelistRule[];
}

const WHITELIST_PATH = path.join(process.cwd(), 'data', 'whitelist.json');

// Cache in globalThis to survive HMR
declare global {
  // eslint-disable-next-line no-var
  var __whitelist: WhitelistData | undefined;
}

function ensureDir() {
  const dir = path.dirname(WHITELIST_PATH);
  if (!existsSync(dir)) {
    const { mkdirSync } = require('fs');
    mkdirSync(dir, { recursive: true });
  }
}

function load(): WhitelistData {
  if (globalThis.__whitelist) return globalThis.__whitelist;
  try {
    const raw = readFileSync(WHITELIST_PATH, 'utf-8');
    const data = JSON.parse(raw) as WhitelistData;
    globalThis.__whitelist = data;
    return data;
  } catch {
    const data: WhitelistData = { rules: [] };
    globalThis.__whitelist = data;
    return data;
  }
}

function save(data: WhitelistData) {
  ensureDir();
  globalThis.__whitelist = data;
  writeFileSync(WHITELIST_PATH, JSON.stringify(data, null, 2) + '\n');
}

/** Get all whitelist rules. */
export function getWhitelistRules(): WhitelistRule[] {
  return load().rules;
}

/** Add a rule. Returns false if an identical entry already exists. */
export function addWhitelistRule(rule: Omit<WhitelistRule, 'addedAt'>): boolean {
  const data = load();
  if (data.rules.some(r => r.type === rule.type && r.entry === rule.entry)) {
    return false; // already exists
  }
  data.rules.push({ ...rule, addedAt: new Date().toISOString() });
  save(data);
  return true;
}

/** Remove a rule by entry. Returns true if removed. */
export function removeWhitelistRule(type: 'command' | 'tool', entry: string): boolean {
  const data = load();
  const before = data.rules.length;
  data.rules = data.rules.filter(r => !(r.type === type && r.entry === entry));
  if (data.rules.length < before) {
    save(data);
    return true;
  }
  return false;
}

/**
 * Check if a Bash command's base command is whitelisted.
 * Just matches the command name — the classifier still catches risky flags
 * (curl -d, git push, find -exec, etc.) so this is safe to be broad.
 */
export function isCommandWhitelisted(args: string[]): boolean {
  if (args.length === 0) return false;
  const data = load();
  const base = (args[0].split('/').pop() || args[0]).toLowerCase();
  return data.rules.some(r => r.type === 'command' && r.entry.toLowerCase() === base);
}

/** Check if a non-Bash tool is whitelisted. */
export function isToolWhitelisted(toolName: string): boolean {
  const data = load();
  return data.rules.some(r => r.type === 'tool' && r.entry === toolName);
}

// --- Entry extraction for the "Always Allow" button ---

/**
 * Extract a whitelist entry from a Bash command.
 * Always just the base command name. The classifier handles risky flags/subcommands,
 * so whitelisting `curl` is safe — `curl -d` still gets caught.
 */
export function extractBashEntry(command: string): { entry: string; label: string } {
  const trimmed = command.trim();
  const args = trimmed.split(/\s+/);
  const base = (args[0]?.split('/').pop() || args[0] || 'unknown').toLowerCase();
  return { entry: base, label: base };
}

/**
 * Extract a whitelist entry from a non-Bash tool.
 * For MCP tools, uses the full tool name as entry. Label is human-readable.
 */
export function extractToolEntry(toolName: string): { entry: string; label: string } {
  const mcpMatch = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (mcpMatch) {
    const server = mcpMatch[1].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const action = mcpMatch[2].replace(/[-_]+/g, ' ');
    return { entry: toolName, label: `${server}: ${action}` };
  }
  return { entry: toolName, label: toolName };
}
