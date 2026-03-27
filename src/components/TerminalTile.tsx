'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Terminal } from './Terminal';
import { PtyTab } from '@/hooks/usePixelOffice';
import { Session, WSMessageToClient } from '@/lib/types';
import { useRecentCwds } from '@/hooks/useRecentCwds';

interface TerminalTileProps {
  tab: PtyTab;
  session?: Session;
  wsRef: React.RefObject<WebSocket | null>;
  terminalHandlers: React.RefObject<Map<string, (msg: WSMessageToClient) => void>>;
  onClose: () => void;
  onSpawnHere: (cwd: string) => void;
  /** For drag-to-swap reordering */
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  reconnectCount?: number;
}

function projectName(cwd: string): string {
  if (!cwd) return 'starting…';
  return cwd.split('/').filter(Boolean).pop() || cwd;
}

function stateColor(session: Session | undefined, exited: boolean): string {
  if (exited) return '#4a2020';
  if (!session) return '#555';
  switch (session.state) {
    case 'typing': return '#4a7cbf';
    case 'reading': return '#4abf5c';
    case 'waiting': return '#bf8b4a';
    default: return '#555';
  }
}

export function TerminalTile({ tab, session, wsRef, terminalHandlers, onClose, onSpawnHere, onDragStart, onDragOver, onDrop, reconnectCount }: TerminalTileProps) {
  const name = projectName(tab.cwd);
  const color = stateColor(session, tab.exited);
  const isActive = session && !tab.exited && session.state !== 'idle';
  const focus = session?.currentFocus || null;
  const lastTool = session?.recentTools?.[session.recentTools.length - 1];
  const subtitle = focus || (lastTool && session?.state !== 'idle' ? lastTool.summary : null);

  return (
    <div
      className="flex flex-col bg-[#0a0a18] border border-[#1a1a3a] rounded overflow-hidden"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Title bar — draggable for reordering */}
      <div
        className="flex flex-col border-b border-[#1a1a3a] flex-shrink-0 group cursor-grab active:cursor-grabbing"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          onDragStart?.();
        }}
      >
        <div className="flex items-center h-7 px-2">
          <div
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mr-1.5 ${isActive ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: color }}
          />
          <span className="text-[#888] text-[11px] font-mono flex-1 truncate">
            {tab.exited ? `${name} (exited)` : name}
          </span>
          {session?.state === 'waiting' && (
            <span className="text-[#bf8b4a] text-[9px] font-mono mr-2">Approval</span>
          )}
          <button
            draggable={false}
            onMouseDown={e => e.stopPropagation()}
            className="text-[#222] hover:text-[#888] text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {subtitle && (
          <div className="px-2 pb-1 text-[#3a3a5a] text-[10px] font-mono truncate">
            {subtitle}
          </div>
        )}
      </div>

      {/* Terminal */}
      <div className="flex-1 min-h-0 bg-[#0e0e1e]">
        <Terminal ptyId={tab.ptyId} wsRef={wsRef} terminalHandlers={terminalHandlers} reconnectCount={reconnectCount} />
      </div>
    </div>
  );
}

/** Empty tile with spawn button — also accepts drops from panel */
export function EmptyTile({ onSpawn, onDropPty, spawnError }: { onSpawn: (cwd: string) => void; onDropPty?: (ptyId: string) => void; spawnError?: string | null }) {
  const [showInput, setShowInput] = useState(false);
  const [cwd, setCwd] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { recents } = useRecentCwds();

  useEffect(() => {
    if (showInput) requestAnimationFrame(() => inputRef.current?.focus());
  }, [showInput]);

  const handleSubmit = useCallback(() => {
    onSpawn(cwd.trim() || '~');
    setCwd('');
    // Don't close input — it stays open until spawn succeeds (tile gets replaced)
    // or error shows. If spawn succeeds, the tile disappears anyway.
  }, [cwd, onSpawn]);

  const handleQuickSpawn = useCallback((path: string) => {
    onSpawn(path);
  }, [onSpawn]);

  return (
    <div
      className="flex flex-col items-center justify-center bg-[#080814] border border-[#141430] border-dashed rounded gap-3"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDrop={(e) => {
        e.preventDefault();
        const ptyId = e.dataTransfer.getData('text/plain');
        if (ptyId) onDropPty?.(ptyId);
      }}
    >
      {showInput ? (
        <div className="flex flex-col gap-2 w-72">
          {/* Recent projects */}
          {recents.length > 0 && (
            <div className="flex flex-wrap gap-1 justify-center">
              {recents.map(r => (
                <button
                  key={r}
                  onClick={() => handleQuickSpawn(r)}
                  className="px-2 py-0.5 bg-[#0a0a16] hover:bg-[#1a1a4a] border border-[#1a1a3a] text-[#556] hover:text-[#aab] text-[10px] font-mono rounded cursor-pointer transition-colors"
                >
                  {projectName(r)}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
                if (e.key === 'Escape') setShowInput(false);
              }}
              placeholder="Desktop/Projects/my-app"
              className="flex-1 bg-[#0a0a16] border border-[#1a1a3a] rounded px-2 py-1.5 text-[11px] font-mono text-[#aab] placeholder-[#2a2a4a] focus:outline-none focus:border-[#3a3a6a]"
            />
            <button
              onClick={handleSubmit}
              className="px-3 py-1.5 bg-[#1a1a4a] hover:bg-[#2a2a6a] text-[#aab] text-[11px] font-mono rounded cursor-pointer"
            >
              Go
            </button>
          </div>
          {spawnError && (
            <div className="text-[#ff5555] text-[10px] font-mono text-center mt-1">{spawnError}</div>
          )}
        </div>
      ) : (
        <>
          {spawnError && (
            <div className="text-[#ff5555] text-[10px] font-mono text-center mb-1">{spawnError}</div>
          )}
          <button
            onClick={() => setShowInput(true)}
            className="px-4 py-2 text-[#2a2a5a] hover:text-[#5a5a8a] text-[12px] font-mono transition-colors cursor-pointer"
          >
            + New Session
          </button>
        </>
      )}
    </div>
  );
}
