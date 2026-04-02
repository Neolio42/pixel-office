// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Test the helper functions from TerminalTile by importing the module and testing behavior

// Since TerminalTile and EmptyTile are in the same file, we test the rendered output

vi.mock('@/hooks/useRecentCwds', () => ({
  useRecentCwds: () => ({ recents: ['/project/a', '/project/b'], saveRecent: vi.fn() }),
}));

vi.mock('./Terminal', () => ({
  Terminal: ({ ptyId }: { ptyId: string }) => {
    return <div data-testid={`terminal-${ptyId}`}>Terminal: {ptyId}</div>;
  },
}));

import { TerminalTile, EmptyTile } from '../src/components/TerminalTile';
import type { PtyTab } from '../src/hooks/usePixelOffice';
import type { Session } from '../src/lib/types';

function makeTab(overrides: Partial<PtyTab> = {}): PtyTab {
  return {
    ptyId: 'pty-1',
    cwd: '/home/user/my-project',
    exited: false,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 's-1',
    deskIndex: 0,
    state: 'typing',
    currentTool: 'Edit',
    cwd: '/home/user/my-project',
    tty: '',
    startedAt: Date.now(),
    lastSeen: Date.now(),
    recentTools: [],
    ...overrides,
  };
}

const mockWsRef = { current: null };
const mockTerminalHandlers = { current: new Map() };

describe('TerminalTile', () => {
  it('renders project name from cwd', () => {
    const tab = makeTab({ cwd: '/home/user/my-project' });
    render(
      <TerminalTile
        tab={tab}
        wsRef={mockWsRef as any}
        terminalHandlers={mockTerminalHandlers as any}
        onClose={vi.fn()}
        onSpawnHere={vi.fn()}
      />
    );
    expect(screen.getByText('my-project')).toBeDefined();
  });

  it('renders "starting…" for empty cwd', () => {
    const tab = makeTab({ cwd: '' });
    render(
      <TerminalTile
        tab={tab}
        wsRef={mockWsRef as any}
        terminalHandlers={mockTerminalHandlers as any}
        onClose={vi.fn()}
        onSpawnHere={vi.fn()}
      />
    );
    expect(screen.getByText('starting…')).toBeDefined();
  });

  it('renders exited status', () => {
    const tab = makeTab({ cwd: '/project', exited: true });
    render(
      <TerminalTile
        tab={tab}
        wsRef={mockWsRef as any}
        terminalHandlers={mockTerminalHandlers as any}
        onClose={vi.fn()}
        onSpawnHere={vi.fn()}
      />
    );
    expect(screen.getByText('project (exited)')).toBeDefined();
  });

  it('renders "Approval" badge for waiting session', () => {
    const tab = makeTab();
    const session = makeSession({ state: 'waiting' });
    render(
      <TerminalTile
        tab={tab}
        session={session}
        wsRef={mockWsRef as any}
        terminalHandlers={mockTerminalHandlers as any}
        onClose={vi.fn()}
        onSpawnHere={vi.fn()}
      />
    );
    expect(screen.getByText('Approval')).toBeDefined();
  });

  it('renders close button', () => {
    const tab = makeTab();
    render(
      <TerminalTile
        tab={tab}
        wsRef={mockWsRef as any}
        terminalHandlers={mockTerminalHandlers as any}
        onClose={vi.fn()}
        onSpawnHere={vi.fn()}
      />
    );
    expect(screen.getByText('✕')).toBeDefined();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    const tab = makeTab();
    render(
      <TerminalTile
        tab={tab}
        wsRef={mockWsRef as any}
        terminalHandlers={mockTerminalHandlers as any}
        onClose={onClose}
        onSpawnHere={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('✕'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders focus subtitle when available', () => {
    const tab = makeTab();
    const session = makeSession({ state: 'typing', currentFocus: 'Fixing auth bug' });
    render(
      <TerminalTile
        tab={tab}
        session={session}
        wsRef={mockWsRef as any}
        terminalHandlers={mockTerminalHandlers as any}
        onClose={vi.fn()}
        onSpawnHere={vi.fn()}
      />
    );
    expect(screen.getByText('Fixing auth bug')).toBeDefined();
  });
});

describe('EmptyTile', () => {
  it('renders "+ New Session" button', () => {
    render(<EmptyTile onSpawn={vi.fn()} />);
    expect(screen.getByText('+ New Session')).toBeDefined();
  });

  it('shows spawn input when button clicked', () => {
    render(<EmptyTile onSpawn={vi.fn()} />);
    fireEvent.click(screen.getByText('+ New Session'));
    expect(screen.getByPlaceholderText('Desktop/Projects/my-app')).toBeDefined();
    expect(screen.getByText('Go')).toBeDefined();
  });

  it('calls onSpawn with input value when submitted', () => {
    const onSpawn = vi.fn();
    render(<EmptyTile onSpawn={onSpawn} />);
    fireEvent.click(screen.getByText('+ New Session'));
    const input = screen.getByPlaceholderText('Desktop/Projects/my-app');
    fireEvent.change(input, { target: { value: '/my/project' } });
    fireEvent.click(screen.getByText('Go'));
    expect(onSpawn).toHaveBeenCalledWith('/my/project');
  });

  it('calls onSpawn with ~ when input is empty', () => {
    const onSpawn = vi.fn();
    render(<EmptyTile onSpawn={onSpawn} />);
    fireEvent.click(screen.getByText('+ New Session'));
    fireEvent.click(screen.getByText('Go'));
    expect(onSpawn).toHaveBeenCalledWith('~');
  });

  it('submits on Enter key', () => {
    const onSpawn = vi.fn();
    render(<EmptyTile onSpawn={onSpawn} />);
    fireEvent.click(screen.getByText('+ New Session'));
    const input = screen.getByPlaceholderText('Desktop/Projects/my-app');
    fireEvent.change(input, { target: { value: '/test' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSpawn).toHaveBeenCalledWith('/test');
  });

  it('closes input on Escape', () => {
    render(<EmptyTile onSpawn={vi.fn()} />);
    fireEvent.click(screen.getByText('+ New Session'));
    const input = screen.getByPlaceholderText('Desktop/Projects/my-app');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByText('+ New Session')).toBeDefined();
  });

  it('renders spawn error message', () => {
    render(<EmptyTile onSpawn={vi.fn()} spawnError="Directory not found" />);
    expect(screen.getByText('Directory not found')).toBeDefined();
  });

  it('renders recent projects as quick spawn buttons', () => {
    render(<EmptyTile onSpawn={vi.fn()} />);
    fireEvent.click(screen.getByText('+ New Session'));
    // The mocked useRecentCwds returns ['/project/a', '/project/b']
    expect(screen.getByText('a')).toBeDefined();
    expect(screen.getByText('b')).toBeDefined();
  });

  it('calls onSpawn when recent project clicked', () => {
    const onSpawn = vi.fn();
    render(<EmptyTile onSpawn={onSpawn} />);
    fireEvent.click(screen.getByText('+ New Session'));
    fireEvent.click(screen.getByText('a'));
    expect(onSpawn).toHaveBeenCalledWith('/project/a');
  });
});
