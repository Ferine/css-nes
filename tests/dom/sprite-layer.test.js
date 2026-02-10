// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { SpriteLayer } from '../../src/sprite-layer.js';
import { createMockPPUState } from '../helpers/mock-ppu-state.js';
import { createMockTileCache } from '../helpers/mock-tile-cache.js';

describe('SpriteLayer (DOM)', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('constructor creates .sprite-layer with 64 .sprite divs', () => {
    const sl = new SpriteLayer(container);
    const layer = container.querySelector('.sprite-layer');
    expect(layer).not.toBeNull();

    const sprites = layer.querySelectorAll('.sprite');
    expect(sprites).toHaveLength(64);
  });

  it('each sprite has 2 .sprite-half children', () => {
    const sl = new SpriteLayer(container);
    for (let i = 0; i < 64; i++) {
      const halves = sl.spriteDivs[i].querySelectorAll('.sprite-half');
      expect(halves).toHaveLength(2);
      expect(halves[0].dataset.half).toBe('top');
      expect(halves[1].dataset.half).toBe('bottom');
    }
  });

  it('sprites are initially hidden', () => {
    const sl = new SpriteLayer(container);
    for (let i = 0; i < 64; i++) {
      expect(sl.spriteDivs[i].style.display).toBe('none');
    }
  });

  it('sprites have OAM address data attributes', () => {
    const sl = new SpriteLayer(container);
    expect(sl.spriteDivs[0].dataset.oamAddr).toBe('$00');
    expect(sl.spriteDivs[1].dataset.oamAddr).toBe('$04');
    expect(sl.spriteDivs[63].dataset.oamAddr).toBe('$fc');
  });

  describe('8x8 mode', () => {
    it('positions sprite with y+1 offset', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 0 });

      state.sprites[0] = {
        x: 100, y: 50, tileIndex: 0, palette: 0,
        flipH: false, flipV: false, behindBg: false,
      };

      sl.update(state, tc);

      expect(sl.spriteDivs[0].style.left).toBe('100px');
      expect(sl.spriteDivs[0].style.top).toBe('51px'); // y+1
    });

    it('sets correct palette class', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 0 });

      state.sprites[0] = {
        x: 10, y: 20, tileIndex: 5, palette: 8, // group 2
        flipH: false, flipV: false, behindBg: false,
      };

      sl.update(state, tc);

      // sprPatternBase defaults to 0 → bank index 0
      expect(sl.spriteDivs[0].className).toBe('sprite spr-b0-pal-2');
    });

    it('applies flip transforms', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 0 });

      state.sprites[0] = {
        x: 10, y: 20, tileIndex: 0, palette: 0,
        flipH: true, flipV: true, behindBg: false,
      };

      sl.update(state, tc);

      expect(sl.spriteDivs[0].style.transform).toBe('scale(-1, -1)');
    });

    it('sets z-index for behind-bg priority', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 0 });

      state.sprites[0] = {
        x: 10, y: 20, tileIndex: 0, palette: 0,
        flipH: false, flipV: false, behindBg: true,
      };
      state.sprites[1] = {
        x: 20, y: 20, tileIndex: 0, palette: 0,
        flipH: false, flipV: false, behindBg: false,
      };

      sl.update(state, tc);

      expect(sl.spriteDivs[0].style.zIndex).toBe('-1');
      expect(sl.spriteDivs[1].style.zIndex).toBe('1');
    });

    it('uses bank-1 class when sprPatternBase is 256', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 0, sprPatternBase: 256 });

      state.sprites[0] = {
        x: 10, y: 20, tileIndex: 5, palette: 4, // group 1
        flipH: false, flipV: false, behindBg: false,
      };

      sl.update(state, tc);

      expect(sl.spriteDivs[0].className).toBe('sprite spr-b1-pal-1');
    });

    it('sets backgroundPosition from tileCache', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 0 });

      state.sprites[0] = {
        x: 10, y: 20, tileIndex: 42, palette: 0,
        flipH: false, flipV: false, behindBg: false,
      };

      sl.update(state, tc);

      expect(sl.spriteDivs[0].style.backgroundPosition).toBe(
        tc.getTilePosition(42)
      );
    });
  });

  describe('8x16 mode', () => {
    it('tileIndex bit 0 selects bank', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 1 });

      // Odd tileIndex → bank 256
      state.sprites[0] = {
        x: 10, y: 20, tileIndex: 0x03, palette: 0,
        flipH: false, flipV: false, behindBg: false,
      };

      sl.update(state, tc);

      // tileIndex & 1 = 1 → bank = 256
      // topTile = 0x03 & 0xFE = 0x02
      // botTile = 0x02 + 1 = 0x03
      const topDiv = sl.spriteTopDivs[0];
      const botDiv = sl.spriteBotDivs[0];

      // tile 0x02: col=2, row=0 → "-16px -0px", DOM normalizes -0px → 0px
      expect(topDiv.style.backgroundPosition).toBe('-16px 0px');
      // tile 0x03: col=3, row=0 → "-24px -0px", DOM normalizes
      expect(botDiv.style.backgroundPosition).toBe('-24px 0px');
    });

    it('top and bottom tile halves are visible', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 1 });

      state.sprites[0] = {
        x: 10, y: 20, tileIndex: 0x04, palette: 0,
        flipH: false, flipV: false, behindBg: false,
      };

      sl.update(state, tc);

      expect(sl.spriteTopDivs[0].style.display).toBe('');
      expect(sl.spriteBotDivs[0].style.display).toBe('');
    });

    it('swaps top/bottom tiles on flipV', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 1 });

      state.sprites[0] = {
        x: 10, y: 20, tileIndex: 0x10, palette: 0,
        flipH: false, flipV: true, behindBg: false,
      };

      sl.update(state, tc);

      // topTile = 0x10 & 0xFE = 0x10, botTile = 0x11
      // flipV: top gets botTile (0x11: col=1, row=1 → -8px -8px), bot gets topTile (0x10: col=0, row=1 → -0px -8px)
      // DOM normalizes -0px → 0px
      expect(sl.spriteTopDivs[0].style.backgroundPosition).toBe('-8px -8px');
      expect(sl.spriteBotDivs[0].style.backgroundPosition).toBe('0px -8px');
    });

    it('uses bank-0 class for even tileIndex, bank-1 for odd', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 1 });

      // Even tileIndex → bank 0
      state.sprites[0] = {
        x: 10, y: 20, tileIndex: 0x04, palette: 0,
        flipH: false, flipV: false, behindBg: false,
      };
      // Odd tileIndex → bank 1 (256)
      state.sprites[1] = {
        x: 30, y: 20, tileIndex: 0x05, palette: 0,
        flipH: false, flipV: false, behindBg: false,
      };

      sl.update(state, tc);

      expect(sl.spriteTopDivs[0].className).toContain('spr-b0-pal-');
      expect(sl.spriteTopDivs[1].className).toContain('spr-b1-pal-');
    });

    it('applies palette class to both halves', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 1 });

      state.sprites[0] = {
        x: 10, y: 20, tileIndex: 0x04, palette: 12, // group 3
        flipH: false, flipV: false, behindBg: false,
      };

      sl.update(state, tc);

      // tileIndex 0x04 is even → bank 0
      expect(sl.spriteTopDivs[0].className).toContain('spr-b0-pal-3');
      expect(sl.spriteBotDivs[0].className).toContain('spr-b0-pal-3');
    });
  });

  describe('visibility', () => {
    it('hides sprites with y >= 240', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 0 });

      state.sprites[0] = {
        x: 10, y: 240, tileIndex: 0, palette: 0,
        flipH: false, flipV: false, behindBg: false,
      };

      sl.update(state, tc);

      // y=240 → sprY=241, 241>=240 → hidden
      expect(sl.spriteDivs[0].style.display).toBe('none');
    });

    it('hides layer when spritesVisible=false', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spritesVisible: false });

      sl.update(state, tc);

      expect(sl.spriteLayer.style.display).toBe('none');
    });

    it('shows visible sprites (y < 239)', () => {
      const sl = new SpriteLayer(container);
      const tc = createMockTileCache();
      const state = createMockPPUState({ spriteSize: 0 });

      state.sprites[0] = {
        x: 10, y: 100, tileIndex: 0, palette: 0,
        flipH: false, flipV: false, behindBg: false,
      };

      sl.update(state, tc);

      expect(sl.spriteDivs[0].style.display).toBe('');
    });
  });
});
