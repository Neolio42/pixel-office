import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';
import { WSMessageToClient, WSMessageFromClient } from './types';
import { resolveApproval } from './approval-queue';
import { getAllSessions } from './store';

// Use globalThis so the same WSS instance is shared across
// Next.js App Router module instances and the custom server.ts
declare global {
  // eslint-disable-next-line no-var
  var __wss: WebSocketServer | undefined;
}

function getWSS(): WebSocketServer | null {
  return globalThis.__wss ?? null;
}

export function initWSS(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  globalThis.__wss = wss;

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[WS] Client connected');

    // Send current state snapshot so late-joining clients are in sync
    const sessions = getAllSessions();
    if (sessions.length > 0) {
      ws.send(JSON.stringify({ type: 'sessions', sessions }));
    }

    ws.on('message', (raw) => {
      try {
        const msg: WSMessageFromClient = JSON.parse(raw.toString());
        handleClientMessage(msg);
      } catch (e) {
        console.error('[WS] Bad message:', e);
      }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
    });

    ws.on('error', (err) => {
      console.error('[WS] Socket error:', err);
    });
  });
}

function handleClientMessage(msg: WSMessageFromClient) {
  if (msg.type === 'approval-response') {
    const resolved = resolveApproval(msg.approvalId, msg.decision);
    if (resolved) {
      broadcast({ type: 'approval-resolved', approvalId: msg.approvalId });
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
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}
