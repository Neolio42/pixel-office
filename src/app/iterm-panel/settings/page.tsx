'use client';

import { useState, useEffect, useCallback } from 'react';

interface PatternRule {
  pattern: string;
  action: 'allow' | 'deny';
  label: string;
  addedAt: string;
}

export default function SettingsPage() {
  const [rules, setRules] = useState<PatternRule[]>([]);
  const [newPattern, setNewPattern] = useState('');
  const [newAction, setNewAction] = useState<'allow' | 'deny'>('allow');

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/rules');
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const addNewRule = async () => {
    const pattern = newPattern.trim();
    if (!pattern) return;
    await fetch('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern, action: newAction, label: pattern }),
    });
    setNewPattern('');
    fetchRules();
  };

  const deleteRule = async (pattern: string, action: 'allow' | 'deny') => {
    await fetch('/api/rules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern, action }),
    });
    fetchRules();
  };

  const allowRules = rules.filter(r => r.action === 'allow');
  const denyRules = rules.filter(r => r.action === 'deny');

  return (
    <div className="flex flex-col h-screen w-full bg-[#0e0e1e] overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[#1a1a3a] flex items-center gap-2 flex-shrink-0">
        <a href="/iterm-panel" className="text-[#556] hover:text-[#aab] text-[11px] font-mono cursor-pointer transition-colors">
          ← Back
        </a>
        <span className="text-[#556] text-[10px] font-mono uppercase tracking-widest">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Add rule */}
        <div className="mb-4">
          <div className="text-[#556] text-[9px] font-mono uppercase tracking-widest mb-1.5">Add Rule</div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addNewRule(); }}
              placeholder="e.g. git push, python3, npm install"
              className="flex-1 px-2 py-1 bg-[#0a0a1a] border border-[#2a2a4a] rounded text-[10px] font-mono text-[#aab] placeholder-[#334] outline-none focus:border-[#4a6a8a]"
            />
            <select
              value={newAction}
              onChange={(e) => setNewAction(e.target.value as 'allow' | 'deny')}
              className="px-2 py-1 bg-[#0a0a1a] border border-[#2a2a4a] rounded text-[10px] font-mono text-[#aab] outline-none cursor-pointer"
            >
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
            </select>
            <button
              onClick={addNewRule}
              className="px-3 py-1 bg-[#1a2a3a] hover:bg-[#2a3a4a] border border-[#2a4a6b] text-[#6aafcf] text-[10px] font-mono rounded transition-colors cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>

        {/* Deny rules */}
        <div className="mb-4">
          <div className="text-[#bf4a4a] text-[9px] font-mono uppercase tracking-widest mb-1">
            Deny ({denyRules.length})
          </div>
          {denyRules.length === 0 ? (
            <div className="text-[#333] text-[9px] font-mono px-1">No deny rules</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {denyRules.map(r => (
                <div key={`deny-${r.pattern}`} className="flex items-center gap-1.5 px-2 py-1 bg-[#1a0a0a] rounded border border-[#2a1a1a]">
                  <span className="text-[#bf4a4a] text-[10px] font-mono flex-1 min-w-0 truncate">{r.pattern}</span>
                  <button
                    onClick={() => deleteRule(r.pattern, 'deny')}
                    className="text-[#333] hover:text-[#bf4a4a] text-[10px] font-mono flex-shrink-0 cursor-pointer transition-colors"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Allow rules */}
        <div>
          <div className="text-[#4abf5c] text-[9px] font-mono uppercase tracking-widest mb-1">
            Allow ({allowRules.length})
          </div>
          {allowRules.length === 0 ? (
            <div className="text-[#333] text-[9px] font-mono px-1">No allow rules</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {allowRules.map(r => (
                <div key={`allow-${r.pattern}`} className="flex items-center gap-1.5 px-2 py-1 bg-[#0a1a0a] rounded border border-[#1a2a1a]">
                  <span className="text-[#4abf5c] text-[10px] font-mono flex-1 min-w-0 truncate">{r.pattern}</span>
                  <button
                    onClick={() => deleteRule(r.pattern, 'allow')}
                    className="text-[#333] hover:text-[#bf4a4a] text-[10px] font-mono flex-shrink-0 cursor-pointer transition-colors"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
