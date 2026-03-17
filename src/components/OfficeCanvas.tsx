'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { CANVAS_W, CANVAS_H, TILE_SIZE, SCALE } from '@/game/office-layout';
import { usePixelOffice } from '@/hooks/usePixelOffice';
import { WorkerPanel } from './WorkerPanel';
import { ApprovalToast } from './ApprovalToast';
import { WorkerPopup } from './WorkerPopup';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

let demoCounter = 0;
let addWorkerCounter = 0;

export function OfficeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { sessions, approvals, sendApproval, assetsLoaded, selectedWorker, setSelectedWorker, workersRef } = usePixelOffice(canvasRef);
  const [demoRunning, setDemoRunning] = useState(false);
  // Popup anchor in viewport pixels
  const [popupAnchor, setPopupAnchor] = useState<{ x: number; y: number } | null>(null);
  // Viewport size for clamping popup
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const update = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Canvas logical size vs displayed size (object-contain scaling)
    const rect = canvas.getBoundingClientRect();
    const displayW = rect.width;
    const displayH = rect.height;

    // object-contain: canvas may have letter-boxing; compute actual rendered area
    const scaleX = displayW / CANVAS_W;
    const scaleY = displayH / CANVAS_H;
    const fitScale = Math.min(scaleX, scaleY);

    const renderedW = CANVAS_W * fitScale;
    const renderedH = CANVAS_H * fitScale;
    const offsetX = (displayW - renderedW) / 2;
    const offsetY = (displayH - renderedH) / 2;

    // Click position relative to the rendered canvas area
    const clickX = e.clientX - rect.left - offsetX;
    const clickY = e.clientY - rect.top - offsetY;

    // Convert to logical canvas pixels, then to tile coords
    const logicalX = clickX / fitScale;
    const logicalY = clickY / fitScale;
    const tileX = logicalX / (TILE_SIZE * SCALE);
    const tileY = logicalY / (TILE_SIZE * SCALE);

    // Find nearest worker within 1.5 tiles
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
      // Compute viewport anchor from worker's logical canvas position
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
  }, [workersRef, setSelectedWorker]);

  const handleDismissPopup = useCallback(() => {
    setSelectedWorker(null);
    setPopupAnchor(null);
  }, [setSelectedWorker]);

  // Keep a ref to approvals so the demo async function can read the latest value
  const approvalsRef = useRef(approvals);
  useEffect(() => {
    approvalsRef.current = approvals;
  }, [approvals]);

  // ⌘Y keyboard shortcut — approve the oldest pending approval
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

  // Track previous approvals to detect when one disappears (i.e. was resolved)
  const prevApprovalsRef = useRef(approvals);
  const approvalResolvedWaitersRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    const prev = prevApprovalsRef.current;
    const curr = approvals;

    // Find approvals that were present before but are gone now
    for (const prevApproval of prev) {
      const stillPresent = curr.some(a => a.id === prevApproval.id);
      if (!stillPresent) {
        const waiter = approvalResolvedWaitersRef.current.get(prevApproval.sessionId);
        if (waiter) {
          approvalResolvedWaitersRef.current.delete(prevApproval.sessionId);
          waiter();
        }
      }
    }

    prevApprovalsRef.current = curr;
  }, [approvals]);

  const waitForApprovalResolved = useCallback((sessionId: string): Promise<void> => {
    return new Promise(resolve => {
      // Check if there's already an approval for this session right now
      const existing = approvalsRef.current.find(a => a.sessionId === sessionId);
      if (!existing) {
        // No approval pending — resolve immediately (already resolved or never appeared)
        resolve();
        return;
      }
      approvalResolvedWaitersRef.current.set(sessionId, resolve);
    });
  }, []);

  const waitForApprovalToAppear = useCallback((sessionId: string): Promise<void> => {
    return new Promise(resolve => {
      const existing = approvalsRef.current.find(a => a.sessionId === sessionId);
      if (existing) {
        resolve();
        return;
      }
      // Poll via a short interval — WS delivery is near-instant
      const interval = setInterval(() => {
        if (approvalsRef.current.find(a => a.sessionId === sessionId)) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }, []);

  const runDemo = useCallback(async () => {
    setDemoRunning(true);
    demoCounter += 1;
    const sessionId = `demo-session-${demoCounter}-${Date.now()}`;
    const cwd = `/home/claude/projects/demo-${demoCounter}`;

    try {
      // 1. Session start
      await fetch('/api/hooks/session-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, cwd }),
      });

      // 2. Wait 4s for worker to finish walking to desk before sending tool calls
      await delay(4000);

      // 3. Read tool — reading animation (2s)
      await fetch('/api/hooks/pre-tool-use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, tool_name: 'Read', tool_input: { file_path: `${cwd}/src/index.ts` } }),
      });

      // 4. After 2s: post-tool-use -> idle (500ms)
      await delay(2000);
      await fetch('/api/hooks/post-tool-use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });

      // 5. After 500ms idle: Edit tool — typing animation (2s)
      await delay(500);
      await fetch('/api/hooks/pre-tool-use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, tool_name: 'Edit', tool_input: { file_path: `${cwd}/src/index.ts` } }),
      });

      // 6. After 2s: post-tool-use -> idle (500ms)
      await delay(2000);
      await fetch('/api/hooks/post-tool-use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });

      // 7. After 500ms idle: Bash git push — blocks server-side until approved, so don't await
      await delay(500);
      const bashPromise = fetch('/api/hooks/pre-tool-use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          tool_name: 'Bash',
          tool_input: { command: 'git push origin main' },
        }),
      });

      // 8. Wait for approval toast to appear, then wait for user to approve/deny
      await waitForApprovalToAppear(sessionId);
      await waitForApprovalResolved(sessionId);

      // Drain the blocking fetch (decision already made server-side)
      await bashPromise;

      // 9. Post-tool-use after approval
      await fetch('/api/hooks/post-tool-use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });

      // 10. After 1s idle: session end — worker walks away
      await delay(1000);
      await fetch('/api/hooks/session-end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } finally {
      setDemoRunning(false);
    }
  }, [waitForApprovalToAppear, waitForApprovalResolved]);

  const addWorker = useCallback(async () => {
    addWorkerCounter += 1;
    const sessionId = `worker-${addWorkerCounter}-${Date.now()}`;
    const cwd = `/home/claude/projects/worker-${addWorkerCounter}`;
    await fetch('/api/hooks/session-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, cwd }),
    });
  }, []);

  return (
    <div className="flex h-screen w-screen bg-[#1a1a2e] overflow-hidden">
      <div className="flex-1 flex items-center justify-center relative">
        {!assetsLoaded && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <span className="text-[#8888aa] font-mono text-sm animate-pulse">Loading assets…</span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="border border-[#2a2a4a] max-w-full max-h-full object-contain cursor-pointer"
          style={{ imageRendering: 'pixelated', opacity: assetsLoaded ? 1 : 0 }}
          onClick={handleCanvasClick}
        />
        {/* Approval toasts overlay */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col gap-3 z-30">
          {approvals.map(approval => (
            <ApprovalToast
              key={approval.id}
              approval={approval}
              session={sessions.find(s => s.sessionId === approval.sessionId)}
              onDecision={sendApproval}
            />
          ))}
        </div>
        {/* Worker detail popup */}
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
            />
          );
        })()}
        {/* Demo controls — bottom-left */}
        <div className="absolute bottom-4 left-4 flex gap-2 z-10">
          <button
            onClick={runDemo}
            disabled={demoRunning}
            className="px-3 py-1.5 bg-[#12122a] hover:bg-[#1a1a3a] disabled:opacity-40 disabled:cursor-not-allowed border border-[#2a2a4a] text-[#8888aa] hover:text-[#aaaacc] text-xs font-mono rounded transition-colors cursor-pointer"
          >
            {demoRunning ? 'Running...' : 'Demo'}
          </button>
          <button
            onClick={addWorker}
            className="px-3 py-1.5 bg-[#12122a] hover:bg-[#1a1a3a] border border-[#2a2a4a] text-[#8888aa] hover:text-[#aaaacc] text-xs font-mono rounded transition-colors cursor-pointer"
          >
            + Add Worker
          </button>
        </div>
      </div>
      <WorkerPanel
        sessions={sessions}
        onSelectWorker={(id) => {
          // Dismiss canvas popup when panel selects a worker
          if (id) {
            setSelectedWorker(null);
            setPopupAnchor(null);
          }
        }}
      />
    </div>
  );
}
