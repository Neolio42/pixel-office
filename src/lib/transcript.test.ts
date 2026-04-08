import { describe, it, expect, beforeEach } from 'vitest';
import { readTaskFromTranscript, readLatestAssistantMessage } from './transcript';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('transcript', () => {
  let testFilePath: string;

  beforeEach(() => {
    testFilePath = join(tmpdir(), `test-transcript-${Date.now()}.jsonl`);
  });

  async function cleanup() {
    try {
      await unlink(testFilePath);
    } catch {
      // ignore
    }
  }

  describe('readTaskFromTranscript', () => {
    it('returns null for non-existent file', async () => {
      const result = await readTaskFromTranscript('/non/existent/file.jsonl');
      expect(result).toBeNull();
    });

    it('extracts task from user message with string content', async () => {
      const content = JSON.stringify({ type: 'user', message: { content: 'Implement a new feature for the app' } }) + '\n';
      await writeFile(testFilePath, content);
      const result = await readTaskFromTranscript(testFilePath);
      expect(result).toBe('Implement a new feature for the app');
      await cleanup();
    });

    it('extracts task from user message with array content', async () => {
      const content = JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'text', text: 'Add unit tests for the lib modules' }
          ]
        }
      }) + '\n';
      await writeFile(testFilePath, content);
      const result = await readTaskFromTranscript(testFilePath);
      expect(result).toBe('Add unit tests for the lib modules');
      await cleanup();
    });

    it('extracts first line from multi-line user message', async () => {
      const content = JSON.stringify({ type: 'user', message: { content: 'Create a login page\n\nWith username and password fields' } }) + '\n';
      await writeFile(testFilePath, content);
      const result = await readTaskFromTranscript(testFilePath);
      expect(result).toBe('Create a login page');
      await cleanup();
    });

    it('strips markdown headers from task', async () => {
      const content = JSON.stringify({ type: 'user', message: { content: '### Implement the following plan:\nCreate a new feature' } }) + '\n';
      await writeFile(testFilePath, content);
      const result = await readTaskFromTranscript(testFilePath);
      expect(result).toBe('Create a new feature');
      await cleanup();
    });

    it('skips non-user entries', async () => {
      const content = [
        JSON.stringify({ type: 'system', message: { content: 'System message' } }),
        JSON.stringify({ type: 'user', message: { content: 'Real task here' } })
      ].join('\n') + '\n';
      await writeFile(testFilePath, content);
      const result = await readTaskFromTranscript(testFilePath);
      expect(result).toBe('Real task here');
      await cleanup();
    });

    it('truncates long task to 120 characters', async () => {
      const longTask = 'This is a very long task description that should be truncated because it exceeds the maximum length of 120 characters for the task summary';
      const content = JSON.stringify({ type: 'user', message: { content: longTask } }) + '\n';
      await writeFile(testFilePath, content);
      const result = await readTaskFromTranscript(testFilePath);
      expect(result).toHaveLength(120);
      await cleanup();
    });

    it('returns null for malformed JSONL', async () => {
      const content = 'invalid json\n{incomplete json';
      await writeFile(testFilePath, content);
      const result = await readTaskFromTranscript(testFilePath);
      expect(result).toBeNull();
      await cleanup();
    });

    it('returns null for user entry without message', async () => {
      const content = JSON.stringify({ type: 'user' }) + '\n';
      await writeFile(testFilePath, content);
      const result = await readTaskFromTranscript(testFilePath);
      expect(result).toBeNull();
      await cleanup();
    });

    it('returns null for user entry without content', async () => {
      const content = JSON.stringify({ type: 'user', message: {} }) + '\n';
      await writeFile(testFilePath, content);
      const result = await readTaskFromTranscript(testFilePath);
      expect(result).toBeNull();
      await cleanup();
    });

    it('returns short text (less than 3 characters after processing)', async () => {
      const content = JSON.stringify({ type: 'user', message: { content: 'Hi' } }) + '\n';
      await writeFile(testFilePath, content);
      const result = await readTaskFromTranscript(testFilePath);
      // The filter for l.length > 3 removes 'Hi' from firstLine candidates,
      // but it falls back to raw.slice(0, 120), so 'Hi' is still returned
      expect(result).toBe('Hi');
      await cleanup();
    });
  });

  describe('readLatestAssistantMessage', () => {
    it('returns null for non-existent file', async () => {
      const result = await readLatestAssistantMessage('/non/existent/file.jsonl');
      expect(result).toBeNull();
    });

    it('extracts latest assistant message with string content', async () => {
      const content = [
        JSON.stringify({ type: 'user', message: { content: 'User message' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Assistant response' } })
      ].join('\n') + '\n';
      await writeFile(testFilePath, content);
      const result = await readLatestAssistantMessage(testFilePath);
      expect(result).toBe('Assistant response');
      await cleanup();
    });

    it('extracts latest assistant message with array content', async () => {
      const content = [
        JSON.stringify({ type: 'user', message: { content: 'User message' } }),
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Here is the response' }
            ]
          }
        })
      ].join('\n') + '\n';
      await writeFile(testFilePath, content);
      const result = await readLatestAssistantMessage(testFilePath);
      expect(result).toBe('Here is the response');
      await cleanup();
    });

    it('finds last assistant message when there are multiple', async () => {
      const content = [
        JSON.stringify({ type: 'assistant', message: { content: 'First response' } }),
        JSON.stringify({ type: 'user', message: { content: 'User message' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Second response' } })
      ].join('\n') + '\n';
      await writeFile(testFilePath, content);
      const result = await readLatestAssistantMessage(testFilePath);
      expect(result).toBe('Second response');
      await cleanup();
    });

    it('returns null for file with only user messages', async () => {
      const content = [
        JSON.stringify({ type: 'user', message: { content: 'User message 1' } }),
        JSON.stringify({ type: 'user', message: { content: 'User message 2' } })
      ].join('\n') + '\n';
      await writeFile(testFilePath, content);
      const result = await readLatestAssistantMessage(testFilePath);
      expect(result).toBeNull();
      await cleanup();
    });

    it('returns null for short assistant text (less than 5 characters)', async () => {
      const content = [
        JSON.stringify({ type: 'user', message: { content: 'User message' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Hi' } })
      ].join('\n') + '\n';
      await writeFile(testFilePath, content);
      const result = await readLatestAssistantMessage(testFilePath);
      expect(result).toBeNull();
      await cleanup();
    });

    it('returns null for assistant message without message', async () => {
      const content = JSON.stringify({ type: 'assistant' }) + '\n';
      await writeFile(testFilePath, content);
      const result = await readLatestAssistantMessage(testFilePath);
      expect(result).toBeNull();
      await cleanup();
    });

    it('returns null for assistant message without content', async () => {
      const content = JSON.stringify({ type: 'assistant', message: {} }) + '\n';
      await writeFile(testFilePath, content);
      const result = await readLatestAssistantMessage(testFilePath);
      expect(result).toBeNull();
      await cleanup();
    });

    it('handles malformed JSONL gracefully', async () => {
      const content = [
        JSON.stringify({ type: 'assistant', message: { content: 'Valid message' } }),
        'invalid json',
        JSON.stringify({ type: 'assistant', message: { content: 'Another valid message' } })
      ].join('\n') + '\n';
      await writeFile(testFilePath, content);
      const result = await readLatestAssistantMessage(testFilePath);
      expect(result).toBe('Another valid message');
      await cleanup();
    });
  });
});
