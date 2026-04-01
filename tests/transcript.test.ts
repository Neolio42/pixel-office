import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readTaskFromTranscript, readLatestAssistantMessage } from '../src/lib/transcript';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(__dirname, '.transcript-test-data');

describe('transcript', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('readTaskFromTranscript', () => {
    it('returns null for non-existent file', async () => {
      const result = await readTaskFromTranscript('/non/existent/path.jsonl');
      expect(result).toBeNull();
    });

    it('extracts task from first user message', async () => {
      const filePath = join(TEST_DIR, 'test1.jsonl');
      const lines = [
        JSON.stringify({ type: 'system', message: 'Session started' }),
        JSON.stringify({ type: 'user', message: { content: 'Fix the login bug in auth.ts' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'I will fix the bug' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBe('Fix the login bug in auth.ts');
    });

    it('extracts task from content array format', async () => {
      const filePath = join(TEST_DIR, 'test2.jsonl');
      const lines = [
        JSON.stringify({
          type: 'user',
          message: {
            content: [{ type: 'text', text: 'Implement the following plan:\nCreate a REST API' }],
          },
        }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      // Should strip the "implement the following plan" prefix
      expect(result).toBeTruthy();
    });

    it('returns null for empty file', async () => {
      const filePath = join(TEST_DIR, 'empty.jsonl');
      writeFileSync(filePath, '');

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBeNull();
    });

    it('skips non-user entries', async () => {
      const filePath = join(TEST_DIR, 'no-user.jsonl');
      const lines = [
        JSON.stringify({ type: 'system', message: 'start' }),
        JSON.stringify({ type: 'assistant', message: { content: 'Hello' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result).toBeNull();
    });

    it('truncates long tasks to 120 chars', async () => {
      const filePath = join(TEST_DIR, 'long.jsonl');
      const longTask = 'A'.repeat(200);
      const lines = [
        JSON.stringify({ type: 'user', message: { content: longTask } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readTaskFromTranscript(filePath);
      expect(result!.length).toBeLessThanOrEqual(120);
    });
  });

  describe('readLatestAssistantMessage', () => {
    it('returns null for non-existent file', async () => {
      const result = await readLatestAssistantMessage('/non/existent/path.jsonl');
      expect(result).toBeNull();
    });

    it('finds the last assistant message', async () => {
      const filePath = join(TEST_DIR, 'assistant.jsonl');
      const lines = [
        JSON.stringify({ type: 'assistant', message: { content: 'First response' } }),
        JSON.stringify({ type: 'user', message: { content: 'Follow up' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Latest response here' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBe('Latest response here');
    });

    it('finds assistant message from content array', async () => {
      const filePath = join(TEST_DIR, 'assistant-array.jsonl');
      const lines = [
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Array format response' }],
          },
        }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBe('Array format response');
    });

    it('skips very short assistant messages', async () => {
      const filePath = join(TEST_DIR, 'short.jsonl');
      const lines = [
        JSON.stringify({ type: 'assistant', message: { content: 'ok' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'This is a real response with enough content' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBe('This is a real response with enough content');
    });

    it('returns null when no assistant messages exist', async () => {
      const filePath = join(TEST_DIR, 'no-assistant.jsonl');
      const lines = [
        JSON.stringify({ type: 'user', message: { content: 'Hello' } }),
      ];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readLatestAssistantMessage(filePath);
      expect(result).toBeNull();
    });
  });
});
