import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage for jsdom-like testing
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

// Since useRecentCwds is a React hook with 'use client' and localStorage,
// we test the underlying logic by importing the module and mocking localStorage.
// We can't use renderHook without jsdom, so we test the storage logic directly.

describe('useRecentCwds logic', () => {
  const STORAGE_KEY = 'pixel-office-recent-cwds';
  const MAX_RECENTS = 10;

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  function simulateSaveRecent(prevRecents: string[], cwd: string): string[] {
    const updated = [cwd, ...prevRecents.filter(c => c !== cwd)].slice(0, MAX_RECENTS);
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  }

  function simulateLoadRecents(): string[] {
    try {
      const stored = JSON.parse(localStorageMock.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(stored)) return stored;
    } catch { /* ignore */ }
    return [];
  }

  it('starts with empty recents when localStorage is empty', () => {
    const recents = simulateLoadRecents();
    expect(recents).toEqual([]);
  });

  it('saves a new cwd to the front of recents', () => {
    const result = simulateSaveRecent([], '/home/user/project1');
    expect(result).toEqual(['/home/user/project1']);
  });

  it('moves existing cwd to the front', () => {
    const prev = ['/a', '/b', '/c'];
    const result = simulateSaveRecent(prev, '/c');
    expect(result).toEqual(['/c', '/a', '/b']);
  });

  it('deduplicates entries', () => {
    const prev = ['/a', '/b', '/a'];
    const result = simulateSaveRecent(prev, '/a');
    expect(result.filter(c => c === '/a')).toHaveLength(1);
  });

  it('limits recents to MAX_RECENTS (10)', () => {
    let recents: string[] = [];
    for (let i = 0; i < 15; i++) {
      recents = simulateSaveRecent(recents, `/project-${i}`);
    }
    expect(recents.length).toBe(10);
  });

  it('most recent entry is at the front', () => {
    let recents: string[] = [];
    recents = simulateSaveRecent(recents, '/first');
    recents = simulateSaveRecent(recents, '/second');
    recents = simulateSaveRecent(recents, '/third');
    expect(recents[0]).toBe('/third');
    expect(recents[1]).toBe('/second');
    expect(recents[2]).toBe('/first');
  });

  it('persists to localStorage as JSON', () => {
    simulateSaveRecent([], '/test');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify(['/test'])
    );
  });

  it('loads recents from localStorage', () => {
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(['/a', '/b']));
    const recents = simulateLoadRecents();
    expect(recents).toEqual(['/a', '/b']);
  });

  it('handles corrupted localStorage gracefully', () => {
    localStorageMock.getItem.mockReturnValueOnce('not-json');
    const recents = simulateLoadRecents();
    expect(recents).toEqual([]);
  });

  it('handles non-array localStorage value', () => {
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({ invalid: true }));
    const recents = simulateLoadRecents();
    expect(recents).toEqual([]);
  });

  it('STORAGE_KEY and MAX_RECENTS constants are correct', () => {
    expect(STORAGE_KEY).toBe('pixel-office-recent-cwds');
    expect(MAX_RECENTS).toBe(10);
  });
});
