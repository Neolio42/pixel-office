'use client';

import { Session } from '@/lib/types';

const STATE_LABELS: Record<string, string> = {
  idle: 'Idle',
  typing: 'Typing',
  reading: 'Reading',
  waiting: 'Awaiting approval',
  walking: 'Walking',
};

const STATE_COLORS: Record<string, string> = {
  idle: '#888',
  typing: '#4a7cbf',
  reading: '#4abf5c',
  waiting: '#bf8b4a',
  walking: '#8b4abf',
};

const WORKER_NAMES = ['Pixel', 'Byte', 'Cache', 'Queue', 'Stack'];

function formatDuration(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

const ACTIVE_STATES = new Set(['typing', 'reading', 'walking']);

export function WorkerPanel({ sessions }: { sessions: Session[] }) {
  return (
    <div className="w-72 bg-[#12122a] border-l border-[#2a2a4a] p-4 overflow-y-auto">
      <h2 className="text-[#8888aa] text-xs font-mono uppercase tracking-widest mb-4">
        Workers ({sessions.length})
      </h2>
      {sessions.length === 0 && (
        <p className="text-[#555] text-sm font-mono">No active sessions</p>
      )}
      {sessions.map((session) => {
        const isActive = ACTIVE_STATES.has(session.state);
        const isWaiting = session.state === 'waiting';
        return (
          <div
            key={session.sessionId}
            className="mb-3 p-3 rounded-lg bg-[#1a1a3a] border border-[#2a2a4a]"
          >
            <div className="flex items-center gap-2 mb-1">
              {/* Activity indicator: pulsing when active, static when idle */}
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: STATE_COLORS[session.state] || '#888' }}
              />
              <span className="text-[#ccc] text-sm font-mono font-bold flex-1 truncate">
                {WORKER_NAMES[session.deskIndex] || `Worker ${session.deskIndex}`}
              </span>
              <span className="text-[#555] text-xs font-mono flex-shrink-0">
                {formatDuration(session.startedAt)}
              </span>
            </div>
            <div className="flex items-center gap-2 ml-4">
              <span className="text-[#777] text-xs font-mono">
                {STATE_LABELS[session.state] || session.state}
              </span>
              {isWaiting && (
                <span className="text-[#bf8b4a] text-xs font-mono bg-[#bf8b4a]/10 border border-[#bf8b4a]/30 rounded px-1.5 py-0.5 leading-none">
                  Needs approval
                </span>
              )}
            </div>
            {session.recentTools.length > 0 && (
              <div className="text-[#6688aa] text-xs font-mono ml-4 mt-1 truncate" title={session.recentTools[session.recentTools.length - 1].summary}>
                {session.recentTools[session.recentTools.length - 1].summary}
              </div>
            )}
            {session.recentTools.length === 0 && session.currentTool && (
              <div className="text-[#6688aa] text-xs font-mono ml-4 mt-1">
                {session.currentTool}
              </div>
            )}
            <div className="text-[#444] text-xs font-mono ml-4 mt-1 truncate" title={session.cwd}>
              {session.cwd.split('/').slice(-2).join('/')}
            </div>
          </div>
        );
      })}
    </div>
  );
}
