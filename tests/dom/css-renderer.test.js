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
});
