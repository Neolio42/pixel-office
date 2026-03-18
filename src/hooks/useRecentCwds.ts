'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'pixel-office-recent-cwds';
const MAX_RECENTS = 10;

export function useRecentCwds() {
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(stored)) setRecents(stored);
    } catch { /* ignore */ }
  }, []);

  const saveRecent = useCallback((cwd: string) => {
    setRecents(prev => {
      const updated = [cwd, ...prev.filter(c => c !== cwd)].slice(0, MAX_RECENTS);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  return { recents, saveRecent };
}
