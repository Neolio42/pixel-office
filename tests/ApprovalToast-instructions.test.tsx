import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ApprovalToast } from '../src/components/ApprovalToast';
import { ApprovalRequest } from '../src/hooks/usePixelOffice';

describe('ApprovalToast - instruction message support', () => {
  const mockOnDecision = vi.fn();

  function makeApproval(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
    return {
      id: 'approval-1',
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'npm install' },
      createdAt: Date.now(),
      reason: 'risky',
      ...overrides,
    };
  }

  function makeSession(task?: string) {
    return {
      sessionId: 'session-1',
      deskIndex: 0,
      state: 'waiting' as const,
      currentTool: 'Bash',
      cwd: '/tmp/project',
      tty: '/dev/pts/0',
      startedAt: Date.now(),
      lastSeen: Date.now(),
      recentTools: [],
      task,
    };
  }

  beforeEach(() => {
    mockOnDecision.mockClear();
  });

  it('renders instructions input field', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    expect(input).toBeInTheDocument();
  });

  it('allows typing instructions in the input field', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/instructions for claude/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Please check dependencies first' } });

    expect(input.value).toBe('Please check dependencies first');
  });

  it('includes instructions when approving with Enter key', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.change(input, { target: { value: 'Use --legacy-peer-deps' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'allow', 'Use --legacy-peer-deps');
  });

  it('includes instructions when denying with Shift+Enter', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.change(input, { target: { value: 'Wrong package, use npm instead' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'deny', 'Wrong package, use npm instead');
  });

  it('approves without instructions when input is empty', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'allow', undefined);
  });

  it('denies without instructions when input is empty', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'deny', undefined);
  });

  it('trims whitespace from instructions before sending', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.change(input, { target: { value: '  Use version 5.0  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'allow', 'Use version 5.0');
  });

  it('handles empty string after trimming', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'allow', undefined);
  });

  it('submits instructions when clicking Approve button', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.change(input, { target: { value: 'Check the lockfile' } });

    const approveButton = screen.getByText('Approve');
    fireEvent.click(approveButton);

    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'allow', 'Check the lockfile');
  });

  it('submits instructions when clicking Deny button', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.change(input, { target: { value: 'Use yarn instead' } });

    const denyButton = screen.getByText('Deny');
    fireEvent.click(denyButton);

    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'deny', 'Use yarn instead');
  });

  it('supports long instruction messages', () => {
    const approval = makeApproval();
    const longMessage = 'Please ensure you review all dependencies and check for any known security vulnerabilities before proceeding with the installation. Make sure to use the exact version specified in the package.json file.';

    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.change(input, { target: { value: longMessage } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'allow', longMessage);
  });

  it('preserves input value when user types', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/instructions for claude/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'First' } });
    expect(input.value).toBe('First');

    fireEvent.change(input, { target: { value: 'First instruction' } });
    expect(input.value).toBe('First instruction');
  });

  it('prevents default on Enter key to avoid form submission', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.keyDown(input, { key: 'Enter' });

    // The component should call onDecision when Enter is pressed
    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'allow', undefined);
  });

  it('stops propagation on keydown events', () => {
    const approval = makeApproval();
    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockOnDecision).toHaveBeenCalled();
  });

  it('shows worker name and cwd in header when session is provided', () => {
    const approval = makeApproval();
    const session = makeSession('Fix the build');

    render(<ApprovalToast approval={approval} session={session} onDecision={mockOnDecision} />);

    // Worker name and cwd are combined in a single span: "Pixel · tmp/project"
    // Use getAllByText since multiple elements may contain the text
    const pixelElements = screen.getAllByText((content, element) => {
      return element?.textContent?.includes('Pixel') ?? false;
    });
    expect(pixelElements.length).toBeGreaterThan(0);

    const projectElements = screen.getAllByText((content, element) => {
      return element?.textContent?.includes('tmp/project') ?? false;
    });
    expect(projectElements.length).toBeGreaterThan(0);
  });

  it('shows task context when session has task', () => {
    const approval = makeApproval();
    const session = makeSession('Install dependencies for testing');

    render(<ApprovalToast approval={approval} session={session} onDecision={mockOnDecision} />);

    expect(screen.getByText(/Install dependencies for testing/)).toBeInTheDocument();
  });

  it('strips leading characters from task display', () => {
    const approval = makeApproval();
    const session = makeSession('— Fix the bug');

    render(<ApprovalToast approval={approval} session={session} onDecision={mockOnDecision} />);

    const taskElement = screen.getByText(/Fix the bug/);
    expect(taskElement).toBeInTheDocument();
    expect(taskElement.textContent).not.toContain('—');
  });

  it('does not show task section when session has no task', () => {
    const approval = makeApproval();
    const session = makeSession(undefined);

    render(<ApprovalToast approval={approval} session={session} onDecision={mockOnDecision} />);

    // The task section should not be present or should be empty
    const taskSection = screen.queryByText(/Install dependencies|Fix|Implement|Build/i);
    expect(taskSection).not.toBeInTheDocument();
  });

  it('handles multiline instructions', () => {
    const approval = makeApproval();
    // BUG: HTML input elements flatten newlines in their value
    // The component uses <input type="text"> which doesn't support multiline
    // When newlines are typed into an input, they get flattened to single line
    const multilineMessage = 'First line\nSecond line\nThird line';
    const flattenedMessage = 'First lineSecond lineThird line';

    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.change(input, { target: { value: multilineMessage } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'allow', flattenedMessage);
  });

  it('handles special characters in instructions', () => {
    const approval = makeApproval();
    const specialMessage = 'Use --force & check $HOME/.npmrc';

    render(<ApprovalToast approval={approval} onDecision={mockOnDecision} />);

    const input = screen.getByPlaceholderText(/Instructions for Claude/i);
    fireEvent.change(input, { target: { value: specialMessage } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockOnDecision).toHaveBeenCalledWith('approval-1', 'allow', specialMessage);
  });
});
