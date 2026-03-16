// Sprite-based renderer using PNG assets from pixel-agents
//
// Render order (painter's algorithm, back-to-front):
//   1. Floors (colorized tiles)
//   2. Walls (auto-tiled, colorized)
//   3. Back-row furniture (sorted by ty)
//   4. Desks
//   5. Workers (depth-sorted by y)
//   6. Speech bubbles

import {
  TILE_SIZE, SCALE, GRID_W, GRID_H, DESK_POSITIONS,
  GridCell, buildFurniturePlacements, FurniturePlacement,
} from './office-layout';
import { AssetBundle, HsbcParams, colorizeImage } from './asset-loader';
import { drawCharacter, FRAMES, FRAME_DURATIONS, AnimState } from './sprites';
import { WorkerEntity, getWorkerScreenPos } from './worker-entity';

const T = TILE_SIZE * SCALE; // rendered tile size in CSS pixels

// Cache furniture placements (rebuilt when layout module changes via HMR)
let cachedFurniture: FurniturePlacement[] | null = null;
function getCachedFurniturePlacements(): FurniturePlacement[] {
  if (!cachedFurniture) cachedFurniture = buildFurniturePlacements();
  return cachedFurniture;
}
// Force cache invalidation on import
cachedFurniture = null;

// Module-level asset reference set by initRenderer()
let assets: AssetBundle | null = null;

// PC animation frame counter (cycles independently of worker state)
let pcFrameTimer = 0;
let pcFrameIndex = 0;
const PC_FRAME_KEYS = ['PC/PC_FRONT_ON_1', 'PC/PC_FRONT_ON_2', 'PC/PC_FRONT_ON_3'];
const PC_FRAME_MS = 400;

// Global animation time for ambient effects
let globalTime = 0;

export function initRenderer(bundle: AssetBundle): void {
  assets = bundle;
}

// ── Floor rendering ─────────────────────────────────────────────────────────

function getColorizedFloor(floorIndex: number, params: HsbcParams): HTMLCanvasElement | null {
  if (!assets) return null;
  const key = `${floorIndex}:${params.h}:${params.s}:${params.b}:${params.c}`;
  let canvas = assets.colorizedFloors.get(key);
  if (!canvas) {
    // Colorize on demand and cache
    canvas = colorizeImage(assets.floors[floorIndex], params);
    assets.colorizedFloors.set(key, canvas);
  }
  return canvas;
}

function drawFloorTile(ctx: CanvasRenderingContext2D, tx: number, ty: number, cell: GridCell) {
  const canvas = getColorizedFloor(cell.floorIndex, cell.floorParams);
  if (!canvas) return;
  ctx.drawImage(canvas, 0, 0, TILE_SIZE, TILE_SIZE, tx * T, ty * T, T, T);
}

// ── Wall rendering (auto-tiled) ─────────────────────────────────────────────
// wall_0.png is 64×128 = 4 cols × 8 rows of 16×32 tiles
// 16 bitmask configs laid out left-to-right, top-to-bottom

const WALL_TILE_W = 16;
const WALL_TILE_H = 32;
const WALL_SHEET_COLS = 4;

function drawWallTile(ctx: CanvasRenderingContext2D, tx: number, ty: number, cell: GridCell) {
  if (!assets) return;

  if (cell.isDoor) {
    // Draw the floor through the door opening
    drawFloorTile(ctx, tx, ty, cell);
    return;
  }

  const mask = cell.wallMask;
  // Clamp to 0-15 just in case
  const idx = Math.min(15, Math.max(0, mask));
  const col = idx % WALL_SHEET_COLS;
  const row = Math.floor(idx / WALL_SHEET_COLS);

  const sx = col * WALL_TILE_W;
  const sy = row * WALL_TILE_H;

  // Draw wall tile at double height (16×32 sprite spans 2 tile rows)
  // Align bottom of sprite to bottom of this tile row
  const dx = tx * T;
  const dy = ty * T + T - WALL_TILE_H * SCALE; // top of sprite

  ctx.drawImage(
    assets.colorizedWall,
    sx, sy, WALL_TILE_W, WALL_TILE_H,
    dx, dy,
    WALL_TILE_W * SCALE,
    WALL_TILE_H * SCALE
  );
}

// ── Furniture rendering ─────────────────────────────────────────────────────

function drawFurniture(
  ctx: CanvasRenderingContext2D,
  placement: FurniturePlacement,
  assetKey?: string // override key for animation
) {
  if (!assets) return;
  const key = assetKey ?? placement.assetKey;
  const img = assets.furniture.get(key);
  if (!img) return;

  const dx = placement.tx * T + (placement.offsetX ?? 0) * SCALE;
  const dy = placement.ty * T + (placement.offsetY ?? 0) * SCALE;
  const dw = placement.pngW * SCALE;
  const dh = placement.pngH * SCALE;

  if (placement.flipX) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, placement.pngW, placement.pngH, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(img, 0, 0, placement.pngW, placement.pngH, dx, dy, dw, dh);
  }
}

// ── Main render ─────────────────────────────────────────────────────────────

export function renderOffice(
  ctx: CanvasRenderingContext2D,
  grid: GridCell[][],
  workers: WorkerEntity[],
  dt = 0
): void {
  if (!assets) return;

  ctx.imageSmoothingEnabled = false;

  // Advance global animation time
  globalTime += dt;

  // Advance PC screen animation
  pcFrameTimer += dt * 1000;
  if (pcFrameTimer >= PC_FRAME_MS) {
    pcFrameTimer -= PC_FRAME_MS;
    pcFrameIndex = (pcFrameIndex + 1) % PC_FRAME_KEYS.length;
  }

  // ── Pass 1: Floors ────────────────────────────────────────────────────────
  for (let ty = 0; ty < GRID_H; ty++) {
    for (let tx = 0; tx < GRID_W; tx++) {
      drawFloorTile(ctx, tx, ty, grid[ty][tx]);
    }
  }

  // ── Pass 2: Walls ─────────────────────────────────────────────────────────
  for (let ty = 0; ty < GRID_H; ty++) {
    for (let tx = 0; tx < GRID_W; tx++) {
      const cell = grid[ty][tx];
      if (cell.isWall || cell.isDoor) {
        drawWallTile(ctx, tx, ty, cell);
      }
    }
  }

  // ── Pass 3: Background furniture (bookshelves, plants, whiteboard, etc.) ──
  const furniturePlacements = getCachedFurniturePlacements();

  // Separate desk, PC, and decorative items
  const deskOnly: FurniturePlacement[] = [];
  const pcItems: FurniturePlacement[] = [];
  const bgItems: FurniturePlacement[] = [];

  for (const p of furniturePlacements) {
    if (p.type === 'desk') {
      deskOnly.push(p);
    } else if (p.type === 'pc') {
      pcItems.push(p);
    } else {
      bgItems.push(p);
    }
  }

  // Sort bg items by ty (back to front)
  bgItems.sort((a, b) => a.ty - b.ty || a.tx - b.tx);
  for (const p of bgItems) {
    // Subtle sway for plants
    const isPlant = p.type === 'plant' || p.type === 'plant_2' || p.type === 'large_plant'
      || p.type === 'hanging_plant' || p.type === 'cactus';
    if (isPlant) {
      const dx = p.tx * T + (p.offsetX ?? 0) * SCALE;
      const dy = p.ty * T + (p.offsetY ?? 0) * SCALE;
      const dw = p.pngW * SCALE;
      const dh = p.pngH * SCALE;
      // Sway from the base (bottom-center pivot)
      const sway = Math.sin(globalTime * 1.2 + p.tx * 2.1 + p.ty * 1.7) * 0.012;
      ctx.save();
      ctx.translate(dx + dw / 2, dy + dh);
      ctx.rotate(sway);
      ctx.translate(-(dx + dw / 2), -(dy + dh));
      drawFurniture(ctx, p);
      ctx.restore();
    } else if (p.type === 'coffee') {
      // Draw the mug normally, then add steam
      drawFurniture(ctx, p);
      drawSteam(ctx, p.tx * T + (p.offsetX ?? 0) * SCALE + 8 * SCALE, p.ty * T + (p.offsetY ?? 0) * SCALE);
    } else {
      drawFurniture(ctx, p);
    }
  }

  // ── Pass 4a: Desks first ──────────────────────────────────────────────────
  deskOnly.sort((a, b) => a.ty - b.ty);
  for (const p of deskOnly) {
    drawFurniture(ctx, p);
  }

  // ── Pass 4b: PCs on top of desks ──────────────────────────────────────────
  for (const p of pcItems) {
    // Use animated PC frame based on worker state at this desk
    const deskIdx = DESK_POSITIONS.findIndex(d => d.deskX + 1 === p.tx && d.deskY - 1 === p.ty);
    const worker = deskIdx >= 0
      ? [...workers].find(w => w.deskIndex === deskIdx && w.arrived && !w.leaving)
      : undefined;

    let pcKey: string;
    if (worker && (worker.state === 'typing' || worker.state === 'reading')) {
      pcKey = PC_FRAME_KEYS[pcFrameIndex];
    } else if (worker && worker.arrived) {
      pcKey = 'PC/PC_FRONT_ON_1';
    } else {
      pcKey = 'PC/PC_FRONT_OFF';
    }
    drawFurniture(ctx, p, pcKey);
  }

  // ── Pass 5: Workers (depth-sorted by y) ───────────────────────────────────
  const sorted = [...workers].sort((a, b) => a.y - b.y);

  const SPRITE_W = 16;
  const SPRITE_H = 32;

  for (const worker of sorted) {
    const pos = getWorkerScreenPos(worker);
    const renderedW = SPRITE_W * SCALE;
    const renderedH = SPRITE_H * SCALE;

    // Center sprite on tile, bottom-align to tile bottom
    const spx = pos.x + Math.floor((T - renderedW) / 2);
    let spy = pos.y + T - renderedH;

    // When seated (typing/reading/idle at desk), shift down slightly
    if (worker.arrived && !worker.leaving &&
        (worker.state === 'typing' || worker.state === 'reading' || worker.state === 'idle')) {
      spy += 6 * SCALE; // 6 source pixels down
    }

    const charSheet = assets.characters[worker.charIndex % assets.characters.length];
    drawCharacter(ctx, charSheet, worker.state, worker.frameIndex, spx, spy, SCALE, worker.facing);

    if (worker.speechBubble) {
      drawSpeechBubble(ctx, spx + renderedW / 2, spy - 4, worker.speechBubble);
    }
  }

  // ── Pass 6: Room labels ───────────────────────────────────────────────────
  drawRoomLabels(ctx);
}

// ── Coffee steam animation ────────────────────────────────────────────────

function drawSteam(ctx: CanvasRenderingContext2D, cx: number, topY: number) {
  const s = SCALE;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  // 3 small rising wisp pixels
  for (let i = 0; i < 3; i++) {
    const phase = globalTime * 1.5 + i * 2.1;
    const yOff = ((phase % 3) / 3) * 12 * s; // rises over 12 source pixels
    const xWobble = Math.sin(phase * 2) * 2 * s;
    const alpha = 1 - (phase % 3) / 3; // fade out as it rises
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillRect(cx + xWobble - s, topY - yOff - s, s * 2, s * 2);
  }
  ctx.globalAlpha = 1;
}

// ── Speech bubble ──────────────────────────────────────────────────────────

function drawSpeechBubble(ctx: CanvasRenderingContext2D, cx: number, bottomY: number, text: string) {
  ctx.font = 'bold 11px "Courier New", monospace';
  const metrics = ctx.measureText(text);
  const padX = 8;
  const padY = 5;
  const w = Math.ceil(metrics.width) + padX * 2;
  const h = 18 + padY * 2;
  const bx = Math.floor(cx - w / 2);
  const by = bottomY - h - 10;

  // Drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(bx + 2, by + 2, w, h);

  // Bubble background
  ctx.fillStyle = '#f0ede8';
  ctx.fillRect(bx, by, w, h);

  // Pixel-art border
  ctx.fillStyle = '#2a2a4a';
  ctx.fillRect(bx + 2, by, w - 4, 2);
  ctx.fillRect(bx + 2, by + h - 2, w - 4, 2);
  ctx.fillRect(bx, by + 2, 2, h - 4);
  ctx.fillRect(bx + w - 2, by + 2, 2, h - 4);
  // Rounded corners
  ctx.fillStyle = '#f0ede8';
  ctx.fillRect(bx, by, 2, 2);
  ctx.fillRect(bx + w - 2, by, 2, 2);
  ctx.fillRect(bx, by + h - 2, 2, 2);
  ctx.fillRect(bx + w - 2, by + h - 2, 2, 2);
  ctx.fillStyle = '#2a2a4a';
  ctx.fillRect(bx + 1, by + 1, 1, 1);
  ctx.fillRect(bx + w - 2, by + 1, 1, 1);
  ctx.fillRect(bx + 1, by + h - 2, 1, 1);
  ctx.fillRect(bx + w - 2, by + h - 2, 1, 1);

  // Tail
  const tx2 = Math.floor(cx);
  ctx.fillStyle = '#2a2a4a';
  ctx.fillRect(tx2 - 3, by + h, 6, 2);
  ctx.fillRect(tx2 - 2, by + h + 2, 4, 2);
  ctx.fillRect(tx2 - 1, by + h + 4, 2, 2);
  ctx.fillStyle = '#f0ede8';
  ctx.fillRect(tx2 - 2, by + h, 4, 2);
  ctx.fillRect(tx2 - 1, by + h + 2, 2, 2);

  // Text
  ctx.fillStyle = '#1a1a2e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, by + h / 2);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

// ── Room labels ─────────────────────────────────────────────────────────────

function drawRoomLabels(ctx: CanvasRenderingContext2D) {
  ctx.font = '9px "Courier New", monospace';
  ctx.fillStyle = 'rgba(200,200,230,0.2)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  ctx.fillText('WORK AREA',  6 * T + T / 2, 12 * T + 4);
  ctx.fillText('BREAK ROOM', 16 * T,         5 * T + 4);
  ctx.fillText('MEETING',    16 * T,         12 * T + 4);

  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

// Re-export for use in worker-entity / usePixelOffice
export type { AnimState };
export { FRAMES, FRAME_DURATIONS };
