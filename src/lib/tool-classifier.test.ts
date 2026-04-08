import { describe, it, expect } from 'vitest';
import { classifyTool } from './tool-classifier';

describe('tool-classifier', () => {
  describe('Reading tools', () => {
    it('classifies Read tool as reading and safe', () => {
      const result = classifyTool('Read', { file_path: '/foo/bar.txt' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies Grep tool as reading and safe', () => {
      const result = classifyTool('Grep', { pattern: 'foo' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies Glob tool as reading and safe', () => {
      const result = classifyTool('Glob', { pattern: '*.ts' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies LS tool as reading and safe', () => {
      const result = classifyTool('LS', {});
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies WebFetch tool as reading and safe', () => {
      const result = classifyTool('WebFetch', { url: 'https://example.com' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies WebSearch tool as reading and safe', () => {
      const result = classifyTool('WebSearch', { query: 'test' });
      expect(result.state).toBe('reading');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });
  });

  describe('Typing tools', () => {
    it('classifies Edit tool as typing and safe', () => {
      const result = classifyTool('Edit', { file_path: '/foo/bar.txt', old_string: 'a', new_string: 'b' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies Write tool as typing and safe', () => {
      const result = classifyTool('Write', { file_path: '/foo/bar.txt', content: 'content' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies MultiEdit tool as typing and safe', () => {
      const result = classifyTool('MultiEdit', { file_path: '/foo/bar.txt' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies NotebookEdit tool as typing and safe', () => {
      const result = classifyTool('NotebookEdit', { notebook_path: '/foo/bar.ipynb', new_source: 'code' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });
  });

  describe('Agent tools', () => {
    it('classifies Agent tool as typing and safe', () => {
      const result = classifyTool('Agent', { description: 'test task', prompt: 'do something' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies TodoWrite tool as typing and safe', () => {
      const result = classifyTool('TodoWrite', { todos: [] });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies AskUserQuestion tool as typing and safe', () => {
      const result = classifyTool('AskUserQuestion', { questions: [] });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies Skill tool as typing and safe', () => {
      const result = classifyTool('Skill', { skill: 'test' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies EnterPlanMode tool as typing and safe', () => {
      const result = classifyTool('EnterPlanMode', {});
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('classifies ExitPlanMode tool as typing and safe', () => {
      const result = classifyTool('ExitPlanMode', {});
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });
  });

  describe('Bash tool - safe commands', () => {
    it('classifies simple safe commands as typing without approval', () => {
      const safeCommands = ['ls', 'pwd', 'cat file.txt', 'echo hello', 'grep pattern file', 'find . -name "*.ts"'];
      for (const cmd of safeCommands) {
        const result = classifyTool('Bash', { command: cmd });
        expect(result.state).toBe('typing');
        expect(result.needsApproval).toBe(false);
        expect(result.reason).toBe('safe');
      }
    });

    it('classifies safe git commands', () => {
      const safeGitCommands = ['git status', 'git log', 'git diff', 'git add .', 'git show HEAD'];
      for (const cmd of safeGitCommands) {
        const result = classifyTool('Bash', { command: cmd });
        expect(result.needsApproval).toBe(false);
        expect(result.reason).toBe('safe');
      }
    });

    it('classifies safe npm commands as typing without approval', () => {
      const safeNpmCommands = ['npm test', 'npm run build', 'npm run lint', 'npm start', 'npm ls', 'npm info'];
      for (const cmd of safeNpmCommands) {
        const result = classifyTool('Bash', { command: cmd });
        expect(result.state).toBe('typing');
        expect(result.needsApproval).toBe(false);
        expect(result.reason).toBe('safe');
      }
    });
  });

  describe('Bash tool - risky commands', () => {
    it('classifies rm command as risky requiring approval', () => {
      const result = classifyTool('Bash', { command: 'rm file.txt' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies sudo command as risky requiring approval', () => {
      const result = classifyTool('Bash', { command: 'sudo apt install something' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies chmod command as risky requiring approval', () => {
      const result = classifyTool('Bash', { command: 'chmod 755 script.sh' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies git push as risky requiring approval', () => {
      const result = classifyTool('Bash', { command: 'git push' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies git reset --hard as risky requiring approval', () => {
      const result = classifyTool('Bash', { command: 'git reset --hard HEAD' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies git clean with -f flag as risky requiring approval', () => {
      const result = classifyTool('Bash', { command: 'git clean -fd' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies npm install as risky requiring approval', () => {
      const result = classifyTool('Bash', { command: 'npm install lodash' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies npm uninstall as risky requiring approval', () => {
      const result = classifyTool('Bash', { command: 'npm uninstall lodash' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies npx command as risky requiring approval', () => {
      const result = classifyTool('Bash', { command: 'npx create-next-app' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies commands with --force flag as risky', () => {
      const result = classifyTool('Bash', { command: 'git push --force' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });

    it('classifies commands with --no-verify flag as unknown (git subcommands return before flag check)', () => {
      const result = classifyTool('Bash', { command: 'git commit --no-verify -m msg' });
      // git commit is not in SAFE_GIT, so it returns 'unknown' (needs approval)
      // The --no-verify flag check comes after git subcommand handling
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });
  });

  describe('Bash tool - unknown commands', () => {
    it('classifies unknown commands as waiting requiring approval', () => {
      const result = classifyTool('Bash', { command: 'unknown-command arg1' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });

    it('classifies compound commands without shfmt as unknown requiring approval', () => {
      const result = classifyTool('Bash', { command: 'cmd1 && cmd2' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });

    it('handles quoted pipes in commands (e.g. jq)', () => {
      const result = classifyTool('Bash', { command: 'jq \'.foo | keys\' file.json' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('handles real pipes as compound requiring approval', () => {
      const result = classifyTool('Bash', { command: 'cat file.txt | grep foo' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });
  });

  describe('MCP tools', () => {
    it('classifies MCP read/get/list actions as reading and safe', () => {
      const safeActions = ['mcp__server__get_file', 'mcp__db__list_users', 'mcp__api__fetch_data', 'mcp__test__search_items'];
      for (const toolName of safeActions) {
        const result = classifyTool(toolName, {});
        expect(result.state).toBe('reading');
        expect(result.needsApproval).toBe(false);
        expect(result.reason).toBe('safe');
      }
    });

    it('classifies MCP risky actions as waiting requiring approval', () => {
      const riskyActions = ['mcp__server__delete_file', 'mcp__db__remove_user', 'mcp__api__execute_query', 'mcp__test__send_message'];
      for (const toolName of riskyActions) {
        const result = classifyTool(toolName, {});
        expect(result.state).toBe('waiting');
        expect(result.needsApproval).toBe(true);
        expect(result.reason).toBe('risky');
      }
    });

    it('classifies unknown MCP actions as typing without approval', () => {
      const result = classifyTool('mcp__server__unknown_action', {});
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('unknown');
    });

    it('classifies risky MCP patterns that include safe words as risky', () => {
      // "delete_resource" should be risky even though it has no safe pattern
      const result = classifyTool('mcp__server__delete_resource', {});
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('risky');
    });
  });

  describe('Unknown tools', () => {
    it('classifies unknown tools as waiting requiring approval', () => {
      const result = classifyTool('UnknownTool', { arg1: 'value1' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });
  });

  describe('Edge cases', () => {
    it('handles empty command string', () => {
      const result = classifyTool('Bash', { command: '' });
      // Empty command returns unknown (needs approval)
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });

    it('handles command with only whitespace', () => {
      const result = classifyTool('Bash', { command: '   ' });
      // Whitespace-only command returns unknown (needs approval)
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });

    it('handles git subcommands with value flags', () => {
      const result = classifyTool('Bash', { command: 'git -C /path/to/repo status' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('handles git with --no-pager flag', () => {
      const result = classifyTool('Bash', { command: 'git --no-pager log' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('handles bare git command', () => {
      const result = classifyTool('Bash', { command: 'git' });
      expect(result.state).toBe('typing');
      expect(result.needsApproval).toBe(false);
      expect(result.reason).toBe('safe');
    });

    it('handles bash -c commands as unknown', () => {
      const result = classifyTool('Bash', { command: 'bash -c "echo test"' });
      expect(result.state).toBe('waiting');
      expect(result.needsApproval).toBe(true);
      expect(result.reason).toBe('unknown');
    });

    it('handles docker safe subcommands', () => {
      const safeDockerCommands = ['docker ps', 'docker images', 'docker logs container', 'docker inspect img'];
      for (const cmd of safeDockerCommands) {
        const result = classifyTool('Bash', { command: cmd });
        expect(result.state).toBe('typing');
        expect(result.needsApproval).toBe(false);
        expect(result.reason).toBe('safe');
      }
    });

    it('handles brew safe subcommands', () => {
      const safeBrewCommands = ['brew list', 'brew info git', 'brew search python', 'brew deps node'];
      for (const cmd of safeBrewCommands) {
        const result = classifyTool('Bash', { command: cmd });
        expect(result.state).toBe('typing');
        expect(result.needsApproval).toBe(false);
        expect(result.reason).toBe('safe');
      }
    });

    it('handles brew risky subcommands', () => {
      const riskyBrewCommands = ['brew install git', 'brew uninstall node', 'brew upgrade python'];
      for (const cmd of riskyBrewCommands) {
        const result = classifyTool('Bash', { command: cmd });
        expect(result.state).toBe('waiting');
        expect(result.needsApproval).toBe(true);
        expect(result.reason).toBe('risky');
      }
    });

    it('handles apt/apk safe subcommands', () => {
      const safeAptCommands = ['apt list', 'apt show git', 'apt search python', 'apt depends node'];
      for (const cmd of safeAptCommands) {
        const result = classifyTool('Bash', { command: cmd });
        expect(result.state).toBe('typing');
        expect(result.needsApproval).toBe(false);
        expect(result.reason).toBe('safe');
      }
    });

    it('handles apt/apk risky subcommands', () => {
      const riskyAptCommands = ['apt install git', 'apt remove node', 'apt upgrade python'];
      for (const cmd of riskyAptCommands) {
        const result = classifyTool('Bash', { command: cmd });
        expect(result.state).toBe('waiting');
        expect(result.needsApproval).toBe(true);
        expect(result.reason).toBe('risky');
      }
    });
  });
});
