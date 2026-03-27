'use client';

import { useState, useEffect, useCallback } from 'react';

interface WhitelistRule {
  type: 'command' | 'tool';
  entry: string;
  label: string;
  addedAt: string;
}

interface PatternStat {
  pattern: string;
  total: number;
  auto: number;
  asked: number;
  allowed: number;
  denied: number;
}

export function WhitelistPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rules, setRules] = useState<WhitelistRule[]>([]);
  const [stats, setStats] = useState<PatternStat[]>([]);
  const [tab, setTab] = useState<'rules' | 'log'>('rules');

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/whitelist');
      const data = await res.json();
      setRules(data.rules || []);
    } catch { /* ignore */ }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/command-log?view=stats');
      const data = await res.json();
      setStats(data.stats || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      fetchRules();
      fetchStats();
    }
  }, [open, fetchRules, fetchStats]);

  const removeRule = async (type: string, entry: string) => {
    await fetch('/api/whitelist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, entry }),
    });
    fetchRules();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[#1a1a2e] border border-[#2a2a4a] rounded-lg shadow-2xl w-[560px] max-h-[70vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#2a2a4a] flex items-center justify-between">
          <div className="flex gap-3">
            <button
              onClick={() => setTab('rules')}
              className={`text-xs font-mono font-bold uppercase tracking-wider cursor-pointer transition-colors ${tab === 'rules' ? 'text-[#6aafcf]' : 'text-[#4a4a6a] hover:text-[#6a6a8a]'}`}
            >
              Whitelist ({rules.length})
            </button>
            <button
              onClick={() => { setTab('log'); fetchStats(); }}
              className={`text-xs font-mono font-bold uppercase tracking-wider cursor-pointer transition-colors ${tab === 'log' ? 'text-[#6aafcf]' : 'text-[#4a4a6a] hover:text-[#6a6a8a]'}`}
            >
              Command Stats
            </button>
          </div>
          <button onClick={onClose} className="text-[#4a4a6a] hover:text-[#9999bb] text-lg cursor-pointer">×</button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-4">
          {tab === 'rules' && (
            rules.length === 0 ? (
              <div className="text-[#4a4a6a] text-xs font-mono text-center py-8">
                No whitelist rules yet. Click &quot;Always Allow&quot; on an approval toast to add one.
              </div>
            ) : (
              <div className="space-y-1.5">
                {rules.map((rule) => (
                  <div key={`${rule.type}-${rule.entry}`} className="flex items-center justify-between bg-[#0e0e1a] rounded border border-[#2a2a4a] px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${rule.type === 'command' ? 'bg-[#1a2a3a] text-[#6aafcf]' : 'bg-[#2a1a3a] text-[#af6acf]'}`}>
                        {rule.type}
                      </span>
                      <span className="text-[#ccccee] text-xs font-mono font-bold">{rule.label}</span>
                      {rule.label !== rule.entry && (
                        <span className="text-[#4a4a6a] text-[10px] font-mono">{rule.entry}</span>
                      )}
                    </div>
                    <button
                      onClick={() => removeRule(rule.type, rule.entry)}
                      className="text-[#4a4a6a] hover:text-[#e05c5c] text-xs font-mono cursor-pointer transition-colors px-2"
                    >
                      remove
                    </button>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'log' && (
            stats.length === 0 ? (
              <div className="text-[#4a4a6a] text-xs font-mono text-center py-8">
                No commands logged yet. Start using Claude Code to see stats.
              </div>
            ) : (
              <div className="space-y-1">
                {/* Header */}
                <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono uppercase text-[#4a4a6a] tracking-wider">
                  <span className="flex-1">Pattern</span>
                  <span className="w-12 text-right">Total</span>
                  <span className="w-12 text-right">Auto</span>
                  <span className="w-12 text-right">Asked</span>
                  <span className="w-14 text-right">Allowed</span>
                  <span className="w-14 text-right">Denied</span>
                </div>
                {stats.map((stat) => (
                  <div key={stat.pattern} className="flex items-center gap-2 bg-[#0e0e1a] rounded border border-[#2a2a4a] px-3 py-2">
                    <span className="text-[#ccccee] text-xs font-mono font-bold flex-1 truncate">{stat.pattern}</span>
                    <span className="text-[#9999bb] text-xs font-mono w-12 text-right">{stat.total}</span>
                    <span className="text-[#4abf5c] text-xs font-mono w-12 text-right">{stat.auto || '-'}</span>
                    <span className="text-[#bf8b4a] text-xs font-mono w-12 text-right">{stat.asked || '-'}</span>
                    <span className="text-[#4abf5c] text-xs font-mono w-14 text-right">{stat.allowed || '-'}</span>
                    <span className="text-[#e05c5c] text-xs font-mono w-14 text-right">{stat.denied || '-'}</span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
