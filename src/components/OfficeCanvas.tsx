'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { useRecentCwds } from '@/hooks/useRecentCwds';
import { CANVAS_W, CANVAS_H, TILE_SIZE, SCALE } from '@/game/office-layout';
import { usePixelOffice } from '@/hooks/usePixelOffice';
import { WorkerPanel } from './WorkerPanel';
import { ApprovalToast } from './ApprovalToast';
import { WorkerPopup } from './WorkerPopup';
import { TerminalTile, EmptyTile } from './TerminalTile';

/** Max terminals visible in the grid at once */
const MAX_TILES = 3;

export function OfficeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    sessions, approvals, sendApproval, assetsLoaded,
    selectedWorker, setSelectedWorker, workersRef,
    wsRef, ptyTabs, setPtyTabs, spawnSession, spawnError, terminalHandlersRef, onSpawnSuccessRef,
  } = usePixelOffice(canvasRef);
  const [popupAnchor, setPopupAnchor] = useState<{ x: number; y: number } | null>(null);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

  // Which ptyIds are pinned to visible tiles (up to MAX_TILES)
  const [visiblePtyIds, setVisiblePtyIds] = useState<string[]>([]);

  // Sync visible tiles when tabs change
  useEffect(() => {
    setVisiblePtyIds(prev => {
      // Remove any that no longer exist
      const filtered = prev.filter(id => ptyTabs.some(t => t.ptyId === id));
      // Auto-add new tabs if there's room
      for (const tab of ptyTabs) {
        if (filtered.length >= MAX_TILES) break;
        if (!filtered.includes(tab.ptyId)) {
          filtered.push(tab.ptyId);
        }
      }
      // Only update if changed
      if (filtered.length === prev.length && filtered.every((id, i) => prev[i] === id)) return prev;
      return filtered;
    });
  }, [ptyTabs]);

  useEffect(() => {
    const update = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const openTerminal = useCallback((ptyId: string) => {
    setVisiblePtyIds(prev => {
      if (prev.includes(ptyId)) return prev; // already visible
      if (prev.length < MAX_TILES) return [...prev, ptyId];
      // Replace the last tile
      return [...prev.slice(0, -1), ptyId];
    });
  }, []);

  const closeTerminalTile = useCallback((ptyId: string) => {
    setVisiblePtyIds(prev => prev.filter(id => id !== ptyId));
  }, []);

  const { saveRecent } = useRecentCwds();
  const pendingSpawnCwdRef = useRef<string | null>(null);

  const handleSpawn = useCallback((cwd: string) => {
    pendingSpawnCwdRef.current = cwd;
    spawnSession(cwd);
  }, [spawnSession]);

  // Save to recents only on successful spawn
  useEffect(() => {
    onSpawnSuccessRef.current = () => {
      if (pendingSpawnCwdRef.current) {
        saveRecent(pendingSpawnCwdRef.current);
        pendingSpawnCwdRef.current = null;
      }
    };
  }, [saveRecent, onSpawnSuccessRef]);

  // Drag-to-swap tile reordering
  const dragSourceRef = useRef<string | null>(null);

  const handleTileDragStart = useCallback((ptyId: string) => {
    dragSourceRef.current = ptyId;
  }, []);

  const handleTileDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleTileDrop = useCallback((targetPtyId: string) => {
    const sourcePtyId = dragSourceRef.current;
    if (!sourcePtyId || sourcePtyId === targetPtyId) return;
    setVisiblePtyIds(prev => {
      const sourceIdx = prev.indexOf(sourcePtyId);
      const targetIdx = prev.indexOf(targetPtyId);
      if (targetIdx < 0) return prev;
      // Source is from panel (not visible) — replace target
      if (sourceIdx < 0) {
        const next = [...prev];
        next[targetIdx] = sourcePtyId;
        return next;
      }
      // Both visible — swap
      const next = [...prev];
      next[sourceIdx] = targetPtyId;
      next[targetIdx] = sourcePtyId;
      return next;
    });
    dragSourceRef.current = null;
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const displayW = rect.width;
    const displayH = rect.height;

    const scaleX = displayW / CANVAS_W;
    const scaleY = displayH / CANVAS_H;
    const fitScale = Math.min(scaleX, scaleY);

    const renderedW = CANVAS_W * fitScale;
    const renderedH = CANVAS_H * fitScale;
    const offsetX = (displayW - renderedW) / 2;
    const offsetY = (displayH - renderedH) / 2;

    const clickX = e.clientX - rect.left - offsetX;
    const clickY = e.clientY - rect.top - offsetY;

    const logicalX = clickX / fitScale;
    const logicalY = clickY / fitScale;
    const tileX = logicalX / (TILE_SIZE * SCALE);
    const tileY = logicalY / (TILE_SIZE * SCALE);

    const CLICK_RADIUS = 1.5;
    let closest: string | null = null;
    let closestDist = CLICK_RADIUS;

    for (const [id, worker] of workersRef.current) {
      const dist = Math.sqrt((worker.x - tileX) ** 2 + (worker.y - tileY) ** 2);
      if (dist < closestDist) {
        closestDist = dist;
        closest = id;
      }
    }

    if (closest) {
      setSelectedWorker(closest);
      const worker = workersRef.current.get(closest)!;
      const workerLogicalX = worker.x * TILE_SIZE * SCALE;
      const workerLogicalY = worker.y * TILE_SIZE * SCALE;
      const vpX = rect.left + offsetX + workerLogicalX * fitScale;
      const vpY = rect.top + offsetY + workerLogicalY * fitScale;
      setPopupAnchor({ x: vpX, y: vpY });
    } else {
      setSelectedWorker(null);
      setPopupAnchor(null);
    }
  }, [workersRef, setSelectedWorker, sessions]);

  const handleDismissPopup = useCallback(() => {
    setSelectedWorker(null);
    setPopupAnchor(null);
  }, [setSelectedWorker]);

  // ⌘Y keyboard shortcut — approve the oldest pending approval
  const approvalsRef = useRef(approvals);
  useEffect(() => { approvalsRef.current = approvals; }, [approvals]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        const oldest = approvalsRef.current[0];
        if (oldest) sendApproval(oldest.id, 'allow');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sendApproval]);

  // Build the grid tiles: office + terminals + empty slots
  const visibleTabs = visiblePtyIds
    .map(id => ptyTabs.find(t => t.ptyId === id))
    .filter((t): t is NonNullable<typeof t> => !!t);

  const terminalCount = visibleTabs.length;
  const showEmptyTile = terminalCount < MAX_TILES;

  // Grid layout: 2x2 with office always top-left
  // 0 terminals: office fills the whole area
  // 1 terminal: office left, terminal right
  // 2 terminals: office top-left, term1 top-right, term2 bottom spanning full
  // 3 terminals: office top-left, term1 top-right, term2 bottom-left, term3 bottom-right
  const totalTiles = terminalCount + (showEmptyTile ? 1 : 0);

  return (
    <div className="flex h-screen w-screen bg-[#08080f] overflow-hidden">
      {/* Main grid area */}
      <div className={`flex-1 grid gap-[1px] p-[1px] min-w-0 ${
        totalTiles === 0
          ? 'grid-cols-1 grid-rows-1'
          : totalTiles <= 1
            ? 'grid-cols-2 grid-rows-1'
            : 'grid-cols-2 grid-rows-2'
      }`}>
        {/* Office tile — always present */}
        <div className={`relative flex items-center justify-center bg-[#0e0e1e] rounded overflow-hidden ${
          totalTiles >= 3 ? '' : totalTiles === 2 ? '' : totalTiles === 0 ? 'col-span-2 row-span-2' : ''
        }`}>
          {!assetsLoaded && (
            <div className="absolute inset-0 flex items-center justify-center z-20">
              <span className="text-[#8888aa] font-mono text-sm animate-pulse">Loading assets…</span>
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="max-w-full max-h-full object-contain cursor-pointer"
            style={{ imageRendering: 'pixelated', opacity: assetsLoaded ? 1 : 0 }}
            onClick={handleCanvasClick}
          />
          {/* Approval toasts */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col gap-2 z-30">
            {approvals.map(approval => (
              <ApprovalToast
                key={approval.id}
                approval={approval}
                session={sessions.find(s => s.sessionId === approval.sessionId)}
                onDecision={sendApproval}
              />
            ))}
          </div>
          {/* Worker popup */}
          {selectedWorker && popupAnchor && (() => {
            const session = sessions.find(s => s.sessionId === selectedWorker);
            if (!session) return null;
            return (
              <WorkerPopup
                session={session}
                anchorX={popupAnchor.x}
                anchorY={popupAnchor.y}
                viewportW={viewportSize.w}
                viewportH={viewportSize.h}
                onDismiss={handleDismissPopup}
                onOpenTerminal={session.ptyId ? () => openTerminal(session.ptyId!) : undefined}
              />
            );
          })()}
        </div>

        {/* Terminal tiles */}
        {visibleTabs.map((tab) => (
          <TerminalTile
            key={tab.ptyId}
            tab={tab}
            session={sessions.find(s => s.ptyId === tab.ptyId)}
            wsRef={wsRef}
            terminalHandlers={terminalHandlersRef}
            onClose={() => closeTerminalTile(tab.ptyId)}
            onSpawnHere={handleSpawn}
            onDragStart={() => handleTileDragStart(tab.ptyId)}
            onDragOver={handleTileDragOver}
            onDrop={() => handleTileDrop(tab.ptyId)}
          />
        ))}

        {/* Empty tile for spawning */}
        {showEmptyTile && totalTiles > 0 && (
          <EmptyTile
            onSpawn={handleSpawn}
            spawnError={spawnError}
            onDropPty={(ptyId) => {
              setVisiblePtyIds(prev => {
                if (prev.includes(ptyId)) return prev;
                if (prev.length >= MAX_TILES) return prev;
                return [...prev, ptyId];
              });
            }}
          />
        )}
      </div>

      {/* Right panel — sessions */}
      <WorkerPanel
        sessions={sessions}
        visiblePtyIds={visiblePtyIds}
        onSelectWorker={(id) => {
          if (id) {
            setSelectedWorker(null);
            setPopupAnchor(null);
          }
        }}
        onOpenTerminal={openTerminal}
        onSpawn={handleSpawn}
        spawnError={spawnError}
        onDragSessionStart={handleTileDragStart}
      />
    </div>
  );
}
