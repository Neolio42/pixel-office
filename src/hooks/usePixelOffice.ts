'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { Session, WSMessageToClient } from '@/lib/types';
import { buildGrid } from '@/game/office-layout';
import { renderOffice, initRenderer } from '@/game/renderer';
import { WorkerEntity, createWorker, updateWorker, setWorkerState, startLeaving } from '@/game/worker-entity';
import { loadAssets, AssetBundle } from '@/game/asset-loader';

/** Convert a raw tool name + optional input into a short human-readable speech bubble label. */
function toolLabel(toolName: string, toolInput?: Record<string, unknown>): string {
  // Bash: show a truncated version of the command
  if (toolName === 'Bash') {
    const cmd = String(toolInput?.command || '').trim();
    return cmd ? (cmd.length > 20 ? cmd.slice(0, 18) + '…' : cmd) : 'Running…';
  }
  if (toolName === 'Read') return 'Reading file';
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') return 'Editing file';
  if (toolName === 'Grep' || toolName === 'Glob') return 'Searching';
  if (toolName === 'Agent') return 'Thinking…';

  // MCP tools: mcp__<server>__<action>
  const mcpMatch = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (mcpMatch) {
    const server = mcpMatch[1].toLowerCase();
    if (server.includes('chrome') || server.includes('browser') || server.includes('playwright')) return 'Browser';
    if (server.includes('clickup')) return 'ClickUp';
    // Clean up server name: replace hyphens/underscores with space, title-case
    const cleaned = server
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    return cleaned.length > 15 ? cleaned.slice(0, 13) + '…' : cleaned;
  }

  // Default: cap at 15 chars
  return toolName.length > 15 ? toolName.slice(0, 13) + '…' : toolName;
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

  const label = toolLabel(toolName, toolInput);
  return `${label}?`;
}

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
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

  const sendApproval = useCallback((approvalId: string, decision: 'allow' | 'deny') => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'approval-response',
        approvalId,
        decision,
      }));
    }
    setApprovals(prev => prev.filter(a => a.id !== approvalId));
  }, []);

  // Load assets on mount
  useEffect(() => {
    loadAssets().then(bundle => {
      assetsRef.current = bundle;
      initRenderer(bundle);
      setAssetsLoaded(true);
    }).catch(err => {
      console.error('[Assets] Failed to load:', err);
    });
  }, []);

  // WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg: WSMessageToClient = JSON.parse(event.data);

      switch (msg.type) {
        case 'sessions': {
          setSessions(msg.sessions);
          const workers = workersRef.current;
          for (const s of msg.sessions) {
            if (!workers.has(s.sessionId)) {
              workers.set(s.sessionId, createWorker(s.sessionId, s.deskIndex));
            }
          }
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
          const worker = workers.get(s.sessionId)!;
          setWorkerState(worker, s.state);
          if (s.state === 'waiting' && s.currentTool) {
            worker.speechBubble = toolLabel(s.currentTool);
          } else if (s.state === 'typing' || s.state === 'reading') {
            // Show current tool briefly, then clear
            if (s.currentTool) {
              worker.speechBubble = toolLabel(s.currentTool);
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
          break;
        }
        case 'approval-request': {
          setApprovals(prev => [...prev, msg.approval]);
          const worker = workersRef.current.get(msg.approval.sessionId);
          if (worker) worker.speechBubble = approvalLabel(msg.approval.toolName, msg.approval.toolInput);
          break;
        }
        case 'approval-resolved': {
          setApprovals(prev => prev.filter(a => a.id !== msg.approvalId));
          break;
        }
        case 'notification': {
          console.log(`[Notification] ${msg.sessionId}: ${msg.message}`);
          break;
        }
      }
    };

    ws.onclose = () => console.log('[WS] Disconnected');
    ws.onerror = (err) => console.error('[WS] Error:', err);

    return () => { ws.close(); };
  }, []);

  // Game loop — starts only after assets are loaded
  useEffect(() => {
    if (!assetsLoaded) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const loop = (time: number) => {
      const dt = lastTimeRef.current ? (time - lastTimeRef.current) / 1000 : 0.016;
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

      // Render
      renderOffice(ctx, gridRef.current, [...workersRef.current.values()], dt);

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => { cancelAnimationFrame(animFrameRef.current); };
  }, [assetsLoaded, canvasRef]);

  return { sessions, approvals, sendApproval, assetsLoaded, selectedWorker, setSelectedWorker, workersRef };
}
