import { access, constants, stat } from 'fs/promises';
import { homedir } from 'os';
import { resolve } from 'path';

const CLAUDE_DIR = resolve(homedir(), '.claude');

/**
 * Read the initial user task from a Claude Code JSONL transcript.
 * Reads the first ~20KB, finds the first `type: "user"` entry.
 */
export async function readTaskFromTranscript(transcriptPath: string): Promise<string | null> {
  const resolvedPath = resolve(transcriptPath);
  if (!resolvedPath.startsWith(CLAUDE_DIR + '/')) return null;

  const path = resolvedPath;
  try {
    await access(path, constants.R_OK);
  } catch {
    return null;
  }

  try {
    const info = await stat(path);
    const readSize = Math.min(info.size, 20_000);
    const buf = Buffer.alloc(readSize);
    const { open } = await import('fs/promises');
    const fh = await open(path, 'r');
    await fh.read(buf, 0, readSize, 0);
    await fh.close();

    const chunk = buf.toString('utf-8');
    const lines = chunk.split('\n').filter(l => l.length > 0);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'user') continue;

        const raw = extractText(entry);
        if (!raw) return null;

        const firstLine = raw.split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0)
          .map(l => l.replace(/^#+\s*/, '').replace(/^implement\s+the\s+following\s+(plan|task|request):\s*/i, '').trim())
          .filter(l => l.length > 3)[0];

        return firstLine?.slice(0, 120) ?? raw.slice(0, 120);
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Read the latest assistant message from a transcript JSONL.
 * Reads the last ~30KB of the file (tail), finds the last `type: "assistant"`
 * entry with text content.
 */
export async function readLatestAssistantMessage(transcriptPath: string): Promise<string | null> {
  const resolvedPath = resolve(transcriptPath);
  if (!resolvedPath.startsWith(CLAUDE_DIR + '/')) return null;

  const path = resolvedPath;
  try {
    await access(path, constants.R_OK);
  } catch {
    return null;
  }

  try {
    const info = await stat(path);
    const tailSize = Math.min(info.size, 200_000);
    const buf = Buffer.alloc(tailSize);
    const { open } = await import('fs/promises');
    const fh = await open(path, 'r');
    await fh.read(buf, 0, tailSize, Math.max(0, info.size - tailSize));
    await fh.close();

    const chunk = buf.toString('utf-8');
    const lines = chunk.split('\n').filter(l => l.length > 0);

    // Walk backwards to find the last assistant text
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type !== 'assistant') continue;

        const text = extractText(entry);
        if (text && text.length > 5) return text;
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/** Extract text content from a JSONL entry (user or assistant). */
function extractText(entry: { message?: { content?: unknown } }): string | null {
  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null && 'type' in block && 'text' in block) {
        if ((block as { type: string }).type === 'text') {
          return (block as { text: string }).text;
        }
      }
    }
  }
  return null;
}
