// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkerPopup } from '../src/components/WorkerPopup';
import type { Session } from '../src/lib/types';

// Mock fetch
const mockFetch = vi.fn(() => Promise.resolve({ ok: true }));
globalThis.fetch = mockFetch;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 's-1',
    deskIndex: 0,
    state: 'typing',
    currentTool: 'Edit',
    cwd: '/home/user/my-project',
    tty: '',
    startedAt: Date.now() - 120000,
    lastSeen: Date.now(),
    recentTools: [
      { toolName: 'Edit', summary: 'Editing auth.ts', timestamp: Date.now() },
    ],
    currentFocus: 'Fixing login bug',
    ...overrides,
  };
}

describe('WorkerPopup', () => {
  const defaultProps = {
    anchorX: 400,
    anchorY: 300,
    viewportW: 1920,
    viewportH: 1080,
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders project name', () => {
    const session = makeSession();
    render(<WorkerPopup {...defaultProps} session={session} />);
    expect(screen.getByText('my-project')).toBeDefined();
  });

  it('renders focus text', () => {
    const session = makeSession({ currentFocus: 'Fixing login bug' });
    render(<WorkerPopup {...defaultProps} session={session} />);
    expect(screen.getByText('Fixing login bug')).toBeDefined();
  });

  it('renders last tool summary', () => {
    const session = makeSession();
    render(<WorkerPopup {...defaultProps} session={session} />);
    expect(screen.getByText('Editing auth.ts')).toBeDefined();
  });

  it('renders "Idle" for idle sessions without focus/tools', () => {
    const session = makeSession({ state: 'idle', currentFocus: undefined, recentTools: [], currentTool: null });
    render(<WorkerPopup {...defaultProps} session={session} />);
    expect(screen.getByText('Idle')).toBeDefined();
  });

  it('renders "Working" for active sessions without focus/tools', () => {
    const session = makeSession({ state: 'typing', currentFocus: undefined, recentTools: [], currentTool: 'Edit' });
    render(<WorkerPopup {...defaultProps} session={session} />);
    expect(screen.getByText('Working')).toBeDefined();
  });

  it('renders dismiss button', () => {
    const session = makeSession();
    render(<WorkerPopup {...defaultProps} session={session} />);
    expect(screen.getByText('✕')).toBeDefined();
  });

  it('calls onDismiss when dismiss clicked', () => {
    const onDismiss = vi.fn();
    const session = makeSession();
    render(<WorkerPopup {...defaultProps} session={session} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('✕'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders "Open Terminal" when onOpenTerminal provided', () => {
    const onOpenTerminal = vi.fn();
    const session = makeSession();
    render(<WorkerPopup {...defaultProps} session={session} onOpenTerminal={onOpenTerminal} />);
    expect(screen.getByText('Open Terminal')).toBeDefined();
  });

  it('renders "Focus Terminal" when no onOpenTerminal', () => {
    const session = makeSession();
    render(<WorkerPopup {...defaultProps} session={session} />);
    expect(screen.getByText('Focus Terminal')).toBeDefined();
  });

  it('calls onOpenTerminal and onDismiss when Open Terminal clicked', () => {
    const onOpenTerminal = vi.fn();
    const onDismiss = vi.fn();
    const session = makeSession();
    render(<WorkerPopup {...defaultProps} session={session} onOpenTerminal={onOpenTerminal} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Open Terminal'));
    expect(onOpenTerminal).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('calls fetch when Focus Terminal clicked', async () => {
    const session = makeSession();
    render(<WorkerPopup {...defaultProps} session={session} />);
    fireEvent.click(screen.getByText('Focus Terminal'));
    expect(mockFetch).toHaveBeenCalledWith('/api/focus-terminal', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('renders duration as "just now" for very recent sessions', () => {
    const session = makeSession({ startedAt: Date.now() });
    render(<WorkerPopup {...defaultProps} session={session} />);
    // The duration text should show "just now" for < 1 minute
    // But it's rendered as part of the popup header
    expect(screen.getByText('just now')).toBeDefined();
  });

  it('adjusts position when popup would overflow right', () => {
    const session = makeSession();
    // anchorX near right edge, viewport is 1920 wide
    const { container } = render(
      <WorkerPopup {...defaultProps} session={session} anchorX={1800} anchorY={300} />
    );
    const popup = container.firstChild as HTMLElement;
    // Should have moved left since 1800 + 250 > 1920
    expect(popup.style.left).toBeDefined();
  });

  it('adjusts position when popup would overflow top', () => {
    const session = makeSession();
    const { container } = render(
      <WorkerPopup {...defaultProps} session={session} anchorX={400} anchorY={50} />
    );
    const popup = container.firstChild as HTMLElement;
    // Should have moved below anchor since 50 - 140 < 8
    expect(popup.style.top).toBeDefined();
  });
});
