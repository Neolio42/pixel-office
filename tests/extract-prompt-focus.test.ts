import { describe, it, expect } from 'vitest';

// Import the exported pure functions from API routes
import { extractPromptFocus } from '../src/app/api/hooks/user-prompt/route';

describe('extractPromptFocus', () => {
  it('extracts a clear action from a simple prompt', () => {
    const result = extractPromptFocus('Fix the login bug in auth.ts');
    expect(result).toBeTruthy();
    expect(result).toContain('Fix');
  });

  it('extracts action from "add" commands', () => {
    const result = extractPromptFocus('Add error handling to the API endpoints');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('add');
  });

  it('extracts action from "remove" commands', () => {
    const result = extractPromptFocus('Remove the deprecated function');
    expect(result).toBeTruthy();
  });

  it('extracts action from "create" commands', () => {
    const result = extractPromptFocus('Create a new test file for utils');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('creat');
  });

  it('extracts action from "update" commands', () => {
    const result = extractPromptFocus('Update the dependencies');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('updat');
  });

  it('strips "let\'s" prefix', () => {
    const result = extractPromptFocus("Let's refactor the database layer");
    expect(result).toBeTruthy();
    expect(result).toContain('Refactor');
  });

  it('strips "can you" prefix', () => {
    const result = extractPromptFocus('Can you please fix the tests');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('fix');
  });

  it('strips "we need to" prefix', () => {
    const result = extractPromptFocus('We need to implement caching');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('implement');
  });

  it('handles multi-sentence prompts', () => {
    const result = extractPromptFocus('The app is slow. Let\'s optimize the database queries.');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('optimiz');
  });

  it('returns null for very short prompts', () => {
    expect(extractPromptFocus('hi')).toBeNull();
    expect(extractPromptFocus('ok')).toBeNull();
    expect(extractPromptFocus('')).toBeNull();
  });

  it('returns null for prompts under 5 chars', () => {
    expect(extractPromptFocus('test')).toBeNull();
  });

  it('returns null for questions', () => {
    expect(extractPromptFocus('What is the status of the project?')).toBeNull();
  });

  it('returns null for noise sentences', () => {
    expect(extractPromptFocus("it's working fine now")).toBeNull();
  });

  it('returns null for prompts starting with code blocks', () => {
    expect(extractPromptFocus('```js\nconsole.log("hello")\n```')).toBeNull();
  });

  it('capitalizes first letter', () => {
    const result = extractPromptFocus('Fix the bug');
    if (result) {
      expect(result[0]).toBe(result[0].toUpperCase());
    }
  });

  it('strips trailing punctuation', () => {
    const result = extractPromptFocus('Fix the bug!');
    if (result) {
      expect(result).not.toMatch(/[.!]+$/);
    }
  });

  it('handles "implement the following plan:" prefix', () => {
    const result = extractPromptFocus('Implement the following plan: Create a REST API');
    expect(result).toBeTruthy();
  });

  it('handles "please" prefix', () => {
    const result = extractPromptFocus('Please update the documentation');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('updat');
  });

  it('strips "I think we should" prefix', () => {
    const result = extractPromptFocus('I think we should clean up the code');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('clean');
  });

  it('handles "first of all" prefix', () => {
    const result = extractPromptFocus('First of all, let\'s fix the build errors');
    expect(result).toBeTruthy();
  });

  it('returns null for just "yes" or "continue"', () => {
    // These are filtered by the route handler, but extractPromptFocus
    // should still handle them gracefully
    // Actually, these are filtered before calling extractPromptFocus
    // So we test that extractPromptFocus handles short responses
    expect(extractPromptFocus('yes')).toBeNull();
  });

  it('finds actionable sentence among noise', () => {
    const prompt = "Yeah that looks good. Now build the new feature for user authentication.";
    const result = extractPromptFocus(prompt);
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('build');
  });

  it('handles "how about we" prefix', () => {
    const result = extractPromptFocus('How about we refactor the main module?');
    expect(result).toBeTruthy();
    expect(result!.toLowerCase()).toContain('refactor');
  });

  it('handles "you know" prefix', () => {
    const result = extractPromptFocus("You know, clean up the tests. They're messy.");
    expect(result).toBeTruthy();
  });

  it('strips "and stuff" suffix', () => {
    const result = extractPromptFocus('Fix the bugs and stuff');
    if (result) {
      expect(result).not.toContain('and stuff');
    }
  });
});
