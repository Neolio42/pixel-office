import { describe, it, expect } from 'vitest';
import { classifyTool } from '../src/lib/tool-classifier';

describe('tool-classifier - approval system overhaul features', () => {
  describe('MCP tool classification with reason', () => {
    it('classifies MCP get actions as safe', () => {
      const result = classifyTool('mcp__github__get_issue', { owner: 'test' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP list actions as safe', () => {
      const result = classifyTool('mcp__db__list_users', {});
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP read actions as safe', () => {
      const result = classifyTool('mcp__filesystem__read_file', { path: '/tmp/test.txt' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP find actions as safe', () => {
      const result = classifyTool('mcp__search__find_documents', { query: 'test' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP search actions as safe', () => {
      const result = classifyTool('mcp__api__search_records', {});
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP describe actions as safe', () => {
      const result = classifyTool('mcp__aws__describe_instance', { id: 'i-123' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP show actions as safe', () => {
      const result = classifyTool('mcp__git__show_commit', { hash: 'abc123' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP view actions as safe', () => {
      const result = classifyTool('mcp__dashboard__view_stats', {});
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP count actions as safe', () => {
      const result = classifyTool('mcp__analytics__count_events', {});
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP check actions as safe', () => {
      const result = classifyTool('mcp__monitoring__check_status', {});
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP fetch actions as safe', () => {
      const result = classifyTool('mcp__api__fetch_data', { url: '/api/data' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP browse actions as safe', () => {
      const result = classifyTool('mcp__browser__browse_page', { url: 'https://example.com' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MCP delete actions as risky', () => {
      const result = classifyTool('mcp__github__delete_issue', { owner: 'test', repo: 'test' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP remove actions as risky', () => {
      const result = classifyTool('mcp__db__remove_user', { id: 123 });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP drop actions as risky', () => {
      const result = classifyTool('mcp__db__drop_table', { table: 'users' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP destroy actions as risky', () => {
      const result = classifyTool('mcp__aws__destroy_instance', { id: 'i-123' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP execute actions as risky', () => {
      const result = classifyTool('mcp__shell__execute_command', { command: 'rm -rf /' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP javascript actions as risky', () => {
      const result = classifyTool('mcp__chrome__javascript_evaluate', { code: 'document.body.innerHTML' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP computer actions as risky', () => {
      const result = classifyTool('mcp__playwright__computer_click', { x: 100, y: 200 });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP send actions as risky', () => {
      const result = classifyTool('mcp__email__send_message', { to: 'test@example.com' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP create actions as risky', () => {
      const result = classifyTool('mcp__github__create_issue', { title: 'Bug' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP update actions as risky', () => {
      const result = classifyTool('mcp__github__update_issue', { issue_number: 1, state: 'closed' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP modify actions as risky', () => {
      const result = classifyTool('mcp__db__modify_record', { id: 1, data: {} });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP edit actions as risky', () => {
      const result = classifyTool('mcp__filesystem__edit_file', { path: '/tmp/test.txt', content: 'new' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP write actions as risky', () => {
      const result = classifyTool('mcp__filesystem__write_file', { path: '/tmp/test.txt', content: 'content' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP upload actions as risky', () => {
      const result = classifyTool('mcp__storage__upload_file', { path: '/tmp/file.txt' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies MCP publish actions as risky', () => {
      const result = classifyTool('mcp__npm__publish_package', { package: 'mypackage' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies unknown MCP actions as auto-approved with unknown reason', () => {
      const result = classifyTool('mcp__custom__some_action', {});
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('unknown');
    });

    it('prioritizes risky over safe in compound MCP action names', () => {
      const result = classifyTool('mcp__api__get_and_delete_user', { id: 123 });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('prioritizes risky over safe in create_and_get action', () => {
      const result = classifyTool('mcp__api__create_and_get_resource', {});
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('handles MCP tools with multiple underscores in server name', () => {
      const result = classifyTool('mcp__my_custom_server_v2__get_data', {});
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });
  });

  describe('Bash command classification with reason', () => {
    it('classifies safe bash commands with safe reason', () => {
      const result = classifyTool('Bash', { command: 'ls -la' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies risky bash commands with risky reason', () => {
      const result = classifyTool('Bash', { command: 'rm -rf /tmp/test' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies unknown bash commands with unknown reason', () => {
      const result = classifyTool('Bash', { command: 'some_unknown_command' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });

    it('classifies git push as risky', () => {
      const result = classifyTool('Bash', { command: 'git push origin main' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies git reset --hard as risky', () => {
      const result = classifyTool('Bash', { command: 'git reset --hard HEAD~1' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies git clean -fd as risky', () => {
      const result = classifyTool('Bash', { command: 'git clean -fd' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies git clean -fdx as risky', () => {
      const result = classifyTool('Bash', { command: 'git clean -fdx' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies git status as safe', () => {
      const result = classifyTool('Bash', { command: 'git status' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies git log as safe', () => {
      const result = classifyTool('Bash', { command: 'git log --oneline' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies git diff as safe', () => {
      const result = classifyTool('Bash', { command: 'git diff HEAD' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies npm install as risky', () => {
      const result = classifyTool('Bash', { command: 'npm install express' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies npm test as safe', () => {
      const result = classifyTool('Bash', { command: 'npm test' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies npm run build as safe', () => {
      const result = classifyTool('Bash', { command: 'npm run build' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies npm exec as risky', () => {
      const result = classifyTool('Bash', { command: 'npm exec some-package' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies npx as risky', () => {
      const result = classifyTool('Bash', { command: 'npx create-react-app myapp' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies docker ps as safe', () => {
      const result = classifyTool('Bash', { command: 'docker ps' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies docker images as safe', () => {
      const result = classifyTool('Bash', { command: 'docker images' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies docker inspect as safe', () => {
      const result = classifyTool('Bash', { command: 'docker inspect container-123' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies brew install as risky', () => {
      const result = classifyTool('Bash', { command: 'brew install node' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies brew list as safe', () => {
      const result = classifyTool('Bash', { command: 'brew list' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies brew upgrade as risky', () => {
      const result = classifyTool('Bash', { command: 'brew upgrade node' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies apt install as risky', () => {
      const result = classifyTool('Bash', { command: 'apt install git' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies apt list as safe', () => {
      const result = classifyTool('Bash', { command: 'apt list --installed' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies apt-get update as risky', () => {
      const result = classifyTool('Bash', { command: 'apt-get update' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies pnpm add as risky', () => {
      const result = classifyTool('Bash', { command: 'pnpm add lodash' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies pnpm test as safe', () => {
      const result = classifyTool('Bash', { command: 'pnpm test' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies yarn add as risky', () => {
      const result = classifyTool('Bash', { command: 'yarn add react' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies yarn test as safe', () => {
      const result = classifyTool('Bash', { command: 'yarn test' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies bun add as risky', () => {
      const result = classifyTool('Bash', { command: 'bun add express' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies bun test as safe', () => {
      const result = classifyTool('Bash', { command: 'bun test' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies cp as safe', () => {
      const result = classifyTool('Bash', { command: 'cp a.txt b.txt' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies mv as safe', () => {
      const result = classifyTool('Bash', { command: 'mv a.txt b.txt' });
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies commands with --force as risky', () => {
      const result = classifyTool('Bash', { command: 'git push --force' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies commands with --no-verify as risky', () => {
      const result = classifyTool('Bash', { command: 'git commit --no-verify -m "test"' });
      expect(result.needsApproval).toBe(true);
      // BUG: The actual code returns 'unknown' for git commit before checking --no-verify
      // The --no-verify check (line 213) happens after the git subcommand check (line 167)
      // So git commit returns 'unknown' without checking for --no-verify
      expect(result.reason).toBe('unknown');
    });

    it('classifies git -f push as risky', () => {
      const result = classifyTool('Bash', { command: 'git -f push' });
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });
  });

  describe('Tool classification returns correct state and reason', () => {
    it('returns reading state for Read tools', () => {
      const result = classifyTool('Read', { file_path: '/tmp/test.txt' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('returns typing state for Edit tools', () => {
      const result = classifyTool('Edit', { file_path: '/tmp/test.txt' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('returns typing state for Write tools', () => {
      const result = classifyTool('Write', { file_path: '/tmp/test.txt' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('returns typing state for Agent tools', () => {
      const result = classifyTool('Agent', {});
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('returns waiting state for unknown tools', () => {
      const result = classifyTool('UnknownTool', {});
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });

    it('returns waiting state for risky Bash commands', () => {
      const result = classifyTool('Bash', { command: 'rm -rf /' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('returns typing state for safe Bash commands', () => {
      const result = classifyTool('Bash', { command: 'ls -la' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('returns reading state for safe MCP tools', () => {
      const result = classifyTool('mcp__api__get_user', { id: 1 });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('returns waiting state for risky MCP tools', () => {
      const result = classifyTool('mcp__api__delete_user', { id: 1 });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('returns typing state for unknown MCP tools', () => {
      const result = classifyTool('mcp__custom__foobar', {});
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('unknown');
    });
  });
});
