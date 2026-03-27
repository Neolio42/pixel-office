'use client';

import { useState, useCallback } from 'react';

const STORAGE_KEY = 'pixel-office-recent-cwds';
const MAX_RECENTS = 10;

function loadRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(stored)) return stored;
  } catch { /* ignore */ }
  return [];
}

export function useRecentCwds() {
  const [recents, setRecents] = useState(loadRecents);

  const saveRecent = useCallback((cwd: string) => {
    setRecents(prev => {
      const updated = [cwd, ...prev.filter(c => c !== cwd)].slice(0, MAX_RECENTS);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  return { recents, saveRecent };
}
