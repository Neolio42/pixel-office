import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---- tool-classifier tests ----
import { classifyTool } from '../src/lib/tool-classifier';

describe('classifyTool', () => {
  it('classifies reading tools as safe', () => {
    const result = classifyTool('Read', { file_path: '/tmp/test.ts' });
    expect(result.state).toBe('reading');
    expect(result.needsApproval).toBe(false);
    expect(result.reason).toBe('safe');
  });

  it('classifies Grep as safe', () => {
    const result = classifyTool('Grep', { pattern: 'TODO' });
    expect(result.state).toBe('reading');
    expect(result.needsApproval).toBe(false);
  });

  it('classifies Edit as safe (typing)', () => {
    const result = classifyTool('Edit', { file_path: '/tmp/test.ts' });
    expect(result.state).toBe('typing');
    expect(result.needsApproval).toBe(false);
  });

  it('classifies Write as safe (typing)', () => {
    const result = classifyTool('Write', { file_path: '/tmp/test.ts' });
    expect(result.state).toBe('typing');
    expect(result.needsApproval).toBe(false);
  });

  it('classifies Agent tools as safe', () => {
    const result = classifyTool('Agent', {});
    expect(result.needsApproval).toBe(false);
  });

  it('classifies unknown tools as needing approval', () => {
    const result = classifyTool('SomeWeirdTool', {});
    expect(result.needsApproval).toBe(true);
    expect(result.reason).toBe('unknown');
    expect(result.state).toBe('waiting');
  });

  // Bash command classification
  describe('Bash commands', () => {
    it('allows safe commands like ls', () => {
      const result = classifyTool('Bash', { command: 'ls -la' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('allows cat', () => {
      const result = classifyTool('Bash', { command: 'cat file.txt' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows git status', () => {
      const result = classifyTool('Bash', { command: 'git status' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('allows git diff', () => {
      const result = classifyTool('Bash', { command: 'git diff HEAD' });
      expect(result.needsApproval).toBe(false);
    });

    it('blocks git push', () => {
      const result = classifyTool('Bash', { command: 'git push origin main' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('blocks git reset --hard', () => {
      const result = classifyTool('Bash', { command: 'git reset --hard HEAD~1' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('blocks rm', () => {
      const result = classifyTool('Bash', { command: 'rm -rf /tmp/test' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('blocks sudo', () => {
      const result = classifyTool('Bash', { command: 'sudo apt install something' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('allows npm test', () => {
      const result = classifyTool('Bash', { command: 'npm test' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows npm run build', () => {
      const result = classifyTool('Bash', { command: 'npm run build' });
      expect(result.needsApproval).toBe(false);
    });

    it('blocks npm install', () => {
      const result = classifyTool('Bash', { command: 'npm install express' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('allows node', () => {
      const result = classifyTool('Bash', { command: 'node script.js' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows python3', () => {
      const result = classifyTool('Bash', { command: 'python3 main.py' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows cp and mv', () => {
      expect(classifyTool('Bash', { command: 'cp a.txt b.txt' }).needsApproval).toBe(false);
      expect(classifyTool('Bash', { command: 'mv a.txt b.txt' }).needsApproval).toBe(false);
    });

    it('allows docker ps', () => {
      const result = classifyTool('Bash', { command: 'docker ps' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows curl and wget', () => {
      expect(classifyTool('Bash', { command: 'curl https://example.com' }).needsApproval).toBe(false);
      expect(classifyTool('Bash', { command: 'wget https://example.com/file.zip' }).needsApproval).toBe(false);
    });

    it('blocks chmod', () => {
      const result = classifyTool('Bash', { command: 'chmod 777 /tmp/test' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('blocks npx', () => {
      const result = classifyTool('Bash', { command: 'npx create-react-app myapp' });
      expect(result.needsApproval).toBe(true);
    });

    it('blocks apt-get install', () => {
      const result = classifyTool('Bash', { command: 'apt-get install git' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('allows apt list', () => {
      const result = classifyTool('Bash', { command: 'apt list --installed' });
      expect(result.needsApproval).toBe(false);
    });

    it('handles empty command', () => {
      const result = classifyTool('Bash', { command: '' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });

    it('handles bare git (no subcommand)', () => {
      const result = classifyTool('Bash', { command: 'git' });
      expect(result.needsApproval).toBe(false);
    });

    it('handles git with flags before subcommand', () => {
      const result = classifyTool('Bash', { command: 'git --no-pager log' });
      expect(result.needsApproval).toBe(false);
    });

    it('blocks brew install', () => {
      const result = classifyTool('Bash', { command: 'brew install node' });
      expect(result.needsApproval).toBe(true);
    });

    it('allows brew list', () => {
      const result = classifyTool('Bash', { command: 'brew list' });
      expect(result.needsApproval).toBe(false);
    });

    it('handles --force flag as risky', () => {
      const result = classifyTool('Bash', { command: 'somecommand --force' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('handles pip install as risky', () => {
      const result = classifyTool('Bash', { command: 'pip install requests' });
      expect(result.needsApproval).toBe(true);
    });

    it('handles pnpm add as risky', () => {
      const result = classifyTool('Bash', { command: 'pnpm add lodash' });
      expect(result.needsApproval).toBe(true);
    });

    it('handles pnpm test as safe', () => {
      const result = classifyTool('Bash', { command: 'pnpm test' });
      expect(result.needsApproval).toBe(false);
    });

    it('handles bun add as risky', () => {
      const result = classifyTool('Bash', { command: 'bun add react' });
      expect(result.needsApproval).toBe(true);
    });
  });

  // MCP tools
  describe('MCP tools', () => {
    it('classifies safe MCP actions (get, list, read)', () => {
      const result = classifyTool('mcp__github__get_issue', { owner: 'test' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies risky MCP actions (delete, send, create)', () => {
      const result = classifyTool('mcp__github__delete_issue', { owner: 'test' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies unknown MCP actions as auto-approved', () => {
      const result = classifyTool('mcp__custom__foobar', {});
      expect(result.needsApproval).toBe(false);
    });

    it('risky takes priority over safe in MCP action names', () => {
      // Something like "get_and_delete" should be risky, not safe
      const result = classifyTool('mcp__api__get_and_delete_resource', {});
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('handles MCP search tools as safe', () => {
      const result = classifyTool('mcp__db__search_users', {});
      expect(result.needsApproval).toBe(false);
    });

    it('handles MCP update tools as risky', () => {
      const result = classifyTool('mcp__db__update_user', {});
      expect(result.needsApproval).toBe(true);
    });

    it('handles MCP execute tools as risky', () => {
      const result = classifyTool('mcp__shell__execute_command', {});
      expect(result.needsApproval).toBe(true);
    });
  });
});
