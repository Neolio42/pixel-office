import { describe, it, expect } from 'vitest';
import { FLOOR_COLORS, WALL_COLORS, colorizeImage } from '../src/game/asset-loader';
import type { HsbcParams } from '../src/game/asset-loader';

// We test the pure functions: FLOOR_COLORS, WALL_COLORS, and colorizeImage
// (colorizeImage requires DOM, so we test the constants and structure)

describe('asset-loader constants', () => {
  it('exports FLOOR_COLORS with wood, blueCarpet, neutralTile', () => {
    expect(FLOOR_COLORS.wood).toBeDefined();
    expect(FLOOR_COLORS.blueCarpet).toBeDefined();
    expect(FLOOR_COLORS.neutralTile).toBeDefined();
  });

  it('FLOOR_COLORS.wood has correct HsbcParams', () => {
    const wood = FLOOR_COLORS.wood;
    expect(wood.h).toBe(25);
    expect(wood.s).toBe(48);
    expect(wood.b).toBe(-43);
    expect(wood.c).toBe(-88);
  });

  it('FLOOR_COLORS.blueCarpet has correct HsbcParams', () => {
    const carpet = FLOOR_COLORS.blueCarpet;
    expect(carpet.h).toBe(209);
    expect(carpet.s).toBe(39);
    expect(carpet.b).toBe(-25);
    expect(carpet.c).toBe(-80);
  });

  it('FLOOR_COLORS.neutralTile has correct HsbcParams', () => {
    const tile = FLOOR_COLORS.neutralTile;
    expect(tile.h).toBe(209);
    expect(tile.s).toBe(0);
    expect(tile.b).toBe(-16);
    expect(tile.c).toBe(-8);
  });

  it('WALL_COLORS has correct HsbcParams', () => {
    expect(WALL_COLORS.h).toBe(214);
    expect(WALL_COLORS.s).toBe(30);
    expect(WALL_COLORS.b).toBe(-100);
    expect(WALL_COLORS.c).toBe(-55);
  });

  it('all FLOOR_COLORS are valid HsbcParams', () => {
    for (const [name, params] of Object.entries(FLOOR_COLORS)) {
      expect(typeof params.h).toBe('number');
      expect(typeof params.s).toBe('number');
      expect(typeof params.b).toBe('number');
      expect(typeof params.c).toBe('number');
      expect(params.h).toBeGreaterThanOrEqual(0);
      expect(params.h).toBeLessThanOrEqual(360);
      expect(params.s).toBeGreaterThanOrEqual(0);
      expect(params.s).toBeLessThanOrEqual(100);
    }
  });
});

describe('HsbcParams interface', () => {
  it('can create a valid HsbcParams object', () => {
    const params: HsbcParams = { h: 100, s: 50, b: 0, c: 0 };
    expect(params.h).toBe(100);
    expect(params.s).toBe(50);
    expect(params.b).toBe(0);
    expect(params.c).toBe(0);
  });
});
