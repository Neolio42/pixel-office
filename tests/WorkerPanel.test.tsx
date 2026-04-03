// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkerPanel } from '../src/components/WorkerPanel';
import type { Session } from '../src/lib/types';

// Mock useRecentCwds
vi.mock('@/hooks/useRecentCwds', () => ({
  useRecentCwds: () => ({ recents: ['/project/a', '/project/b'], saveRecent: vi.fn() }),
}));

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 's-1',
    deskIndex: 0,
    state: 'idle',
    currentTool: null,
    cwd: '/home/user/my-project',
    tty: '',
    startedAt: Date.now() - 60000,
    lastSeen: Date.now(),
    recentTools: [],
    ...overrides,
  };
}

describe('WorkerPanel', () => {
  it('renders "No sessions" when empty', () => {
    render(<WorkerPanel sessions={[]} visiblePtyIds={[]} />);
    expect(screen.getByText('No sessions')).toBeDefined();
  });

  it('renders session count in header', () => {
    const sessions = [makeSession(), makeSession({ sessionId: 's-2', deskIndex: 1 })];
    render(<WorkerPanel sessions={sessions} visiblePtyIds={[]} />);
    expect(screen.getByText('2 active')).toBeDefined();
  });

  it('renders project name from cwd', () => {
    const session = makeSession({ cwd: '/home/user/my-project' });
    render(<WorkerPanel sessions={[session]} visiblePtyIds={[]} />);
    expect(screen.getByText('my-project')).toBeDefined();
  });

  it('renders idle state text when no focus', () => {
    const session = makeSession({ state: 'idle' });
    render(<WorkerPanel sessions={[session]} visiblePtyIds={[]} />);
    expect(screen.getByText('Idle')).toBeDefined();
  });

  it('renders focus text when available', () => {
    const session = makeSession({ state: 'typing', currentFocus: 'Fixing auth bug' });
    render(<WorkerPanel sessions={[session]} visiblePtyIds={[]} />);
    expect(screen.getByText('Fixing auth bug')).toBeDefined();
  });

  it('renders approval needed badge when waiting', () => {
    const session = makeSession({ state: 'waiting' });
    render(<WorkerPanel sessions={[session]} visiblePtyIds={[]} />);
    expect(screen.getByText('Approval needed')).toBeDefined();
  });

  it('renders last tool summary when active', () => {
    const session = makeSession({
      state: 'typing',
      recentTools: [{ toolName: 'Edit', summary: 'Editing file.ts', timestamp: Date.now() }],
    });
    render(<WorkerPanel sessions={[session]} visiblePtyIds={[]} />);
    expect(screen.getByText('Editing file.ts')).toBeDefined();
  });

  it('calls onSpawn when spawn input submitted', async () => {
    const onSpawn = vi.fn();
    render(<WorkerPanel sessions={[]} visiblePtyIds={[]} onSpawn={onSpawn} />);
    // Click the + button to open spawn input
    const plusButton = screen.getByTitle('Spawn new Claude session');
    fireEvent.click(plusButton);
    // Type cwd and submit
    const input = screen.getByPlaceholderText('~/projects/my-app');
    fireEvent.change(input, { target: { value: '/test/project' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSpawn).toHaveBeenCalledWith('/test/project');
  });

  it('uses ~ when spawn input is empty', async () => {
    const onSpawn = vi.fn();
    render(<WorkerPanel sessions={[]} visiblePtyIds={[]} onSpawn={onSpawn} />);
    const plusButton = screen.getByTitle('Spawn new Claude session');
    fireEvent.click(plusButton);
    const input = screen.getByPlaceholderText('~/projects/my-app');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSpawn).toHaveBeenCalledWith('~');
  });

  it('renders spawn error message', () => {
    render(<WorkerPanel sessions={[]} visiblePtyIds={[]} spawnError="Spawn failed: no PTY" />);
    // The error is shown inside the spawn input area, need to open it first
    const plusButton = screen.getByTitle('Spawn new Claude session');
    fireEvent.click(plusButton);
    expect(screen.getByText('Spawn failed: no PTY')).toBeDefined();
  });

  it('expands session on click', () => {
    const session = makeSession({ state: 'idle', ptyId: 'pty-1' });
    const onSelectWorker = vi.fn();
    render(<WorkerPanel sessions={[session]} visiblePtyIds={[]} onSelectWorker={onSelectWorker} />);
    // Click on the session row
    const projectEl = screen.getByText('my-project');
    fireEvent.click(projectEl.closest('[class*="cursor-pointer"]')!);
    expect(onSelectWorker).toHaveBeenCalledWith('s-1');
  });

  it('renders "Open Terminal" button for session with ptyId', () => {
    const session = makeSession({ state: 'idle', ptyId: 'pty-1' });
    render(<WorkerPanel sessions={[session]} visiblePtyIds={[]} />);
    // Expand first
    const projectEl = screen.getByText('my-project');
    fireEvent.click(projectEl.closest('[class*="cursor-pointer"]')!);
    expect(screen.getByText('Open Terminal')).toBeDefined();
  });

  it('renders "Focus Terminal" button for session without ptyId', () => {
    const session = makeSession({ state: 'idle' });
    render(<WorkerPanel sessions={[session]} visiblePtyIds={[]} />);
    // Expand first
    const projectEl = screen.getByText('my-project');
    fireEvent.click(projectEl.closest('[class*="cursor-pointer"]')!);
    expect(screen.getByText('Focus Terminal')).toBeDefined();
  });

  it('shows visibility indicator for PTY sessions', () => {
    const session = makeSession({ state: 'idle', ptyId: 'pty-1' });
    render(<WorkerPanel sessions={[session]} visiblePtyIds={['pty-1']} />);
    expect(screen.getByTitle('Visible in grid')).toBeDefined();
  });

  it('shows background indicator for hidden PTY sessions', () => {
    const session = makeSession({ state: 'idle', ptyId: 'pty-1' });
    render(<WorkerPanel sessions={[session]} visiblePtyIds={[]} />);
    expect(screen.getByTitle('Background — drag to grid')).toBeDefined();
  });
});
