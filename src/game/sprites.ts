// Sprite rendering using PNG character sheets from pixel-agents
//
// Sheet layout (112x96 = 7 frames × 3 rows):
//   Each frame: 16px wide × 32px tall
//   Row 0 (sy=0):  facing down
//   Row 1 (sy=32): facing up
//   Row 2 (sy=64): facing right (mirror for left)
//
// Walk cycle: frames 0-3 in each row, frame 1 = idle pose
// Typing: frames 3-4 in row 0
// Reading: frames 5-6 in row 0

// ── Animation state ─────────────────────────────────────────────────────────

export type AnimState = 'idle' | 'typing' | 'reading' | 'waiting' | 'walking';

import type { WorkerState } from '@/lib/types';

/** Map full WorkerState (8 values) to the 5 sprite animations we render. */
export function toAnimState(state: WorkerState): AnimState {
  switch (state) {
    case 'thinking': return 'reading';   // subtle scan-frame animation reads as "pondering"
    case 'done':     return 'idle';
    case 'error':    return 'waiting';   // waiting pose conveys "stuck"
    default:         return state;
  }
}

export type FacingDir = 'down' | 'up' | 'right' | 'left';

// Each entry is [frameX in sheet], using row 0 (facing down) for all states
// since this is a top-down office view
const FRAME_X: Record<AnimState, number[]> = {
  idle:    [1, 0],       // frames 1,0 = subtle idle breathing
  typing:  [3, 4],       // frames 3-4 = typing animation
  reading: [5, 6],       // frames 5-6 = reading/looking-down
  waiting: [0, 1],       // frames 0-1 = subtle idle sway
  walking: [0, 1, 2, 3], // full walk cycle
};

export const FRAME_COUNTS: Record<AnimState, number> = Object.fromEntries(
  Object.entries(FRAME_X).map(([state, frames]) => [state, frames.length])
) as Record<AnimState, number>;

export const FRAME_DURATIONS: Record<AnimState, number> = {
  idle:    600,
  typing:  180,
  reading: 1200,
  waiting: 400,
  walking: 150,
};

export const FRAME_W = 16;
export const FRAME_H = 32;

// ── drawCharacter — main sprite rendering function ─────────────────────────
//
// charSheet: the HTMLImageElement for this worker (char_0.png … char_5.png)
// state: animation state
// frameIndex: current frame within state (wraps within FRAME_X[state])
// x, y: top-left destination in canvas pixels
// zoom: integer zoom factor (SCALE)

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  charSheet: HTMLImageElement,
  state: AnimState,
  frameIndex: number,
  x: number,
  y: number,
  zoom: number,
  facing: FacingDir = 'down'
): void {
  const frameXList = FRAME_X[state];
  const fx = frameXList[frameIndex % frameXList.length];

  // Row selection based on facing direction
  // Row 0 = facing down, Row 1 = facing up, Row 2 = facing right
  let row: number;
  let flipX = false;
  switch (facing) {
    case 'up':    row = 1; break;
    case 'right': row = 2; break;
    case 'left':  row = 2; flipX = true; break;
    default:      row = 0; break; // 'down'
  }

  const sx = fx * FRAME_W;
  const sy = row * FRAME_H;
  const dw = FRAME_W * zoom;
  const dh = FRAME_H * zoom;
  const dx = Math.floor(x);
  const dy = Math.floor(y);

  if (flipX) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(charSheet, sx, sy, FRAME_W, FRAME_H, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(charSheet, sx, sy, FRAME_W, FRAME_H, dx, dy, dw, dh);
  }
}
