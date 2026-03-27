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
import { drawCharacter, FRAME_DURATIONS, FRAME_W, FRAME_H, AnimState } from './sprites';
import { WorkerEntity, getWorkerScreenPos, EmoteType } from './worker-entity';

/** Interaction state passed from the UI layer to the renderer each frame */
export interface CanvasInteraction {
  hoveredWorkerId: string | null;
  selectedWorkerId: string | null;
  drag: {
    workerId: string;
    cursorX: number; // logical canvas pixel X
    cursorY: number; // logical canvas pixel Y
  } | null;
  dropTile: { tx: number; ty: number } | null; // walkable tile under drag cursor
}

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

// Pre-computed furniture partitions (built once in initRenderer)
let sortedBgItems: FurniturePlacement[] = [];
let sortedDesks: FurniturePlacement[] = [];
let cachedPcItems: FurniturePlacement[] = [];
let pcDeskMap: Map<FurniturePlacement, number> = new Map();

// Scratch buffer for worker depth-sort (avoids allocation each frame)
const workerSortBuffer: WorkerEntity[] = [];

export function initRenderer(bundle: AssetBundle): void {
  assets = bundle;
  const all = getCachedFurniturePlacements();
  sortedBgItems = all.filter(p => p.type !== 'desk' && p.type !== 'pc')
    .sort((a, b) => a.ty - b.ty || a.tx - b.tx);
  sortedDesks = all.filter(p => p.type === 'desk')
    .sort((a, b) => a.ty - b.ty);
  cachedPcItems = all.filter(p => p.type === 'pc');
  pcDeskMap = new Map();
  for (const p of cachedPcItems) {
    const deskIdx = DESK_POSITIONS.findIndex(d => d.deskX + 1 === p.tx && d.deskY - 1 === p.ty);
    pcDeskMap.set(p, deskIdx);
  }
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
  dt = 0,
  interaction?: CanvasInteraction
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

  // ── Pass 2b: Drop indicator (when dragging a worker) ─────────────────────
  if (interaction?.dropTile) {
    const { tx, ty } = interaction.dropTile;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#4abf5c';
    // Draw a soft circle at the drop tile
    const cx = tx * T + T / 2;
    const cy = ty * T + T / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy + T * 0.2, T * 0.45, T * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── Pass 3: Background furniture (bookshelves, plants, whiteboard, etc.) ──
  for (const p of sortedBgItems) {
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
  for (const p of sortedDesks) {
    drawFurniture(ctx, p);
  }

  // ── Pass 4b: PCs on top of desks ──────────────────────────────────────────
  for (const p of cachedPcItems) {
    // Use animated PC frame based on worker state at this desk
    const deskIdx = pcDeskMap.get(p) ?? -1;
    const worker = deskIdx >= 0
      ? workers.find(w => w.deskIndex === deskIdx && w.arrived && !w.leaving)
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
  const draggedId = interaction?.drag?.workerId ?? null;
  workerSortBuffer.length = 0;
  workerSortBuffer.push(...workers);
  workerSortBuffer.sort((a, b) => a.y - b.y);

  for (const worker of workerSortBuffer) {
    // Skip dragged worker in normal pass — draw them floating at cursor later
    if (worker.sessionId === draggedId) continue;

    const pos = getWorkerScreenPos(worker);
    const renderedW = FRAME_W * SCALE;
    const renderedH = FRAME_H * SCALE;

    // Center sprite on tile, bottom-align to tile bottom
    const spx = pos.x + Math.floor((T - renderedW) / 2);
    let spy = pos.y + T - renderedH;

    // When seated (typing/reading/idle at desk), shift down slightly
    if (worker.arrived && !worker.leaving &&
        (worker.state === 'typing' || worker.state === 'reading' || worker.state === 'idle')) {
      spy += 6 * SCALE; // 6 source pixels down
    }

    // Hover highlight — soft glow ellipse under the worker
    if (interaction?.hoveredWorkerId === worker.sessionId && draggedId === null) {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(spx + renderedW / 2, spy + renderedH - 4, renderedW * 0.55, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Selection highlight — brighter ellipse
    if (interaction?.selectedWorkerId === worker.sessionId) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#4a7cbf';
      ctx.beginPath();
      ctx.ellipse(spx + renderedW / 2, spy + renderedH - 4, renderedW * 0.55, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const charSheet = assets.characters[worker.charIndex % assets.characters.length];
    drawCharacter(ctx, charSheet, worker.state, worker.frameIndex, spx, spy, SCALE, worker.facing);

    // Speech bubble
    if (worker.speechBubble) {
      drawSpeechBubble(ctx, spx + renderedW / 2, spy - 4, worker.speechBubble);
    }

    // Emote
    if (worker.emote) {
      drawEmote(ctx, spx + renderedW / 2, spy - (worker.speechBubble ? 40 : 8), worker.emote);
    }
  }

  // ── Pass 5b: Dragged worker — floating at cursor, picked up look ────────
  if (interaction?.drag && draggedId) {
    const worker = workers.find(w => w.sessionId === draggedId);
    if (worker && assets) {
      const { cursorX, cursorY } = interaction.drag;
      const pickupScale = SCALE * 1.3; // bigger = picked up
      const renderedW = FRAME_W * pickupScale;
      const renderedH = FRAME_H * pickupScale;
      const spx = cursorX - renderedW / 2;
      const spy = cursorY - renderedH - 8; // float above cursor

      // Drop shadow at cursor
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.ellipse(cursorX, cursorY + 4, renderedW * 0.4, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Bobbing animation
      const bob = Math.sin(globalTime * 4) * 3;

      const charSheet = assets.characters[worker.charIndex % assets.characters.length];
      drawCharacter(ctx, charSheet, 'idle', worker.frameIndex, spx, spy + bob, pickupScale, 'down');

      // Ghost at original position (faint)
      const origPos = getWorkerScreenPos(worker);
      const origW = FRAME_W * SCALE;
      const origH = FRAME_H * SCALE;
      const origSpx = origPos.x + Math.floor((T - origW) / 2);
      let origSpy = origPos.y + T - origH;
      if (worker.arrived && !worker.leaving &&
          (worker.state === 'typing' || worker.state === 'reading' || worker.state === 'idle')) {
        origSpy += 6 * SCALE;
      }
      ctx.save();
      ctx.globalAlpha = 0.25;
      drawCharacter(ctx, charSheet, worker.state, worker.frameIndex, origSpx, origSpy, SCALE, worker.facing);
      ctx.restore();
    }
  }

  // ── Pass 6: Room labels ───────────────────────────────────────────────────
  drawRoomLabels(ctx);
}

// ── Coffee steam animation ────────────────────────────────────────────────

function drawSteam(ctx: CanvasRenderingContext2D, cx: number, topY: number) {
  ctx.save();
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
  ctx.restore();
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

// ── Emote rendering ─────────────────────────────────────────────────────────

function drawEmote(
  ctx: CanvasRenderingContext2D,
  cx: number,
  bottomY: number,
  emote: { type: EmoteType; timer: number; maxTimer: number }
) {
  const progress = 1 - emote.timer / emote.maxTimer; // 0 → 1
  const alpha = Math.max(0, 1 - progress * 1.2); // fade out
  const floatY = bottomY - progress * 24; // float upward

  ctx.save();
  ctx.globalAlpha = alpha;

  const s = SCALE;
  switch (emote.type) {
    case 'approved': {
      // Green checkmark
      ctx.fillStyle = '#4abf5c';
      ctx.fillRect(cx - 4 * s, floatY - 2 * s, s, 3 * s);
      ctx.fillRect(cx - 3 * s, floatY + 1 * s, s, s);
      ctx.fillRect(cx - 2 * s, floatY, s, s);
      ctx.fillRect(cx - 1 * s, floatY - 1 * s, s, s);
      ctx.fillRect(cx, floatY - 2 * s, s, s);
      ctx.fillRect(cx + 1 * s, floatY - 3 * s, s, s);
      break;
    }
    case 'denied': {
      // Red X
      ctx.fillStyle = '#e05c5c';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(cx - 2 * s + i * s, floatY - 2 * s + i * s, s, s);
        ctx.fillRect(cx + 1 * s - i * s, floatY - 2 * s + i * s, s, s);
      }
      break;
    }
    case 'error': {
      // Red exclamation
      ctx.fillStyle = '#e05c5c';
      ctx.fillRect(cx - s / 2, floatY - 4 * s, s, 3 * s);
      ctx.fillRect(cx - s / 2, floatY, s, s);
      break;
    }
    case 'done': {
      // Gold sparkle star
      ctx.fillStyle = '#f0d040';
      const starX = cx;
      const starY = floatY - 2 * s;
      // Vertical bar
      ctx.fillRect(starX - s / 2, starY - 2 * s, s, 4 * s);
      // Horizontal bar
      ctx.fillRect(starX - 2 * s, starY - s / 2, 4 * s, s);
      // Diagonal dots
      ctx.fillRect(starX - s * 1.2, starY - s * 1.2, s * 0.8, s * 0.8);
      ctx.fillRect(starX + s * 0.5, starY - s * 1.2, s * 0.8, s * 0.8);
      ctx.fillRect(starX - s * 1.2, starY + s * 0.5, s * 0.8, s * 0.8);
      ctx.fillRect(starX + s * 0.5, starY + s * 0.5, s * 0.8, s * 0.8);
      break;
    }
  }

  ctx.restore();
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
export { FRAME_DURATIONS };
