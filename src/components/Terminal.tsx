'use client';

import { useRef, useEffect } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WSMessageToClient } from '@/lib/types';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  ptyId: string;
  wsRef: React.RefObject<WebSocket | null>;
  terminalHandlers: React.RefObject<Map<string, (msg: WSMessageToClient) => void>>;
}

export function Terminal({ ptyId, wsRef, terminalHandlers }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const subscribedRef = useRef(false);
  const scrollbackReceivedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Reuse existing terminal if StrictMode remounted us
    if (xtermRef.current) {
      if (!containerRef.current.querySelector('.xterm')) {
        xtermRef.current.open(containerRef.current);
        requestAnimationFrame(() => fitAddonRef.current?.fit());
      }
    } else {
      const term = new XTerm({
        theme: {
          background: '#0e0e1e',
          foreground: '#c8c8d8',
          cursor: '#c8c8d8',
          selectionBackground: '#3a3a6a',
          black: '#0e0e1e',
          red: '#ff5555',
          green: '#50fa7b',
          yellow: '#f1fa8c',
          blue: '#6272a4',
          magenta: '#ff79c6',
          cyan: '#8be9fd',
          white: '#c8c8d8',
          brightBlack: '#555577',
          brightRed: '#ff6e6e',
          brightGreen: '#69ff94',
          brightYellow: '#ffffa5',
          brightBlue: '#d6acff',
          brightMagenta: '#ff92df',
          brightCyan: '#a4ffff',
          brightWhite: '#ffffff',
        },
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: true,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      requestAnimationFrame(() => fitAddon.fit());

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
    }

    const term = xtermRef.current!;
    const fitAddon = fitAddonRef.current!;

    // Subscribe to terminal output (only once)
    const ws = wsRef.current;
    const doSubscribe = (socket: WebSocket) => {
      if (subscribedRef.current) return;
      subscribedRef.current = true;
      scrollbackReceivedRef.current = false;
      const dims = fitAddon.proposeDimensions();
      socket.send(JSON.stringify({
        type: 'terminal-subscribe',
        ptyId,
        ...(dims ? { cols: dims.cols, rows: dims.rows } : {}),
      }));
    };
    let onOpen: (() => void) | null = null;
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        doSubscribe(ws);
      } else {
        onOpen = () => doSubscribe(ws);
        ws.addEventListener('open', onOpen, { once: true });
      }
    }

    // Register handler in the shared map so the hook routes data to us
    terminalHandlers.current.set(ptyId, (msg: WSMessageToClient) => {
      if (msg.type === 'terminal-scrollback') {
        if (scrollbackReceivedRef.current) return;
        scrollbackReceivedRef.current = true;
        term.write(msg.data);
        // Force redraw at correct dimensions after scrollback
        requestAnimationFrame(() => {
          const d = fitAddon.proposeDimensions();
          if (d) {
            const w = wsRef.current;
            if (w && w.readyState === WebSocket.OPEN) {
              w.send(JSON.stringify({ type: 'terminal-resize', ptyId, cols: d.cols, rows: d.rows }));
            }
          }
        });
      } else if (msg.type === 'terminal-output') {
        term.write(msg.data);
      } else if (msg.type === 'terminal-exited') {
        term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
      }
    });

    // Send user keystrokes to server
    const onDataDisposable = term.onData((data) => {
      const w = wsRef.current;
      if (w && w.readyState === WebSocket.OPEN) {
        w.send(JSON.stringify({ type: 'terminal-input', ptyId, data }));
      }
    });

    // Handle resize
    let cancelled = false;
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          const w = wsRef.current;
          if (w && w.readyState === WebSocket.OPEN) {
            w.send(JSON.stringify({ type: 'terminal-resize', ptyId, cols: dims.cols, rows: dims.rows }));
          }
        }
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelled = true;
      if (onOpen && ws) ws.removeEventListener('open', onOpen);
      resizeObserver.disconnect();
      onDataDisposable.dispose();
    };
  }, [ptyId, wsRef, terminalHandlers]);

  // Clean up when ptyId changes or component truly unmounts
  useEffect(() => {
    return () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && subscribedRef.current) {
        ws.send(JSON.stringify({ type: 'terminal-unsubscribe', ptyId }));
      }
      subscribedRef.current = false;
      scrollbackReceivedRef.current = false;
      terminalHandlers.current.delete(ptyId);
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptyId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ backgroundColor: '#0e0e1e' }}
    />
  );
}
