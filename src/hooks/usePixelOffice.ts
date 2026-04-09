'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { Session, WSMessageToClient } from '@/lib/types';
import { buildGrid } from '@/game/office-layout';
import { renderOffice, initRenderer } from '@/game/renderer';
import { WorkerEntity, createWorker, updateWorker, setWorkerState, setWorkerPlanMode, startLeaving, triggerEmote } from '@/game/worker-entity';
import { loadAssets, AssetBundle } from '@/game/asset-loader';
import { CanvasInteraction } from '@/game/renderer';

/** Get the speech bubble text from the session's most recent tool summary. Truncates to ~25 chars at word boundary. */
function bubbleText(session: Session): string | null {
  const last = session.recentTools[session.recentTools.length - 1];
  if (!last) return null;
  const s = last.summary;
  if (s.length <= 25) return s;
  // Cut at last space before limit to avoid mid-word truncation
  const cut = s.lastIndexOf(' ', 23);
  return (cut > 10 ? s.slice(0, cut) : s.slice(0, 23)) + '…';
}

/** For approval-request bubbles, phrase it as a question like "Can I push?" */
function approvalLabel(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash') {
    const cmd = String(toolInput.command || '').trim();
    // Extract the first "word" of the command for a short question
    const firstWord = cmd.split(/\s+/)[0] || 'run';
    const short = firstWord.length > 10 ? firstWord.slice(0, 8) + '…' : firstWord;
    return `Can I ${short}?`;
  }
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') return 'Can I edit?';
  if (toolName === 'Read') return 'Can I read?';

  const mcpMatch = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (mcpMatch) {
    const server = mcpMatch[1].toLowerCase();
    if (server.includes('chrome') || server.includes('browser') || server.includes('playwright')) return 'Browser?';
    if (server.includes('clickup')) return 'ClickUp?';
    const cleaned = server.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return (cleaned.length > 12 ? cleaned.slice(0, 10) + '…' : cleaned) + '?';
  }

  const label = toolName.length > 15 ? toolName.slice(0, 13) + '…' : toolName;
  return `${label}?`;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  createdAt: number;
  reason: 'safe' | 'risky' | 'unknown';
}

export interface PtyTab {
  ptyId: string;
  cwd: string;
  exited: boolean;
  exitCode?: number;
}

export function usePixelOffice(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  const wsRef = useRef<WebSocket | null>(null);
  const workersRef = useRef<Map<string, WorkerEntity>>(new Map());
  const gridRef = useRef(buildGrid());
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const assetsRef = useRef<AssetBundle | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [ptyTabs, setPtyTabs] = useState<PtyTab[]>([]);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);
  /** Map of ptyId → data handler, so multiple terminals can receive data simultaneously */
  const terminalHandlersRef = useRef<Map<string, (msg: WSMessageToClient) => void>>(new Map());
  const exitTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const initialSyncDoneRef = useRef(false);
  /** Called on successful spawn — used by UI to save recents only on success */
  const onSpawnSuccessRef = useRef<((ptyId: string) => void) | null>(null);
  /** Canvas interaction state — written by OfficeCanvas, read by game loop */
  const interactionRef = useRef<CanvasInteraction>({
    hoveredWorkerId: null,
    selectedWorkerId: null,
    drag: null,
    dropTile: null,
  });
  /** Track pending approval decisions client-side for emote triggering */
  const pendingDecisionsRef = useRef<Map<string, 'allow' | 'deny'>>(new Map());
  /** Ref mirror of approvals state for use inside WS closure */
  const approvalsRef = useRef<ApprovalRequest[]>([]);

  const sendApproval = useCallback((approvalId: string, decision: 'allow' | 'deny', message?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      pendingDecisionsRef.current.set(approvalId, decision);
      wsRef.current.send(JSON.stringify({
        type: 'approval-response',
        approvalId,
        decision,
        ...(message ? { message } : {}),
      }));
      // Toast removal happens when we receive 'approval-resolved' from server
    } else {
      console.warn('[WS] Cannot send approval — WebSocket not open');
    }
  }, []);

  const sendAlwaysAllow = useCallback((approvalId: string, pattern: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      pendingDecisionsRef.current.set(approvalId, 'allow');
      wsRef.current.send(JSON.stringify({
        type: 'always-allow',
        approvalId,
        pattern,
      }));
    } else {
      console.warn('[WS] Cannot send always-allow — WebSocket not open');
    }
  }, []);

  // Keep approvalsRef in sync with state
  useEffect(() => { approvalsRef.current = approvals; }, [approvals]);

  const spawnSession = useCallback((cwd: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'spawn-session',
        cwd,
      }));
    }
  }, []);

  /** Update existing ptyTab cwd from session data. Never creates tabs —
   *  creation only happens via spawn-result or initial sessions snapshot on connect. */
  const syncPtyTabRef = useRef((session: Session) => {
    if (!session.ptyId) return;
    setPtyTabs(prev => {
      const idx = prev.findIndex(t => t.ptyId === session.ptyId);
      if (idx < 0) return prev; // don't auto-create — user may have closed it
      if (prev[idx].cwd === session.cwd) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], cwd: session.cwd };
      return next;
    });
  });

  // Load assets on mount
  useEffect(() => {
    loadAssets().then(bundle => {
      assetsRef.current = bundle;
      initRenderer(bundle);
      setAssetsLoaded(true);
    }).catch(err => {
      console.error('[Assets] Failed to load:', err);
      setAssetError('Failed to load office assets');
    });
  }, []);

  // WebSocket connection with auto-reconnect
  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;
    let intentionalClose = false;
    let connectionCount = 0;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        connectionCount++;
        console.log('[WS] Connected');
        reconnectDelay = 1000;
        if (connectionCount > 1) {
          setReconnectCount(c => c + 1);
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        let msg: WSMessageToClient;
        try {
          msg = JSON.parse(event.data);
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
          return;
        }
        switch (msg.type) {
          case 'sessions': {
            setSessions(msg.sessions);
            const workers = workersRef.current;
            for (const s of msg.sessions) {
              if (!workers.has(s.sessionId)) {
                workers.set(s.sessionId, createWorker(s.sessionId, s.deskIndex));
              }
              if (!initialSyncDoneRef.current && s.ptyId) {
                setPtyTabs(prev => prev.some(t => t.ptyId === s.ptyId) ? prev : [...prev, { ptyId: s.ptyId!, cwd: s.cwd, exited: false }]);
              } else {
                syncPtyTabRef.current(s);
              }
            }
            initialSyncDoneRef.current = true;
            const sessionIds = new Set(msg.sessions.map(s => s.sessionId));
            for (const [id, worker] of workers) {
              if (!sessionIds.has(id) && !worker.leaving) {
                startLeaving(worker);
              }
            }
            break;
          }
          case 'session-update': {
            const workers = workersRef.current;
            const s = msg.session;
            syncPtyTabRef.current(s);
            setSessions(prev => {
              const idx = prev.findIndex(p => p.sessionId === s.sessionId);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = s;
                return next;
              }
              return [...prev, s];
            });
            if (!workers.has(s.sessionId)) {
              workers.set(s.sessionId, createWorker(s.sessionId, s.deskIndex));
            }
            const worker = workers.get(s.sessionId);
            if (!worker) break;
            setWorkerState(worker, s.state);
            setWorkerPlanMode(worker, !!s.inPlanMode);
            if (s.state === 'waiting') {
              const pendingApproval = approvalsRef.current.find(a => a.sessionId === s.sessionId);
              worker.speechBubble = approvalLabel(s.currentTool || 'Unknown', pendingApproval?.toolInput || {});
            } else if (s.state === 'typing' || s.state === 'reading') {
              const text = s.currentFocus || bubbleText(s);
              if (text) {
                if (text.length <= 22) {
                  worker.speechBubble = text;
                } else {
                  const cut = text.lastIndexOf(' ', 20);
                  worker.speechBubble = (cut > 8 ? text.slice(0, cut) : text.slice(0, 20)) + '…';
                }
              } else {
                worker.speechBubble = null;
              }
            } else if (s.state === 'idle') {
              worker.speechBubble = null;
            }
            break;
          }
          case 'session-remove': {
            setSessions(prev => prev.filter(s => s.sessionId !== msg.sessionId));
            const worker = workersRef.current.get(msg.sessionId);
            if (worker) startLeaving(worker);
            // Clear drag if this worker was being dragged
            if (interactionRef.current.drag?.workerId === msg.sessionId) {
              interactionRef.current.drag = null;
              interactionRef.current.dropTile = null;
            }
            break;
          }
          case 'approval-request': {
            // Deduplicate — server replays pending approvals on reconnect
            setApprovals(prev => prev.some(a => a.id === msg.approval.id) ? prev : [...prev, msg.approval]);
            const worker = workersRef.current.get(msg.approval.sessionId);
            if (worker) worker.speechBubble = approvalLabel(msg.approval.toolName, msg.approval.toolInput);
            break;
          }
          case 'approval-resolved': {
            const resolvedApproval = approvalsRef.current.find(a => a.id === msg.approvalId);
            if (resolvedApproval) {
              const worker = workersRef.current.get(resolvedApproval.sessionId);
              if (worker) {
                worker.speechBubble = null;
                const decision = pendingDecisionsRef.current.get(msg.approvalId);
                if (decision) {
                  triggerEmote(worker, decision === 'allow' ? 'approved' : 'denied');
                  pendingDecisionsRef.current.delete(msg.approvalId);
                }
              }
            }
            setApprovals(prev => prev.filter(a => a.id !== msg.approvalId));
            break;
          }
          case 'notification': {
            console.log(`[Notification] ${msg.sessionId}: ${msg.message}`);
            break;
          }
          case 'spawn-result': {
            if (msg.success && msg.ptyId) {
              setPtyTabs(prev => prev.some(t => t.ptyId === msg.ptyId) ? prev : [...prev, { ptyId: msg.ptyId, cwd: '', exited: false }]);
              setSpawnError(null);
              onSpawnSuccessRef.current?.(msg.ptyId);
            } else {
              setSpawnError(msg.error || 'Spawn failed');
            }
            break;
          }
          case 'terminal-exited': {
            terminalHandlersRef.current.get(msg.ptyId)?.(msg);
            const delay = msg.exitCode === -1 ? 0 : 2000;
            const timerId = setTimeout(() => {
              exitTimersRef.current.delete(timerId);
              setPtyTabs(prev => prev.filter(t => t.ptyId !== msg.ptyId));
            }, delay);
            exitTimersRef.current.add(timerId);
            break;
          }
          case 'terminal-output':
          case 'terminal-scrollback': {
            terminalHandlersRef.current.get(msg.ptyId)?.(msg);
            break;
          }
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected');
        if (!intentionalClose) {
          console.log(`[WS] Reconnecting in ${reconnectDelay}ms...`);
          reconnectTimeout = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
            connect();
          }, reconnectDelay);
        }
      };

      ws.onerror = (err) => console.error('[WS] Error:', err);
    }

    connect();

    return () => {
      intentionalClose = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      wsRef.current?.close();
      for (const id of exitTimersRef.current) clearTimeout(id);
      exitTimersRef.current.clear();
    };
  }, []);

  // Game loop — starts only after assets are loaded
  useEffect(() => {
    if (!assetsLoaded) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const loop = (time: number) => {
      const rawDt = lastTimeRef.current ? (time - lastTimeRef.current) / 1000 : 0.016;
      const dt = Math.min(rawDt, 1 / 15); // cap to prevent drift on tab re-focus
      lastTimeRef.current = time;

      // Update workers
      const toRemove: string[] = [];
      for (const [id, worker] of workersRef.current) {
        const done = updateWorker(worker, dt);
        if (done) toRemove.push(id);
      }
      for (const id of toRemove) {
        workersRef.current.delete(id);
      }

      // Render with interaction state
      renderOffice(ctx, gridRef.current, [...workersRef.current.values()], dt, interactionRef.current);

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => { cancelAnimationFrame(animFrameRef.current); };
  }, [assetsLoaded, canvasRef]);

  return {
    sessions,
    approvals,
    approvalsRef,
    sendApproval,
    sendAlwaysAllow,
    assetsLoaded,
    assetError,
    reconnectCount,
    selectedWorker,
    setSelectedWorker,
    workersRef,
    wsRef,
    ptyTabs,
    setPtyTabs,
    spawnSession,
    spawnError,
    terminalHandlersRef,
    onSpawnSuccessRef,
    interactionRef,
    gridRef,
  };
}
