'use client';

import { useState, useRef, useEffect } from 'react';
import { Session } from '@/lib/types';
import { useRecentCwds } from '@/hooks/useRecentCwds';

const STATE_COLORS: Record<string, string> = {
  idle: '#444',
  typing: '#4a7cbf',
  reading: '#4abf5c',
  waiting: '#bf8b4a',
  walking: '#8b4abf',
};

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
  // Track which sessions just appeared for slide-in animation
  const knownSessionsRef = useRef<Set<string>>(new Set());
  const [newSessionIds, setNewSessionIds] = useState<Set<string>>(new Set());
  // Track state changes for flash animation
  const prevStatesRef = useRef<Map<string, string>>(new Map());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(sessions.map(s => s.sessionId));
    const freshIds = new Set<string>();
    for (const id of currentIds) {
      if (!knownSessionsRef.current.has(id)) {
        freshIds.add(id);
      }
    }
    knownSessionsRef.current = currentIds; // always update before early return
    if (freshIds.size > 0) {
      setNewSessionIds(freshIds);
      const timer = setTimeout(() => setNewSessionIds(new Set()), 400);
      return () => clearTimeout(timer);
    }
  }, [sessions]);

  // Detect state changes for flash effect
  useEffect(() => {
    const flashing = new Set<string>();
    const currentIds = new Set<string>();
    for (const s of sessions) {
      currentIds.add(s.sessionId);
      const prev = prevStatesRef.current.get(s.sessionId);
      if (prev && prev !== s.state) {
        flashing.add(s.sessionId);
      }
      prevStatesRef.current.set(s.sessionId, s.state);
    }
    // Prune entries for removed sessions
    for (const id of prevStatesRef.current.keys()) {
      if (!currentIds.has(id)) prevStatesRef.current.delete(id);
    }
    if (flashing.size > 0) {
      setFlashIds(flashing);
      const timer = setTimeout(() => setFlashIds(new Set()), 600);
      return () => clearTimeout(timer);
    }
  }, [sessions]);

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
  }

  return (
    <div className="w-56 bg-[#0e0e1e] border-l border-[#1a1a3a] overflow-y-auto flex flex-col">
      {/* Header with spawn button */}
      <div className="px-3 py-2.5 border-b border-[#1a1a3a] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${sessions.length > 0 ? 'bg-[#4abf5c] animate-pulse' : 'bg-[#333]'}`} />
          <span className="text-[#556] text-[10px] font-mono uppercase tracking-widest">
            {sessions.length} worker{sessions.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={() => setShowSpawnInput(!showSpawnInput)}
          className="w-5 h-5 flex items-center justify-center text-[#333] hover:text-[#888] hover:bg-[#1a1a3a] text-[14px] font-mono cursor-pointer transition-colors rounded"
          title="Spawn new Claude session"
        >
          +
        </button>
      </div>

      {/* Spawn input + recent projects */}
      {showSpawnInput && (
        <div className="px-2 py-2 border-b border-[#1a1a3a] bg-[#0a0a18]">
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
          <p className="text-[#333] text-[11px] font-mono">No workers yet</p>
          <p className="text-[#222] text-[9px] font-mono mt-1">Start a Claude session to see them here</p>
        </div>
      )}

      <div className="flex-1 p-1 flex flex-col gap-0.5">
        {sessions.map((session) => {
          const isExpanded = expandedId === session.sessionId;
          const isIdle = session.state === 'idle';
          const isWaiting = session.state === 'waiting';
          const project = projectName(session.cwd);
          const stateColor = STATE_COLORS[session.state] || '#444';
          const stateIcon = STATE_ICONS[session.state] || '·';
          const focus = session.currentFocus || null;
          const lastTool = session.recentTools[session.recentTools.length - 1];
          const isVisible = session.ptyId ? visiblePtyIds.includes(session.ptyId) : false;
          const isNew = newSessionIds.has(session.sessionId);
          const isFlashing = flashIds.has(session.sessionId);

          return (
            <div
              key={session.sessionId}
              className={`rounded-md cursor-pointer transition-all duration-200 overflow-hidden ${
                isNew ? 'animate-[slideIn_0.3s_ease-out]' : ''
              } ${
                isExpanded
                  ? 'bg-[#161630]'
                  : 'hover:bg-[#12122a]'
              }`}
              style={{
                borderLeft: `2px solid ${stateColor}`,
                backgroundColor: isFlashing ? `${stateColor}10` : undefined,
              }}
              onClick={() => handleClick(session.sessionId)}
              draggable={!!session.ptyId}
              onDragStart={(e) => {
                if (session.ptyId) {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', session.ptyId);
                  onDragSessionStart?.(session.ptyId);
                }
              }}
            >
              <div className="px-2 py-1.5">
                {/* Project name + state icon + time */}
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
                  <div className="text-[#8899aa] text-[10px] font-mono mt-0.5 ml-4 leading-relaxed truncate">
                    {focus}
                  </div>
                )}

                {lastTool && !isIdle && (
                  <div className="text-[#3a3a5a] text-[9px] font-mono mt-0.5 ml-4 truncate">
                    {lastTool.summary}
                  </div>
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

              {/* Expanded section with smooth height transition */}
              <div
                className="grid transition-[grid-template-rows] duration-200"
                style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
              >
                <div className="overflow-hidden">
                  <div className="px-2 pb-2 pt-1">
                    {/* Tool history as mini timeline */}
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
                    {session.ptyId ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenTerminal?.(session.ptyId!);
                        }}
                        className="w-full py-1 bg-[#0a0a16] hover:bg-[#141428] border border-[#1a1a30] text-[#445] hover:text-[#778] text-[9px] font-mono rounded transition-colors cursor-pointer"
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
                        className="w-full py-1 bg-[#0a0a16] hover:bg-[#141428] border border-[#1a1a30] text-[#445] hover:text-[#778] text-[9px] font-mono rounded transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {focusing === session.sessionId ? 'Focusing…' : 'Focus Terminal'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
