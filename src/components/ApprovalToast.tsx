'use client';

import { useState, useRef, useEffect } from 'react';
import { ApprovalRequest } from '@/hooks/usePixelOffice';
import { Session } from '@/lib/types';

const WORKER_NAMES = ['Pixel', 'Byte', 'Cache', 'Queue', 'Stack'];

/** Clean up a tool name for display — strips mcp__ prefix and underscores. */
function cleanToolName(toolName: string): string {
  const mcpMatch = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (mcpMatch) {
    const server = mcpMatch[1].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const action = mcpMatch[2].replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `${server}: ${action}`;
  }
  return toolName;
}

function formatToolDetails(toolName: string, toolInput: Record<string, unknown>): { title: string; details: string[] } {
  if (toolName === 'Bash' || toolName === 'BashOutput') {
    const cmd = String(toolInput.command || '').trim();
    return {
      title: 'Run command',
      details: [cmd],
    };
  }

  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') {
    const path = String(toolInput.file_path || '');
    const shortPath = path.split('/').slice(-3).join('/');
    return {
      title: `${toolName} file`,
      details: [shortPath],
    };
  }

  if (toolName === 'Read') {
    const path = String(toolInput.file_path || '');
    const shortPath = path.split('/').slice(-3).join('/');
    return {
      title: 'Read file',
      details: [shortPath],
    };
  }

  // MCP or unknown tool: clean up the name and show string input values
  const title = cleanToolName(toolName);
  const details: string[] = [];
  for (const [key, value] of Object.entries(toolInput)) {
    if (typeof value === 'string') {
      details.push(`${key}: ${value.length > 120 ? value.slice(0, 120) + '…' : value}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      details.push(`${key}: ${value}`);
    }
  }
  if (details.length === 0) {
    details.push(JSON.stringify(toolInput).slice(0, 200));
  }

  return { title, details };
}

interface Props {
  approval: ApprovalRequest;
  session?: Session;
  onDecision: (approvalId: string, decision: 'allow' | 'deny', message?: string) => void;
}

export function ApprovalToast({ approval, session, onDecision }: Props) {
  const { title, details } = formatToolDetails(approval.toolName, approval.toolInput);
  const workerName = session ? (WORKER_NAMES[session.deskIndex] ?? `Worker ${session.deskIndex}`) : null;
  const cwdShort = session ? session.cwd.split('/').slice(-2).join('/') : null;
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when toast appears
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (decision: 'allow' | 'deny') => {
    onDecision(approval.id, decision, message.trim() || undefined);
  };

  return (
    <div className="bg-[#1a1a2e] border border-[#bf8b4a]/60 rounded-lg shadow-2xl min-w-[420px] max-w-[580px] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-[#bf8b4a]/10 border-b border-[#bf8b4a]/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#bf8b4a] animate-pulse" />
          <span className="text-[#bf8b4a] text-xs font-mono font-bold uppercase tracking-wider">
            Approval Required
          </span>
        </div>
        {workerName && (
          <span className="text-[#6a6a8a] text-xs font-mono">
            {workerName}{cwdShort ? ` · ${cwdShort}` : ''}
          </span>
        )}
      </div>

      {/* Task context */}
      {session?.task && (
        <div className="px-4 pt-2 pb-0">
          <div className="text-[#8899aa] text-xs font-mono truncate" title={session.task}>
            {session.task.replace(/^[\s—–\-•*]+/, '')}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="px-4 py-3">
        <div className="text-[#ccccee] text-sm font-mono font-bold mb-2">
          {title}
        </div>
        <div className="bg-[#0e0e1a] rounded border border-[#2a2a4a] p-2.5 mb-3 max-h-[120px] overflow-y-auto">
          {details.map((line, i) => (
            <div key={i} className="text-[#9999bb] text-xs font-mono break-all whitespace-pre-wrap leading-relaxed">
              {line}
            </div>
          ))}
        </div>

        {/* Instructions input */}
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit(e.shiftKey ? 'deny' : 'allow');
            }
            e.stopPropagation();
          }}
          placeholder="Instructions for Claude (optional)"
          className="w-full bg-[#0e0e1a] border border-[#2a2a4a] focus:border-[#bf8b4a]/50 rounded px-2.5 py-2 text-[#ccccee] text-xs font-mono placeholder-[#4a4a6a] outline-none transition-colors"
        />
      </div>

      {/* Actions */}
      <div className="px-4 pb-3 flex gap-2">
        <button
          onClick={() => handleSubmit('allow')}
          className="flex-1 px-4 py-2.5 bg-[#1a3a2a] hover:bg-[#2a5a3a] border border-[#2a6b3a] text-[#4abf5c] text-sm font-mono font-bold rounded transition-colors cursor-pointer flex items-center justify-center gap-2"
        >
          <span>Approve</span>
          <span className="text-[#4abf5c]/60 text-xs">↵</span>
        </button>
        <button
          onClick={() => handleSubmit('deny')}
          className="flex-1 px-4 py-2.5 bg-[#3a1a1a] hover:bg-[#5a2a2a] border border-[#6b2a2a] text-[#e05c5c] text-sm font-mono font-bold rounded transition-colors cursor-pointer flex items-center justify-center gap-2"
        >
          <span>Deny</span>
          <span className="text-[#e05c5c]/60 text-xs">⇧↵</span>
        </button>
      </div>
    </div>
  );
}
