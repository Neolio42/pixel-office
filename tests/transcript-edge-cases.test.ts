import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readTaskFromTranscript, readLatestAssistantMessage } from '../src/lib/transcript';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(__dirname, '.transcript-edge-test-data');

describe('transcript - edge cases', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  describe('readTaskFromTranscript edge cases', () => {
    it('handles malformed JSON lines gracefully', async () => {
      const filePath = join(TEST_DIR, 'malformed.jsonl');
      const lines = [
        'this is not json',
        '{"type": "user", "message": {"content": "Fix the bug"}}',  // valid
        '{broken json',
        '',
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBe('Fix the bug');
    });

    it('handles user message with only whitespace content', async () => {
      const filePath = join(TEST_DIR, 'whitespace.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: '   ' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      // Whitespace content passes through (no special whitespace filtering)
      expect(result).toBe('   ');
    });

    it('handles user message with short content', async () => {
      const filePath = join(TEST_DIR, 'short-content.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: 'ok' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      // Short content still passes through (filter is on trimmed lines, not content length)
      expect(result).toBe('ok');
    });

    it('strips markdown heading from task', async () => {
      const filePath = join(TEST_DIR, 'heading.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: '## Fix the login page' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBe('Fix the login page');
    });

    it('strips "implement the following plan:" prefix', async () => {
      const filePath = join(TEST_DIR, 'impl-plan.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: 'Implement the following plan:\nCreate a REST API' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBe('Create a REST API');
    });

    it('strips "implement the following task:" prefix', async () => {
      const filePath = join(TEST_DIR, 'impl-task.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: 'Implement the following task:\nBuild the module' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBe('Build the module');
    });

    it('picks first user message when multiple exist', async () => {
      const filePath = join(TEST_DIR, 'multi-user.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: 'First task description' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Working on it' } }),
        JSON.stringify({ type: 'user', message: { content: 'Follow up question' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBe('First task description');
    });

    it('handles content array with multiple text blocks (returns first)', async () => {
      const filePath = join(TEST_DIR, 'multi-block.jsonl');
      const lines = [
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              { type: 'text', text: 'First block' },
              { type: 'text', text: 'Second block' },
            ],
          },
        }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBe('First block');
    });

    it('handles user message with null content', async () => {
      const filePath = join(TEST_DIR, 'null-content.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: null } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBeNull();
    });

    it('handles user message without message field', async () => {
      const filePath = join(TEST_DIR, 'no-message.jsonl');
      const lines = [
        JSON.stringify({ type: 'user' }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBeNull();
    });

    it('handles content array with no text blocks', async () => {
      const filePath = join(TEST_DIR, 'no-text-blocks.jsonl');
      const lines = [
        JSON.stringify({
          type: 'user',
          message: {
            content: [{ type: 'image', url: 'data:image/png;base64,abc' }],
          },
        }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBeNull();
    });

    it('truncates long task at 120 chars', async () => {
      const filePath = join(TEST_DIR, 'long-task.jsonl');
      const longTask = 'A'.repeat(200);
      const lines = [
        JSON.stringify({ type: 'user', message: { content: longTask } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).not.toBeNull();
      expect(result!.length).toBeLessThanOrEqual(120);
    });
  });

  describe('readLatestAssistantMessage edge cases', () => {
    it('handles malformed JSON lines gracefully', async () => {
      const filePath = join(TEST_DIR, 'malformed-assistant.jsonl');
      const lines = [
        'not json',
        JSON.stringify({ type: 'assistant', message: { content: 'Valid response here' } }),
        'also not json',
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBe('Valid response here');
    });

    it('returns null when all assistant messages are too short', async () => {
      const filePath = join(TEST_DIR, 'all-short.jsonl');
      const lines = [
        JSON.stringify({ type: 'assistant', message: { content: 'ok' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'yes' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'no' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBeNull();
    });

    it('finds assistant message from content array with mixed blocks', async () => {
      const filePath = join(TEST_DIR, 'mixed-blocks.jsonl');
      const lines = [
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read' },
              { type: 'text', text: 'Here is the analysis of the code' },
            ],
          },
        }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBe('Here is the analysis of the code');
    });

    it('handles file with only system entries', async () => {
      const filePath = join(TEST_DIR, 'system-only.jsonl');
      const lines = [
        JSON.stringify({ type: 'system', message: 'start' }),
        JSON.stringify({ type: 'system', message: 'init' }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBeNull();
    });

    it('returns the LAST assistant message when multiple exist', async () => {
      const filePath = join(TEST_DIR, 'multiple-assistant.jsonl');
      const lines = [
        JSON.stringify({ type: 'assistant', message: { content: 'First response with enough text' } }),
        JSON.stringify({ type: 'user', message: { content: 'Follow up' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Second response with enough text' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Third response with enough text' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBe('Third response with enough text');
    });

    it('handles exactly 5-char assistant message (boundary)', async () => {
      const filePath = join(TEST_DIR, 'boundary.jsonl');
      const lines = [
        JSON.stringify({ type: 'assistant', message: { content: '12345' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBeNull(); // length must be > 5
    });

    it('handles 6-char assistant message (just above boundary)', async () => {
      const filePath = join(TEST_DIR, 'above-boundary.jsonl');
      const lines = [
        JSON.stringify({ type: 'assistant', message: { content: '123456' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBe('123456');
    });

    it('handles empty file', async () => {
      const filePath = join(TEST_DIR, 'empty-assistant.jsonl');
      writeFileSync(filePath, '');

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBeNull();
    });
  });
});
