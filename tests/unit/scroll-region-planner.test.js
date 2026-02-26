import { describe, it, expect } from 'vitest';
import { planScrollRegions } from '../../src/scroll-region-planner.js';

function makeState(scrollX, scrollY, signature = null) {
  return {
    scroll: {
      coarseX: Math.floor(scrollX / 8),
      coarseY: Math.floor(scrollY / 8),
      fineX: scrollX % 8,
      fineY: scrollY % 8,
      nameTableH: 0,
      nameTableV: 0,
    },
    bgVisible: true,
    spritesVisible: true,
    bgPatternBase: 0,
    sprPatternBase: 0,
    spriteSize: 0,
    mirrorMap: [0, 1, 2, 3],
    chrSignature: signature || [null, null, null, null, null, null, null, null],
  };
}

describe('scroll-region-planner', () => {
  it('builds one region for uniform scanline state', () => {
    const scanlines = Array.from({ length: 240 }, () => makeState(0, 0));
    const regions = planScrollRegions({ scanlines });
    expect(regions).toHaveLength(1);
    expect(regions[0].yStart).toBe(0);
    expect(regions[0].yEnd).toBe(240);
    expect(regions[0].scrollX).toBe(0);
    expect(regions[0].scrollY).toBe(0);
  });

  it('splits regions when scroll changes mid-frame', () => {
    const top = makeState(0, 0);
    const bottom = makeState(32, 0);
    const scanlines = new Array(240);
    for (let y = 0; y < 240; y++) {
      scanlines[y] = y < 40 ? top : bottom;
    }

    const regions = planScrollRegions({ scanlines });
    expect(regions).toHaveLength(2);
    expect(regions[0].yStart).toBe(0);
    expect(regions[0].yEnd).toBe(40);
    expect(regions[0].scrollX).toBe(0);
    expect(regions[1].yStart).toBe(40);
    expect(regions[1].yEnd).toBe(240);
    expect(regions[1].scrollX).toBe(32);
  });

  it('falls back to a single region when scanline data is missing', () => {
    const fallback = {
      scroll: { coarseX: 2, coarseY: 0, fineX: 1, fineY: 0, nameTableH: 1, nameTableV: 0 },
      bgVisible: true,
      spritesVisible: true,
      bgPatternBase: 256,
      sprPatternBase: 0,
      spriteSize: 0,
    };
    const regions = planScrollRegions(null, fallback);
    expect(regions).toHaveLength(1);
    expect(regions[0].scrollX).toBe(2 * 8 + 1 + 256);
    expect(regions[0].bgPatternBase).toBe(256);
  });

  it('caps excessive split regions down to configured maxRegions', () => {
    const scanlines = new Array(240);
    for (let y = 0; y < 240; y++) {
      // alternate every 8 scanlines to produce many raw regions
      const block = Math.floor(y / 8);
      scanlines[y] = block % 2 === 0 ? makeState(0, 0) : makeState(64, 0);
    }

    const regions = planScrollRegions(
      { scanlines },
      null,
      { maxRegions: 2, minRegionHeight: 1 }
    );

    expect(regions.length).toBeLessThanOrEqual(2);
    expect(regions[0].yStart).toBe(0);
    expect(regions.at(-1).yEnd).toBe(240);
  });

  it('splits regions when CHR signature changes', () => {
    const sigA = [{}, {}, {}, {}, {}, {}, {}, {}];
    const sigB = [...sigA];
    sigB[4] = {};

    const scanlines = new Array(240);
    for (let y = 0; y < 240; y++) {
      scanlines[y] = y < 120 ? makeState(0, 0, sigA) : makeState(0, 0, sigB);
    }

    const regions = planScrollRegions({ scanlines }, null, {
      compress: false,
      minRegionHeight: 1,
      maxRegions: 240,
    });

    expect(regions).toHaveLength(2);
    expect(regions[0].yStart).toBe(0);
    expect(regions[0].yEnd).toBe(120);
    expect(regions[1].yStart).toBe(120);
    expect(regions[1].yEnd).toBe(240);
  });
});
