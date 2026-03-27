// Multi-room pixel office layout — sprite-based
// Grid: 20 wide × 15 tall
//
// Rooms:
//   Main work area: cols 0-12, rows 0-14  (warm wood floor — floor_7)
//   Break room:     cols 13-19, rows 0-6  (neutral tile — floor_0)
//   Meeting room:   cols 13-19, rows 7-14 (blue carpet — floor_1)

import { HsbcParams, FLOOR_COLORS } from './asset-loader';

export const TILE_SIZE = 16;
export const SCALE = 4;           // 4× zoom for crisp pixel art
export const GRID_W = 20;
export const GRID_H = 15;
export const CANVAS_W = GRID_W * TILE_SIZE * SCALE; // 1280
export const CANVAS_H = GRID_H * TILE_SIZE * SCALE; // 960

// ── Tile types ──────────────────────────────────────────────────────────────

export type FloorVariant = 'wood' | 'tile' | 'carpet';

export type FurnitureType =
  | 'desk'
  | 'pc'
  | 'bookshelf'
  | 'double_bookshelf'
  | 'plant'
  | 'plant_2'
  | 'large_plant'
  | 'whiteboard'
  | 'sofa'
  | 'coffee_table'
  | 'coffee'
  | 'wooden_chair'
  | 'cushioned_chair'
  | 'cactus'
  | 'clock'
  | 'hanging_plant'
  | 'painting_small'
  | 'painting_small_2'
  | 'painting_large'
  | 'bin'
  | 'pot';

export interface GridCell {
  // Floor info
  floorIndex: number;      // which floor_*.png to use
  floorParams: HsbcParams; // colorize params
  // Wall info
  isWall: boolean;
  isDoor: boolean;
  wallMask: number;        // 4-bit N=1,E=2,S=4,W=8 for auto-tiling
  // Furniture placed at this cell (drawn separately, not per-cell)
  furniture?: FurnitureType;
}

export interface DeskPosition {
  deskX: number;
  deskY: number;
  chairX: number;
  chairY: number;
}

// 5 desks in the main work area
export const DESK_POSITIONS: DeskPosition[] = [
  { deskX: 1, deskY: 3,  chairX: 1, chairY: 4 },
  { deskX: 4, deskY: 3,  chairX: 4, chairY: 4 },
  { deskX: 7, deskY: 3,  chairX: 7, chairY: 4 },
  { deskX: 2, deskY: 8,  chairX: 2, chairY: 9 },
  { deskX: 7, deskY: 8,  chairX: 7, chairY: 9 },
];

export const DOOR_X = 6;
export const DOOR_Y = 14;

// ── Furniture placement list ────────────────────────────────────────────────
// Each entry has tile coords + which asset to draw + optional pixel offsets

export interface FurniturePlacement {
  tx: number;   // tile column
  ty: number;   // tile row (top-left anchor)
  type: FurnitureType;
  // asset key into AssetBundle.furniture
  assetKey: string;
  // native PNG size
  pngW: number;
  pngH: number;
  // optional horizontal flip
  flipX?: boolean;
  // pixel offset within the tile anchor (in source pixels, will be scaled)
  offsetX?: number;
  offsetY?: number;
}

// ── Floor variant helper ────────────────────────────────────────────────────

function floorFor(tx: number, ty: number): { floorIndex: number; floorParams: HsbcParams } {
  // Side rooms (cols 14-18 are the floor area inside walls at 13 and 19)
  if (tx >= 14 && tx <= 18) {
    if (ty >= 1 && ty <= 6)  return { floorIndex: 1, floorParams: FLOOR_COLORS.blueCarpet };
    if (ty >= 8 && ty <= 14) return { floorIndex: 0, floorParams: FLOOR_COLORS.neutralTile };
  }
  // Default: wood
  return { floorIndex: 7, floorParams: FLOOR_COLORS.wood };
}

// ── buildGrid ───────────────────────────────────────────────────────────────

export function buildGrid(): GridCell[][] {
  // Initialize all as wood floor
  const grid: GridCell[][] = Array.from({ length: GRID_H }, (_, ty) =>
    Array.from({ length: GRID_W }, (_, tx) => ({
      ...floorFor(tx, ty),
      isWall: false,
      isDoor: false,
      wallMask: 0,
    }))
  );

  const markWall = (x: number, y: number, isDoor = false) => {
    if (y < 0 || y >= GRID_H || x < 0 || x >= GRID_W) return;
    grid[y][x].isWall = !isDoor;
    grid[y][x].isDoor = isDoor;
    // Wall cells use wood floor underneath for doors
    const { floorIndex, floorParams } = isDoor ? floorFor(x, y) : { floorIndex: 7, floorParams: FLOOR_COLORS.wood };
    grid[y][x].floorIndex = floorIndex;
    grid[y][x].floorParams = floorParams;
  };

  // Top wall (row 0)
  for (let x = 0; x < GRID_W; x++) markWall(x, 0);

  // Left wall (col 0)
  for (let y = 0; y < GRID_H; y++) markWall(0, y);

  // Right wall (col 19)
  for (let y = 0; y < GRID_H; y++) markWall(19, y);

  // Bottom wall (row 14) — main room bottom with door gap
  for (let x = 0; x < 13; x++) {
    if (x === DOOR_X || x === DOOR_X + 1) {
      markWall(x, 14, true);
    } else {
      markWall(x, 14);
    }
  }

  // Internal vertical wall (col 13) with doorways
  for (let y = 0; y < GRID_H; y++) {
    if (y === 5 || y === 10) {
      markWall(13, y, true);
    } else {
      markWall(13, y);
    }
  }

  // Bottom wall for right-side rooms (row 14, cols 14-18)
  for (let x = 14; x <= 18; x++) markWall(x, 14);

  // Internal horizontal wall (row 7, cols 13-19)
  for (let x = 13; x < GRID_W; x++) markWall(x, 7);

  // Compute wall bitmasks for auto-tiling
  const isWallOrOob = (x: number, y: number): boolean => {
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return true;
    return grid[y][x].isWall;
  };
  for (let ty = 0; ty < GRID_H; ty++) {
    for (let tx = 0; tx < GRID_W; tx++) {
      if (!grid[ty][tx].isWall) continue;
      let mask = 0;
      if (isWallOrOob(tx, ty - 1)) mask |= 1; // N
      if (isWallOrOob(tx + 1, ty)) mask |= 2; // E
      if (isWallOrOob(tx, ty + 1)) mask |= 4; // S
      if (isWallOrOob(tx - 1, ty)) mask |= 8; // W
      grid[ty][tx].wallMask = mask;
    }
  }

  return grid;
}

// ── Walkability check ──────────────────────────────────────────────────────

export function isWalkable(tx: number, ty: number, grid: GridCell[][]): boolean {
  if (ty < 0 || ty >= GRID_H || tx < 0 || tx >= GRID_W) return false;
  const cell = grid[ty][tx];
  return !cell.isWall || cell.isDoor;
}

// ── Furniture placement list ────────────────────────────────────────────────
// Built once and used by renderer. Positions mirror old buildGrid() furniture.

export function buildFurniturePlacements(): FurniturePlacement[] {
  const items: FurniturePlacement[] = [];

  // ── Desks (DESK_FRONT is 48×32 = 3 tiles wide × 2 tiles tall) ────────────
  for (const d of DESK_POSITIONS) {
    items.push({
      tx: d.deskX, ty: d.deskY,
      type: 'desk', assetKey: 'DESK/DESK_FRONT',
      pngW: 48, pngH: 32,
    });
    items.push({
      tx: d.deskX + 1, ty: d.deskY - 1,
      type: 'pc', assetKey: 'PC/PC_FRONT_ON_1',
      pngW: 16, pngH: 32,
      offsetY: 12,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ── MAIN WORK AREA (cols 1-12, rows 1-13) ──────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Back wall layout (row 1, left to right):
  //   [1-2] double bookshelf  [4] painting  [6] plant  [8] painting
  //   [9-10] double bookshelf  [11-12] large painting

  // Back wall: bookshelves sit against wall, paintings hang on wall
  items.push({ tx: 1, ty: 1, type: 'double_bookshelf', assetKey: 'DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF', pngW: 32, pngH: 32, offsetY: -16 });
  items.push({ tx: 9, ty: 1, type: 'double_bookshelf', assetKey: 'DOUBLE_BOOKSHELF/DOUBLE_BOOKSHELF', pngW: 32, pngH: 32, offsetY: -16 });
  // Paintings hung HIGH on wall (offsetY -22 places them on the dark wall face, above bookshelves)
  items.push({ tx: 4, ty: 1, type: 'painting_small', assetKey: 'SMALL_PAINTING/SMALL_PAINTING', pngW: 16, pngH: 32, offsetY: -22 });
  items.push({ tx: 8, ty: 1, type: 'painting_small_2', assetKey: 'SMALL_PAINTING_2/SMALL_PAINTING_2', pngW: 16, pngH: 32, offsetY: -22 });
  // Large painting on right end of back wall
  items.push({ tx: 11, ty: 1, type: 'painting_large', assetKey: 'LARGE_PAINTING/LARGE_PAINTING', pngW: 32, pngH: 32, offsetY: -22 });

  // Plants on FLOOR (row 2+), not touching walls
  // Plant between paintings on back wall — sits on floor at row 2
  items.push({ tx: 6, ty: 2, type: 'plant', assetKey: 'PLANT/PLANT', pngW: 16, pngH: 32 });

  // Plants in the gap between desk rows (rows 5-7)
  items.push({ tx: 2, ty: 6, type: 'large_plant', assetKey: 'LARGE_PLANT/LARGE_PLANT', pngW: 32, pngH: 48, offsetY: -16 });
  items.push({ tx: 12, ty: 6, type: 'hanging_plant', assetKey: 'HANGING_PLANT/HANGING_PLANT', pngW: 16, pngH: 32 });
  items.push({ tx: 6, ty: 6, type: 'cactus', assetKey: 'CACTUS/CACTUS', pngW: 16, pngH: 32 });

  // Bottom area plants — row 11 max (row 12+ overlaps bottom wall sprites)
  items.push({ tx: 2, ty: 11, type: 'plant_2', assetKey: 'PLANT_2/PLANT_2', pngW: 16, pngH: 32 });
  items.push({ tx: 10, ty: 11, type: 'plant', assetKey: 'PLANT/PLANT', pngW: 16, pngH: 32 });

  // ══════════════════════════════════════════════════════════════════════════
  // ── BREAK ROOM (cols 14-18, rows 1-6, blue carpet) ─────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Layout:
  //   Row 1: [painting] [clock]          (wall-mounted)
  //   Row 2: [sofa]                      (centered)
  //   Row 3-4: [coffee table + mug]      (centered)
  //   Row 5: [plant]                     (corner accent)

  items.push({ tx: 14, ty: 1, type: 'painting_small', assetKey: 'SMALL_PAINTING/SMALL_PAINTING', pngW: 16, pngH: 32, offsetY: -22 });
  items.push({ tx: 16, ty: 1, type: 'clock', assetKey: 'CLOCK/CLOCK', pngW: 16, pngH: 32, offsetY: -22 });
  items.push({ tx: 15, ty: 2, type: 'sofa', assetKey: 'SOFA/SOFA_BACK', pngW: 32, pngH: 16 });
  items.push({ tx: 15, ty: 3, type: 'coffee_table', assetKey: 'COFFEE_TABLE/COFFEE_TABLE', pngW: 32, pngH: 32 });
  items.push({ tx: 16, ty: 3, type: 'coffee', assetKey: 'COFFEE/COFFEE', pngW: 16, pngH: 16, offsetY: 4 });
  // Plants — row 4 max (row 5+ overlaps the row 7 internal wall)
  items.push({ tx: 17, ty: 4, type: 'plant', assetKey: 'PLANT/PLANT', pngW: 16, pngH: 32 });
  items.push({ tx: 14, ty: 4, type: 'cactus', assetKey: 'CACTUS/CACTUS', pngW: 16, pngH: 32 });

  // ══════════════════════════════════════════════════════════════════════════
  // ── MEETING ROOM (cols 14-18, rows 8-13, neutral tile) ─────────────────
  // ══════════════════════════════════════════════════════════════════════════
  //
  // Layout:
  //   Row 8: [whiteboard]                (centered on wall)
  //   Row 9: (gap)
  //   Row 10: [chairs] [table] [chairs]  (meeting setup)
  //   Row 11: [chairs below]
  //   Row 12-13: [plant corner] [bin]

  items.push({ tx: 15, ty: 8, type: 'whiteboard', assetKey: 'WHITEBOARD/WHITEBOARD', pngW: 32, pngH: 32 });
  // Chairs above table
  items.push({ tx: 15, ty: 10, type: 'cushioned_chair', assetKey: 'CUSHIONED_CHAIR/CUSHIONED_CHAIR_BACK', pngW: 16, pngH: 16, offsetY: -12 });
  items.push({ tx: 16, ty: 10, type: 'cushioned_chair', assetKey: 'CUSHIONED_CHAIR/CUSHIONED_CHAIR_BACK', pngW: 16, pngH: 16, offsetY: -12 });
  // Table
  items.push({ tx: 15, ty: 10, type: 'coffee_table', assetKey: 'COFFEE_TABLE/COFFEE_TABLE', pngW: 32, pngH: 32 });
  // Chairs below table
  items.push({ tx: 15, ty: 11, type: 'wooden_chair', assetKey: 'WOODEN_CHAIR/WOODEN_CHAIR_BACK', pngW: 16, pngH: 32 });
  items.push({ tx: 16, ty: 11, type: 'wooden_chair', assetKey: 'WOODEN_CHAIR/WOODEN_CHAIR_BACK', pngW: 16, pngH: 32 });
  // Corner plant — row 11 max (row 12+ overlaps bottom wall), col 17 (not touching right wall)
  items.push({ tx: 17, ty: 11, type: 'plant_2', assetKey: 'PLANT_2/PLANT_2', pngW: 16, pngH: 32 });

  return items;
}
