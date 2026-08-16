'use client';

import { useMemo } from 'react';
import { StateCode } from '@/lib/types';
import { STATE_COLORS } from '@/lib/ui-constants';

const CODE_TO_STATE: Record<StateCode, string> = {
  i: 'idle',
  t: 'typing',
  r: 'reading',
  w: 'waiting',
  k: 'walking',
  h: 'thinking',
  d: 'done',
  e: 'error',
};

interface Props {
  history?: StateCode[];
  /** ms between samples — used to compute how stale the rightmost bar is. */
  intervalMs?: number;
  width?: number;
  height?: number;
}

/** Pixel-art-styled sparkline: each minute is one column, coloured by state.
 *  Empty buckets (no data yet) are rendered as faint background. */
export function WorkerSparkline({ history = [], width = 120, height = 12 }: Props) {
  const max = 60;
  const bars = useMemo(() => {
    // Right-align — newest sample is rightmost
    const arr: (StateCode | null)[] = new Array(max).fill(null);
    const start = Math.max(0, max - history.length);
    for (let i = 0; i < history.length && start + i < max; i++) {
      arr[start + i] = history[i];
    }
    return arr;
  }, [history]);

  const barW = width / max;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ shapeRendering: 'crispEdges', display: 'block' }}
      aria-label="state history"
    >
      {bars.map((code, i) => {
        if (!code) {
          return (
            <rect
              key={i}
              x={i * barW}
              y={height - 1}
              width={Math.max(barW - 0.5, 0.5)}
              height={1}
              fill="#222"
            />
          );
        }
        const state = CODE_TO_STATE[code];
        const color = STATE_COLORS[state] || '#444';
        // Bar height by "activity intensity": idle/done = 2px, waiting/error = 4px, active = full
        let h = height;
        if (code === 'i' || code === 'd') h = 2;
        else if (code === 'w' || code === 'e') h = Math.max(4, height - 4);
        return (
          <rect
            key={i}
            x={i * barW}
            y={height - h}
            width={Math.max(barW - 0.5, 0.5)}
            height={h}
            fill={color}
          />
        );
      })}
    </svg>
  );
}
