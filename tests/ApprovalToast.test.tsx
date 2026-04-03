// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprovalToast } from '../src/components/ApprovalToast';
import type { ApprovalRequest } from '../src/hooks/usePixelOffice';
import type { Session } from '../src/lib/types';

function makeApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'a-1',
    sessionId: 's-1',
    toolName: 'Bash',
    toolInput: { command: 'npm test' },
    createdAt: Date.now(),
    reason: 'risky',
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 's-1',
    deskIndex: 0,
    state: 'waiting',
    currentTool: 'Bash',
    cwd: '/home/user/my-project',
    tty: '',
    startedAt: Date.now() - 60000,
    lastSeen: Date.now(),
    recentTools: [],
    task: 'Fix the authentication module',
    ...overrides,
  };
}

describe('ApprovalToast', () => {
  it('renders "Approval Required" header', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={vi.fn()} />);
    expect(screen.getByText('Approval Required')).toBeDefined();
  });

  it('renders tool-specific title for Bash', () => {
    const approval = makeApproval({ toolName: 'Bash', toolInput: { command: 'npm test' } });
    render(<ApprovalToast approval={approval} onDecision={vi.fn()} />);
    expect(screen.getByText('Run command')).toBeDefined();
  });

  it('renders command details for Bash', () => {
    const approval = makeApproval({ toolName: 'Bash', toolInput: { command: 'npm run build' } });
    render(<ApprovalToast approval={approval} onDecision={vi.fn()} />);
    expect(screen.getByText('npm run build')).toBeDefined();
  });

  it('renders file path for Edit tool', () => {
    const approval = makeApproval({
      toolName: 'Edit',
      toolInput: { file_path: '/project/src/components/App.tsx' },
    });
    render(<ApprovalToast approval={approval} onDecision={vi.fn()} />);
    expect(screen.getByText('Edit file')).toBeDefined();
  });

  it('renders file path for Write tool', () => {
    const approval = makeApproval({
      toolName: 'Write',
      toolInput: { file_path: '/project/src/lib/utils.ts' },
    });
    render(<ApprovalToast approval={approval} onDecision={vi.fn()} />);
    expect(screen.getByText('Write file')).toBeDefined();
  });

  it('renders file path for Read tool', () => {
    const approval = makeApproval({
      toolName: 'Read',
      toolInput: { file_path: '/project/README.md' },
    });
    render(<ApprovalToast approval={approval} onDecision={vi.fn()} />);
    expect(screen.getByText('Read file')).toBeDefined();
  });

  it('renders worker name from session', () => {
    const approval = makeApproval();
    const session = makeSession({ deskIndex: 0 });
    render(<ApprovalToast approval={approval} session={session} onDecision={vi.fn()} />);
    // Worker name is 'Pixel' for deskIndex 0
    expect(screen.getByText(/Pixel/)).toBeDefined();
  });

  it('renders task context from session', () => {
    const approval = makeApproval();
    const session = makeSession({ task: 'Fix the authentication module' });
    render(<ApprovalToast approval={approval} session={session} onDecision={vi.fn()} />);
    expect(screen.getByText('Fix the authentication module')).toBeDefined();
  });

  it('renders Approve and Deny buttons', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={vi.fn()} />);
    expect(screen.getByText('Approve')).toBeDefined();
    expect(screen.getByText('Deny')).toBeDefined();
  });

  it('calls onDecision with allow when Approve clicked', () => {
    const onDecision = vi.fn();
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={onDecision} />);
    fireEvent.click(screen.getByText('Approve'));
    expect(onDecision).toHaveBeenCalledWith('a-1', 'allow', undefined);
  });

  it('calls onDecision with deny when Deny clicked', () => {
    const onDecision = vi.fn();
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={onDecision} />);
    fireEvent.click(screen.getByText('Deny'));
    expect(onDecision).toHaveBeenCalledWith('a-1', 'deny', undefined);
  });

  it('sends message with decision when instructions provided', () => {
    const onDecision = vi.fn();
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={onDecision} />);
    const input = screen.getByPlaceholderText('Instructions for Claude (optional)');
    fireEvent.change(input, { target: { value: 'Be careful' } });
    fireEvent.click(screen.getByText('Approve'));
    expect(onDecision).toHaveBeenCalledWith('a-1', 'allow', 'Be careful');
  });

  it('submits allow on Enter in instructions input', () => {
    const onDecision = vi.fn();
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={onDecision} />);
    const input = screen.getByPlaceholderText('Instructions for Claude (optional)');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onDecision).toHaveBeenCalledWith('a-1', 'allow', undefined);
  });

  it('submits deny on Shift+Enter in instructions input', () => {
    const onDecision = vi.fn();
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={onDecision} />);
    const input = screen.getByPlaceholderText('Instructions for Claude (optional)');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onDecision).toHaveBeenCalledWith('a-1', 'deny', undefined);
  });

  it('renders MCP tool names in cleaned format', () => {
    const approval = makeApproval({
      toolName: 'mcp__my_server__do_something',
      toolInput: { query: 'test' },
    });
    render(<ApprovalToast approval={approval} onDecision={vi.fn()} />);
    expect(screen.getByText('My Server: Do Something')).toBeDefined();
  });

  it('renders unknown tool with JSON fallback', () => {
    const approval = makeApproval({
      toolName: 'CustomTool',
      toolInput: { nested: { deep: true } },
    });
    render(<ApprovalToast approval={approval} onDecision={vi.fn()} />);
    expect(screen.getByText('CustomTool')).toBeDefined();
  });
});
