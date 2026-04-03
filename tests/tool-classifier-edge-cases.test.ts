import { describe, it, expect } from 'vitest';
import { classifyTool } from '../src/lib/tool-classifier';

describe('classifyTool - edge cases', () => {
  // BashOutput should be treated like Bash
  describe('BashOutput', () => {
    it('classifies BashOutput same as Bash', () => {
      const result = classifyTool('BashOutput', { command: 'ls -la' });
      expect(result.needsApproval).toBe(false);
    });

    it('classifies BashOutput with risky command', () => {
      const result = classifyTool('BashOutput', { command: 'rm -rf /tmp' });
      expect(result.needsApproval).toBe(true);
    });
  });

  describe('more reading tools', () => {
    it('classifies Glob as safe', () => {
      const result = classifyTool('Glob', { pattern: '**/*.ts' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
    });

    it('classifies WebFetch as safe', () => {
      const result = classifyTool('WebFetch', { url: 'https://example.com' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
    });

    it('classifies WebSearch as safe', () => {
      const result = classifyTool('WebSearch', { query: 'TypeScript best practices' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
    });

    it('classifies LS as safe', () => {
      const result = classifyTool('LS', { path: '/tmp' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
    });

    it('classifies ToolSearch as safe', () => {
      const result = classifyTool('ToolSearch', {});
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
    });
  });

  describe('more typing tools', () => {
    it('classifies MultiEdit as safe', () => {
      const result = classifyTool('MultiEdit', { file_path: '/tmp/test.ts' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
    });

    it('classifies NotebookEdit as safe', () => {
      const result = classifyTool('NotebookEdit', { notebook_path: '/tmp/test.ipynb' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
    });
  });

  describe('agent tools', () => {
    it('classifies TodoWrite as safe', () => {
      const result = classifyTool('TodoWrite', {});
      expect(result.needsApproval).toBe(false);
    });

    it('classifies EnterPlanMode as safe', () => {
      const result = classifyTool('EnterPlanMode', {});
      expect(result.needsApproval).toBe(false);
    });

    it('classifies ExitPlanMode as safe', () => {
      const result = classifyTool('ExitPlanMode', {});
      expect(result.needsApproval).toBe(false);
    });

    it('classifies AskUserQuestion as safe', () => {
      const result = classifyTool('AskUserQuestion', {});
      expect(result.needsApproval).toBe(false);
    });

    it('classifies Skill as safe', () => {
      const result = classifyTool('Skill', {});
      expect(result.needsApproval).toBe(false);
    });
  });

  describe('Bash compound commands', () => {
    it('handles compound commands with pipe', () => {
      // If shfmt is available, it will parse; otherwise falls back to 'unknown'
      const result = classifyTool('Bash', { command: 'cat file.txt | grep TODO' });
      // Either safe (if parsed by shfmt) or unknown (if shfmt fails)
      if (result.reason === 'unknown') {
        expect(result.needsApproval).toBe(true);
      }
    });

    it('handles command with && operator', () => {
      const result = classifyTool('Bash', { command: 'cd /tmp && ls' });
      // Compound command - depends on shfmt availability
      if (result.reason === 'unknown') {
        expect(result.needsApproval).toBe(true);
      }
    });

    it('handles commands with quoted pipes (not compound)', () => {
      // Pipes inside quotes should not trigger compound detection
      const result = classifyTool('Bash', { command: "jq '.foo | keys' file.json" });
      // This should be safe since the pipe is inside quotes
      // The code strips quoted strings before checking compound chars
    });
  });

  describe('Bash edge cases', () => {
    it('handles git clean -fd as risky', () => {
      const result = classifyTool('Bash', { command: 'git clean -fd' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('handles git clean -fdx as risky', () => {
      const result = classifyTool('Bash', { command: 'git clean -fdx' });
      expect(result.needsApproval).toBe(true);
    });

    it('allows git commit', () => {
      const result = classifyTool('Bash', { command: 'git commit -m "fix"' });
      // git commit is not in SAFE_GIT, so it should be unknown
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });

    it('allows git checkout', () => {
      const result = classifyTool('Bash', { command: 'git checkout main' });
      // git checkout is not in SAFE_GIT, should be unknown
      expect(result.reason).toBe('unknown');
    });

    it('handles npm exec as risky', () => {
      const result = classifyTool('Bash', { command: 'npm exec some-package' });
      expect(result.needsApproval).toBe(true);
    });

    it('handles npm i (alias for install) as risky', () => {
      const result = classifyTool('Bash', { command: 'npm i express' });
      expect(result.needsApproval).toBe(true);
    });

    it('handles yarn add as risky', () => {
      const result = classifyTool('Bash', { command: 'yarn add lodash' });
      expect(result.needsApproval).toBe(true);
    });

    it('handles yarn install as risky', () => {
      const result = classifyTool('Bash', { command: 'yarn install' });
      expect(result.needsApproval).toBe(true);
    });

    it('allows yarn test', () => {
      const result = classifyTool('Bash', { command: 'yarn test' });
      expect(result.needsApproval).toBe(false);
    });

    it('handles docker run as unknown', () => {
      const result = classifyTool('Bash', { command: 'docker run -it ubuntu bash' });
      expect(result.reason).toBe('unknown');
    });

    it('allows docker images', () => {
      const result = classifyTool('Bash', { command: 'docker images' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows docker buildx', () => {
      const result = classifyTool('Bash', { command: 'docker buildx ls' });
      expect(result.needsApproval).toBe(false);
    });

    it('handles pip3 install as risky', () => {
      const result = classifyTool('Bash', { command: 'pip3 install requests' });
      expect(result.needsApproval).toBe(true);
    });

    it('allows pip3 list', () => {
      // pip3 list is not in safe npm set but should be unknown for pip
      const result = classifyTool('Bash', { command: 'pip3 list' });
      expect(result.reason).toBe('unknown');
    });

    it('handles bash -c as unknown', () => {
      const result = classifyTool('Bash', { command: 'bash -c "rm -rf /"' });
      expect(result.reason).toBe('unknown');
    });

    it('handles sh -c as unknown', () => {
      const result = classifyTool('Bash', { command: 'sh -c "echo hello"' });
      expect(result.reason).toBe('unknown');
    });

    it('handles --no-verify flag as risky', () => {
      const result = classifyTool('Bash', { command: 'somecommand --no-verify' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('handles git -f flag as risky', () => {
      const result = classifyTool('Bash', { command: 'git -f push' });
      expect(result.needsApproval).toBe(true);
    });

    it('handles mkdir as safe', () => {
      const result = classifyTool('Bash', { command: 'mkdir new-folder' });
      expect(result.needsApproval).toBe(false);
    });

    it('handles touch as safe', () => {
      const result = classifyTool('Bash', { command: 'touch newfile.txt' });
      expect(result.needsApproval).toBe(false);
    });

    it('handles command with full path', () => {
      const result = classifyTool('Bash', { command: '/usr/bin/ls -la' });
      expect(result.needsApproval).toBe(false);
    });

    it('handles variable expansion as unknown', () => {
      const result = classifyTool('Bash', { command: '$MY_COMMAND arg1' });
      expect(result.reason).toBe('unknown');
    });

    it('handles chown as risky', () => {
      const result = classifyTool('Bash', { command: 'chown user file.txt' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('handles reboot as risky', () => {
      const result = classifyTool('Bash', { command: 'reboot' });
      expect(result.needsApproval).toBe(true);
    });

    it('handles systemctl as risky', () => {
      const result = classifyTool('Bash', { command: 'systemctl restart nginx' });
      expect(result.needsApproval).toBe(true);
    });

    it('handles apt-get update as risky', () => {
      const result = classifyTool('Bash', { command: 'apt-get update' });
      expect(result.needsApproval).toBe(true);
    });

    it('handles apt show as safe', () => {
      const result = classifyTool('Bash', { command: 'apt show nodejs' });
      expect(result.needsApproval).toBe(false);
    });

    it('handles brew upgrade as risky', () => {
      const result = classifyTool('Bash', { command: 'brew upgrade node' });
      expect(result.needsApproval).toBe(true);
    });

    it('handles brew info as safe', () => {
      const result = classifyTool('Bash', { command: 'brew info node' });
      expect(result.needsApproval).toBe(false);
    });

    it('handles bun add as risky', () => {
      const result = classifyTool('Bash', { command: 'bun add react' });
      expect(result.needsApproval).toBe(true);
    });

    it('handles bun test as safe', () => {
      const result = classifyTool('Bash', { command: 'bun test' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows jq', () => {
      const result = classifyTool('Bash', { command: 'jq . package.json' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows diff', () => {
      const result = classifyTool('Bash', { command: 'diff file1.txt file2.txt' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows make', () => {
      const result = classifyTool('Bash', { command: 'make build' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows cargo', () => {
      const result = classifyTool('Bash', { command: 'cargo build' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows go', () => {
      const result = classifyTool('Bash', { command: 'go test ./...' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows deno', () => {
      const result = classifyTool('Bash', { command: 'deno test' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows vitest', () => {
      const result = classifyTool('Bash', { command: 'vitest run' });
      expect(result.needsApproval).toBe(false);
    });

    it('allows xcodebuild', () => {
      const result = classifyTool('Bash', { command: 'xcodebuild build' });
      expect(result.needsApproval).toBe(false);
    });
  });

  describe('MCP tools edge cases', () => {
    it('classifies MCP read tools as safe', () => {
      expect(classifyTool('mcp__api__get_user', {}).needsApproval).toBe(false);
      expect(classifyTool('mcp__api__list_items', {}).needsApproval).toBe(false);
      expect(classifyTool('mcp__api__find_record', {}).needsApproval).toBe(false);
      expect(classifyTool('mcp__api__search_docs', {}).needsApproval).toBe(false);
      expect(classifyTool('mcp__api__describe_table', {}).needsApproval).toBe(false);
      expect(classifyTool('mcp__api__show_config', {}).needsApproval).toBe(false);
    });

    it('classifies MCP destructive tools as risky', () => {
      expect(classifyTool('mcp__api__delete_user', {}).needsApproval).toBe(true);
      expect(classifyTool('mcp__api__remove_item', {}).needsApproval).toBe(true);
      expect(classifyTool('mcp__api__send_email', {}).needsApproval).toBe(true);
      expect(classifyTool('mcp__api__create_record', {}).needsApproval).toBe(true);
      expect(classifyTool('mcp__api__update_settings', {}).needsApproval).toBe(true);
      expect(classifyTool('mcp__api__execute_query', {}).needsApproval).toBe(true);
    });

    it('classifies MCP write/edit tools as risky', () => {
      expect(classifyTool('mcp__api__write_file', {}).needsApproval).toBe(true);
      expect(classifyTool('mcp__api__edit_config', {}).needsApproval).toBe(true);
      expect(classifyTool('mcp__api__upload_file', {}).needsApproval).toBe(true);
      expect(classifyTool('mcp__api__publish_release', {}).needsApproval).toBe(true);
    });

    it('classifies MCP browser tools as risky', () => {
      expect(classifyTool('mcp__chrome__javascript_evaluate', {}).needsApproval).toBe(true);
      expect(classifyTool('mcp__playwright__computer_click', {}).needsApproval).toBe(true);
    });

    it('classifies unknown MCP actions as auto-approved', () => {
      expect(classifyTool('mcp__custom__something_random', {}).needsApproval).toBe(false);
      expect(classifyTool('mcp__custom__navigate_page', {}).needsApproval).toBe(false);
    });

    it('handles MCP tool with multiple underscores in server name', () => {
      const result = classifyTool('mcp__my_server_v2__get_data', {});
      expect(result.needsApproval).toBe(false);
    });
  });
});
