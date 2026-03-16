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

// ── Palette — kept for API compatibility, no longer used for drawing ────────

export interface Palette {
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  shoes: string;
  eye: string;
  skin_shadow: string;
  shirt_shadow: string;
  hair_shadow: string;
}

export const PALETTES: Palette[] = [
  { skin: '#f5c9a0', shirt: '#4a7cbf', pants: '#2d3a5c', hair: '#6b3a1e', shoes: '#2a1a0e', eye: '#1a1a2e', skin_shadow: '#d4a070', shirt_shadow: '#2d5a96', hair_shadow: '#3d1e08' },
  { skin: '#f5c9a0', shirt: '#bf4a4a', pants: '#2d3a5c', hair: '#1e1e3a', shoes: '#2a1a0e', eye: '#1a1a2e', skin_shadow: '#d4a070', shirt_shadow: '#962828', hair_shadow: '#0e0e22' },
  { skin: '#e8b07a', shirt: '#4abf5c', pants: '#3a3a5c', hair: '#8b4513', shoes: '#1e1208', eye: '#1a1a2e', skin_shadow: '#c08050', shirt_shadow: '#2a9638', hair_shadow: '#5a2a06' },
  { skin: '#f5c9a0', shirt: '#8b4abf', pants: '#2d3a5c', hair: '#d4a017', shoes: '#2a1a0e', eye: '#1a1a2e', skin_shadow: '#d4a070', shirt_shadow: '#5c2a96', hair_shadow: '#a07010' },
  { skin: '#e8b07a', shirt: '#bf7a2a', pants: '#3a3a5c', hair: '#1e0e06', shoes: '#1e1208', eye: '#1a1a2e', skin_shadow: '#c08050', shirt_shadow: '#965210', hair_shadow: '#0a0400' },
  { skin: '#e8c090', shirt: '#bf4a8b', pants: '#3a2a5c', hair: '#4a1a6a', shoes: '#2a1a0e', eye: '#1a1a2e', skin_shadow: '#c09060', shirt_shadow: '#962868', hair_shadow: '#2a0a42' },
];

// ── Animation state ─────────────────────────────────────────────────────────

export type AnimState = 'idle' | 'typing' | 'reading' | 'waiting' | 'walking';

// Each entry is [frameX in sheet], using row 0 (facing down) for all states
// since this is a top-down office view
const FRAME_X: Record<AnimState, number[]> = {
  idle:    [1, 0],       // frames 1,0 = subtle idle breathing
  typing:  [3, 4],       // frames 3-4 = typing animation
  reading: [5, 6],       // frames 5-6 = reading/looking-down
  waiting: [0, 1],       // frames 0-1 = subtle idle sway
  walking: [0, 1, 2, 3], // full walk cycle
};

// Build FRAMES as string[][] arrays (one entry per anim frame) for API compat.
// The strings are just placeholders — actual drawing uses drawCharacter().
export const FRAMES: Record<AnimState, string[][]> = Object.fromEntries(
  Object.entries(FRAME_X).map(([state, frames]) => [
    state,
    frames.map(() => ['']),
  ])
) as Record<AnimState, string[][]>;

export const FRAME_DURATIONS: Record<AnimState, number> = {
  idle:    600,
  typing:  180,
  reading: 1200,
  waiting: 400,
  walking: 150,
};

// ── drawSprite — legacy shim (no-op when charSheet rendering is active) ────

export function drawSprite(
  _ctx: CanvasRenderingContext2D,
  _frame: string[],
  _palette: Palette,
  _x: number,
  _y: number,
  _scale: number
): void {
  // No-op: use drawCharacter() instead
}

// ── drawCharacter — main sprite rendering function ─────────────────────────
//
// charSheet: the HTMLImageElement for this worker (char_0.png … char_5.png)
// state: animation state
// frameIndex: current frame within state (wraps within FRAME_X[state])
// x, y: top-left destination in canvas pixels
// zoom: integer zoom factor (SCALE)

export type FacingDir = 'down' | 'up' | 'right' | 'left';

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

  const FRAME_W = 16;
  const FRAME_H = 32;

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
