'use client';

import { useState, useEffect } from 'react';
import { Session } from '@/lib/types';
import { STATE_COLORS } from '@/lib/ui-constants';

interface Props {
  session: Session;
  anchorX: number;
  anchorY: number;
  viewportW: number;
  viewportH: number;
  onDismiss: () => void;
  onOpenTerminal?: () => void;
}

export function WorkerPopup({ session, anchorX, anchorY, viewportW, viewportH, onDismiss, onOpenTerminal }: Props) {
  const [focusing, setFocusing] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

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

  const popupW = 250;
  const popupH = 140;

  let left = anchorX + 12;
  let top = anchorY - popupH - 12;
  if (left + popupW > viewportW - 8) left = anchorX - popupW - 12;
  if (left < 8) left = 8;
  if (top < 8) top = anchorY + 40;
  if (top + popupH > viewportH - 8) top = viewportH - popupH - 8;

  const project = session.cwd.split('/').filter(Boolean).pop() || session.cwd;
  const stateColor = STATE_COLORS[session.state] ?? '#444';
  const minutesAgo = Math.floor((Date.now() - session.startedAt) / 60000);
  const duration = minutesAgo < 1 ? 'just now' : `${minutesAgo}m`;
  const focus = session.currentFocus;
  const lastTool = session.recentTools[session.recentTools.length - 1];

  return (
    <div
      className="fixed z-20 pointer-events-auto"
      style={{ left, top, width: popupW }}
    >
      <div
        className="bg-[#0e0e1e] border border-[#1e1e3e] rounded-lg p-2.5"
        style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.7)' }}
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: stateColor }}
          />
          <span className="text-[#99a] text-[11px] font-mono font-bold flex-1">{project}</span>
          <span className="text-[#2a2a3a] text-[10px] font-mono">{duration}</span>
          <button
            onClick={onDismiss}
            className="text-[#333] hover:text-[#666] text-[11px] font-mono leading-none px-0.5 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Focus — primary */}
        {focus && (
          <div className="text-[#aab0b8] text-[11px] font-mono mb-1 ml-3 leading-relaxed">{focus}</div>
        )}

        {/* Current tool — secondary */}
        {lastTool && (
          <div className="text-[#3a3a5a] text-[10px] font-mono mb-2 ml-3">{lastTool.summary}</div>
        )}

        {!focus && !lastTool && (
          <div className="text-[#333] text-[11px] font-mono mb-2 ml-3 italic">
            {session.state === 'idle' ? 'Idle' : 'Working'}
          </div>
        )}

        {onOpenTerminal ? (
          <button
            onClick={() => { onOpenTerminal(); onDismiss(); }}
            className="w-full py-1 bg-[#0a0a16] hover:bg-[#141428] border border-[#1a1a30] text-[#445] hover:text-[#778] text-[10px] font-mono rounded transition-colors cursor-pointer"
          >
            Open Terminal
          </button>
        ) : (
          <button
            onClick={handleFocusTerminal}
            disabled={focusing}
            className="w-full py-1 bg-[#0a0a16] hover:bg-[#141428] border border-[#1a1a30] text-[#445] hover:text-[#778] text-[10px] font-mono rounded transition-colors cursor-pointer disabled:opacity-50"
          >
            {focusing ? 'Focusing…' : 'Focus Terminal'}
          </button>
        )}
      </div>
    </div>
  );
}
