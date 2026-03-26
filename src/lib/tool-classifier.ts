import { WorkerState } from './types';
import { execFileSync } from 'child_process';

export type ClassificationReason = 'safe' | 'risky' | 'unknown';

interface Classification {
  state: WorkerState;
  needsApproval: boolean;
  reason: ClassificationReason;
}

const READING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'ToolSearch']);
const TYPING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set([
  'Agent', 'TodoWrite', 'AskUserQuestion', 'Skill', 'EnterPlanMode', 'ExitPlanMode',
  'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop',
]);

// Commands that are always safe regardless of arguments
const SAFE_COMMANDS = new Set([
  'ls', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq',
  'date', 'whoami', 'which', 'type', 'file', 'stat', 'du', 'df',
  'grep', 'rg', 'find', 'sed', 'awk', 'tr', 'cut', 'paste',
  'node', 'deno',
  'tsc', 'eslint', 'prettier', 'jest', 'vitest', 'mocha', 'playwright',
  'python', 'python3', 'cargo', 'go', 'rustc', 'gcc', 'g++', 'make', 'cmake',
  'mkdir', 'touch', 'ln',
  'tar', 'zip', 'unzip', 'gzip', 'gunzip',
  'jq', 'yq', 'xargs', 'tee', 'diff', 'patch',
  'curl', 'wget', 'http',
  'sleep', 'true', 'false', 'test', '[',
  'printf', 'read', 'set', 'export', 'source', '.',
  'cd', 'pushd', 'popd', 'dirs',
  'shfmt', 'shellcheck',
  'xcodebuild', 'xcrun', 'xcode-select', 'xcresulttool',
  'simctl', 'swift', 'swiftc', 'swift-format', 'swift-demangle',
  'instruments', 'lipo', 'otool', 'nm', 'dsymutil', 'dwarfdump',
  'plutil', 'defaults', 'codesign', 'security',
  'xctrace', 'actool', 'ibtool',
]);

// Git subcommands that are safe (read-only or local-only, no destructive flags)
const SAFE_GIT = new Set([
  'status', 'log', 'diff', 'add', 'show',
  'fetch',
  'blame', 'bisect', 'format-patch',
  'rev-parse', 'ls-files', 'ls-tree', 'remote',
  'describe', 'shortlog', 'reflog', 'worktree',
]);

// npm/pip subcommands that are safe
const SAFE_NPM = new Set(['run', 'test', 'start', 'build', 'init', 'info', 'ls', 'list', 'outdated', 'audit', 'pack', 'version', 'why']);

// Docker subcommands that are safe (read-only)
const SAFE_DOCKER = new Set(['ps', 'images', 'inspect', 'logs', 'stats', 'version', 'info', 'pull', 'network', 'volume', 'context', 'buildx', 'compose', 'top', 'port', 'diff', 'history']);

// Brew subcommands that are safe (read-only)
const SAFE_BREW = new Set(['list', 'ls', 'info', 'search', 'home', 'deps', 'uses', 'leaves', 'outdated', 'doctor', 'config', 'desc', 'cat', 'log', 'pin', 'unpin', 'tap', 'untap']);

// Commands that need boss approval (not auto-deny — boss decides)
const RISKY_COMMANDS = new Set([
  'rm', 'rmdir', 'sudo', 'su',
  'chmod', 'chown', 'chgrp',
  'dd', 'mkfs', 'fdisk',
  'reboot', 'shutdown', 'halt', 'poweroff',
  'iptables', 'ufw', 'systemctl',
  'npx',
]);

// Shell metacharacters that indicate compound commands
// Includes \n (statement separator) and < (heredocs)
const COMPOUND_CHARS = /[|&;$`(){}<>\n]/;

/**
 * Extract all command names from a compound bash command using shfmt AST.
 * Returns null if shfmt isn't available or parsing fails.
 */
function extractCommandsViaAST(command: string): string[][] | null {
  try {
    // Pass command via stdin to avoid shell injection
    const stdout = execFileSync('shfmt', ['--tojson'], {
      input: command,
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(stdout);

    // Recursively extract all CallExpr nodes — each is a command invocation
    const commands: string[][] = [];

    function walk(node: unknown): void {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;

      if (obj.Type === 'CallExpr' && Array.isArray(obj.Args)) {
        // Extract all argument parts as a single command line
        const args: string[] = [];
        for (const arg of obj.Args as Array<{ Parts?: Array<{ Value?: string; Type?: string }> }>) {
          if (arg.Parts) {
            for (const part of arg.Parts) {
              // ParamExp (variable expansion like $CMD) — can't know the value,
              // so mark it explicitly so classifySingleCommand returns 'unknown'
              if (part.Type === 'ParamExp') {
                args.push('$__VAR_EXPANSION__');
              } else if (part.Value) {
                args.push(part.Value);
              }
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
function classifySingleCommand(args: string[]): ClassificationReason {
  const cmd = args[0];
  if (!cmd) return 'unknown';

  // Strip path prefix (e.g., /usr/bin/ls → ls)
  const base = cmd.split('/').pop() || cmd;

  // Variable expansion — can't know what it resolves to
  if (base.startsWith('$') || base === '__VAR_EXPANSION__') return 'unknown';

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
    // git clean with -f anywhere in flags (including combined like -fd, -fdx)
    if (sub === 'clean' && args.some(a => a.startsWith('-') && !a.startsWith('--') && a.includes('f'))) return 'risky';
    if (SAFE_GIT.has(sub)) return 'safe';
    return 'unknown';
  }

  // npm/pip: check subcommand
  if (base === 'npm' || base === 'pip' || base === 'pip3') {
    const sub = args[1];
    if (sub === 'install' || sub === 'i' || sub === 'uninstall' || sub === 'remove' || sub === 'exec' || sub === 'x' || sub === 'publish') return 'risky';
    if (base === 'npm' && SAFE_NPM.has(sub || '')) return 'safe';
    return 'unknown';
  }

  // pnpm/yarn/bun: check subcommand
  if (base === 'pnpm' || base === 'yarn' || base === 'bun') {
    const sub = args[1];
    if (sub === 'add' || sub === 'install' || sub === 'i' || sub === 'remove' || sub === 'uninstall'
        || sub === 'dlx' || sub === 'exec' || sub === 'x' || sub === 'publish') return 'risky';
    if (sub === 'run' || sub === 'test' || sub === 'build' || sub === 'start'
        || sub === 'info' || sub === 'list' || sub === 'ls' || sub === 'why'
        || sub === 'outdated' || sub === 'audit') return 'safe';
    return 'unknown';
  }

  // Docker: check subcommand
  if (base === 'docker') {
    const sub = args[1];
    if (SAFE_DOCKER.has(sub || '')) return 'safe';
    return 'unknown';
  }

  // Brew: check subcommand
  if (base === 'brew') {
    const sub = args[1];
    if (sub === 'install' || sub === 'uninstall' || sub === 'remove' || sub === 'upgrade') return 'risky';
    if (SAFE_BREW.has(sub || '')) return 'safe';
    return 'unknown';
  }

  // apt/apk: check subcommand
  if (base === 'apt' || base === 'apt-get' || base === 'apk') {
    const sub = args[1];
    if (sub === 'list' || sub === 'show' || sub === 'search' || sub === 'info' || sub === 'depends') return 'safe';
    return 'risky'; // install, remove, purge, upgrade, etc.
  }

  // Check --force / --no-verify flags on any command
  // Note: -f only risky for git (for other commands like `ls -f` it's harmless)
  if (args.some(a => a === '--force' || a === '--no-verify' || (a === '-f' && base === 'git'))) {
    return 'risky';
  }

  // Bash/sh -c: the inner command matters, not the shell itself
  if ((base === 'bash' || base === 'sh' || base === 'zsh') && args.includes('-c')) {
    return 'unknown'; // can't easily parse the inner command
  }

  // cp/mv — can overwrite files, but are common enough to allow
  // (rm is the destructive one in RISKY_COMMANDS)
  if (base === 'cp' || base === 'mv') return 'safe';

  // Check safe list
  if (SAFE_COMMANDS.has(base)) return 'safe';

  return 'unknown';
}

/**
 * Classify a bash command — uses shfmt AST for compound commands,
 * simple parsing for single commands.
 */
function classifyBashCommand(command: string): { needsApproval: boolean; reason: ClassificationReason } {
  const trimmed = command.trim();

  // Strip quoted strings before checking for compound chars —
  // e.g. jq '.foo | keys' has a pipe inside quotes, not a shell pipe
  const unquoted = trimmed.replace(/'[^']*'/g, '""').replace(/"[^"]*"/g, '""');

  // For compound commands, try AST parsing
  if (COMPOUND_CHARS.test(unquoted)) {
    const commands = extractCommandsViaAST(trimmed);

    if (commands) {
      // Deny > Allow: if ANY command is risky or unknown, the whole thing needs approval
      let worstReason: ClassificationReason = 'safe';
      for (const args of commands) {
        const result = classifySingleCommand(args);
        if (result === 'risky') return { needsApproval: true, reason: 'risky' };
        if (result === 'unknown') worstReason = 'unknown';
      }
      return { needsApproval: worstReason !== 'safe', reason: worstReason };
    }
    // shfmt failed on a compound command — can't trust whitespace splitting
    // (e.g. "safe_cmd; rm -rf /" would only check safe_cmd). Default to risky.
    return { needsApproval: true, reason: 'unknown' };
  }

  // Simple command — split on whitespace
  const args = trimmed.split(/\s+/);
  const reason = classifySingleCommand(args);
  return { needsApproval: reason !== 'safe', reason };
}

// MCP tool patterns — checked anywhere in the action name (not just start)
// because many MCP tools prefix actions with their server name (e.g. gmail_create_draft, n8n_delete_workflow)
const SAFE_MCP_ACTIONS = /(^|_)(get|list|read|find|search|describe|show|view|count|check|fetch|browse|tabs_context)(_|$)/;
const RISKY_MCP_ACTIONS = /(^|_)(delete|remove|drop|destroy|execute|javascript|computer|send|create|update|modify|edit|write|upload|publish)(_|$)/;

export function classifyTool(toolName: string, toolInput: Record<string, unknown>): Classification {
  // MCP tools — classify by action pattern instead of blanket approve
  if (toolName.startsWith('mcp__')) {
    const actionMatch = toolName.match(/^mcp__[^_]+(?:_[^_]+)*__(.+)$/);
    const action = actionMatch ? actionMatch[1] : '';

    // Check risky FIRST — a tool like "get_and_delete_resource" should be risky, not safe
    if (RISKY_MCP_ACTIONS.test(action)) {
      return { state: 'waiting', needsApproval: true, reason: 'risky' };
    }
    if (SAFE_MCP_ACTIONS.test(action)) {
      return { state: 'reading', needsApproval: false, reason: 'safe' };
    }
    // Unknown MCP action — auto-approve with 'unknown' reason
    // (most MCP tools are benign, and requiring approval for all would be noisy)
    return { state: 'typing', needsApproval: false, reason: 'unknown' };
  }

  if (READING_TOOLS.has(toolName)) {
    return { state: 'reading', needsApproval: false, reason: 'safe' };
  }

  if (TYPING_TOOLS.has(toolName)) {
    return { state: 'typing', needsApproval: false, reason: 'safe' };
  }

  if (AGENT_TOOLS.has(toolName)) {
    return { state: 'typing', needsApproval: false, reason: 'safe' };
  }

  if (toolName === 'Bash' || toolName === 'BashOutput') {
    const command = String(toolInput.command || '');
    const { needsApproval, reason } = classifyBashCommand(command);
    return {
      state: needsApproval ? 'waiting' : 'typing',
      needsApproval,
      reason,
    };
  }

  // Unknown tool — needs approval
  return { state: 'waiting', needsApproval: true, reason: 'unknown' };
}
