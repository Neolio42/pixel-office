import { describe, it, expect } from 'vitest';
import { PALETTES, FRAMES, FRAME_DURATIONS, drawSprite, AnimState } from '../src/game/sprites';

describe('sprites', () => {
  describe('PALETTES', () => {
    it('has exactly 6 palettes', () => {
      expect(PALETTES).toHaveLength(6);
    });

    it('each palette has all required keys', () => {
      const requiredKeys = ['skin', 'shirt', 'pants', 'hair', 'shoes', 'eye', 'skin_shadow', 'shirt_shadow', 'hair_shadow'];
      for (const palette of PALETTES) {
        for (const key of requiredKeys) {
          expect(palette).toHaveProperty(key);
          expect(typeof palette[key as keyof typeof palette]).toBe('string');
        }
      }
    });

    it('all palette colors are valid hex strings', () => {
      const hexRegex = /^#[0-9a-f]{6}$/i;
      for (const palette of PALETTES) {
        for (const value of Object.values(palette)) {
          expect(value).toMatch(hexRegex);
        }
      }
    });
  });

  describe('FRAMES', () => {
    const states: AnimState[] = ['idle', 'typing', 'reading', 'waiting', 'walking'];

    it('has entries for all animation states', () => {
      for (const state of states) {
        expect(FRAMES).toHaveProperty(state);
      }
    });

    it('each state has at least one frame', () => {
      for (const state of states) {
        expect(FRAMES[state].length).toBeGreaterThan(0);
      }
    });

    it('walking has the most frames (4)', () => {
      expect(FRAMES.walking.length).toBe(4);
    });

    it('idle has 2 frames', () => {
      expect(FRAMES.idle.length).toBe(2);
    });

    it('typing has 2 frames', () => {
      expect(FRAMES.typing.length).toBe(2);
    });

    it('reading has 2 frames', () => {
      expect(FRAMES.reading.length).toBe(2);
    });

    it('waiting has 2 frames', () => {
      expect(FRAMES.waiting.length).toBe(2);
    });
  });

  describe('FRAME_DURATIONS', () => {
    const states: AnimState[] = ['idle', 'typing', 'reading', 'waiting', 'walking'];

    it('has entries for all animation states', () => {
      for (const state of states) {
        expect(FRAME_DURATIONS).toHaveProperty(state);
        expect(typeof FRAME_DURATIONS[state]).toBe('number');
      }
    });

    it('all durations are positive', () => {
      for (const state of states) {
        expect(FRAME_DURATIONS[state]).toBeGreaterThan(0);
      }
    });

    it('walking has the fastest frame duration (150ms)', () => {
      expect(FRAME_DURATIONS.walking).toBe(150);
    });

    it('reading has the slowest frame duration (1200ms)', () => {
      expect(FRAME_DURATIONS.reading).toBe(1200);
    });

    it('typing duration is 180ms', () => {
      expect(FRAME_DURATIONS.typing).toBe(180);
    });

    it('idle duration is 600ms', () => {
      expect(FRAME_DURATIONS.idle).toBe(600);
    });

    it('waiting duration is 400ms', () => {
      expect(FRAME_DURATIONS.waiting).toBe(400);
    });
  });

  describe('drawSprite', () => {
    it('is a no-op function (returns undefined)', () => {
      // drawSprite is a legacy shim that does nothing
      const result = drawSprite(
        {} as CanvasRenderingContext2D,
        [''],
        PALETTES[0],
        0,
        0,
        1
      );
      expect(result).toBeUndefined();
    });

    it('does not throw even with null-ish ctx', () => {
      expect(() => {
        drawSprite(null as any, [], PALETTES[0], 0, 0, 1);
      }).not.toThrow();
    });
  });
});
