'use client';

import { useState } from 'react';
import { Session } from '@/lib/types';

const STATE_COLORS: Record<string, string> = {
  idle: '#444',
  typing: '#4a7cbf',
  reading: '#4abf5c',
  waiting: '#bf8b4a',
  walking: '#8b4abf',
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

interface Props {
  sessions: Session[];
  onSelectWorker?: (sessionId: string | null) => void;
}

export function WorkerPanel({ sessions, onSelectWorker }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusing, setFocusing] = useState<string | null>(null);

  function handleClick(sessionId: string) {
    const next = expandedId === sessionId ? null : sessionId;
    setExpandedId(next);
    onSelectWorker?.(next);
  }

  async function handleFocusTerminal(sessionId: string) {
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
  }

  return (
    <div className="w-60 bg-[#0e0e1e] border-l border-[#1a1a3a] overflow-y-auto flex flex-col">
      <div className="px-3 py-2.5 border-b border-[#1a1a3a]">
        <span className="text-[#444] text-[10px] font-mono uppercase tracking-widest">
          {sessions.length} active
        </span>
      </div>

      {sessions.length === 0 && (
        <div className="px-3 py-6 text-center">
          <p className="text-[#333] text-[11px] font-mono">No sessions</p>
        </div>
      )}

      <div className="flex-1 p-1">
        {sessions.map((session) => {
          const isExpanded = expandedId === session.sessionId;
          const isIdle = session.state === 'idle';
          const isWaiting = session.state === 'waiting';
          const project = projectName(session.cwd);
          const stateColor = STATE_COLORS[session.state] || '#444';
          const focus = session.currentFocus || null;
          const lastTool = session.recentTools[session.recentTools.length - 1];

          return (
            <div
              key={session.sessionId}
              className={`rounded cursor-pointer transition-all ${
                isExpanded
                  ? 'bg-[#161630] border border-[#2a2a5a]'
                  : 'border border-transparent hover:bg-[#12122a]'
              }`}
              onClick={() => handleClick(session.sessionId)}
            >
              <div className="px-2 py-2">
                {/* Project name + time */}
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${!isIdle && !isWaiting ? 'animate-pulse' : ''}`}
                    style={{ backgroundColor: stateColor }}
                  />
                  <span className="text-[#99a] text-[11px] font-mono font-bold flex-1 truncate">
                    {project}
                  </span>
                  <span className="text-[#2a2a3a] text-[10px] font-mono flex-shrink-0">
                    {formatDuration(session.startedAt)}
                  </span>
                </div>

                {/* Focus — what they're working on (from prompt heuristic) */}
                {focus && (
                  <div className="text-[#aab0b8] text-[11px] font-mono mt-1 ml-3 leading-relaxed">
                    {focus}
                  </div>
                )}

                {/* Current tool — secondary, dimmer */}
                {lastTool && !isIdle && (
                  <div className="text-[#3a3a5a] text-[10px] font-mono mt-0.5 ml-3 truncate">
                    {lastTool.summary}
                  </div>
                )}

                {!focus && isIdle && (
                  <div className="text-[#2a2a3a] text-[11px] font-mono mt-1 ml-3">Idle</div>
                )}

                {isWaiting && (
                  <div className="ml-3 mt-1">
                    <span className="text-[#bf8b4a] text-[10px] font-mono bg-[#bf8b4a]/8 border border-[#bf8b4a]/15 rounded px-1.5 py-0.5 leading-none">
                      Approval needed
                    </span>
                  </div>
                )}
              </div>

              {isExpanded && (
                <div className="px-2 pb-2 border-t border-[#1a1a3a] pt-1.5">
                  {session.recentTools.length > 1 && (
                    <div className="mb-1.5">
                      {session.recentTools.slice(-4, -1).reverse().map((t, i) => (
                        <div
                          key={t.timestamp}
                          className="text-[10px] font-mono leading-relaxed ml-1 truncate"
                          style={{ color: i === 0 ? '#3a3a5a' : '#222238' }}
                        >
                          {t.summary}
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFocusTerminal(session.sessionId);
                    }}
                    disabled={focusing === session.sessionId}
                    className="w-full py-1 bg-[#0a0a16] hover:bg-[#141428] border border-[#1a1a30] text-[#445] hover:text-[#778] text-[10px] font-mono rounded transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {focusing === session.sessionId ? 'Focusing…' : 'Focus Terminal'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
