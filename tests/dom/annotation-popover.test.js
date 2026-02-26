// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { AnnotationPopover } from '../../src/annotation-popover.js';
import { createMockPPUState } from '../helpers/mock-ppu-state.js';

describe('AnnotationPopover (DOM)', () => {
  let viewport;
  let renderer;

  beforeEach(() => {
    document.body.innerHTML = '';

    viewport = document.createElement('div');
    viewport.className = 'nes-viewport paused';
    viewport.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 256,
      bottom: 240,
      width: 256,
      height: 240,
    });
    document.body.appendChild(viewport);

    renderer = {
      paletteManager: {
        getBgPaletteGroup: () => ['#000000', '#111111', '#222222', '#333333'],
        getSprPaletteGroup: () => ['#000000', '#444444', '#555555', '#666666'],
      },
    };
  });

  function click(target, options = {}) {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, ...options }));
  }

  it('opens pixel provenance on shift+click and highlights one pixel', () => {
    const state = createMockPPUState();
    const popover = new AnnotationPopover(viewport, renderer, () => state);

    click(viewport, { clientX: 12, clientY: 20, shiftKey: true });

    expect(popover.isVisible).toBe(true);
    expect(popover.popover.classList.contains('annotation-popover-pixel')).toBe(true);
    expect(popover.popover.innerHTML).toContain('Pixel Provenance');
    expect(popover.highlight.style.width).toBe('1px');
    expect(popover.highlight.style.height).toBe('1px');
  });

  it('still dismisses on normal click when no tile/sprite element is targeted', () => {
    const state = createMockPPUState();
    const popover = new AnnotationPopover(viewport, renderer, () => state);

    click(viewport, { clientX: 12, clientY: 20, shiftKey: true });
    expect(popover.isVisible).toBe(true);

    click(viewport, { clientX: 12, clientY: 20, shiftKey: false });
    expect(popover.isVisible).toBe(false);
  });

  it('reports sprite winner when sprite pixel is opaque over transparent BG', () => {
    const state = createMockPPUState({
      bgVisible: true,
      spritesVisible: true,
      spriteSize: 0,
      sprPatternBase: 0,
    });

    // BG at pixel (0,0): transparent
    state.nameTables[0].tile[0] = 1;
    state.ptTile[1].pix[0] = 0;

    // Sprite 0 covers pixel (0,0) with opaque color index 2 in palette group 1
    state.sprites[0] = {
      x: 0,
      y: -1, // NES screen Y is OAM Y + 1
      tileIndex: 0,
      palette: 4, // group 1
      flipH: false,
      flipV: false,
      behindBg: false,
    };
    state.ptTile[0].pix[0] = 2;
    state.sprPalette[6] = 0x0000FF; // #ff0000 in CSS space

    const popover = new AnnotationPopover(viewport, renderer, () => state);
    click(viewport, { clientX: 0, clientY: 0, shiftKey: true });

    expect(popover.popover.innerHTML).toContain('Winner');
    expect(popover.popover.innerHTML).toContain('Sprite #0');
    expect(popover.popover.innerHTML).toContain('#ff0000');
  });
});
