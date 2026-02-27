// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { CSSRenderer } from '../../src/css-renderer.js';
import { createMockPPUState } from '../helpers/mock-ppu-state.js';

/**
 * Stub canvas for happy-dom (no real canvas support).
 */
function stubCanvas() {
  const proto = HTMLCanvasElement.prototype;
  proto.getContext = function () {
    return {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: () => {},
    };
  };
  proto.toDataURL = function () {
    return 'data:image/png;base64,stub';
  };
}

describe('CSSRenderer (DOM)', () => {
  let wrapper;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    stubCanvas();
    wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
  });

  it('constructor creates .nes-viewport with resolution data attribute', () => {
    const renderer = new CSSRenderer(wrapper);
    const vp = wrapper.querySelector('.nes-viewport');
    expect(vp).not.toBeNull();
    expect(vp.dataset.resolution).toBe('256x240');
  });

  it('renderFrame increments frameCount', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState();

    expect(renderer.frameCount).toBe(0);
    renderer.renderFrame(state);
    expect(renderer.frameCount).toBe(1);
    renderer.renderFrame(state);
    expect(renderer.frameCount).toBe(2);
  });

  it('renderFrame sets viewport background color', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState();
    // bgPalette[0] = 0x0000FF (BBGGRR) → R=FF → #ff0000
    state.bgPalette[0] = 0x0000FF;

    renderer.renderFrame(state);

    expect(renderer.viewport.style.backgroundColor).toBe('#ff0000');
  });

  it('renderFrame sets scroll data attributes', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState({
      scroll: {
        coarseX: 10, coarseY: 5, fineX: 3, fineY: 2,
        nameTableH: 1, nameTableV: 0,
      },
    });

    renderer.renderFrame(state);

    // scrollX = 10*8 + 3 + 1*256 = 339
    // scrollY = 5*8 + 2 + 0*240 = 42
    expect(renderer.viewport.dataset.scrollX).toBe('339');
    expect(renderer.viewport.dataset.scrollY).toBe('42');
  });

  it('renderFrame sets pattern table data attributes', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState({
      bgPatternBase: 256,
      sprPatternBase: 0,
    });

    renderer.renderFrame(state);

    expect(renderer.viewport.dataset.bgPatternTable).toBe('$1000');
    expect(renderer.viewport.dataset.sprPatternTable).toBe('$0000');
  });

  it('renderFrame sets sprite size data attribute', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState({ spriteSize: 1 });

    renderer.renderFrame(state);

    expect(renderer.viewport.dataset.spriteSize).toBe('8x16');
  });

  it('renderFrame sets mirroring data attribute', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState({ mirrorMap: [0, 0, 1, 1] });

    renderer.renderFrame(state);

    expect(renderer.viewport.dataset.mirroring).toBe('0,0,1,1');
  });

  it('renderFrame calls subsystems in correct order', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState();

    // Just ensure it doesn't throw — subsystems are tested individually
    renderer.renderFrame(state);
    renderer.renderFrame(state);

    expect(renderer.frameCount).toBe(2);
  });

  it('setScale sets wrapper transform', () => {
    const renderer = new CSSRenderer(wrapper);
    renderer.setScale(2);
    expect(wrapper.style.transform).toBe('scale(2)');

    renderer.setScale(3);
    expect(wrapper.style.transform).toBe('scale(3)');
  });

  it('uses split BG region compositor when renderPlan has multiple regions', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState({
      renderPlan: {
        mode: 'region',
        eventCount: 1,
        regions: [
          {
            yStart: 0,
            yEnd: 32,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: true,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
          },
          {
            yStart: 32,
            yEnd: 240,
            scroll: { coarseX: 4, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 1, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: true,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
          },
        ],
      },
    });

    renderer.renderFrame(state);

    expect(renderer.bgLayer.bgLayer.style.display).toBe('none');
    expect(renderer.bgRegionLayer.root.style.display).toBe('');
    expect(renderer.viewport.dataset.bgRegions).toBe('2');
    expect(renderer.viewport.dataset.timingMode).toBe('region');
  });

  it('uses region timing model to keep sprites visible when snapshot says hidden', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState({
      spritesVisible: false,
      renderPlan: {
        mode: 'region',
        eventCount: 1,
        regions: [
          {
            yStart: 0,
            yEnd: 240,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: true,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
          },
        ],
      },
    });

    renderer.renderFrame(state);

    expect(renderer.spriteLayer.spriteLayer.style.display).toBe('');
  });

  it('hides sprites when all render regions disable them', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState({
      spritesVisible: true,
      renderPlan: {
        mode: 'region',
        eventCount: 1,
        regions: [
          {
            yStart: 0,
            yEnd: 240,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: false,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
          },
        ],
      },
    });

    renderer.renderFrame(state);

    expect(renderer.spriteLayer.spriteLayer.style.display).toBe('none');
  });

  it('keeps sprites visible when canonical regions include visible scanlines', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState({
      spritesVisible: true,
      renderPlan: {
        mode: 'region',
        eventCount: 1,
        // Compressed regions incorrectly collapse to hidden-only.
        regions: [
          {
            yStart: 0,
            yEnd: 240,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: false,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
          },
        ],
        // Canonical model still has visible sprite scanlines.
        canonicalRegions: [
          {
            yStart: 0,
            yEnd: 10,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: false,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
          },
          {
            yStart: 10,
            yEnd: 240,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: true,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
          },
        ],
      },
    });

    renderer.renderFrame(state);

    expect(renderer.spriteLayer.spriteLayer.style.display).toBe('');
  });

  it('hides sprites when canonical regions are all hidden', () => {
    const renderer = new CSSRenderer(wrapper);
    const state = createMockPPUState({
      spritesVisible: true,
      renderPlan: {
        mode: 'region',
        eventCount: 1,
        regions: [
          {
            yStart: 0,
            yEnd: 240,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: true,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
          },
        ],
        canonicalRegions: [
          {
            yStart: 0,
            yEnd: 240,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: false,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
          },
        ],
      },
    });

    renderer.renderFrame(state);

    expect(renderer.spriteLayer.spriteLayer.style.display).toBe('none');
  });

  it('selects sprite CHR signature from the region that contains visible sprites', () => {
    const renderer = new CSSRenderer(wrapper);

    const topSig = [11, 12, 13, 14, 15, 16, 17, 18];
    const bottomSig = [21, 22, 23, 24, 25, 26, 27, 28];
    let capturedSpriteSig = null;
    const origUpdate = renderer.tileCache.update.bind(renderer.tileCache);
    renderer.tileCache.update = (...args) => {
      capturedSpriteSig = args[6];
      return origUpdate(...args);
    };

    const state = createMockPPUState({
      chrBankSignature: [1, 2, 3, 4, 5, 6, 7, 8],
      renderPlan: {
        mode: 'region',
        eventCount: 1,
        regions: [
          {
            yStart: 0,
            yEnd: 120,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: true,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
            chrSignature: topSig,
          },
          {
            yStart: 120,
            yEnd: 240,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: true,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
            chrSignature: bottomSig,
          },
        ],
      },
    });

    // Put two sprites in the lower region and one in the upper region.
    state.sprites[0] = { x: 10, y: 30, tileIndex: 1, palette: 0, flipH: false, flipV: false, behindBg: false };
    state.sprites[1] = { x: 20, y: 150, tileIndex: 2, palette: 0, flipH: false, flipV: false, behindBg: false };
    state.sprites[2] = { x: 40, y: 170, tileIndex: 3, palette: 0, flipH: false, flipV: false, behindBg: false };

    renderer.renderFrame(state);

    expect(capturedSpriteSig).toEqual(bottomSig);
  });

  it('binds sprite classes to per-region sprite sheet sets', () => {
    const renderer = new CSSRenderer(wrapper);

    const topSig = [101, 102, 103, 104, 105, 106, 107, 108];
    const bottomSig = [201, 202, 203, 204, 205, 206, 207, 208];
    renderer.tileCache.activateSpriteSet = (sig) => (sig[0] === 101 ? 'spr-set-top' : 'spr-set-bottom');

    const state = createMockPPUState({
      renderPlan: {
        mode: 'region',
        eventCount: 1,
        regions: [
          {
            yStart: 0,
            yEnd: 120,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: true,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
            chrSignature: topSig,
          },
          {
            yStart: 120,
            yEnd: 240,
            scroll: { coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0 },
            bgVisible: true,
            spritesVisible: true,
            bgPatternBase: 0,
            sprPatternBase: 0,
            spriteSize: 0,
            chrSignature: bottomSig,
          },
        ],
      },
    });

    state.sprites[0] = { x: 20, y: 20, tileIndex: 2, palette: 0, flipH: false, flipV: false, behindBg: false };
    state.sprites[1] = { x: 20, y: 180, tileIndex: 3, palette: 0, flipH: false, flipV: false, behindBg: false };

    renderer.renderFrame(state);

    expect(renderer.spriteLayer.spriteDivs[0].className).toContain('spr-set-top');
    expect(renderer.spriteLayer.spriteDivs[1].className).toContain('spr-set-bottom');
  });
});
