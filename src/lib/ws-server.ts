import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { WSMessageToClient, WSMessageFromClient } from './types';
import { resolveApproval, getPendingApprovals, getPendingApproval } from './approval-queue';
import { getAllSessions, removeSession } from './store';
import { addRule } from './rules';
import {
  spawnSession,
  writeToPty,
  resizePty,
  getScrollback,
  getPtyEntry,
  setPtyOutputHandler,
  setPtyExitHandler,
} from './pty-manager';

// Use globalThis so the same WSS instance is shared across
// Next.js App Router module instances and the custom server.ts
declare global {
  // eslint-disable-next-line no-var
  var __wss: WebSocketServer | undefined;
  // eslint-disable-next-line no-var
  var __wsClientMeta: WeakMap<WebSocket, { subscriptions: Set<string> }> | undefined;
}

function getWSS(): WebSocketServer | null {
  return globalThis.__wss ?? null;
}

function getClientMeta(): WeakMap<WebSocket, { subscriptions: Set<string> }> {
  if (!globalThis.__wsClientMeta) {
    globalThis.__wsClientMeta = new WeakMap();
  }
  return globalThis.__wsClientMeta;
}

function ensureMeta(ws: WebSocket): { subscriptions: Set<string> } {
  const map = getClientMeta();
  let meta = map.get(ws);
  if (!meta) {
    meta = { subscriptions: new Set() };
    map.set(ws, meta);
  }
  return meta;
}

export function initWSS(server: Server) {
  if (globalThis.__wss) {
    // Re-register PTY handlers on existing WSS (for HMR)
    setPtyOutputHandler((ptyId, data) => {
      sendToSubscribers(ptyId, { type: 'terminal-output', ptyId, data });
    });
    setPtyExitHandler((ptyId, exitCode) => {
      sendToSubscribers(ptyId, { type: 'terminal-exited', ptyId, exitCode });
    });
    return;
  }

  const wss = new WebSocketServer({ noServer: true });
  globalThis.__wss = wss;

  // Wire PTY output/exit to subscriber-only delivery
  setPtyOutputHandler((ptyId, data) => {
    sendToSubscribers(ptyId, { type: 'terminal-output', ptyId, data });
  });

  setPtyExitHandler((ptyId, exitCode) => {
    sendToSubscribers(ptyId, { type: 'terminal-exited', ptyId, exitCode });
  });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[WS] Client connected');
    ensureMeta(ws);

    // Send current state snapshot so late-joining clients are in sync
    // Strip ptyId from sessions whose PTY no longer exists
    const sessions = getAllSessions().map(s => {
      if (s.ptyId && !getPtyEntry(s.ptyId)) {
        return { ...s, ptyId: undefined };
      }
      return s;
    });
    ws.send(JSON.stringify({ type: 'sessions', sessions }));

    // Replay any pending approvals so reconnecting/new clients can act on them
    for (const a of getPendingApprovals()) {
      ws.send(JSON.stringify({
        type: 'approval-request',
        approval: {
          id: a.id,
          sessionId: a.sessionId,
          toolName: a.toolName,
          toolInput: a.toolInput,
          createdAt: a.createdAt,
          reason: a.reason || 'unknown',
        },
      }));
    }

    ws.on('message', (raw) => {
      try {
        const msg: WSMessageFromClient = JSON.parse(raw.toString());
        handleClientMessage(ws, msg);
      } catch (e) {
        console.error('[WS] Bad message:', e);
      }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
      // Wait 5s before checking — gives the browser time to reconnect on refresh.
      // Only deny approvals that have been pending for >60s to avoid killing
      // approvals during a quick tab refresh.
      setTimeout(() => {
        if (!hasConnectedClients()) {
          const pending = getPendingApprovals();
          if (pending.length > 0) {
            const cutoff = Date.now() - 60_000;
            const stale = pending.filter(a => a.createdAt < cutoff);
            const kept = pending.filter(a => a.createdAt >= cutoff);
            if (stale.length > 0) {
              console.log(`[WS] No clients after 5s — denying ${stale.length} stale approval(s), keeping ${kept.length} recent`);
              for (const approval of stale) {
                resolveApproval(approval.id, 'deny', 'Browser disconnected — no boss to approve');
              }
            }
          }
        }
      }, 5000);
    });

    ws.on('error', (err) => {
      console.error('[WS] Socket error:', err);
    });
  });
}

function handleClientMessage(ws: WebSocket, msg: WSMessageFromClient) {
  switch (msg.type) {
    case 'approval-response': {
      resolveApproval(msg.approvalId, msg.decision, msg.message);
      // Pre-tool-use route broadcasts approval-resolved after the promise resolves.
      break;
    }

    case 'always-allow': {
      const approval = getPendingApproval(msg.approvalId);
      if (approval) {
        const pattern = msg.pattern;
        const added = addRule({ pattern, action: 'allow', label: pattern });
        resolveApproval(msg.approvalId, 'allow', `Always allowed: ${pattern}`);
        console.log(`[Rules] Added allow pattern: "${pattern}" (added=${added})`);
      }
      break;
    }

    case 'spawn-session': {
      console.log('[WS] spawn-session received:', msg.cwd);
      try {
        // Normalize cwd to a clean absolute path
        const home: string = process.env.HOME || os.homedir() || '/tmp';
        let cwd = msg.cwd.trim() || home;
        // Expand ~ to home
        if (cwd === '~' || cwd === '~/') {
          cwd = home;
        } else if (cwd.startsWith('~/')) {
          cwd = path.join(home, cwd.slice(2));
        } else if (!cwd.startsWith('/')) {
          cwd = path.join(home, cwd);
        }
        cwd = path.resolve(cwd);
        // If doesn't exist, try prepending home (catches "/Desktop" → "/Users/ned/Desktop")
        // Uses realpathSync which is case-insensitive on macOS (HFS+/APFS)
        let resolved: string | null = null;
        try {
          resolved = fs.realpathSync(cwd);
        } catch {
          try {
            resolved = fs.realpathSync(path.join(home, cwd));
          } catch { /* neither exists */ }
        }
        if (!resolved) {
          throw new Error(`Directory not found: ${cwd}`);
        }
        cwd = resolved;
        const isHome = cwd === home || cwd.startsWith(home + '/');
        const isTmp = cwd === '/tmp' || cwd.startsWith('/tmp/') || cwd.startsWith('/private/tmp');
        if (!isHome && !isTmp) {
          throw new Error('Directory is outside home');
        }
        const entry = spawnSession(cwd);
        ws.send(JSON.stringify({
          type: 'spawn-result',
          ptyId: entry.ptyId,
          success: true,
        } satisfies WSMessageToClient));
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error('[WS] Spawn failed:', error);
        ws.send(JSON.stringify({
          type: 'spawn-result',
          ptyId: '',
          success: false,
          error,
        } satisfies WSMessageToClient));
      }
      break;
    }

    case 'terminal-input': {
      writeToPty(msg.ptyId, msg.data);
      break;
    }

    case 'terminal-resize': {
      resizePty(msg.ptyId, msg.cols, msg.rows);
      break;
    }

    case 'terminal-subscribe': {
      const meta = ensureMeta(ws);
      const ptyEntry = getPtyEntry(msg.ptyId);
      // If PTY doesn't exist or already exited, notify client immediately
      if (!ptyEntry) {
        ws.send(JSON.stringify({
          type: 'terminal-exited',
          ptyId: msg.ptyId,
          exitCode: -1,
        } satisfies WSMessageToClient));
        break;
      }
      meta.subscriptions.add(msg.ptyId);
      // Resize PTY to match client before sending scrollback
      if (msg.cols && msg.rows) {
        resizePty(msg.ptyId, msg.cols, msg.rows);
      }
      // Send scrollback to this client
      const scrollback = getScrollback(msg.ptyId);
      if (scrollback) {
        ws.send(JSON.stringify({
          type: 'terminal-scrollback',
          ptyId: msg.ptyId,
          data: scrollback,
        } satisfies WSMessageToClient));
      }
      // If already exited, send exit event after scrollback
      if (ptyEntry.exited) {
        ws.send(JSON.stringify({
          type: 'terminal-exited',
          ptyId: msg.ptyId,
          exitCode: ptyEntry.exitCode ?? -1,
        } satisfies WSMessageToClient));
      }
      break;
    }

    case 'terminal-unsubscribe': {
      const meta = ensureMeta(ws);
      meta.subscriptions.delete(msg.ptyId);
      break;
    }

    case 'dismiss-session': {
      const session = getAllSessions().find(s => s.sessionId === msg.sessionId);
      if (!session) break;
      // Deny any pending approvals for this session
      const orphaned = getPendingApprovals().filter(a => a.sessionId === msg.sessionId);
      for (const approval of orphaned) {
        resolveApproval(approval.id, 'deny', 'Dismissed by boss');
      }
      removeSession(msg.sessionId);
      broadcast({ type: 'session-remove', sessionId: msg.sessionId });
      console.log(`[WS] Boss dismissed session: ${msg.sessionId}${orphaned.length > 0 ? ` (${orphaned.length} approval(s) denied)` : ''}`);
      break;
    }
  }
}

/** Send a message only to clients subscribed to a specific ptyId. */
function sendToSubscribers(ptyId: string, data: WSMessageToClient) {
  const wss = getWSS();
  if (!wss) return;
  const json = JSON.stringify(data);
  const clientMeta = getClientMeta();
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      const meta = clientMeta.get(client);
      if (meta?.subscriptions.has(ptyId)) {
        client.send(json);
      }
    }
  }
}

export function hasConnectedClients(): boolean {
  const wss = getWSS();
  if (!wss) return false;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

export function broadcast(data: WSMessageToClient) {
  const wss = getWSS();
  if (!wss) {
    console.warn('[WS] broadcast called but WSS not initialized');
    return;
  }
  // Strip ptyId from sessions whose PTY no longer exists on server
  if (data.type === 'sessions') {
    data = {
      ...data,
      sessions: data.sessions.map(s =>
        s.ptyId && !getPtyEntry(s.ptyId) ? { ...s, ptyId: undefined } : s
      ),
    };
  } else if (data.type === 'session-update' && data.session.ptyId && !getPtyEntry(data.session.ptyId)) {
    data = { ...data, session: { ...data.session, ptyId: undefined } };
  }
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}
