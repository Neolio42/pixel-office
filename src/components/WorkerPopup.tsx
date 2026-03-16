'use client';

import { useState } from 'react';
import { Session } from '@/lib/types';

const STATE_LABELS: Record<string, string> = {
  idle: 'Idle',
  typing: 'Typing',
  reading: 'Reading',
  waiting: 'Awaiting approval',
  walking: 'Walking',
};

const STATE_COLORS: Record<string, string> = {
  idle: '#888888',
  typing: '#4a7cbf',
  reading: '#4abf5c',
  waiting: '#bf8b4a',
  walking: '#8b4abf',
};

const WORKER_NAMES = ['Pixel', 'Byte', 'Cache', 'Queue', 'Stack'];

// Character sprite colors to give each worker a distinct color swatch
const CHAR_COLORS = ['#e05c5c', '#5c9be0', '#5ce07a', '#e0c55c', '#c55ce0', '#5ce0d4'];

interface Props {
  session: Session;
  // Position in viewport pixels where the popup should anchor near the worker
  anchorX: number;
  anchorY: number;
  // Viewport dimensions for edge-clamping
  viewportW: number;
  viewportH: number;
  onDismiss: () => void;
}

export function WorkerPopup({ session, anchorX, anchorY, viewportW, viewportH, onDismiss }: Props) {
  const [focusing, setFocusing] = useState(false);

  async function handleFocusTerminal() {
    setFocusing(true);
    try {
      await fetch('/api/focus-terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
    } finally {
      setFocusing(false);
    }
  }

  const popupW = 260;
  const popupH = 220; // approximate

  // Place popup above-right of the worker sprite, then clamp to viewport
  let left = anchorX + 12;
  let top = anchorY - popupH - 12;

  if (left + popupW > viewportW - 8) left = anchorX - popupW - 12;
  if (left < 8) left = 8;
  if (top < 8) top = anchorY + 40;
  if (top + popupH > viewportH - 8) top = viewportH - popupH - 8;

  const name = WORKER_NAMES[session.deskIndex] ?? `Worker ${session.deskIndex}`;
  const charColor = CHAR_COLORS[session.deskIndex % CHAR_COLORS.length];
  const stateLabel = STATE_LABELS[session.state] ?? session.state;
  const stateColor = STATE_COLORS[session.state] ?? '#888888';

  const minutesAgo = Math.floor((Date.now() - session.startedAt) / 60000);
  const durationLabel = minutesAgo < 1
    ? 'just started'
    : minutesAgo === 1
    ? '1 minute ago'
    : `${minutesAgo} minutes ago`;

  const cwdShort = session.cwd.length > 34
    ? '…' + session.cwd.slice(-(33))
    : session.cwd;

  return (
    <div
      className="fixed z-20 pointer-events-auto"
      style={{ left, top, width: popupW }}
    >
      {/* Pixel-art border feel: layered box-shadow */}
      <div
        className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-lg p-3 shadow-lg"
        style={{ boxShadow: '0 0 0 1px #0a0a1e, 0 4px 24px rgba(0,0,0,0.6)' }}
      >
        {/* Header row: color swatch + name */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded-sm border border-[#3a3a5a] flex-shrink-0"
              style={{ backgroundColor: charColor }}
            />
            <span className="text-[#ccccee] text-sm font-mono font-bold">{name}</span>
          </div>
          <button
            onClick={onDismiss}
            className="text-[#555577] hover:text-[#8888aa] text-xs font-mono leading-none px-1 transition-colors cursor-pointer"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>

        {/* Divider */}
        <div className="border-t border-[#2a2a4a] mb-2" />

        {/* State row */}
        <div className="flex items-center gap-2 mb-1.5">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: stateColor }}
          />
          <span className="text-[#8888aa] text-xs font-mono">{stateLabel}</span>
        </div>

        {/* Current tool */}
        {session.currentTool && (
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-[#555577] text-xs font-mono w-12 flex-shrink-0">tool</span>
            <span className="text-[#6688aa] text-xs font-mono">{session.currentTool}</span>
          </div>
        )}

        {/* cwd */}
        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="text-[#555577] text-xs font-mono w-12 flex-shrink-0">cwd</span>
          <span
            className="text-[#6a6a8a] text-xs font-mono truncate"
            title={session.cwd}
          >
            {cwdShort}
          </span>
        </div>

        {/* Session duration */}
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-[#555577] text-xs font-mono w-12 flex-shrink-0">since</span>
          <span className="text-[#6a6a8a] text-xs font-mono">{durationLabel}</span>
        </div>

        {/* Recent tools */}
        {session.recentTools.length > 0 && (
          <>
            <div className="border-t border-[#2a2a4a] mb-2 mt-1" />
            <div className="text-[#555577] text-xs font-mono mb-1">recent</div>
            <div className="flex flex-col gap-0.5 mb-2">
              {session.recentTools.slice(-4).reverse().map((t, i) => (
                <div
                  key={t.timestamp}
                  className="text-xs font-mono truncate"
                  style={{ color: i === 0 ? '#7799bb' : '#4a4a6a' }}
                  title={t.summary}
                >
                  {t.summary}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleFocusTerminal}
            disabled={focusing}
            className="flex-1 py-1.5 bg-[#12122a] hover:bg-[#1e1e3a] border border-[#2a2a4a] hover:border-[#3a3a5a] text-[#8888aa] hover:text-[#aaaacc] text-xs font-mono rounded transition-colors cursor-pointer disabled:opacity-50"
          >
            {focusing ? 'Focusing…' : 'Focus Terminal'}
          </button>
          <button
            onClick={onDismiss}
            className="flex-1 py-1.5 bg-[#12122a] hover:bg-[#1e1e3a] border border-[#2a2a4a] hover:border-[#3a3a5a] text-[#8888aa] hover:text-[#aaaacc] text-xs font-mono rounded transition-colors cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
