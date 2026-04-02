import { describe, it, expect } from 'vitest';

// ---- Test bubbleText and approvalLabel from usePixelOffice ----
// These are module-private, but we can import the module and test the logic
// by re-implementing the same functions for unit testing.
// Actually, we'll extract the functions by importing the module source directly.

// Since bubbleText and approvalLabel are not exported, we recreate them here
// for testing. They should be kept in sync with src/hooks/usePixelOffice.ts

function bubbleText(session: { recentTools: { summary: string }[] }): string | null {
  const last = session.recentTools[session.recentTools.length - 1];
  if (!last) return null;
  const s = last.summary;
  if (s.length <= 25) return s;
  const cut = s.lastIndexOf(' ', 23);
  return (cut > 10 ? s.slice(0, cut) : s.slice(0, 23)) + '…';
}

function approvalLabel(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash') {
    const cmd = String(toolInput.command || '').trim();
    const firstWord = cmd.split(/\s+/)[0] || 'run';
    const short = firstWord.length > 10 ? firstWord.slice(0, 8) + '…' : firstWord;
    return `Can I ${short}?`;
  }
  if (toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') return 'Can I edit?';
  if (toolName === 'Read') return 'Can I read?';

  const mcpMatch = toolName.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (mcpMatch) {
    const server = mcpMatch[1].toLowerCase();
    if (server.includes('chrome') || server.includes('browser') || server.includes('playwright')) return 'Browser?';
    if (server.includes('clickup')) return 'ClickUp?';
    const cleaned = server.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return (cleaned.length > 12 ? cleaned.slice(0, 10) + '…' : cleaned) + '?';
  }

  const label = toolName.length > 15 ? toolName.slice(0, 13) + '…' : toolName;
  return `${label}?`;
}

describe('usePixelOffice helpers', () => {
  describe('bubbleText', () => {
    it('returns null when no recent tools', () => {
      expect(bubbleText({ recentTools: [] })).toBeNull();
    });

    it('returns short summary unchanged', () => {
      expect(bubbleText({ recentTools: [{ summary: 'Reading file.ts' }] })).toBe('Reading file.ts');
    });

    it('truncates at 25 chars boundary', () => {
      const longSummary = 'Editing a very long file name that exceeds the limit.tsx';
      const result = bubbleText({ recentTools: [{ summary: longSummary }] });
      expect(result).not.toBeNull();
      expect(result!.endsWith('…')).toBe(true);
      expect(result!.length).toBeLessThanOrEqual(26); // 25 chars + ellipsis
    });

    it('truncates at word boundary when possible', () => {
      // "This is exactly" is 14 chars (within 23), last space at 14
      const summary = 'This is exactly twenty-five characters long now';
      const result = bubbleText({ recentTools: [{ summary }] });
      expect(result).not.toBeNull();
      // Should find a space to cut at
      if (result!.includes('…')) {
        // Word boundary cut means no partial words before the ellipsis
        expect(result!.indexOf('…')).toBeGreaterThan(10);
      }
    });

    it('handles exactly 25 char summary without truncation', () => {
      const exact25 = 'a'.repeat(25);
      const result = bubbleText({ recentTools: [{ summary: exact25 }] });
      expect(result).toBe(exact25);
    });

    it('handles 26 char summary with truncation', () => {
      const s26 = 'a'.repeat(26);
      const result = bubbleText({ recentTools: [{ summary: s26 }] });
      expect(result!.endsWith('…')).toBe(true);
    });

    it('falls back to hard cut when no good word boundary', () => {
      // 30 chars, no spaces
      const noSpaces = 'a'.repeat(30);
      const result = bubbleText({ recentTools: [{ summary: noSpaces }] });
      expect(result).toBe('a'.repeat(23) + '…');
    });
  });

  describe('approvalLabel', () => {
    it('formats Bash commands', () => {
      expect(approvalLabel('Bash', { command: 'rm -rf /' })).toBe('Can I rm?');
    });

    it('formats Bash with long first word', () => {
      expect(approvalLabel('Bash', { command: 'verylongcommandname arg1' })).toBe('Can I verylong…?');
    });

    it('handles empty Bash command', () => {
      expect(approvalLabel('Bash', { command: '' })).toBe('Can I run?');
    });

    it('handles Bash with no command field', () => {
      expect(approvalLabel('Bash', {})).toBe('Can I run?');
    });

    it('formats Edit tool', () => {
      expect(approvalLabel('Edit', {})).toBe('Can I edit?');
    });

    it('formats Write tool', () => {
      expect(approvalLabel('Write', {})).toBe('Can I edit?');
    });

    it('formats MultiEdit tool', () => {
      expect(approvalLabel('MultiEdit', {})).toBe('Can I edit?');
    });

    it('formats Read tool', () => {
      expect(approvalLabel('Read', {})).toBe('Can I read?');
    });

    it('formats MCP browser tools', () => {
      expect(approvalLabel('mcp__chrome__screenshot', {})).toBe('Browser?');
      expect(approvalLabel('mcp__playwright__click', {})).toBe('Browser?');
    });

    it('formats MCP ClickUp tools', () => {
      expect(approvalLabel('mcp__clickup__create_task', {})).toBe('ClickUp?');
    });

    it('formats generic MCP tools', () => {
      expect(approvalLabel('mcp__my_server__do_thing', {})).toBe('My Server?');
    });

    it('truncates long MCP server names', () => {
      expect(approvalLabel('mcp__very_long_server_name__action', {})).toBe('Very Long …?');
    });

    it('formats unknown tools', () => {
      expect(approvalLabel('CustomTool', {})).toBe('CustomTool?');
    });

    it('truncates very long tool names', () => {
      const longName = 'A'.repeat(20);
      expect(approvalLabel(longName, {})).toBe('A'.repeat(13) + '…?');
    });

    it('formats tool at exactly 15 chars', () => {
      const name15 = 'A'.repeat(15);
      expect(approvalLabel(name15, {})).toBe(name15 + '?');
    });
  });
});
