import { describe, it, expect } from 'vitest';
import {
  TILE_SIZE,
  SCALE,
  GRID_W,
  GRID_H,
  CANVAS_W,
  CANVAS_H,
  DESK_POSITIONS,
  DOOR_X,
  DOOR_Y,
  buildGrid,
  buildFurniturePlacements,
  DeskPosition,
} from '../src/game/office-layout';

describe('office-layout', () => {
  describe('constants', () => {
    it('TILE_SIZE is 16', () => {
      expect(TILE_SIZE).toBe(16);
    });

    it('SCALE is 4', () => {
      expect(SCALE).toBe(4);
    });

    it('GRID_W is 20 and GRID_H is 15', () => {
      expect(GRID_W).toBe(20);
      expect(GRID_H).toBe(15);
    });

    it('CANVAS dimensions are correct', () => {
      expect(CANVAS_W).toBe(GRID_W * TILE_SIZE * SCALE); // 1280
      expect(CANVAS_H).toBe(GRID_H * TILE_SIZE * SCALE); // 960
      expect(CANVAS_W).toBe(1280);
      expect(CANVAS_H).toBe(960);
    });

    it('DOOR position is at bottom center', () => {
      expect(DOOR_X).toBe(6);
      expect(DOOR_Y).toBe(14);
    });
  });

  describe('DESK_POSITIONS', () => {
    it('has exactly 5 desk positions', () => {
      expect(DESK_POSITIONS).toHaveLength(5);
    });

    it('each desk position has required properties', () => {
      const requiredKeys: (keyof DeskPosition)[] = ['deskX', 'deskY', 'chairX', 'chairY', 'entryX', 'entryY'];
      for (const desk of DESK_POSITIONS) {
        for (const key of requiredKeys) {
          expect(desk).toHaveProperty(key);
          expect(typeof desk[key]).toBe('number');
        }
      }
    });

    it('all desk positions are within the grid', () => {
      for (const desk of DESK_POSITIONS) {
        expect(desk.deskX).toBeGreaterThanOrEqual(0);
        expect(desk.deskX).toBeLessThan(GRID_W);
        expect(desk.deskY).toBeGreaterThanOrEqual(0);
        expect(desk.deskY).toBeLessThan(GRID_H);
        expect(desk.chairX).toBeGreaterThanOrEqual(0);
        expect(desk.chairX).toBeLessThan(GRID_W);
        expect(desk.chairY).toBeGreaterThanOrEqual(0);
        expect(desk.chairY).toBeLessThan(GRID_H);
      }
    });

    it('all desks share the same entry point', () => {
      for (const desk of DESK_POSITIONS) {
        expect(desk.entryX).toBe(DOOR_X);
        expect(desk.entryY).toBe(13); // Entry point is one tile above the door wall
      }
    });

    it('chair is below desk (higher y) for each position', () => {
      for (const desk of DESK_POSITIONS) {
        expect(desk.chairY).toBeGreaterThan(desk.deskY);
      }
    });
  });

  describe('buildGrid', () => {
    it('returns a grid of correct dimensions', () => {
      const grid = buildGrid();
      expect(grid.length).toBe(GRID_H);
      for (const row of grid) {
        expect(row.length).toBe(GRID_W);
      }
    });

    it('top wall (row 0) is all walls', () => {
      const grid = buildGrid();
      for (let x = 0; x < GRID_W; x++) {
        expect(grid[0][x].isWall).toBe(true);
      }
    });

    it('left wall (col 0) is all walls', () => {
      const grid = buildGrid();
      for (let y = 0; y < GRID_H; y++) {
        expect(grid[y][0].isWall).toBe(true);
      }
    });

    it('right wall (col 19) is all walls', () => {
      const grid = buildGrid();
      for (let y = 0; y < GRID_H; y++) {
        expect(grid[y][GRID_W - 1].isWall).toBe(true);
      }
    });

    it('door cells are marked as doors', () => {
      const grid = buildGrid();
      // Main door at (6,14) and (7,14)
      expect(grid[14][DOOR_X].isDoor).toBe(true);
      expect(grid[14][DOOR_X + 1].isDoor).toBe(true);
      // Internal doors at (13,5) and (13,10)
      expect(grid[5][13].isDoor).toBe(true);
      expect(grid[10][13].isDoor).toBe(true);
    });

    it('door cells have isWall=false', () => {
      const grid = buildGrid();
      expect(grid[14][DOOR_X].isWall).toBe(false);
      expect(grid[5][13].isWall).toBe(false);
    });

    it('non-door wall cells have isWall=true', () => {
      const grid = buildGrid();
      // Top-left corner
      expect(grid[0][0].isWall).toBe(true);
      expect(grid[0][0].isDoor).toBe(false);
    });

    it('wall masks are computed for wall cells', () => {
      const grid = buildGrid();
      // Top-left corner should have N and W neighbors = wall → mask includes 1|8 = 9
      expect(grid[0][0].wallMask).toBeGreaterThanOrEqual(0);
      // A solitary wall cell should have mask 15 (all neighbors are walls/OOB)
      // Interior wall at (13,1) should have mask > 0
      expect(grid[1][13].wallMask).toBeGreaterThan(0);
    });

    it('non-wall cells in the main area have floorIndex 7 (wood)', () => {
      const grid = buildGrid();
      // A floor cell in the main area
      expect(grid[2][2].isWall).toBe(false);
      expect(grid[2][2].floorIndex).toBe(7);
    });

    it('break room area (cols 14-18, rows 1-6) uses blueCarpet floorIndex 1', () => {
      const grid = buildGrid();
      // Cell at (15, 3) should be in break room
      expect(grid[3][15].floorIndex).toBe(1);
    });

    it('meeting room area (cols 14-18, rows 8-13) uses neutralTile floorIndex 0', () => {
      const grid = buildGrid();
      // Cell at (15, 12) should be in meeting room
      expect(grid[12][15].floorIndex).toBe(0);
    });

    it('internal horizontal wall at row 7 (cols 13-19)', () => {
      const grid = buildGrid();
      for (let x = 13; x < GRID_W; x++) {
        expect(grid[7][x].isWall).toBe(true);
      }
    });

    it('bottom wall for right-side rooms (row 14, cols 14-18)', () => {
      const grid = buildGrid();
      for (let x = 14; x <= 18; x++) {
        expect(grid[14][x].isWall).toBe(true);
      }
    });
  });

  describe('buildFurniturePlacements', () => {
    it('returns a non-empty array', () => {
      const placements = buildFurniturePlacements();
      expect(placements.length).toBeGreaterThan(0);
    });

    it('each placement has required properties', () => {
      const placements = buildFurniturePlacements();
      for (const p of placements) {
        expect(typeof p.tx).toBe('number');
        expect(typeof p.ty).toBe('number');
        expect(typeof p.type).toBe('string');
        expect(typeof p.assetKey).toBe('string');
        expect(typeof p.pngW).toBe('number');
        expect(typeof p.pngH).toBe('number');
      }
    });

    it('has exactly 5 desks', () => {
      const placements = buildFurniturePlacements();
      const desks = placements.filter(p => p.type === 'desk');
      expect(desks).toHaveLength(5);
    });

    it('has exactly 5 PCs', () => {
      const placements = buildFurniturePlacements();
      const pcs = placements.filter(p => p.type === 'pc');
      expect(pcs).toHaveLength(5);
    });

    it('all furniture placements are within grid bounds', () => {
      const placements = buildFurniturePlacements();
      for (const p of placements) {
        expect(p.tx).toBeGreaterThanOrEqual(0);
        expect(p.tx).toBeLessThan(GRID_W);
        expect(p.ty).toBeGreaterThanOrEqual(0);
        expect(p.ty).toBeLessThan(GRID_H);
      }
    });

    it('pngW and pngH are positive for all placements', () => {
      const placements = buildFurniturePlacements();
      for (const p of placements) {
        expect(p.pngW).toBeGreaterThan(0);
        expect(p.pngH).toBeGreaterThan(0);
      }
    });
  });
});
