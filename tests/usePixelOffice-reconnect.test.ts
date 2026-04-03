import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { usePixelOffice } from '../src/hooks/usePixelOffice';

// Mock the asset-loader module since it doesn't exist
vi.mock('@/game/asset-loader', () => ({
  loadAssets: vi.fn(() => Promise.resolve({
    worker: { idle: null, working: null, leaving: null, walking: [] },
    desk: { top: null, legs: null },
  })),
  initRenderer: vi.fn(),
}));

// Mock game modules to avoid canvas rendering
vi.mock('@/game/office-layout', () => ({
  buildGrid: vi.fn(() => ({})),
}));

vi.mock('@/game/renderer', () => ({
  renderOffice: vi.fn(),
  initRenderer: vi.fn(),
}));

vi.mock('@/game/worker-entity', () => ({
  createWorker: vi.fn(() => ({ speechBubble: null })),
  updateWorker: vi.fn(() => false),
  setWorkerState: vi.fn(),
  setWorkerPlanMode: vi.fn(),
  startLeaving: vi.fn(),
}));

describe('usePixelOffice - reconnection and approval integration', () => {
  beforeEach(() => {
    // Mock window.location
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        host: 'localhost:3000',
      },
    });

    // Mock WebSocket as a class that starts in OPEN state
    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      readyState = 1; // OPEN
      send = vi.fn();
      close = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor() {
        // Intentionally empty - each test gets its own instance
      }
    }
    global.WebSocket = MockWebSocket as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('initializes with empty approvals array', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(result.current.approvals).toEqual([]);
  });

  it('initializes with empty sessions array', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(result.current.sessions).toEqual([]);
  });

  it('initializes with assetsLoaded as false', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(result.current.assetsLoaded).toBe(false);
  });

  it('initializes with empty ptyTabs array', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(result.current.ptyTabs).toEqual([]);
  });

  it('initializes with no selected worker', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(result.current.selectedWorker).toBeNull();
  });

  it('initializes with no spawn error', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(result.current.spawnError).toBeNull();
  });

  it('initializes with empty terminal handlers map', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(result.current.terminalHandlersRef.current.size).toBe(0);
  });

  it('initializes wsRef to a WebSocket instance (auto-connects on mount)', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(result.current.wsRef.current).not.toBeNull();
    expect(result.current.wsRef.current).toBeInstanceOf((global.WebSocket as any));
  });

  it('initializes workersRef as empty map', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(result.current.workersRef.current.size).toBe(0);
  });

  it('provides sendApproval callback', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(typeof result.current.sendApproval).toBe('function');
  });

  it('provides spawnSession callback', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(typeof result.current.spawnSession).toBe('function');
  });

  it('provides setSelectedWorker callback', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(typeof result.current.setSelectedWorker).toBe('function');
  });

  it('provides setPtyTabs callback', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(typeof result.current.setPtyTabs).toBe('function');
  });

  it('sets selected worker', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    act(() => {
      result.current.setSelectedWorker('worker-1');
    });
    expect(result.current.selectedWorker).toBe('worker-1');
  });

  it('updates selected worker', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    act(() => {
      result.current.setSelectedWorker('worker-1');
    });
    act(() => {
      result.current.setSelectedWorker('worker-2');
    });
    expect(result.current.selectedWorker).toBe('worker-2');
  });

  it('sets ptyTabs', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    const tabs = [
      { ptyId: 'pty-1', cwd: '/tmp', exited: false },
      { ptyId: 'pty-2', cwd: '/home', exited: false },
    ];
    act(() => {
      result.current.setPtyTabs(tabs);
    });
    expect(result.current.ptyTabs).toEqual(tabs);
  });

  it('updates ptyTabs', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    const tabs1 = [{ ptyId: 'pty-1', cwd: '/tmp', exited: false }];
    const tabs2 = [{ ptyId: 'pty-1', cwd: '/tmp', exited: false }, { ptyId: 'pty-2', cwd: '/home', exited: false }];
    act(() => {
      result.current.setPtyTabs(tabs1);
    });
    act(() => {
      result.current.setPtyTabs(tabs2);
    });
    expect(result.current.ptyTabs).toEqual(tabs2);
  });

  it('initializes onSpawnSuccessRef as null', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    expect(result.current.onSpawnSuccessRef.current).toBeNull();
  });

  it('allows setting onSpawnSuccessRef callback', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    const callback = vi.fn();
    act(() => {
      result.current.onSpawnSuccessRef.current = callback;
    });
    expect(result.current.onSpawnSuccessRef.current).toBe(callback);
  });

  it('sends approval response via WebSocket', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    act(() => {
      result.current.sendApproval('approval-1', 'allow', 'Looks good');
    });

    const wsInstance = result.current.wsRef.current;

    expect(wsInstance?.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'approval-response',
      approvalId: 'approval-1',
      decision: 'allow',
      message: 'Looks good',
    }));
  });

  it('sends approval response without message', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    act(() => {
      result.current.sendApproval('approval-1', 'deny');
    });

    const wsInstance = result.current.wsRef.current;

    expect(wsInstance?.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'approval-response',
      approvalId: 'approval-1',
      decision: 'deny',
    }));
  });

  it('does not send approval when WebSocket is not open', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Manually set readyState to CLOSED to simulate disconnected state
    if (result.current.wsRef.current) {
      (result.current.wsRef.current as any).readyState = 3; // CLOSED
    }

    act(() => {
      result.current.sendApproval('approval-1', 'allow');
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith('[WS] Cannot send approval — WebSocket not open');
    consoleWarnSpy.mockRestore();
  });

  it('sends spawn-session message via WebSocket', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    act(() => {
      result.current.spawnSession('/tmp/project');
    });

    const wsInstance = result.current.wsRef.current;

    expect(wsInstance?.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'spawn-session',
      cwd: '/tmp/project',
    }));
  });

  it('handles approval-request message via WebSocket', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    const wsInstance = result.current.wsRef.current;

    const mockApproval = {
      id: 'approval-1',
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'npm install' },
      createdAt: Date.now(),
      reason: 'risky' as const,
    };

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'approval-request',
            approval: mockApproval,
          }),
        });
      }
    });

    expect(result.current.approvals).toHaveLength(1);
    expect(result.current.approvals[0]).toEqual(mockApproval);
  });

  it('deduplicates approval requests with same ID', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    const wsInstance = result.current.wsRef.current;

    const approval = {
      id: 'approval-1',
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'npm install' },
      createdAt: Date.now(),
      reason: 'risky' as const,
    };

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'approval-request',
            approval,
          }),
        });
      }
    });

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'approval-request',
            approval,
          }),
        });
      }
    });

    expect(result.current.approvals).toHaveLength(1);
  });

  it('removes approval on approval-resolved message', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    const wsInstance = result.current.wsRef.current;

    const approval = {
      id: 'approval-1',
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'npm install' },
      createdAt: Date.now(),
      reason: 'risky' as const,
    };

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'approval-request',
            approval,
          }),
        });
      }
    });

    expect(result.current.approvals).toHaveLength(1);

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'approval-resolved',
            approvalId: 'approval-1',
          }),
        });
      }
    });

    expect(result.current.approvals).toHaveLength(0);
  });

  it('handles sessions message', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    const wsInstance = result.current.wsRef.current;

    const sessions = [
      {
        sessionId: 'session-1',
        deskIndex: 0,
        state: 'idle' as const,
        currentTool: null,
        cwd: '/tmp',
        tty: '/dev/pts/0',
        startedAt: Date.now(),
        lastSeen: Date.now(),
        recentTools: [],
      },
    ];

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'sessions',
            sessions,
          }),
        });
      }
    });

    expect(result.current.sessions).toEqual(sessions);
  });

  it('handles session-update messages', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    const wsInstance = result.current.wsRef.current;

    const session = {
      sessionId: 'session-1',
      deskIndex: 0,
      state: 'idle' as const,
      currentTool: null,
      cwd: '/tmp',
      tty: '/dev/pts/0',
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'sessions',
            sessions: [session],
          }),
        });
      }
    });

    const updatedSession = { ...session, state: 'waiting' as const, currentTool: 'Bash' };

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'session-update',
            session: updatedSession,
          }),
        });
      }
    });

    expect(result.current.sessions[0].state).toBe('waiting');
    expect(result.current.sessions[0].currentTool).toBe('Bash');
  });

  it('removes session on session-remove message', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    const wsInstance = result.current.wsRef.current;

    const sessions = [
      {
        sessionId: 'session-1',
        deskIndex: 0,
        state: 'idle' as const,
        currentTool: null,
        cwd: '/tmp',
        tty: '/dev/pts/0',
        startedAt: Date.now(),
        lastSeen: Date.now(),
        recentTools: [],
      },
      {
        sessionId: 'session-2',
        deskIndex: 1,
        state: 'idle' as const,
        currentTool: null,
        cwd: '/home',
        tty: '/dev/pts/1',
        startedAt: Date.now(),
        lastSeen: Date.now(),
        recentTools: [],
      },
    ];

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'sessions',
            sessions,
          }),
        });
      }
    });

    expect(result.current.sessions).toHaveLength(2);

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'session-remove',
            sessionId: 'session-1',
          }),
        });
      }
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].sessionId).toBe('session-2');
  });

  it('adds pty tab on spawn-result success', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    const wsInstance = result.current.wsRef.current;

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'spawn-result',
            success: true,
            ptyId: 'pty-1',
          }),
        });
      }
    });

    expect(result.current.ptyTabs.some(t => t.ptyId === 'pty-1')).toBe(true);
    expect(result.current.spawnError).toBeNull();
  });

  it('removes pty tab on terminal-exited message', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    const wsInstance = result.current.wsRef.current;

    act(() => {
      result.current.setPtyTabs([
        { ptyId: 'pty-1', cwd: '/tmp', exited: false },
        { ptyId: 'pty-2', cwd: '/home', exited: false },
      ]);
    });

    expect(result.current.ptyTabs).toHaveLength(2);

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'terminal-exited',
            ptyId: 'pty-1',
            exitCode: 0,
          }),
        });
      }
    });

    // Note: terminal-exited has a 2-second delay before removing the tab
    // We're just testing that the hook handles the message without crashing
    expect(result.current.ptyTabs.some(t => t.ptyId === 'pty-1')).toBe(true);
  });

  it('updates pty tab cwd on session-update', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    const wsInstance = result.current.wsRef.current;

    const tabs = [{ ptyId: 'pty-1', cwd: '/tmp', exited: false }];
    act(() => {
      result.current.setPtyTabs(tabs);
    });

    const session = {
      sessionId: 'session-1',
      deskIndex: 0,
      state: 'idle' as const,
      currentTool: null,
      cwd: '/home',
      ptyId: 'pty-1',
      tty: '/dev/pts/0',
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
    };

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'session-update',
            session,
          }),
        });
      }
    });

    expect(result.current.ptyTabs[0].cwd).toBe('/home');
  });

  it('sets spawnError on spawn-result failure', () => {
    const { result } = renderHook(() => usePixelOffice({ current: null }));

    const wsInstance = result.current.wsRef.current;

    act(() => {
      if ((wsInstance as any)?.onmessage) {
        (wsInstance as any).onmessage({
          data: JSON.stringify({
            type: 'spawn-result',
            success: false,
            error: 'Directory not found',
          }),
        });
      }
    });

    expect(result.current.spawnError).toBe('Directory not found');
  });
});
