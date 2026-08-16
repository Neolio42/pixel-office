'use client';

import { useCallback, useState, useEffect } from 'react';
import { SplitPane } from './SplitPane';
import { TerminalTile, EmptyTile } from './TerminalTile';
import { PtyTab } from '@/hooks/useWorkspace';
import { Session, WSMessageToClient } from '@/lib/types';

const STORAGE_KEY = 'pixel-office-pane-layout';
const MAX_TERMINALS = 12;

// ── Tree types ────────────────────────────────────────────────────────────────

interface PaneNode {
  type: 'pane';
  ptyId: string;
}

interface SplitNode {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  ratio: number;
  first: PaneTree;
  second: PaneTree;
}

interface EmptyNode {
  type: 'empty';
}

type PaneTree = PaneNode | SplitNode | EmptyNode;

// ── Default layout: 2 columns × 3 rows ───────────────────────────────────────

function defaultLayout(): PaneTree {
  return {
    type: 'split',
    direction: 'horizontal',
    ratio: 0.5,
    first: {
      type: 'split',
      direction: 'vertical',
      ratio: 1 / 3,
      first: { type: 'empty' },
      second: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'empty' },
        second: { type: 'empty' },
      },
    },
    second: {
      type: 'split',
      direction: 'vertical',
      ratio: 1 / 3,
      first: { type: 'empty' },
      second: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'empty' },
        second: { type: 'empty' },
      },
    },
  };
}

// ── Tree helpers ─────────────────────────────────────────────────────────────

function countEmpty(node: PaneTree): number {
  if (node.type === 'empty') return 1;
  if (node.type === 'pane') return 0;
  return countEmpty(node.first) + countEmpty(node.second);
}

function countPanes(node: PaneTree): number {
  if (node.type === 'pane') return 1;
  if (node.type === 'empty') return 0;
  return countPanes(node.first) + countPanes(node.second);
}

/** Find and fill the first empty node. Returns new tree or null if no empty. */
function fillEmpty(tree: PaneTree, ptyId: string): PaneTree | null {
  if (tree.type === 'empty') return { type: 'pane', ptyId };
  if (tree.type === 'pane') return null;
  const first = fillEmpty(tree.first, ptyId);
  if (first) return { ...tree, first };
  const second = fillEmpty(tree.second, ptyId);
  if (second) return { ...tree, second };
  return null;
}

/** Remove a pane, replacing it with empty. */
function removePane(tree: PaneTree, ptyId: string): PaneTree {
  if (tree.type === 'empty') return tree;
  if (tree.type === 'pane') return tree.ptyId === ptyId ? { type: 'empty' } : tree;
  return {
    ...tree,
    first: removePane(tree.first, ptyId),
    second: removePane(tree.second, ptyId),
  };
}

/** Get all ptyIds in the tree */
function getPtyIds(node: PaneTree): string[] {
  if (node.type === 'pane') return [node.ptyId];
  if (node.type === 'empty') return [];
  return [...getPtyIds(node.first), ...getPtyIds(node.second)];
}

/** Update a ratio at a specific path */
function updateRatio(tree: PaneTree, path: number[], ratio: number): PaneTree {
  if (path.length === 0) return tree;
  if (tree.type !== 'split') return tree;
  const [head, ...rest] = path;
  if (head === 0) return { ...tree, first: updateRatio(tree.first, rest, ratio) };
  return { ...tree, second: updateRatio(tree.second, rest, ratio) };
}

// ── Layout persistence ───────────────────────────────────────────────────────

function loadLayout(): PaneTree {
  if (typeof window === 'undefined') return defaultLayout();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return defaultLayout();
}

function saveLayout(tree: PaneTree) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tree));
  } catch { /* ignore */ }
}

// ── Container component ──────────────────────────────────────────────────────

interface PaneContainerProps {
  ptyTabs: PtyTab[];
  sessions: Session[];
  wsRef: React.RefObject<WebSocket | null>;
  terminalHandlers: React.RefObject<Map<string, (msg: WSMessageToClient) => void>>;
  reconnectCount?: number;
  onClosePane: (ptyId: string) => void;
  onSpawn: (cwd: string) => void;
  spawnError?: string | null;
}

export function PaneContainer({
  ptyTabs,
  sessions,
  wsRef,
  terminalHandlers,
  reconnectCount,
  onClosePane,
  onSpawn,
  spawnError,
}: PaneContainerProps) {
  const [layout, setLayout] = useState<PaneTree>(defaultLayout);
  const [loaded, setLoaded] = useState(false);

  // Load persisted layout on mount
  useEffect(() => {
    setLayout(loadLayout());
    setLoaded(true);
  }, []);

  // Sync ptyTabs into the tree — add new panes, remove closed ones
  useEffect(() => {
    if (!loaded) return;

    const ptyIdsInTree = new Set(getPtyIds(layout));
    const ptyIdsInTabs = new Set(ptyTabs.map(t => t.ptyId));

    let tree = layout;

    // Add new tabs to empty slots
    for (const tab of ptyTabs) {
      if (!ptyIdsInTree.has(tab.ptyId)) {
        const filled = fillEmpty(tree, tab.ptyId);
        if (filled) {
          tree = filled;
          ptyIdsInTree.add(tab.ptyId);
        }
      }
    }

    // Remove panes whose tabs no longer exist
    for (const id of ptyIdsInTree) {
      if (!ptyIdsInTabs.has(id)) {
        tree = removePane(tree, id);
      }
    }

    setLayout(tree);
  }, [loaded, ptyTabs]);

  // Persist layout changes
  useEffect(() => {
    if (loaded) saveLayout(layout);
  }, [layout, loaded]);

  const handleRatioChange = useCallback((path: number[], ratio: number) => {
    setLayout(prev => updateRatio(prev, path, ratio));
  }, []);

  const handleSpawn = useCallback((cwd: string) => {
    onSpawn(cwd);
  }, [onSpawn]);

  // If too many panes for the tree, reset to default (which has 6 slots)
  const paneCount = countPanes(layout);
  const emptyCount = countEmpty(layout);

  return (
    <div className="flex-1 min-h-0 min-w-0">
      {renderTree(layout, [], {
        ptyTabs,
        sessions,
        wsRef,
        terminalHandlers,
        reconnectCount,
        onClosePane,
        onSpawn: handleSpawn,
        spawnError,
        onRatioChange: handleRatioChange,
        hasRoom: emptyCount > 0 && paneCount < MAX_TERMINALS,
      })}
    </div>
  );
}

// ── Tree renderer ────────────────────────────────────────────────────────────

interface RenderContext {
  ptyTabs: PtyTab[];
  sessions: Session[];
  wsRef: React.RefObject<WebSocket | null>;
  terminalHandlers: React.RefObject<Map<string, (msg: WSMessageToClient) => void>>;
  reconnectCount?: number;
  onClosePane: (ptyId: string) => void;
  onSpawn: (cwd: string) => void;
  spawnError?: string | null;
  onRatioChange: (path: number[], ratio: number) => void;
  hasRoom: boolean;
}

function renderTree(node: PaneTree, path: number[], ctx: RenderContext): React.ReactNode {
  if (node.type === 'empty') {
    if (!ctx.hasRoom) return null;
    return (
      <EmptyTile
        key={`empty-${path.join('-')}`}
        onSpawn={ctx.onSpawn}
        spawnError={ctx.spawnError}
      />
    );
  }

  if (node.type === 'pane') {
    const tab = ctx.ptyTabs.find(t => t.ptyId === node.ptyId);
    if (!tab) {
      // Tab was removed — show empty
      if (!ctx.hasRoom) return null;
      return (
        <EmptyTile
          key={`empty-${path.join('-')}`}
          onSpawn={ctx.onSpawn}
          spawnError={ctx.spawnError}
        />
      );
    }
    const session = ctx.sessions.find(s => s.ptyId === node.ptyId);
    return (
      <div key={node.ptyId} className="h-full w-full min-h-0 min-w-0">
        <TerminalTile
          tab={tab}
          session={session}
          wsRef={ctx.wsRef}
          terminalHandlers={ctx.terminalHandlers}
          onClose={() => ctx.onClosePane(node.ptyId)}
          onSpawnHere={ctx.onSpawn}
          reconnectCount={ctx.reconnectCount}
        />
      </div>
    );
  }

  // Split node
  return (
    <SplitPane
      key={`split-${path.join('-')}`}
      direction={node.direction}
      defaultRatio={node.ratio}
      onRatioChange={(ratio) => ctx.onRatioChange(path, ratio)}
      first={renderTree(node.first, [...path, 0], ctx)}
      second={renderTree(node.second, [...path, 1], ctx)}
    />
  );
}

/** Reset layout to default — exposed for a settings button if needed */
export function resetPaneLayout() {
  const layout = defaultLayout();
  saveLayout(layout);
  return layout;
}
