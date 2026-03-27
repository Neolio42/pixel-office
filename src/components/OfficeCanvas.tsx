'use client';

import { useRef, useState, useEffect, useCallback, useReducer } from 'react';
import { useRecentCwds } from '@/hooks/useRecentCwds';
import { CANVAS_W, CANVAS_H, TILE_SIZE, SCALE, isWalkable } from '@/game/office-layout';
import { setManualTarget } from '@/game/worker-entity';
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
    sessions, approvals, approvalsRef, sendApproval, assetsLoaded, assetError,
    selectedWorker, setSelectedWorker, workersRef,
    wsRef, ptyTabs, setPtyTabs, spawnSession, spawnError, terminalHandlersRef, onSpawnSuccessRef,
    interactionRef, gridRef, reconnectCount,
  } = usePixelOffice(canvasRef);
  const [popupAnchor, setPopupAnchor] = useState<{ x: number; y: number } | null>(null);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

  // Which ptyIds are pinned to visible tiles (up to MAX_TILES)
  type TileAction =
    | { type: 'sync'; tabs: typeof ptyTabs }
    | { type: 'show'; ptyId: string }
    | { type: 'hide'; ptyId: string }
    | { type: 'add'; ptyId: string }
    | { type: 'reorder'; source: string; target: string };
  const [visiblePtyIds, dispatchTiles] = useReducer((prev: string[], action: TileAction): string[] => {
    switch (action.type) {
      case 'sync': {
        const filtered = prev.filter(id => action.tabs.some(t => t.ptyId === id));
        for (const tab of action.tabs) {
          if (filtered.length >= MAX_TILES) break;
          if (!filtered.includes(tab.ptyId)) filtered.push(tab.ptyId);
        }
        if (filtered.length === prev.length && filtered.every((id, i) => prev[i] === id)) return prev;
        return filtered;
      }
      case 'show': {
        if (prev.includes(action.ptyId)) return prev;
        if (prev.length < MAX_TILES) return [...prev, action.ptyId];
        return [...prev.slice(0, -1), action.ptyId];
      }
      case 'hide':
        return prev.filter(id => id !== action.ptyId);
      case 'add': {
        if (prev.includes(action.ptyId) || prev.length >= MAX_TILES) return prev;
        return [...prev, action.ptyId];
      }
      case 'reorder': {
        const sourceIdx = prev.indexOf(action.source);
        const targetIdx = prev.indexOf(action.target);
        if (targetIdx < 0) return prev;
        if (sourceIdx < 0) {
          const next = [...prev];
          next[targetIdx] = action.source;
          return next;
        }
        const next = [...prev];
        next[sourceIdx] = action.target;
        next[targetIdx] = action.source;
        return next;
      }
    }
  }, []);
  useEffect(() => { dispatchTiles({ type: 'sync', tabs: ptyTabs }); }, [ptyTabs]);

  useEffect(() => {
    const update = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const openTerminal = useCallback((ptyId: string) => {
    // Ensure tab exists in ptyTabs (may have been removed on close)
    setPtyTabs(prev => prev.some(t => t.ptyId === ptyId) ? prev : [...prev, { ptyId, cwd: '', exited: false }]);
    dispatchTiles({ type: 'show', ptyId });
  }, [setPtyTabs]);

  const closeTerminalTile = useCallback((ptyId: string) => {
    setPtyTabs(prev => prev.filter(t => t.ptyId !== ptyId));
    dispatchTiles({ type: 'hide', ptyId });
  }, [setPtyTabs]);

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

  const cachedRectRef = useRef<DOMRect | null>(null);

  // Invalidate cached rect on resize
  useEffect(() => {
    const onResize = () => { cachedRectRef.current = null; };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
    dispatchTiles({ type: 'reorder', source: sourcePtyId, target: targetPtyId });
    dragSourceRef.current = null;
  }, []);

  // ── Canvas mouse interaction: hover, click, drag ─────────────────────────
  const dragStateRef = useRef<{
    workerId: string;
    startClientX: number;
    startClientY: number;
    isDragging: boolean; // true once moved > threshold
  } | null>(null);
  const [canvasCursor, setCanvasCursor] = useState<'default' | 'pointer' | 'grabbing'>('default');

  /** Convert client coords to logical canvas coords and tile coords */
  const clientToCanvas = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = cachedRectRef.current || (cachedRectRef.current = canvas.getBoundingClientRect());
    const fitScale = Math.min(rect.width / CANVAS_W, rect.height / CANVAS_H);
    const renderedW = CANVAS_W * fitScale;
    const renderedH = CANVAS_H * fitScale;
    const offsetX = (rect.width - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;
    const logicalX = (clientX - rect.left - offsetX) / fitScale;
    const logicalY = (clientY - rect.top - offsetY) / fitScale;
    const T = TILE_SIZE * SCALE;
    return { logicalX, logicalY, tileX: logicalX / T, tileY: logicalY / T, rect, fitScale, offsetX, offsetY };
  }, [canvasRef]);

  /** Hit-test workers at tile coords */
  const hitTestWorker = useCallback((tileX: number, tileY: number): string | null => {
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
    return closest;
  }, [workersRef]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = clientToCanvas(e.clientX, e.clientY);
    if (!coords) return;
    const hit = hitTestWorker(coords.tileX, coords.tileY);
    if (hit) {
      dragStateRef.current = {
        workerId: hit,
        startClientX: e.clientX,
        startClientY: e.clientY,
        isDragging: false,
      };
      e.preventDefault();
    }
  }, [clientToCanvas, hitTestWorker]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = clientToCanvas(e.clientX, e.clientY);
    if (!coords) return;

    const drag = dragStateRef.current;
    if (drag) {
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (!drag.isDragging && dx * dx + dy * dy > 16) {
        drag.isDragging = true;
        setCanvasCursor('grabbing');
        interactionRef.current.hoveredWorkerId = null; // clear hover on drag start
      }
      if (drag.isDragging) {
        // Update interaction ref for renderer (mutate in place — no spread)
        const tileXi = Math.floor(coords.tileX);
        const tileYi = Math.floor(coords.tileY);
        const walkable = isWalkable(tileXi, tileYi, gridRef.current);
        interactionRef.current.drag = {
          workerId: drag.workerId,
          cursorX: coords.logicalX,
          cursorY: coords.logicalY,
        };
        interactionRef.current.dropTile = walkable ? { tx: tileXi, ty: tileYi } : null;
        return;
      }
    }

    // Hover hit-testing (not dragging)
    const hit = hitTestWorker(coords.tileX, coords.tileY);
    interactionRef.current.hoveredWorkerId = hit;
    setCanvasCursor(hit ? 'pointer' : 'default');
  }, [clientToCanvas, hitTestWorker, interactionRef, gridRef]);

  /** Shared cleanup for drag end — called from canvas mouseup and window mouseup */
  const clearDrag = useCallback(() => {
    dragStateRef.current = null;
    interactionRef.current.drag = null;
    interactionRef.current.dropTile = null;
    setCanvasCursor('default');
  }, [interactionRef]);

  const handleCanvasMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragStateRef.current;
    clearDrag();

    if (!drag) return;

    const coords = clientToCanvas(e.clientX, e.clientY);
    if (!coords) return;

    if (drag.isDragging) {
      // Drop — set manual walk target
      const tileXi = Math.floor(coords.tileX);
      const tileYi = Math.floor(coords.tileY);
      if (isWalkable(tileXi, tileYi, gridRef.current)) {
        const worker = workersRef.current.get(drag.workerId);
        if (worker) setManualTarget(worker, tileXi, tileYi);
      }
    } else {
      // Short click — select/deselect worker (show popup)
      const hit = hitTestWorker(coords.tileX, coords.tileY);
      if (hit) {
        setSelectedWorker(hit);
        interactionRef.current.selectedWorkerId = hit;
        const worker = workersRef.current.get(hit);
        if (!worker) return;
        const workerLogicalX = worker.x * TILE_SIZE * SCALE;
        const workerLogicalY = worker.y * TILE_SIZE * SCALE;
        const vpX = coords.rect.left + coords.offsetX + workerLogicalX * coords.fitScale;
        const vpY = coords.rect.top + coords.offsetY + workerLogicalY * coords.fitScale;
        setPopupAnchor({ x: vpX, y: vpY });
      } else {
        setSelectedWorker(null);
        setPopupAnchor(null);
        interactionRef.current.selectedWorkerId = null;
      }
    }
  }, [clientToCanvas, hitTestWorker, workersRef, setSelectedWorker, interactionRef, gridRef, clearDrag]);

  const handleCanvasMouseLeave = useCallback(() => {
    if (!dragStateRef.current?.isDragging) {
      interactionRef.current.hoveredWorkerId = null;
      setCanvasCursor('default');
    }
  }, [interactionRef]);

  // Global mouseup listener — catches drag releases outside the canvas
  useEffect(() => {
    const handler = () => {
      if (dragStateRef.current?.isDragging) {
        clearDrag();
      }
    };
    window.addEventListener('mouseup', handler);
    return () => window.removeEventListener('mouseup', handler);
  }, [clearDrag]);

  const handleDismissPopup = useCallback(() => {
    setSelectedWorker(null);
    setPopupAnchor(null);
    interactionRef.current.selectedWorkerId = null;
  }, [setSelectedWorker, interactionRef]);

  // ⌘Y / ⌘N keyboard shortcuts — approve or deny the oldest pending approval
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
          {!assetsLoaded && !assetError && (
            <div className="absolute inset-0 flex items-center justify-center z-20">
              <span className="text-[#8888aa] font-mono text-sm animate-pulse">Loading assets…</span>
            </div>
          )}
          {assetError && (
            <div className="absolute inset-0 flex items-center justify-center z-20">
              <span className="text-[#ff5555] font-mono text-sm">{assetError}</span>
            </div>
          )}
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="max-w-full max-h-full object-contain"
            style={{ imageRendering: 'pixelated', opacity: assetsLoaded ? 1 : 0, cursor: canvasCursor }}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseLeave}
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
            reconnectCount={reconnectCount}
          />
        ))}

        {/* Empty tile for spawning */}
        {showEmptyTile && totalTiles > 0 && (
          <EmptyTile
            onSpawn={handleSpawn}
            spawnError={spawnError}
            onDropPty={(ptyId) => {
              dispatchTiles({ type: 'add', ptyId });
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
