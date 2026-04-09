'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useWorkspace, ApprovalRequest, ResolvedApproval } from '@/hooks/useWorkspace';
import { STATE_COLORS } from '@/lib/ui-constants';
import { Session } from '@/lib/types';

// --- shared helpers (duplicated from WorkerPanel to keep panel self-contained) ---

const STATE_ICONS: Record<string, string> = {
  idle: '·',
  typing: '▌',
  reading: '◎',
  waiting: '◈',
  walking: '→',
};

function formatDuration(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function projectName(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() || cwd;
}

function cleanToolName(toolName: string): string {
  const mcpMatch = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (mcpMatch) {
    const vendor = mcpMatch[1].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const tool = mcpMatch[2].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `${vendor}: ${tool}`;
  }
  return toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatToolDetails(toolName: string, toolInput: Record<string, unknown>) {
  let title = cleanToolName(toolName);
  let details = '';

  if (toolName === 'Bash' || toolName === 'bash') {
    const cmd = typeof toolInput.command === 'string' ? toolInput.command : '';
    title = cmd.split(' ')[0] || 'Bash';
    details = cmd;
  } else if (toolName === 'Write' || toolName === 'Edit') {
    const path = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    details = path.split('/').slice(-2).join('/') || '';
  } else if (toolName === 'Read') {
    const path = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    details = path.split('/').slice(-2).join('/') || '';
  } else if (typeof toolInput.path === 'string') {
    details = toolInput.path.split('/').slice(-2).join('/');
  } else if (typeof toolInput.pattern === 'string') {
    details = toolInput.pattern;
  } else if (typeof toolInput.query === 'string') {
    details = toolInput.query;
  }

  return { title, details };
}

function getAlwaysAllowLabel(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash' || toolName === 'BashOutput') {
    const cmd = String(toolInput.command || '').trim();
    const args = cmd.split(/\s+/);
    return (args[0]?.split('/').pop() || args[0] || 'unknown').toLowerCase();
  }
  return cleanToolName(toolName);
}

// --- components ---

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
  const { title, details } = formatToolDetails(approval.toolName, approval.toolInput);
  const project = session ? projectName(session.cwd) : null;
  const reasonColor = approval.reason === 'risky' ? '#bf8b4a' : approval.reason === 'unknown' ? '#8b4abf' : '#4abf5c';

  return (
    <div className="rounded-lg border border-[#2a2a4a] bg-[#12122a] p-2.5 overflow-hidden">
      {/* Header row: reason badge + waiting time */}
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ color: reasonColor, backgroundColor: `${reasonColor}15`, border: `1px solid ${reasonColor}25` }}
        >
          {approval.reason}
        </span>
        {project && (
          <span className="text-[#445] text-[9px] font-mono min-w-0 truncate">{project}</span>
        )}
        <span className="text-[#334] text-[8px] font-mono ml-auto flex-shrink-0">{formatDuration(approval.createdAt)}</span>
      </div>
      {/* Title: always visible, wraps */}
      <div
        className="text-[11px] font-mono font-bold mb-1 break-words overflow-wrap-anywhere"
        style={{ color: reasonColor, overflowWrap: 'anywhere' }}
      >
        {title}
      </div>
      {/* Details: full command, scrollable for very long ones */}
      {details && (
        <div
          className="text-[10px] font-mono text-[#667] mb-1.5 leading-relaxed max-h-28 overflow-y-auto rounded bg-[#0a0a1a] p-1.5 border border-[#1a1a2a]"
          style={{ overflowWrap: 'anywhere', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}
        >
          {details}
        </div>
      )}
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
          className="flex-1 py-1 bg-[#1a3a2a] hover:bg-[#2a4a3a] text-[#4abf5c] text-[10px] font-mono rounded transition-colors cursor-pointer font-bold"
        >
          Allow
        </button>
        <button
          onClick={() => onDecision(approval.id, 'deny')}
          className="flex-1 py-1 bg-[#3a1a1a] hover:bg-[#4a2a2a] text-[#bf4a4a] text-[10px] font-mono rounded transition-colors cursor-pointer font-bold"
        >
          Deny
        </button>
      </div>
      {onAlwaysAllow && (
        <GranularityPicker
          approval={approval}
          onPick={(pattern) => onAlwaysAllow(approval.id, pattern)}
        />
      )}
    </div>
  );
}

function SectionHeader({
  label,
  count,
  badge,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  badge?: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full px-2 py-1.5 flex items-center gap-1.5 hover:bg-[#12122a] transition-colors cursor-pointer"
    >
      <span className="text-[#445] text-[8px]">{collapsed ? '▸' : '▾'}</span>
      <span className="text-[#556] text-[9px] font-mono uppercase tracking-widest">{label}</span>
      {count > 0 && (
        <span className="text-[#445] text-[9px] font-mono">{count}</span>
      )}
      {badge != null && badge > 0 && (
        <span className="text-[#bf8b4a] text-[9px] font-mono animate-pulse font-bold">{badge}</span>
      )}
    </button>
  );
}

function HistoryEntry({
  entry,
  sessions,
}: {
  entry: ResolvedApproval;
  sessions: Session[];
}) {
  const [expanded, setExpanded] = useState(false);
  const session = sessions.find(s => s.sessionId === entry.approval.sessionId);
  const { title, details } = formatToolDetails(entry.approval.toolName, entry.approval.toolInput);
  const isAllow = entry.decision === 'allow';
  const dotColor = isAllow ? '#4abf5c' : '#bf4a4a';

  return (
    <div
      className="px-2 py-0.5 hover:bg-[#0e0e1e] cursor-pointer transition-colors min-w-0"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
        <span className="text-[#667] text-[10px] font-mono min-w-0 truncate">{title}</span>
        <span className="text-[#334] text-[9px] font-mono flex-shrink-0 ml-auto">{formatRelativeTime(entry.resolvedAt)}</span>
      </div>
      {expanded && (
        <div className="ml-3 mt-0.5 min-w-0">
          {details && (
            <div
              className="text-[#556] text-[9px] font-mono leading-relaxed whitespace-pre-wrap"
              style={{ overflowWrap: 'anywhere' }}
            >
              {details}
            </div>
          )}
          {session && <div className="text-[#334] text-[8px] font-mono mt-0.5">{projectName(session.cwd)}</div>}
          {entry.message && <div className="text-[#445] text-[8px] font-mono italic mt-0.5">{entry.message}</div>}
        </div>
      )}
    </div>
  );
}

function WorkerItem({
  session,
  isExpanded,
  onToggle,
  focusing,
  onFocus,
  onDismiss,
  pendingApprovals,
  onDecision,
  onAlwaysAllow,
}: {
  session: Session;
  isExpanded: boolean;
  onToggle: () => void;
  focusing: boolean;
  onFocus: () => void;
  onDismiss: () => void;
  pendingApprovals: ApprovalRequest[];
  onDecision: (id: string, decision: 'allow' | 'deny', message?: string) => void;
  onAlwaysAllow: (id: string, pattern: string) => void;
}) {
  const isIdle = session.state === 'idle';
  const isWaiting = session.state === 'waiting';
  const hasTty = !!session.tty;
  const project = projectName(session.cwd);
  const displayName = project || session.sessionId.slice(0, 8);
  const isGhost = !session.task && session.recentTools.length === 0 && isIdle;
  const stateColor = isGhost ? '#222' : (STATE_COLORS[session.state] || '#444');
  const stateIcon = STATE_ICONS[session.state] || '·';
  const focus = session.currentFocus || null;
  const lastTool = session.recentTools[session.recentTools.length - 1];

  return (
    <div
      className={`rounded-md cursor-pointer transition-all duration-200 overflow-hidden ${
        isExpanded ? 'bg-[#161630]' : 'hover:bg-[#12122a]'
      } ${isGhost ? 'opacity-40' : ''}`}
      style={{ borderLeft: `2px solid ${stateColor}` }}
      onClick={onToggle}
    >
      <div className="px-2.5 py-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`text-[11px] font-mono flex-shrink-0 leading-none ${
              !isIdle && !isWaiting ? 'animate-pulse' : ''
            }`}
            style={{ color: stateColor }}
            title={session.state}
          >
            {stateIcon}
          </span>
          <span className="text-[#99a] text-[11px] font-mono font-bold min-w-0 truncate">{displayName}</span>
          {pendingApprovals.length > 0 && (
            <span className="bg-[#bf8b4a] text-[#0e0e1e] text-[8px] font-mono font-bold rounded-full w-4 h-4 flex items-center justify-center animate-pulse flex-shrink-0">
              {pendingApprovals.length}
            </span>
          )}
          {session.recentTools.length > 0 && (
            <span className="text-[#2a2a3a] text-[9px] font-mono flex-shrink-0">
              {session.recentTools.length}
            </span>
          )}
          <span className="text-[#2a2a3a] text-[10px] font-mono flex-shrink-0">
            {formatDuration(session.startedAt)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="text-[#2a2a3a] hover:text-[#bf4a4a] text-[10px] font-mono flex-shrink-0 leading-none cursor-pointer transition-colors ml-0.5"
            title="Dismiss"
          >
            ×
          </button>
        </div>

        {focus && (
          <div className="text-[#8899aa] text-[10px] font-mono mt-0.5 ml-4 leading-relaxed min-w-0" style={{ overflowWrap: 'anywhere' }}>{focus}</div>
        )}

        {lastTool && !isIdle && (
          <div className="text-[#3a3a5a] text-[9px] font-mono mt-0.5 ml-4 min-w-0" style={{ overflowWrap: 'anywhere' }}>{lastTool.summary}</div>
        )}

        {!focus && isIdle && !isGhost && (
          <div className="text-[#2a2a3a] text-[10px] font-mono mt-0.5 ml-4">On break</div>
        )}

        {isGhost && (
          <div className="text-[#1a1a2a] text-[9px] font-mono mt-0.5 ml-4">No activity</div>
        )}

        {isWaiting && pendingApprovals.length === 0 && (
          <div className="ml-4 mt-0.5">
            <span className="text-[#bf8b4a] text-[9px] font-mono bg-[#bf8b4a]/8 border border-[#bf8b4a]/15 rounded px-1 py-0.5 leading-none">
              Needs approval
            </span>
          </div>
        )}
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-200"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-2.5 pb-2 pt-1">
            {/* Inline approvals */}
            {pendingApprovals.length > 0 && (
              <div className="mb-1.5 flex flex-col gap-1.5">
                {pendingApprovals.map(a => (
                  <ApprovalCard
                    key={a.id}
                    approval={a}
                    session={session}
                    onDecision={onDecision}
                    onAlwaysAllow={onAlwaysAllow}
                  />
                ))}
              </div>
            )}

            {/* Tool history */}
            {session.recentTools.length > 1 && (
              <div className="mb-1.5 ml-1">
                {session.recentTools.slice(-4, -1).reverse().map((t, i) => (
                  <div key={t.timestamp} className="flex items-start gap-1.5 min-w-0">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div
                        className="w-1 h-1 rounded-full mt-1.5"
                        style={{ backgroundColor: i === 0 ? '#3a3a5a' : '#1a1a3a' }}
                      />
                      {i < session.recentTools.slice(-4, -1).length - 1 && (
                        <div className="w-px h-3 bg-[#1a1a3a]" />
                      )}
                    </div>
                    <div
                      className="text-[9px] font-mono leading-relaxed min-w-0"
                      style={{ color: i === 0 ? '#4a4a6a' : '#2a2a4a', overflowWrap: 'anywhere' }}
                    >
                      {t.summary}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {hasTty && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFocus();
                }}
                disabled={focusing}
                className="w-full py-1 bg-[#0a0a16] hover:bg-[#141428] border border-[#1a1a30] text-[#445] hover:text-[#778] text-[9px] font-mono rounded transition-colors cursor-pointer disabled:opacity-50"
              >
                {focusing ? 'Focusing…' : 'Focus Terminal'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- main page ---

function usePersistedState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : initial;
    } catch {
      return initial;
    }
  });

  const set = useCallback((v: T) => {
    setState(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch { /* ignore */ }
  }, [key]);

  return [state, set];
}

export default function ItermPanelPage() {
  const {
    sessions, approvals, approvalHistory, sendApproval, sendAlwaysAllow, sendDismissSession,
  } = useWorkspace();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusing, setFocusing] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [approvalsCollapsed, setApprovalsCollapsed] = usePersistedState('iterm-panel-approvals-collapsed', false);
  const [workersCollapsed, setWorkersCollapsed] = usePersistedState('iterm-panel-workers-collapsed', false);
  const [historyCollapsed, setHistoryCollapsed] = usePersistedState('iterm-panel-history-collapsed', true);
  const [activityLog, setActivityLog] = useState<Array<{ time: string; tool: string; detail: string }>>([]);

  // Auto-expand approvals when new ones arrive
  const prevApprovalCountRef = useRef(approvals.length);
  useEffect(() => {
    if (approvals.length > prevApprovalCountRef.current) {
      setApprovalsCollapsed(false);
    }
    prevApprovalCountRef.current = approvals.length;
  }, [approvals.length, setApprovalsCollapsed]);

  // Sort approvals: risky first, then unknown, then oldest first within each tier
  const sortedApprovals = useMemo(() => {
    const priority: Record<string, number> = { risky: 0, unknown: 1, safe: 2 };
    return [...approvals].sort((a, b) => {
      const pa = priority[a.reason] ?? 2;
      const pb = priority[b.reason] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.createdAt - b.createdAt;
    });
  }, [approvals]);

  const activeApproval = sortedApprovals[0];
  const queuedCount = sortedApprovals.length - 1;

  // Group approvals by session for worker badges
  const approvalsBySession = useMemo(() => {
    const map = new Map<string, ApprovalRequest[]>();
    for (const a of approvals) {
      const list = map.get(a.sessionId) || [];
      list.push(a);
      map.set(a.sessionId, list);
    }
    return map;
  }, [approvals]);

  // Keyboard shortcuts for approval queue
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (sortedApprovals.length === 0) return;
      // Don't capture if typing in an input or button
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'y') {
        e.preventDefault();
        sendApproval(activeApproval!.id, 'allow');
      } else if (mod && e.key === 'n') {
        e.preventDefault();
        sendApproval(activeApproval!.id, 'deny');
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sortedApprovals, activeApproval, sendApproval]);

  // Tick for duration updates (every minute)
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  // Kill any inherited body styles for the webview
  useEffect(() => {
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';
  }, []);

  // Fetch activity log when no workers
  useEffect(() => {
    if (sessions.length > 0) {
      setActivityLog([]);
      return;
    }

    async function fetchLog() {
      try {
        const res = await fetch('/api/command-log?limit=15');
        if (!res.ok) return;
        const { entries } = await res.json();
        setActivityLog(
          (entries || []).map((l: Record<string, unknown>) => ({
            time: String(l.timestamp || ''),
            tool: String(l.toolName || 'unknown'),
            detail: String(l.summary || ''),
          }))
        );
      } catch { /* ignore */ }
    }

    fetchLog();
    const interval = setInterval(fetchLog, 30000);
    return () => clearInterval(interval);
  }, [sessions.length]);

  const handleFocus = useCallback(async (sessionId: string) => {
    setFocusing(sessionId);
    try {
      await fetch('/api/focus-terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } finally {
      setFocusing(null);
    }
  }, []);

  return (
    <div className="flex flex-col h-screen w-full bg-[#0e0e1e] overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[#1a1a3a] flex items-center flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${sessions.length > 0 ? 'bg-[#4abf5c] animate-pulse' : 'bg-[#333]'}`} />
          <span className="text-[#556] text-[10px] font-mono uppercase tracking-widest">
            {sessions.length} worker{sessions.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {approvals.length > 0 && (
            <span className="bg-[#bf8b4a] text-[#0e0e1e] text-[9px] font-mono font-bold rounded-full px-1.5 py-0.5 animate-pulse">
              {approvals.length}
            </span>
          )}
          <a
            href="/iterm-panel/settings"
            className="text-[#334] hover:text-[#667] text-[11px] font-mono cursor-pointer transition-colors"
            title="Settings"
          >
            ⚙
          </a>
        </div>
      </div>

      {/* Approvals section */}
      {approvals.length > 0 && (
        <div className="border-b border-[#1a1a3a] flex-shrink-0">
          <SectionHeader
            label="Approvals"
            count={approvals.length}
            badge={queuedCount}
            collapsed={approvalsCollapsed}
            onToggle={() => setApprovalsCollapsed(!approvalsCollapsed)}
          />
          {!approvalsCollapsed && (
            <div className="px-2 pb-2 flex flex-col gap-1.5">
              {activeApproval && (
                <ApprovalCard
                  approval={activeApproval}
                  session={sessions.find(s => s.sessionId === activeApproval.sessionId)}
                  onDecision={sendApproval}
                  onAlwaysAllow={sendAlwaysAllow}
                />
              )}
              {queuedCount > 0 && (
                <div className="text-[#445] text-[9px] font-mono text-center py-0.5">
                  +{queuedCount} more queued &middot; <span className="text-[#667]">⌘Y</span> allow &middot; <span className="text-[#667]">⌘N</span> deny
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Workers section */}
        {sessions.length > 0 && (
          <div className="border-b border-[#1a1a3a]">
            <SectionHeader
              label="Workers"
              count={sessions.length}
              collapsed={workersCollapsed}
              onToggle={() => setWorkersCollapsed(!workersCollapsed)}
            />
            {!workersCollapsed && (
              <div className="p-1.5 flex flex-col gap-0.5">
                {sessions.map(session => (
                  <WorkerItem
                    key={session.sessionId}
                    session={session}
                    isExpanded={expandedId === session.sessionId}
                    onToggle={() => setExpandedId(expandedId === session.sessionId ? null : session.sessionId)}
                    focusing={focusing === session.sessionId}
                    onFocus={() => handleFocus(session.sessionId)}
                    onDismiss={() => sendDismissSession(session.sessionId)}
                    pendingApprovals={approvalsBySession.get(session.sessionId) || []}
                    onDecision={sendApproval}
                    onAlwaysAllow={sendAlwaysAllow}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Idle activity feed */}
        {sessions.length === 0 && (
          <div className="p-1.5">
            <div className="px-2 py-1.5">
              <span className="text-[#556] text-[9px] font-mono uppercase tracking-widest">Recent Activity</span>
            </div>
            {activityLog.length > 0 ? (
              <div className="flex flex-col">
                {activityLog.map((entry, i) => (
                  <div key={i} className="px-2.5 py-0.5 flex items-start gap-1.5 min-w-0">
                    <span className="text-[#2a2a3a] text-[9px] font-mono flex-shrink-0 w-10">
                      {entry.time ? new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                    <span className="text-[#445] text-[9px] font-mono min-w-0" style={{ overflowWrap: 'anywhere' }}>{entry.detail || entry.tool}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3 py-6 text-center">
                <p className="text-[#333] text-[11px] font-mono">No activity yet</p>
                <p className="text-[#222] text-[9px] font-mono mt-1">Start a Claude session to see them here</p>
              </div>
            )}
          </div>
        )}

        {/* History section */}
        {approvalHistory.length > 0 && (
          <div className="border-t border-[#1a1a3a]">
            <SectionHeader
              label="History"
              count={approvalHistory.length}
              collapsed={historyCollapsed}
              onToggle={() => setHistoryCollapsed(!historyCollapsed)}
            />
            {!historyCollapsed && (
              <div className="flex flex-col">
                {[...approvalHistory].reverse().map(entry => (
                  <HistoryEntry
                    key={entry.approval.id}
                    entry={entry}
                    sessions={sessions}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
