'use client';

import { useState } from 'react';
import { Session } from '@/lib/types';
import { useRecentCwds } from '@/hooks/useRecentCwds';

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
  visiblePtyIds: string[];
  onSelectWorker?: (sessionId: string | null) => void;
  onOpenTerminal?: (ptyId: string) => void;
  onSpawn?: (cwd: string) => void;
  spawnError?: string | null;
  /** Called when user drags a session from the panel — starts a drag with ptyId */
  onDragSessionStart?: (ptyId: string) => void;
}

export function WorkerPanel({ sessions, visiblePtyIds, onSelectWorker, onOpenTerminal, onSpawn, spawnError, onDragSessionStart }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [focusing, setFocusing] = useState<string | null>(null);
  const [showSpawnInput, setShowSpawnInput] = useState(false);
  const [spawnCwd, setSpawnCwd] = useState('');
  const { recents: recentCwds } = useRecentCwds();

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

  function handleSpawnSubmit() {
    const cwd = spawnCwd.trim() || '~';
    onSpawn?.(cwd);
    setSpawnCwd('');
    // Keep open — closes on success (new tab appears) or shows error
  }

  return (
    <div className="w-56 bg-[#0e0e1e] border-l border-[#1a1a3a] overflow-y-auto flex flex-col">
      {/* Header with spawn button */}
      <div className="px-3 py-2 border-b border-[#1a1a3a] flex items-center justify-between">
        <span className="text-[#444] text-[10px] font-mono uppercase tracking-widest">
          {sessions.length} active
        </span>
        <button
          onClick={() => setShowSpawnInput(!showSpawnInput)}
          className="text-[#333] hover:text-[#888] text-[12px] font-mono cursor-pointer transition-colors"
          title="Spawn new Claude session"
        >
          +
        </button>
      </div>

      {/* Spawn input + recent projects */}
      {showSpawnInput && (
        <div className="px-2 py-2 border-b border-[#1a1a3a] bg-[#0a0a18]">
          {/* Recent projects */}
          {recentCwds.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {recentCwds.map(cwd => (
                <button
                  key={cwd}
                  onClick={() => { onSpawn?.(cwd); setShowSpawnInput(false); }}
                  className="px-1.5 py-0.5 bg-[#0a0a16] hover:bg-[#1a1a4a] border border-[#1a1a3a] text-[#556] hover:text-[#aab] text-[9px] font-mono rounded cursor-pointer transition-colors"
                >
                  {projectName(cwd)}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1">
            <input
              autoFocus
              type="text"
              value={spawnCwd}
              onChange={(e) => setSpawnCwd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSpawnSubmit();
                if (e.key === 'Escape') setShowSpawnInput(false);
              }}
              placeholder="~/projects/my-app"
              className="flex-1 bg-[#080816] border border-[#1a1a3a] rounded px-2 py-1 text-[10px] font-mono text-[#aab] placeholder-[#2a2a4a] focus:outline-none focus:border-[#3a3a6a]"
            />
            <button
              onClick={handleSpawnSubmit}
              className="px-2 py-1 bg-[#1a1a4a] hover:bg-[#2a2a6a] text-[#aab] text-[10px] font-mono rounded cursor-pointer"
            >
              Go
            </button>
          </div>
          {spawnError && (
            <div className="text-[#ff5555] text-[9px] font-mono mt-1">{spawnError}</div>
          )}
        </div>
      )}

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
          const isVisible = session.ptyId ? visiblePtyIds.includes(session.ptyId) : false;

          return (
            <div
              key={session.sessionId}
              className={`rounded cursor-pointer transition-all ${
                isExpanded
                  ? 'bg-[#161630] border border-[#2a2a5a]'
                  : 'border border-transparent hover:bg-[#12122a]'
              }`}
              onClick={() => handleClick(session.sessionId)}
              // Make PTY sessions draggable from the panel
              draggable={!!session.ptyId}
              onDragStart={(e) => {
                if (session.ptyId) {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', session.ptyId);
                  onDragSessionStart?.(session.ptyId);
                }
              }}
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
                  {session.ptyId && (
                    <span
                      className={`text-[9px] font-mono flex-shrink-0 ${isVisible ? 'text-[#4a7cbf]' : 'text-[#2a2a4a]'}`}
                      title={isVisible ? 'Visible in grid' : 'Background — drag to grid'}
                    >
                      {isVisible ? '◆' : '◇'}
                    </span>
                  )}
                  <span className="text-[#2a2a3a] text-[10px] font-mono flex-shrink-0">
                    {formatDuration(session.startedAt)}
                  </span>
                </div>

                {/* Focus */}
                {focus && (
                  <div className="text-[#aab0b8] text-[11px] font-mono mt-1 ml-3 leading-relaxed">
                    {focus}
                  </div>
                )}

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
                  {session.ptyId ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTerminal?.(session.ptyId!);
                      }}
                      className="w-full py-1 bg-[#0a0a16] hover:bg-[#141428] border border-[#1a1a30] text-[#445] hover:text-[#778] text-[10px] font-mono rounded transition-colors cursor-pointer"
                    >
                      {isVisible ? 'Show in Grid' : 'Open Terminal'}
                    </button>
                  ) : (
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
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
