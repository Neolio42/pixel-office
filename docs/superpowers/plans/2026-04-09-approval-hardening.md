# Approval Hardening & Production Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken "always allow" system with prefix-matching pattern rules, add Unix socket transport for hooks, add iTerm panel reply-with-instructions and settings page.

**Architecture:** Replace the base-command whitelist with a deny > allow > built-in classifier priority chain using prefix-matching patterns. Add a Unix domain socket listener alongside the existing TCP listener so hooks never hit port conflicts. Add a settings sub-page to the iTerm panel for managing rules.

**Tech Stack:** Next.js 16, React 19, TypeScript, WebSocket (ws), Unix domain sockets (Node `net`)

**Spec:** `docs/superpowers/specs/2026-04-09-approval-hardening-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/rules.ts` | Create | Pattern-based allow/deny rules: CRUD, prefix matching, migration from old whitelist |
| `src/lib/whitelist.ts` | Delete | Replaced by `rules.ts` |
| `src/lib/tool-classifier.ts` | Modify | Insert pattern matching at top of `classifyTool()` before built-in rules |
| `src/lib/types.ts` | Modify | Add `pattern` field to `always-allow` WS message, add `rules-updated` WS message |
| `src/lib/ws-server.ts` | Modify | Update `always-allow` handler to accept pattern, use new rules module |
| `src/app/api/whitelist/route.ts` | Modify → rename to `src/app/api/rules/route.ts` | CRUD API for pattern rules |
| `src/app/iterm-panel/page.tsx` | Modify | Add granularity picker to "always allow", add reply-with-instructions input |
| `src/app/iterm-panel/settings/page.tsx` | Create | Settings page for managing allow/deny patterns |
| `server.ts` | Modify | Add Unix socket listener, remove `detect-port` |
| `bin.ts` | Modify | Update hook registration to use `--unix-socket`, add Unix socket listener |
| `package.json` | Modify | Remove `detect-port`, add `serve` script |

---

### Task 1: Pattern Rules Module (`src/lib/rules.ts`)

**Files:**
- Create: `src/lib/rules.ts`
- Delete: `src/lib/whitelist.ts`

- [ ] **Step 1: Create `src/lib/rules.ts` with PatternRule type and storage**

```typescript
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
  const data = load();
  if (data.rules.some(r => r.pattern === rule.pattern && r.action === rule.action)) {
    return false;
  }
  data.rules.push({ ...rule, addedAt: new Date().toISOString() });
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
    if (normalized === pat || normalized.startsWith(pat + ' ') || normalized.startsWith(pat + '\t')) {
      if (rule.action === 'deny') {
        if (!bestDeny || pat.length > bestDeny.pattern.length) bestDeny = rule;
      } else {
        if (!bestAllow || pat.length > bestAllow.pattern.length) bestAllow = rule;
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

/**
 * Extract granularity levels from a command for the "always allow" picker.
 * Returns levels from most specific to broadest.
 */
export function extractGranularityLevels(toolName: string, toolInput: Record<string, unknown>): Array<{ pattern: string; label: string }> {
  if (toolName === 'Bash' || toolName === 'BashOutput') {
    const cmd = String(toolInput.command || '').trim();
    const args = cmd.split(/\s+/);
    const base = (args[0]?.split('/').pop() || args[0] || '').toLowerCase();
    if (!base) return [];

    const levels: Array<{ pattern: string; label: string }> = [];

    // For subcommand tools (git, npm, docker, etc.), offer base + subcommand level
    const SUBCOMMAND_TOOLS = new Set(['git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'docker', 'brew', 'apt', 'pip', 'pip3']);
    if (SUBCOMMAND_TOOLS.has(base) && args[1] && !args[1].startsWith('-')) {
      const sub = args[1].toLowerCase();
      // If there's a third non-flag arg, offer 3-level
      if (args[2] && !args[2].startsWith('-')) {
        const third = args[2].toLowerCase();
        levels.push({ pattern: `${base} ${sub} ${third}`, label: `${base} ${sub} ${third}` });
      }
      levels.push({ pattern: `${base} ${sub}`, label: `${base} ${sub}` });
    }

    levels.push({ pattern: base, label: `all ${base}` });
    return levels;
  }

  // Non-Bash tools — just the tool name
  return [{ pattern: toolName, label: toolName }];
}
```

- [ ] **Step 2: Delete `src/lib/whitelist.ts`**

```bash
rm src/lib/whitelist.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/rules.ts
git rm src/lib/whitelist.ts
git commit -m "feat: pattern-based allow/deny rules replacing whitelist"
```

---

### Task 2: Wire Rules Into Classifier (`src/lib/tool-classifier.ts`)

**Files:**
- Modify: `src/lib/tool-classifier.ts`

- [ ] **Step 1: Replace whitelist imports with rules imports**

Change the import at line 3 from:
```typescript
import { isCommandWhitelisted, isToolWhitelisted } from './whitelist';
```
to:
```typescript
import { matchRule, matchToolRule } from './rules';
```

- [ ] **Step 2: Update `classifyTool()` to check rules FIRST**

Replace lines 355-359 (the `isToolWhitelisted` check at the top of `classifyTool`):

```typescript
export function classifyTool(toolName: string, toolInput: Record<string, unknown>): Classification {
  // Check user whitelist first — overrides all built-in classification
  if (isToolWhitelisted(toolName)) {
    const state: WorkerState = toolName.startsWith('mcp__') ? 'reading' : 'typing';
    return { state, needsApproval: false, reason: 'safe' };
  }
```

with:

```typescript
export function classifyTool(toolName: string, toolInput: Record<string, unknown>): Classification {
  // --- User pattern rules (deny > allow > built-in) ---

  // For Bash tools, check command string against rules
  if (toolName === 'Bash' || toolName === 'BashOutput') {
    const command = String(toolInput.command || '');
    const ruleResult = matchRule(command);
    if (ruleResult === 'allow') {
      return { state: 'typing', needsApproval: false, reason: 'safe' };
    }
    if (ruleResult === 'deny') {
      return { state: 'waiting', needsApproval: true, reason: 'risky' };
    }
    // No rule matched — fall through to built-in classifier below
  } else {
    // Non-Bash tools — check tool name against rules
    const ruleResult = matchToolRule(toolName);
    if (ruleResult === 'allow') {
      const state: WorkerState = toolName.startsWith('mcp__') ? 'reading' : 'typing';
      return { state, needsApproval: false, reason: 'safe' };
    }
    if (ruleResult === 'deny') {
      return { state: 'waiting', needsApproval: true, reason: 'risky' };
    }
  }
```

- [ ] **Step 3: Remove the old whitelist check at the bottom of `classifySingleCommand`**

Remove line 309 (inside `classifySingleCommand`):
```typescript
  // Check user whitelist before giving up
  if (isCommandWhitelisted(args)) return 'safe';
```

This check is now redundant — rules are checked at the top of `classifyTool` before any built-in logic runs.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tool-classifier.ts
git commit -m "feat: rules checked before built-in classifier (deny > allow > built-in)"
```

---

### Task 3: Update WebSocket Types and Handler

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/ws-server.ts`

- [ ] **Step 1: Update WS message types in `src/lib/types.ts`**

Change the `always-allow` message in `WSMessageFromClient` to include `pattern`:

```typescript
  | { type: 'always-allow'; approvalId: string; pattern: string }
```

Add a `rules-updated` message to `WSMessageToClient`:

```typescript
  | { type: 'rules-updated' }
```

- [ ] **Step 2: Update `ws-server.ts` imports**

Replace:
```typescript
import { addWhitelistRule, extractBashEntry, extractToolEntry } from './whitelist';
```
with:
```typescript
import { addRule } from './rules';
```

- [ ] **Step 3: Rewrite the `always-allow` handler in `ws-server.ts`**

Replace lines 158-184 (the entire `case 'always-allow':` block):

```typescript
    case 'always-allow': {
      const approval = getPendingApproval(msg.approvalId);
      if (approval) {
        const pattern = msg.pattern;
        const added = addRule({ pattern, action: 'allow', label: pattern });
        resolveApproval(msg.approvalId, 'allow', `Always allowed: ${pattern}`);
        console.log(`[Rules] Added allow pattern: "${pattern}" (added=${added})`);
        broadcast({ type: 'rules-updated' });
      }
      break;
    }
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/ws-server.ts
git commit -m "feat: always-allow sends pattern, ws-server uses rules module"
```

---

### Task 4: Update API Route (`whitelist` → `rules`)

**Files:**
- Delete: `src/app/api/whitelist/route.ts`
- Create: `src/app/api/rules/route.ts`

- [ ] **Step 1: Create `src/app/api/rules/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getRules, addRule, removeRule } from '@/lib/rules';

/** GET /api/rules — list all rules */
export async function GET() {
  return NextResponse.json({ rules: getRules() });
}

/** POST /api/rules — add a new rule */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { pattern, action, label } = body;
  if (!pattern || !action) {
    return NextResponse.json({ error: 'pattern and action are required' }, { status: 400 });
  }
  if (action !== 'allow' && action !== 'deny') {
    return NextResponse.json({ error: 'action must be "allow" or "deny"' }, { status: 400 });
  }
  const added = addRule({ pattern, action, label: label || pattern });
  return NextResponse.json({ added });
}

/** DELETE /api/rules — remove a rule */
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { pattern, action } = body;
  if (!pattern || !action) {
    return NextResponse.json({ error: 'pattern and action are required' }, { status: 400 });
  }
  const removed = removeRule(pattern, action);
  return NextResponse.json({ removed });
}
```

- [ ] **Step 2: Delete old whitelist route**

```bash
rm src/app/api/whitelist/route.ts
```

- [ ] **Step 3: Update any remaining references to the whitelist API**

In `src/components/WhitelistPanel.tsx` — check if it fetches from `/api/whitelist`. If it does, update to `/api/rules`. If `WhitelistPanel.tsx` is only used in the main canvas UI, it can be updated to use the new API shape or left as-is (it's not part of the iTerm panel).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/rules/route.ts
git rm src/app/api/whitelist/route.ts
git add -u  # catch any reference updates
git commit -m "feat: /api/rules route replacing /api/whitelist"
```

---

### Task 5: iTerm Panel — Granularity Picker & Reply Input

**Files:**
- Modify: `src/app/iterm-panel/page.tsx`
- Modify: `src/hooks/useWorkspace.ts`

- [ ] **Step 1: Update `useWorkspace.ts` — `sendAlwaysAllow` takes a pattern**

Change the `sendAlwaysAllow` callback:

```typescript
  const sendAlwaysAllow = useCallback((approvalId: string, pattern: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'always-allow',
        approvalId,
        pattern,
      }));
    } else {
      console.warn('[WS] Cannot send always-allow — WebSocket not open');
    }
  }, []);
```

- [ ] **Step 2: Add granularity picker to `ApprovalCard` in `src/app/iterm-panel/page.tsx`**

Import `extractGranularityLevels` won't work client-side (it's server code). Instead, compute levels inline in the component using the same logic — split command, generate prefixes:

Replace the "Always allow" button section in `ApprovalCard` (lines 147-155):

```typescript
function GranularityPicker({
  approval,
  onPick,
}: {
  approval: ApprovalRequest;
  onPick: (pattern: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const levels = useMemo(() => {
    if (approval.toolName === 'Bash' || approval.toolName === 'BashOutput') {
      const cmd = String(approval.toolInput.command || '').trim();
      const args = cmd.split(/\s+/);
      const base = (args[0]?.split('/').pop() || args[0] || '').toLowerCase();
      if (!base) return [];

      const result: Array<{ pattern: string; label: string }> = [];
      const SUB_TOOLS = new Set(['git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'docker', 'brew', 'apt', 'pip', 'pip3']);

      if (SUB_TOOLS.has(base) && args[1] && !args[1].startsWith('-')) {
        const sub = args[1].toLowerCase();
        if (args[2] && !args[2].startsWith('-')) {
          result.push({ pattern: `${base} ${sub} ${args[2].toLowerCase()}`, label: `${base} ${sub} ${args[2].toLowerCase()}` });
        }
        result.push({ pattern: `${base} ${sub}`, label: `${base} ${sub}` });
      }
      result.push({ pattern: base, label: `all ${base}` });
      return result;
    }
    return [{ pattern: approval.toolName, label: approval.toolName }];
  }, [approval.toolName, approval.toolInput]);

  if (levels.length === 0) return null;

  // Single level — just show one button
  if (levels.length === 1) {
    return (
      <button
        onClick={() => onPick(levels[0].pattern)}
        className="w-full mt-1.5 py-0.5 bg-[#1a2a3a] hover:bg-[#2a3a4a] border border-[#2a4a6b] text-[#6aafcf] text-[9px] font-mono rounded transition-colors cursor-pointer"
      >
        Always allow {levels[0].label}
      </button>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full mt-1.5 py-0.5 bg-[#1a2a3a] hover:bg-[#2a3a4a] border border-[#2a4a6b] text-[#6aafcf] text-[9px] font-mono rounded transition-colors cursor-pointer"
      >
        Always allow…
      </button>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {levels.map(level => (
        <button
          key={level.pattern}
          onClick={() => onPick(level.pattern)}
          className="w-full py-0.5 bg-[#1a2a3a] hover:bg-[#2a3a4a] border border-[#2a4a6b] text-[#6aafcf] text-[9px] font-mono rounded transition-colors cursor-pointer text-left px-2"
        >
          {level.label}
        </button>
      ))}
    </div>
  );
}
```

Then update `ApprovalCard` to use `GranularityPicker` instead of the old button. Replace lines 147-155:

```typescript
      {onAlwaysAllow && (
        <GranularityPicker
          approval={approval}
          onPick={(pattern) => onAlwaysAllow(approval.id, pattern)}
        />
      )}
```

Update `ApprovalCard`'s `onAlwaysAllow` prop type from `(id: string) => void` to `(id: string, pattern: string) => void`.

- [ ] **Step 3: Add reply-with-instructions input to `ApprovalCard`**

Add state and UI to the `ApprovalCard` component, above the Allow/Deny buttons:

```typescript
function ApprovalCard({
  approval,
  session,
  onDecision,
  onAlwaysAllow,
}: {
  approval: ApprovalRequest;
  session: Session | undefined;
  onDecision: (id: string, decision: 'allow' | 'deny', message?: string) => void;
  onAlwaysAllow?: (id: string, pattern: string) => void;
}) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  // ... existing title/details/project/reasonColor code ...
```

Add the note UI between the details and buttons:

```typescript
      {/* Reply with instructions */}
      {showNote ? (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onDecision(approval.id, 'allow', note);
            if (e.key === 'Escape') { setShowNote(false); setNote(''); }
          }}
          placeholder="Instructions for Claude…"
          autoFocus
          className="w-full mb-1.5 px-2 py-1 bg-[#0a0a1a] border border-[#2a2a4a] rounded text-[10px] font-mono text-[#aab] placeholder-[#334] outline-none focus:border-[#4a6a8a]"
        />
      ) : (
        <button
          onClick={() => setShowNote(true)}
          className="w-full mb-1.5 py-0.5 text-[#334] hover:text-[#556] text-[8px] font-mono transition-colors cursor-pointer"
        >
          + add note
        </button>
      )}
      <div className="flex gap-1.5">
        <button
          onClick={() => onDecision(approval.id, 'allow', note || undefined)}
          // ... existing classes ...
```

- [ ] **Step 4: Update `onAlwaysAllow` call sites**

In `WorkerItem`, update the `onAlwaysAllow` prop type and pass-through:

```typescript
  onAlwaysAllow: (id: string, pattern: string) => void;
```

In `ItermPanelPage`, update the `sendAlwaysAllow` call sites — they already pass through, just need the type to match.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWorkspace.ts src/app/iterm-panel/page.tsx
git commit -m "feat: granularity picker and reply-with-instructions in iTerm panel"
```

---

### Task 6: iTerm Panel Settings Page

**Files:**
- Create: `src/app/iterm-panel/settings/page.tsx`
- Modify: `src/app/iterm-panel/page.tsx` (add gear icon link)

- [ ] **Step 1: Create `src/app/iterm-panel/settings/page.tsx`**

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';

interface PatternRule {
  pattern: string;
  action: 'allow' | 'deny';
  label: string;
  addedAt: string;
}

export default function SettingsPage() {
  const [rules, setRules] = useState<PatternRule[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [newAction, setNewAction] = useState<'allow' | 'deny'>('allow');

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/rules');
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const addNewRule = async () => {
    const pattern = newPattern.trim();
    if (!pattern) return;
    await fetch('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern, action: newAction, label: pattern }),
    });
    setNewPattern('');
    fetchRules();
  };

  const deleteRule = async (pattern: string, action: 'allow' | 'deny') => {
    await fetch('/api/rules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern, action }),
    });
    fetchRules();
  };

  const allowRules = rules.filter(r => r.action === 'allow');
  const denyRules = rules.filter(r => r.action === 'deny');

  return (
    <div className="flex flex-col h-screen w-full bg-[#0e0e1e] overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[#1a1a3a] flex items-center gap-2 flex-shrink-0">
        <a href="/iterm-panel" className="text-[#556] hover:text-[#aab] text-[11px] font-mono cursor-pointer transition-colors">
          ← Back
        </a>
        <span className="text-[#556] text-[10px] font-mono uppercase tracking-widest">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Add rule */}
        <div className="mb-4">
          <div className="text-[#556] text-[9px] font-mono uppercase tracking-widest mb-1.5">Add Rule</div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addNewRule(); }}
              placeholder="e.g. git push, python3, npm install"
              className="flex-1 px-2 py-1 bg-[#0a0a1a] border border-[#2a2a4a] rounded text-[10px] font-mono text-[#aab] placeholder-[#334] outline-none focus:border-[#4a6a8a]"
            />
            <select
              value={newAction}
              onChange={(e) => setNewAction(e.target.value as 'allow' | 'deny')}
              className="px-2 py-1 bg-[#0a0a1a] border border-[#2a2a4a] rounded text-[10px] font-mono text-[#aab] outline-none cursor-pointer"
            >
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
            </select>
            <button
              onClick={addNewRule}
              className="px-3 py-1 bg-[#1a2a3a] hover:bg-[#2a3a4a] border border-[#2a4a6b] text-[#6aafcf] text-[10px] font-mono rounded transition-colors cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>

        {/* Deny rules */}
        <div className="mb-4">
          <div className="text-[#bf4a4a] text-[9px] font-mono uppercase tracking-widest mb-1">
            Deny ({denyRules.length})
          </div>
          {denyRules.length === 0 ? (
            <div className="text-[#333] text-[9px] font-mono px-1">No deny rules</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {denyRules.map(r => (
                <div key={`deny-${r.pattern}`} className="flex items-center gap-1.5 px-2 py-1 bg-[#1a0a0a] rounded border border-[#2a1a1a]">
                  <span className="text-[#bf4a4a] text-[10px] font-mono flex-1 min-w-0 truncate">{r.pattern}</span>
                  <button
                    onClick={() => deleteRule(r.pattern, 'deny')}
                    className="text-[#333] hover:text-[#bf4a4a] text-[10px] font-mono flex-shrink-0 cursor-pointer transition-colors"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Allow rules */}
        <div>
          <div className="text-[#4abf5c] text-[9px] font-mono uppercase tracking-widest mb-1">
            Allow ({allowRules.length})
          </div>
          {allowRules.length === 0 ? (
            <div className="text-[#333] text-[9px] font-mono px-1">No allow rules</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {allowRules.map(r => (
                <div key={`allow-${r.pattern}`} className="flex items-center gap-1.5 px-2 py-1 bg-[#0a1a0a] rounded border border-[#1a2a1a]">
                  <span className="text-[#4abf5c] text-[10px] font-mono flex-1 min-w-0 truncate">{r.pattern}</span>
                  <button
                    onClick={() => deleteRule(r.pattern, 'allow')}
                    className="text-[#333] hover:text-[#bf4a4a] text-[10px] font-mono flex-shrink-0 cursor-pointer transition-colors"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add gear icon to main iTerm panel header**

In `src/app/iterm-panel/page.tsx`, inside the header `<div>` (around line 542), add after the approval badge:

```typescript
        <a
          href="/iterm-panel/settings"
          className="ml-auto text-[#334] hover:text-[#667] text-[11px] font-mono cursor-pointer transition-colors"
          title="Settings"
        >
          ⚙
        </a>
```

If the approvals badge already uses `ml-auto`, change the gear to just `ml-2` and wrap both in a flex container.

- [ ] **Step 3: Commit**

```bash
git add src/app/iterm-panel/settings/page.tsx src/app/iterm-panel/page.tsx
git commit -m "feat: iTerm panel settings page for allow/deny rules"
```

---

### Task 7: Unix Socket Transport

**Files:**
- Modify: `server.ts`
- Modify: `bin.ts`
- Modify: `package.json`

- [ ] **Step 1: Update `server.ts` — add Unix socket listener**

Replace the entire file:

```typescript
import { createServer } from 'http';
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import next from 'next';
import { initWSS } from './src/lib/ws-server';
import { startStaleSessionCleanup } from './src/lib/cleanup';

const dev = process.env.NODE_ENV !== 'production';
const SOCKET_PATH = process.env.PIXEL_OFFICE_SOCKET || '/tmp/pixel-office.sock';

const app = next({ dev });
const handle = app.getRequestHandler();

// Check shfmt availability
try {
  execSync('shfmt --version', { stdio: 'pipe' });
} catch {
  console.warn('⚠  shfmt not found — compound bash commands will default to "needs approval"');
  console.warn('   Install: brew install shfmt (macOS) or go install mvdan.cc/sh/v3/cmd/shfmt@latest');
}

const port = parseInt(process.env.PORT || '3000', 10);

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  initWSS(server);
  startStaleSessionCleanup();

  // TCP listener for browser (iTerm panel, canvas UI)
  server.listen(port, '127.0.0.1', () => {
    console.log(`> Pixel Office ready on http://localhost:${port}`);
  });

  // Unix socket listener for hooks (reliable, no port conflicts)
  const hookServer = createServer((req, res) => {
    handle(req, res);
  });

  // Clean up stale socket file from previous crash
  if (existsSync(SOCKET_PATH)) {
    try { unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
  }

  hookServer.listen(SOCKET_PATH, () => {
    console.log(`> Hook socket ready at ${SOCKET_PATH}`);
  });

  // Clean up socket on exit
  function cleanup() {
    try { unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
    process.exit(0);
  }
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
});
```

- [ ] **Step 2: Update `bin.ts` — add Unix socket, update hook registration**

In `bin.ts`, update the `BASE_URL` and `curlCmd` function to use Unix socket:

Replace:
```typescript
const BASE_URL = 'http://localhost:3000/api/hooks';
```
with:
```typescript
const SOCKET_PATH = '/tmp/pixel-office.sock';
```

Replace the `curlCmd` function:

```typescript
function curlCmd(endpoint: string, maxTime: number, enrichTty: boolean): string {
  const curlBase = `curl -sf -X POST --unix-socket ${SOCKET_PATH} http://localhost/api/hooks/${endpoint} -H 'Content-Type: application/json'`;
  if (enrichTty) {
    const body = `$(echo "$INPUT" | jq -c --arg tty "$TTY" '. + {tty: $tty}' 2>/dev/null || echo "$INPUT")`;
    return `${TTY_PREFIX}; ${curlBase} -d "${body}" --max-time ${maxTime} 2>/dev/null || true`;
  }
  return `${SIMPLE_PREFIX}; ${curlBase} -d "$INPUT" --max-time ${maxTime} 2>/dev/null || true`;
}

```

Also update the `hooksRegistered` check — the `MARKER` constant is `'pixel-office'` which will still match in the Unix socket path, so no change needed there.

Add the Unix socket listener in the `main` function, after the TCP `server.listen`:

```typescript
  // Unix socket for hooks
  const { existsSync: fsExists, unlinkSync: fsUnlink } = await import('fs');
  const hookServer = createServer((req, res) => { handle(req, res); });
  const socketPath = '/tmp/pixel-office.sock';
  if (fsExists(socketPath)) {
    try { fsUnlink(socketPath); } catch { /* ignore */ }
  }
  hookServer.listen(socketPath, () => {
    console.log(`  ✓ Hook socket at ${socketPath}`);
  });

  function cleanup() {
    try { fsUnlink(socketPath); } catch { /* ignore */ }
    process.exit(0);
  }
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
```

- [ ] **Step 3: Update `package.json`**

Remove `detect-port` from dependencies and add `serve` script:

```json
  "scripts": {
    "dev": "npx tsx server.ts",
    "build": "next build",
    "start": "npx tsx bin.ts",
    "serve": "npm run build && npm start",
    "lint": "eslint",
    "setup": "npx tsx scripts/setup.ts",
    "uninstall": "npx tsx scripts/setup.ts uninstall"
  },
```

Remove `"detect-port": "^2.1.0"` from `dependencies`.

- [ ] **Step 4: Remove detect-port import from `server.ts`**

Already done in step 1 — the new `server.ts` doesn't import `detect-port`.

- [ ] **Step 5: Commit**

```bash
git add server.ts bin.ts package.json
npm install  # updates lockfile after removing detect-port
git add package-lock.json
git commit -m "feat: Unix socket transport for hooks, remove detect-port"
```

---

### Task 8: Update Hook Registration for Existing Users

**Files:**
- Modify: `~/.claude/settings.json` (via running `npm run setup` or `bin.ts` re-registration)

- [ ] **Step 1: Force re-registration of hooks**

The `bin.ts` `hooksRegistered()` check looks for the `pixel-office` marker in existing hooks. Since the old hooks already have this marker, it won't re-register. We need to handle this.

Add a function to `bin.ts` that detects old-style hooks (ones using `localhost:3000` instead of `--unix-socket`) and replaces them:

```typescript
function hooksNeedUpdate(): boolean {
  if (!existsSync(SETTINGS_PATH)) return false;
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
    const hooks = settings.hooks ?? {};
    // Check if any pixel-office hook still uses localhost:3000 instead of --unix-socket
    return Object.values(hooks).some((entries) =>
      (entries as HookEntry[]).some((entry) =>
        entry.hooks?.some((h) =>
          typeof h.command === 'string' &&
          h.command.includes(MARKER) &&
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
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'));
  const hooks = settings.hooks ?? {};

  for (const [event, entries] of Object.entries(hooks)) {
    hooks[event] = (entries as HookEntry[]).filter((entry) =>
      !entry.hooks?.some((h) =>
        typeof h.command === 'string' &&
        h.command.includes(MARKER) &&
        h.command.includes('localhost:3000')
      )
    );
  }

  settings.hooks = hooks;
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
}
```

Update the `main` function's hook registration block:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add bin.ts
git commit -m "feat: auto-migrate hooks from localhost:3000 to unix socket"
```

---

### Task 9: Verify Production Build

- [ ] **Step 1: Build and test**

```bash
npm run build
npm start
```

Verify:
- Server starts without errors
- iTerm panel loads at `http://localhost:3000/iterm-panel`
- Settings page loads at `http://localhost:3000/iterm-panel/settings`
- Unix socket exists at `/tmp/pixel-office.sock`
- Hook test: `curl -sf -X POST --unix-socket /tmp/pixel-office.sock http://localhost/api/hooks/session-start -H 'Content-Type: application/json' -d '{"session_id":"test","cwd":"/tmp"}'`

- [ ] **Step 2: Test the `serve` script**

```bash
npm run serve
```

Verify same behavior as step 1.

- [ ] **Step 3: Commit any fixes found during testing**

```bash
git add -u
git commit -m "fix: production build issues"
```
