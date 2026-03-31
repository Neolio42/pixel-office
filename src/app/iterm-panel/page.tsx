'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { STATE_COLORS } from '@/lib/ui-constants';
import { ApprovalRequest } from '@/hooks/useWorkspace';
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
    details = cmd.length > 120 ? cmd.slice(0, 117) + '…' : cmd;
  } else if (toolName === 'Write' || toolName === 'Edit') {
    const path = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    details = path.split('/').slice(-2).join('/') || '';
  } else if (toolName === 'Read') {
    const path = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
    details = path.split('/').slice(-2).join('/') || '';
  } else if (typeof toolInput.path === 'string') {
    details = toolInput.path.split('/').slice(-2).join('/');
  } else if (typeof toolInput.pattern === 'string') {
    details = toolInput.pattern.length > 60 ? toolInput.pattern.slice(0, 57) + '…' : toolInput.pattern;
  } else if (typeof toolInput.query === 'string') {
    details = toolInput.query.length > 60 ? toolInput.query.slice(0, 57) + '…' : toolInput.query;
  }

  return { title, details };
}

// --- components ---

function ApprovalCard({
  approval,
  session,
  onDecision,
}: {
  approval: ApprovalRequest;
  session: Session | undefined;
  onDecision: (id: string, decision: 'allow' | 'deny', message?: string) => void;
}) {
  const { title, details } = formatToolDetails(approval.toolName, approval.toolInput);
  const project = session ? projectName(session.cwd) : null;
  const reasonColor = approval.reason === 'risky' ? '#bf8b4a' : approval.reason === 'unknown' ? '#8b4abf' : '#4abf5c';

  return (
    <div className="rounded-lg border border-[#2a2a4a] bg-[#12122a] p-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-mono font-bold text-[#ccd]" style={{ color: reasonColor }}>
          {title}
        </span>
        <span
          className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ color: reasonColor, backgroundColor: `${reasonColor}15`, border: `1px solid ${reasonColor}25` }}
        >
          {approval.reason}
        </span>
      </div>
      {details && (
        <div className="text-[10px] font-mono text-[#667] truncate mb-1.5">{details}</div>
      )}
      {project && (
        <div className="text-[9px] font-mono text-[#445] mb-2">{project}</div>
      )}
      <div className="flex gap-1.5">
        <button
          onClick={() => onDecision(approval.id, 'allow')}
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
    </div>
  );
}

function WorkerItem({
  session,
  isExpanded,
  onToggle,
  focusing,
  onFocus,
}: {
  session: Session;
  isExpanded: boolean;
  onToggle: () => void;
  focusing: boolean;
  onFocus: () => void;
}) {
  const isIdle = session.state === 'idle';
  const isWaiting = session.state === 'waiting';
  const project = projectName(session.cwd);
  const stateColor = STATE_COLORS[session.state] || '#444';
  const stateIcon = STATE_ICONS[session.state] || '·';
  const focus = session.currentFocus || null;
  const lastTool = session.recentTools[session.recentTools.length - 1];

  return (
    <div
      className={`rounded-md cursor-pointer transition-all duration-200 overflow-hidden ${
        isExpanded ? 'bg-[#161630]' : 'hover:bg-[#12122a]'
      }`}
      style={{ borderLeft: `2px solid ${stateColor}` }}
      onClick={onToggle}
    >
      <div className="px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[11px] font-mono flex-shrink-0 leading-none ${
              !isIdle && !isWaiting ? 'animate-pulse' : ''
            }`}
            style={{ color: stateColor }}
            title={session.state}
          >
            {stateIcon}
          </span>
          <span className="text-[#99a] text-[11px] font-mono font-bold flex-1 truncate">{project}</span>
          <span className="text-[#2a2a3a] text-[10px] font-mono flex-shrink-0">
            {formatDuration(session.startedAt)}
          </span>
        </div>

        {focus && (
          <div className="text-[#8899aa] text-[10px] font-mono mt-0.5 ml-4 leading-relaxed truncate">{focus}</div>
        )}

        {lastTool && !isIdle && (
          <div className="text-[#3a3a5a] text-[9px] font-mono mt-0.5 ml-4 truncate">{lastTool.summary}</div>
        )}

        {!focus && isIdle && (
          <div className="text-[#2a2a3a] text-[10px] font-mono mt-0.5 ml-4">On break</div>
        )}

        {isWaiting && (
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
            {/* Tool history */}
            {session.recentTools.length > 1 && (
              <div className="mb-1.5 ml-1">
                {session.recentTools.slice(-4, -1).reverse().map((t, i) => (
                  <div key={t.timestamp} className="flex items-start gap-1.5">
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
                      className="text-[9px] font-mono leading-relaxed truncate"
                      style={{ color: i === 0 ? '#4a4a6a' : '#2a2a4a' }}
                    >
                      {t.summary}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
          </div>
        </div>
      </div>
    </div>
  );
}

// --- main page ---

export default function ItermPanelPage() {
  const {
    sessions, approvals, sendApproval,
  } = useWorkspace();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusing, setFocusing] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Tick for duration updates
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
      </div>

      {/* Approvals */}
      {approvals.length > 0 && (
        <div className="p-2 flex flex-col gap-2 flex-shrink-0 border-b border-[#1a1a3a]">
          <span className="text-[#556] text-[9px] font-mono uppercase tracking-widest px-1">
            {approvals.length} pending
          </span>
          {approvals.map(approval => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              session={sessions.find(s => s.sessionId === approval.sessionId)}
              onDecision={sendApproval}
            />
          ))}
        </div>
      )}

      {/* Worker list */}
      <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
        {sessions.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[#333] text-[11px] font-mono">No workers yet</p>
            <p className="text-[#222] text-[9px] font-mono mt-1">Start a Claude session to see them here</p>
          </div>
        )}
        {sessions.map(session => (
          <WorkerItem
            key={session.sessionId}
            session={session}
            isExpanded={expandedId === session.sessionId}
            onToggle={() => setExpandedId(expandedId === session.sessionId ? null : session.sessionId)}
            focusing={focusing === session.sessionId}
            onFocus={() => handleFocus(session.sessionId)}
          />
        ))}
      </div>
    </div>
  );
}
