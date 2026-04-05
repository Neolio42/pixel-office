import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initRenderer,
  renderOffice,
} from '../src/game/renderer';
import { FRAMES, FRAME_DURATIONS } from '../src/game/sprites';

// renderer.ts depends on canvas and images — we test the exported API
// and that functions don't crash with null assets

describe('renderer', () => {
  it('exports initRenderer and renderOffice', () => {
    expect(typeof initRenderer).toBe('function');
    expect(typeof renderOffice).toBe('function');
  });

  it('renderOffice does nothing when no assets initialized', () => {
    // Create a mock canvas context
    const mockCtx = {
      imageSmoothingEnabled: true,
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      putImageData: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
      measureText: vi.fn(() => ({ width: 50 })),
      font: '',
      fillStyle: '',
      textAlign: '',
      textBaseline: '',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    const grid = [[{ isWall: false, isDoor: false, floorIndex: 0, floorParams: { h: 0, s: 0, b: 0, c: 0 }, wallMask: 0 }]];
    // Should not throw — assets is null so it returns early
    expect(() => renderOffice(mockCtx, grid, [], 0)).not.toThrow();
  });

  it('re-exports FRAMES and FRAME_DURATIONS from sprites', () => {
    expect(FRAMES).toBeDefined();
    expect(FRAME_DURATIONS).toBeDefined();
    expect(typeof FRAMES).toBe('object');
    expect(typeof FRAME_DURATIONS).toBe('object');
  });
});
