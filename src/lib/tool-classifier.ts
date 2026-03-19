import { WorkerState } from './types';
import { execSync } from 'child_process';

interface Classification {
  state: WorkerState;
  needsApproval: boolean;
}

const READING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ToolSearch']);
const TYPING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Agent', 'TodoWrite', 'AskUserQuestion', 'Skill', 'EnterPlanMode', 'ExitPlanMode']);

// Commands that are always safe regardless of arguments
const SAFE_COMMANDS = new Set([
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq',
  'date', 'whoami', 'which', 'type', 'file', 'stat', 'du', 'df',
  'grep', 'rg', 'find', 'sed', 'awk', 'tr', 'cut', 'paste',
  'node', 'npx', 'pnpm', 'yarn', 'bun', 'deno',
  'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'mocha', 'playwright',
  'python', 'python3', 'cargo', 'go', 'rustc', 'gcc', 'g++', 'make', 'cmake',
  'mkdir', 'cp', 'mv', 'touch', 'ln',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  'curl', 'wget', 'http',
  'jq', 'yq', 'xargs', 'tee', 'diff', 'patch',
  'docker', 'brew', 'apt', 'apk',
  'sleep', 'true', 'false', 'test', '[',
  'printf', 'read', 'set', 'export', 'source', '.',
  'cd', 'pushd', 'popd', 'dirs',
  'shfmt', 'shellcheck',
]);

// Git subcommands that are safe (read-only or local-only)
const SAFE_GIT = new Set([
  'status', 'log', 'diff', 'add', 'commit', 'branch', 'show',
  'stash', 'fetch', 'checkout', 'switch', 'merge', 'rebase',
  'tag', 'blame', 'bisect', 'cherry-pick', 'am', 'format-patch',
  'rev-parse', 'ls-files', 'ls-tree', 'config', 'remote',
  'describe', 'shortlog', 'reflog', 'worktree',
]);

// npm/pip subcommands that are safe
const SAFE_NPM = new Set(['run', 'test', 'start', 'build', 'exec', 'init', 'info', 'ls', 'list', 'outdated', 'audit', 'pack', 'version', 'why']);

// Commands that need boss approval (not auto-deny — boss decides)
const RISKY_COMMANDS = new Set([
  'rm', 'rmdir', 'sudo', 'su',
  'chmod', 'chown', 'chgrp',
  'dd', 'mkfs', 'fdisk',
  'reboot', 'shutdown', 'halt', 'poweroff',
  'iptables', 'ufw', 'systemctl',
]);

// Shell metacharacters that indicate compound commands
const COMPOUND_CHARS = /[|&;$`(){}]/;

/**
 * Extract all command names from a compound bash command using shfmt AST.
 * Returns null if shfmt isn't available or parsing fails (fallback to simple).
 */
function extractCommandsViaAST(command: string): string[][] | null {
  try {
    const ast = execSync(
      `echo ${JSON.stringify(command)} | shfmt --tojson 2>/dev/null`,
      { encoding: 'utf-8', timeout: 2000 }
    );
    const parsed = JSON.parse(ast);

    // Recursively extract all CallExpr nodes — each is a command invocation
    const commands: string[][] = [];

    function walk(node: unknown): void {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;

      if (obj.Type === 'CallExpr' && Array.isArray(obj.Args)) {
        // Extract all argument parts as a single command line
        const args: string[] = [];
        for (const arg of obj.Args as Array<{ Parts?: Array<{ Value?: string }> }>) {
          if (arg.Parts) {
            for (const part of arg.Parts) {
              if (part.Value) args.push(part.Value);
            }
          }
        }
        if (args.length > 0) commands.push(args);
      }

      // Recurse into all object values and arrays
      for (const value of Object.values(obj)) {
        if (Array.isArray(value)) {
          for (const item of value) walk(item);
        } else if (typeof value === 'object' && value !== null) {
          walk(value);
        }
      }
    }

    walk(parsed);
    return commands.length > 0 ? commands : null;
  } catch {
    return null;
  }
}

/**
 * Check if a single command (as array of args) is risky.
 * Returns 'safe', 'risky', or 'unknown'.
 */
function classifySingleCommand(args: string[]): 'safe' | 'risky' | 'unknown' {
  const cmd = args[0];
  if (!cmd) return 'unknown';

  // Strip path prefix (e.g., /usr/bin/ls → ls)
  const base = cmd.split('/').pop() || cmd;

  // Check deny list first (deny > allow)
  if (RISKY_COMMANDS.has(base)) return 'risky';

  // Git: find the subcommand (skip flags like -C, --no-pager, etc.)
  if (base === 'git') {
    // Git flags that take a value argument: skip both the flag and its value
    const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
    let sub: string | undefined;
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (GIT_VALUE_FLAGS.has(a)) { i++; continue; } // skip flag + its value
      if (a.startsWith('-')) continue; // skip other flags (--no-pager, --bare, etc.)
      sub = a;
      break;
    }
    if (!sub) return 'safe'; // bare `git` is fine
    if (sub === 'push') return 'risky';
    if (sub === 'reset' && args.includes('--hard')) return 'risky';
    if (sub === 'clean' && args.includes('-f')) return 'risky';
    if (SAFE_GIT.has(sub)) return 'safe';
    return 'unknown';
  }

  // npm/pip: check subcommand
  if (base === 'npm' || base === 'pip' || base === 'pip3') {
    const sub = args[1];
    if (sub === 'install' || sub === 'i' || sub === 'uninstall' || sub === 'remove') return 'risky';
    if (base === 'npm' && SAFE_NPM.has(sub || '')) return 'safe';
    return 'unknown';
  }

  // Check --force / --no-verify flags on any command
  if (args.some(a => a === '--force' || a === '--no-verify' || a === '-f' && base === 'git')) {
    return 'risky';
  }

  // Bash/sh -c: the inner command matters, not the shell itself
  if ((base === 'bash' || base === 'sh' || base === 'zsh') && args.includes('-c')) {
    return 'unknown'; // can't easily parse the inner command
  }

  // Check safe list
  if (SAFE_COMMANDS.has(base)) return 'safe';

  return 'unknown';
}

/**
 * Classify a bash command — uses shfmt AST for compound commands,
 * simple parsing for single commands.
 */
function classifyBashCommand(command: string): { needsApproval: boolean } {
  const trimmed = command.trim();

  // For compound commands, try AST parsing
  if (COMPOUND_CHARS.test(trimmed)) {
    const commands = extractCommandsViaAST(trimmed);

    if (commands) {
      // Deny > Allow: if ANY command is risky, the whole thing is risky
      let allSafe = true;
      for (const args of commands) {
        const result = classifySingleCommand(args);
        if (result !== 'safe') {
          allSafe = false;
          break;
        }
      }
      return { needsApproval: !allSafe };
    }
    // shfmt failed — fall through to simple parsing
  }

  // Simple command — split on whitespace
  const args = trimmed.split(/\s+/);
  const result = classifySingleCommand(args);
  return { needsApproval: result !== 'safe' };
}

export function classifyTool(toolName: string, toolInput: Record<string, unknown>): Classification {
  // MCP tools — auto-approve all (browser automation, ClickUp, calendar, etc.)
  if (toolName.startsWith('mcp__')) {
    return { state: 'typing', needsApproval: false };
  }

  if (READING_TOOLS.has(toolName)) {
    return { state: 'reading', needsApproval: false };
  }

  if (TYPING_TOOLS.has(toolName)) {
    return { state: 'typing', needsApproval: false };
  }

  if (AGENT_TOOLS.has(toolName)) {
    return { state: 'typing', needsApproval: false };
  }

  if (toolName === 'Bash' || toolName === 'BashOutput') {
    const command = String(toolInput.command || '');
    const { needsApproval } = classifyBashCommand(command);
    return {
      state: needsApproval ? 'waiting' : 'typing',
      needsApproval,
    };
  }

  // Unknown tool — needs approval
  return { state: 'waiting', needsApproval: true };
}
