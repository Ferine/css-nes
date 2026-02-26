import { describe, it, expect } from 'vitest';
import { buildScanlineState } from '../../src/scanline-state-builder.js';

function fallback() {
  return {
    scroll: {
      coarseX: 0,
      coarseY: 0,
      fineX: 0,
      fineY: 0,
      nameTableH: 0,
      nameTableV: 0,
    },
    bgVisible: true,
    spritesVisible: true,
    bgPatternBase: 0,
    sprPatternBase: 0,
    spriteSize: 0,
    mirrorMap: [0, 1, 2, 3],
    chrSignature: [null, null, null, null, null, null, null, null],
  };
}

describe('scanline-state-builder', () => {
  it('returns a stable single-state model when there is no trace', () => {
    const model = buildScanlineState(null, fallback());
    expect(model.scanlines).toHaveLength(240);
    expect(model.segments).toHaveLength(1);
    expect(model.segments[0].yStart).toBe(0);
    expect(model.segments[0].yEnd).toBe(240);
    expect(model.scanlines[0].scroll.coarseX).toBe(0);
    expect(model.scanlines[239].scroll.coarseX).toBe(0);
  });

  it('applies visible writes from the next scanline by default', () => {
    const timingTrace = {
      startState: {
        regHT: 0, regVT: 0, regFH: 0, regFV: 0, regH: 0, regV: 0,
        f_bgVisibility: 1, f_spVisibility: 1, f_bgPatternTable: 0, f_spPatternTable: 0, f_spriteSize: 0,
      },
      events: [
        {
          seq: 0,
          address: 0x2005,
          phase: 'visible',
          screenY: 20,
          after: {
            regHT: 12, regVT: 0, regFH: 3, regFV: 0, regH: 1, regV: 0,
            f_bgVisibility: 1, f_spVisibility: 1, f_bgPatternTable: 0, f_spPatternTable: 0, f_spriteSize: 0,
          },
        },
      ],
    };

    const model = buildScanlineState(timingTrace, fallback());
    expect(model.scanlines[20].scroll.coarseX).toBe(0);
    expect(model.scanlines[21].scroll.coarseX).toBe(12);
    expect(model.scanlines[21].scroll.fineX).toBe(3);
    expect(model.scanlines[21].scroll.nameTableH).toBe(1);
  });

  it('applies prerender writes from scanline 0', () => {
    const timingTrace = {
      startState: {
        regHT: 0, regVT: 0, regFH: 0, regFV: 0, regH: 0, regV: 0,
        f_bgVisibility: 1, f_spVisibility: 1, f_bgPatternTable: 0, f_spPatternTable: 0, f_spriteSize: 0,
      },
      events: [
        {
          seq: 0,
          address: 0x2000,
          phase: 'prerender',
          screenY: -1,
          after: {
            regHT: 3, regVT: 2, regFH: 1, regFV: 0, regH: 1, regV: 1,
            f_bgVisibility: 1, f_spVisibility: 1, f_bgPatternTable: 1, f_spPatternTable: 0, f_spriteSize: 1,
          },
        },
      ],
    };

    const model = buildScanlineState(timingTrace, fallback());
    expect(model.scanlines[0].scroll.coarseX).toBe(3);
    expect(model.scanlines[0].bgPatternBase).toBe(256);
    expect(model.scanlines[0].spriteSize).toBe(1);
  });

  it('applies mapper writes within the same scanline by default', () => {
    const chrA = [{}, {}, {}, {}, {}, {}, {}, {}];
    const chrB = [...chrA];
    chrB[3] = {};

    const timingTrace = {
      startState: {
        regHT: 0, regVT: 0, regFH: 0, regFV: 0, regH: 0, regV: 0,
        f_bgVisibility: 1, f_spVisibility: 1, f_bgPatternTable: 0, f_spPatternTable: 0, f_spriteSize: 0,
        mirrorMap: [0, 1, 2, 3],
        chrSignature: chrA,
      },
      events: [
        {
          seq: 0,
          address: 0x8000,
          phase: 'visible',
          screenY: 40,
          after: {
            regHT: 0, regVT: 0, regFH: 0, regFV: 0, regH: 0, regV: 0,
            f_bgVisibility: 1, f_spVisibility: 1, f_bgPatternTable: 0, f_spPatternTable: 0, f_spriteSize: 0,
            mirrorMap: [0, 1, 2, 3],
            chrSignature: chrB,
          },
        },
      ],
    };

    const model = buildScanlineState(timingTrace, fallback());
    expect(model.scanlines[39].chrSignature[3][0]).toBe(chrA[3]);
    expect(model.scanlines[40].chrSignature[3][0]).toBe(chrB[3]);
    expect(model.canonicalSegments).toHaveLength(2);
    expect(model.canonicalSegments[1].source).toBe('mapper');
  });
});
