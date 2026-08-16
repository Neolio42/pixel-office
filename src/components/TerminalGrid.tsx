'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { WorkerPanel } from './WorkerPanel';
import { ApprovalToast } from './ApprovalToast';
import { PaneContainer } from './PaneContainer';
import { WhitelistPanel } from './WhitelistPanel';
import { useRecentCwds } from '@/hooks/useRecentCwds';

export function TerminalGrid() {
  const {
    sessions, approvals, approvalsRef, sendApproval, sendAlwaysAllow,
    wsRef, ptyTabs, setPtyTabs, spawnSession, spawnError, terminalHandlersRef,
    onSpawnSuccessRef, reconnectCount,
  } = useWorkspace();

  const [whitelistOpen, setWhitelistOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = localStorage.getItem('pixel-office-sidebar-open');
      return stored !== 'false';
    } catch { return true; }
  });

  // Persist sidebar state
  useEffect(() => {
    try { localStorage.setItem('pixel-office-sidebar-open', String(sidebarOpen)); } catch {}
  }, [sidebarOpen]);

  // Save recent CWDs on successful spawn
  const { saveRecent } = useRecentCwds();
  const pendingSpawnCwdRef = useRef<string | null>(null);

  const handleSpawn = useCallback((cwd: string) => {
    pendingSpawnCwdRef.current = cwd;
    spawnSession(cwd);
  }, [spawnSession]);

  useEffect(() => {
    onSpawnSuccessRef.current = () => {
      if (pendingSpawnCwdRef.current) {
        saveRecent(pendingSpawnCwdRef.current);
        pendingSpawnCwdRef.current = null;
      }
    };
  }, [saveRecent, onSpawnSuccessRef]);

  const handleClosePane = useCallback((ptyId: string) => {
    setPtyTabs(prev => prev.filter(t => t.ptyId !== ptyId));
  }, [setPtyTabs]);

  // Keyboard shortcuts: Cmd+Y approve, Cmd+N deny
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        const oldest = approvalsRef.current[0];
        if (oldest) sendApproval(oldest.id, 'allow');
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        const oldest = approvalsRef.current[0];
        if (oldest) sendApproval(oldest.id, 'deny');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sendApproval, approvalsRef]);

  return (
    <div className="flex h-screen w-screen bg-[#08080f] overflow-hidden">
      {/* Main area: header + pane container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header bar */}
        <div className="h-8 bg-[#0e0e1e] border-b border-[#1a1a3a] flex items-center justify-between px-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#4abf5c] animate-pulse" />
            <span className="text-[#445] text-[10px] font-mono uppercase tracking-widest">
              Pixel Office
            </span>
            <span className="text-[#222] text-[10px] font-mono">
              {sessions.length} session{sessions.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSidebarOpen(prev => !prev)}
              className="px-1.5 py-0.5 text-[#333] hover:text-[#888] hover:bg-[#1a1a3a] text-[12px] font-mono cursor-pointer transition-colors rounded"
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              ≡
            </button>
            <button
              onClick={() => setWhitelistOpen(true)}
              className="px-1.5 py-0.5 text-[#333] hover:text-[#888] hover:bg-[#1a1a3a] text-[12px] font-mono cursor-pointer transition-colors rounded"
              title="Whitelist & stats"
            >
              ⚙
            </button>
          </div>
        </div>

        {/* Terminal pane container */}
        <PaneContainer
          ptyTabs={ptyTabs}
          sessions={sessions}
          wsRef={wsRef}
          terminalHandlers={terminalHandlersRef}
          reconnectCount={reconnectCount}
          onClosePane={handleClosePane}
          onSpawn={handleSpawn}
          spawnError={spawnError}
        />
      </div>

      {/* Approval toasts — fixed at top center */}
      {approvals.length > 0 && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 flex flex-col gap-2 z-50">
          {approvals.map(approval => (
            <ApprovalToast
              key={approval.id}
              approval={approval}
              session={sessions.find(s => s.sessionId === approval.sessionId)}
              onDecision={sendApproval}
              onAlwaysAllow={sendAlwaysAllow}
            />
          ))}
        </div>
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <WorkerPanel
          sessions={sessions}
          onSpawn={handleSpawn}
          spawnError={spawnError}
        />
      )}

      <WhitelistPanel open={whitelistOpen} onClose={() => setWhitelistOpen(false)} />
    </div>
  );
}
