import { describe, expect, it } from 'vitest';
import { fitWithin, layoutRow, nearestRatio, parseRatio, pixelSizeFor } from '../../src/shared/geometry';

describe('parseRatio', () => {
  it('reads W:H, WxH and W/H', () => {
    expect(parseRatio('16:9')).toBeCloseTo(16 / 9);
    expect(parseRatio('1024x768')).toBeCloseTo(4 / 3);
    expect(parseRatio(' 3 / 2 ')).toBeCloseTo(1.5);
    expect(parseRatio('2.39:1')).toBeCloseTo(2.39);
  });

  it('gives null for anything else', () => {
    for (const value of ['', 'auto', '16:0', '0:9', 'square_hd', 'landscape_16_9', '1:1 (1K)']) {
      expect(parseRatio(value)).toBeNull();
    }
  });
});

describe('nearestRatio', () => {
  const values = ['', '1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'];

  it('matches common frame sizes', () => {
    expect(nearestRatio(1920, 1080, values)).toBe('16:9');
    expect(nearestRatio(1080, 1920, values)).toBe('9:16');
    expect(nearestRatio(1080, 1080, values)).toBe('1:1');
    expect(nearestRatio(1440, 960, values)).toBe('3:2');
    // 1.406 is nearer 4:3 (1.333) than 3:2 (1.5) on a log scale.
    expect(nearestRatio(1440, 1024, values)).toBe('4:3');
    expect(nearestRatio(390, 844, values)).toBe('9:16');
    expect(nearestRatio(2560, 1080, values)).toBe('21:9');
  });

  it('compares on a log scale, so 2:1 and 1:2 are equally far from 1:1', () => {
    expect(nearestRatio(2, 1, ['1:1', '4:1'])).toBe('1:1');
    expect(nearestRatio(1, 2, ['1:1', '1:4'])).toBe('1:1');
  });

  it('skips non-ratio values and gives undefined without a usable size', () => {
    expect(nearestRatio(100, 100, ['auto', ''])).toBeUndefined();
    expect(nearestRatio(0, 100, values)).toBeUndefined();
    expect(nearestRatio(Number.NaN, 100, values)).toBeUndefined();
  });
});

describe('pixelSizeFor', () => {
  it('keeps the shape with the long side at longSide, rounded to the step', () => {
    expect(pixelSizeFor(1920, 1080, { longSide: 1024, step: 16 })).toEqual({ width: 1024, height: 576 });
    expect(pixelSizeFor(1080, 1920, { longSide: 1024, step: 16 })).toEqual({ width: 576, height: 1024 });
    expect(pixelSizeFor(500, 500, { longSide: 1024, step: 16 })).toEqual({ width: 1024, height: 1024 });
  });

  it('stays within min and max', () => {
    expect(pixelSizeFor(4000, 100, { longSide: 1024, step: 16, min: 64, max: 2048 })).toEqual({
      width: 1024,
      height: 64,
    });
    expect(pixelSizeFor(1000, 1000, { longSide: 4096, step: 16, max: 2048 })).toEqual({ width: 2048, height: 2048 });
  });

  it('treats a missing shape as square', () => {
    expect(pixelSizeFor(0, 0, { longSide: 512 })).toEqual({ width: 512, height: 512 });
  });
});

describe('fitWithin', () => {
  it('scales down only', () => {
    expect(fitWithin({ width: 2048, height: 1024 }, 1024)).toEqual({ width: 1024, height: 512 });
    expect(fitWithin({ width: 800, height: 600 }, 1024)).toEqual({ width: 800, height: 600 });
    expect(fitWithin({ width: 5504, height: 3072 }, 4096)).toEqual({ width: 4096, height: 2286 });
  });
});

describe('layoutRow', () => {
  it('centres a row of layers on a point', () => {
    const corners = layoutRow(
      [
        { width: 100, height: 100 },
        { width: 200, height: 50 },
      ],
      { x: 0, y: 0 },
      20,
    );
    // Total width 100 + 20 + 200 = 320, so the row starts at -160.
    expect(corners).toEqual([
      { x: -160, y: -50 },
      { x: -40, y: -25 },
    ]);
  });

  it('places one layer around the centre', () => {
    expect(layoutRow([{ width: 1024, height: 576 }], { x: 500, y: 300 }, 40)).toEqual([{ x: -12, y: 12 }]);
  });
});
