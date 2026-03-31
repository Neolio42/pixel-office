'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { Session, WSMessageToClient } from '@/lib/types';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  createdAt: number;
  reason: 'safe' | 'risky' | 'unknown';
}

export interface ResolvedApproval {
  approval: ApprovalRequest;
  decision: 'allow' | 'deny';
  message?: string;
  resolvedAt: number;
}

export interface PtyTab {
  ptyId: string;
  cwd: string;
  exited: boolean;
  exitCode?: number;
}

export function useWorkspace() {
  const wsRef = useRef<WebSocket | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [approvalHistory, setApprovalHistory] = useState<ResolvedApproval[]>([]);
  const [ptyTabs, setPtyTabs] = useState<PtyTab[]>([]);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);
  const terminalHandlersRef = useRef<Map<string, (msg: WSMessageToClient) => void>>(new Map());
  const exitTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const initialSyncDoneRef = useRef(false);
  const onSpawnSuccessRef = useRef<((ptyId: string) => void) | null>(null);
  const approvalsRef = useRef<ApprovalRequest[]>([]);

  const sendApproval = useCallback((approvalId: string, decision: 'allow' | 'deny', message?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'approval-response',
        approvalId,
        decision,
        ...(message ? { message } : {}),
      }));
    } else {
      console.warn('[WS] Cannot send approval — WebSocket not open');
    }
  }, []);

  const sendAlwaysAllow = useCallback((approvalId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'always-allow',
        approvalId,
      }));
    } else {
      console.warn('[WS] Cannot send always-allow — WebSocket not open');
    }
  }, []);

  const sendDismissSession = useCallback((sessionId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'dismiss-session',
        sessionId,
      }));
    } else {
      console.warn('[WS] Cannot send dismiss — WebSocket not open');
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

  /** Update existing ptyTab cwd from session data. Never creates tabs. */
  const syncPtyTabRef = useRef((session: Session) => {
    if (!session.ptyId) return;
    setPtyTabs(prev => {
      const idx = prev.findIndex(t => t.ptyId === session.ptyId);
      if (idx < 0) return prev;
      if (prev[idx].cwd === session.cwd) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], cwd: session.cwd };
      return next;
    });
  });

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
            for (const s of msg.sessions) {
              if (!initialSyncDoneRef.current && s.ptyId) {
                setPtyTabs(prev => prev.some(t => t.ptyId === s.ptyId) ? prev : [...prev, { ptyId: s.ptyId!, cwd: s.cwd, exited: false }]);
              } else {
                syncPtyTabRef.current(s);
              }
            }
            initialSyncDoneRef.current = true;
            break;
          }
          case 'session-update': {
            syncPtyTabRef.current(msg.session);
            setSessions(prev => {
              const idx = prev.findIndex(p => p.sessionId === msg.session.sessionId);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = msg.session;
                return next;
              }
              return [...prev, msg.session];
            });
            break;
          }
          case 'session-remove': {
            setSessions(prev => prev.filter(s => s.sessionId !== msg.sessionId));
            break;
          }
          case 'approval-request': {
            setApprovals(prev => prev.some(a => a.id === msg.approval.id) ? prev : [...prev, msg.approval]);
            break;
          }
          case 'approval-resolved': {
            // Record history from ref (not updater) to keep state updaters pure
            const resolved = approvalsRef.current.find(a => a.id === msg.approvalId);
            if (resolved) {
              setApprovalHistory(h => {
                const entry: ResolvedApproval = {
                  approval: resolved,
                  decision: msg.decision || 'deny',
                  message: msg.message,
                  resolvedAt: Date.now(),
                };
                const next = [...h, entry];
                return next.length > 30 ? next.slice(-30) : next;
              });
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

  return {
    sessions,
    approvals,
    approvalHistory,
    approvalsRef,
    sendApproval,
    sendAlwaysAllow,
    sendDismissSession,
    reconnectCount,
    wsRef,
    ptyTabs,
    setPtyTabs,
    spawnSession,
    spawnError,
    terminalHandlersRef,
    onSpawnSuccessRef,
  };
}
