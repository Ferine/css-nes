// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { TileCache } from '../../src/tile-cache.js';
import { PaletteManager } from '../../src/palette-manager.js';

/**
 * Stub canvas 2D context for happy-dom (which lacks real canvas).
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

describe('TileCache (DOM)', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    stubCanvas();
  });

  it('constructor creates 12 canvases and appends style element', () => {
    const tc = new TileCache();
    expect(tc.canvases).toHaveLength(12);
    expect(tc.contexts).toHaveLength(12);

    const styleEl = document.getElementById('tile-cache-styles');
    expect(styleEl).not.toBeNull();
    expect(styleEl.tagName).toBe('STYLE');
  });

  it('update regenerates all 12 sheets on first call', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    pm.update(bg, spr); // first call marks all groups dirty

    const ptTile = Array.from({ length: 512 }, () => ({
      pix: new Uint8Array(64),
    }));

    tc.update(ptTile, pm, 0, 0);

    // All 12 sheets should be updated (0-3 bg, 4-7 spr bank 0, 8-11 spr bank 1)
    for (let i = 0; i < 12; i++) {
      expect(tc.updatedSheets.has(i)).toBe(true);
    }
  });

  it('update skips sheets when nothing changed', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = Array.from({ length: 512 }, () => ({
      pix: new Uint8Array(64),
    }));

    // First call: initializes everything
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0);

    // Second call: no changes
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0);

    expect(tc.updatedSheets.size).toBe(0);
  });

  it('update regenerates only dirty palette groups', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = Array.from({ length: 512 }, () => ({
      pix: new Uint8Array(64),
    }));

    // Initialize
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0);

    // Change only bg group 2 (indices 8-11)
    const bg2 = [...bg];
    bg2[9] = 0xFF;
    pm.update(bg2, spr);
    tc.update(ptTile, pm, 0, 0);

    expect(tc.updatedSheets.has(2)).toBe(true);  // bg group 2
    expect(tc.updatedSheets.has(0)).toBe(false);
    expect(tc.updatedSheets.has(1)).toBe(false);
    expect(tc.updatedSheets.has(3)).toBe(false);
    // Sprite sheets untouched
    expect(tc.updatedSheets.has(4)).toBe(false);
    expect(tc.updatedSheets.has(5)).toBe(false);
    expect(tc.updatedSheets.has(8)).toBe(false);
    expect(tc.updatedSheets.has(9)).toBe(false);
  });

  it('detects CHR-RAM changes', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = Array.from({ length: 512 }, () => ({
      pix: new Uint8Array(64),
    }));

    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0);

    // Now no palette changes, but tile data changes
    pm.update(bg, spr);
    ptTile[5].pix[0] = 3;
    tc.update(ptTile, pm, 0, 0);

    // All sheets should be regenerated (CHR dirty)
    expect(tc.updatedSheets.size).toBeGreaterThan(0);
  });

  it('detects CHR changes in bank 1 (tiles 256-511)', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = Array.from({ length: 512 }, () => ({
      pix: new Uint8Array(64),
    }));

    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0);

    // Change tile in bank 1 only
    pm.update(bg, spr);
    ptTile[300].pix[0] = 3;
    tc.update(ptTile, pm, 0, 0);

    // Sprite bank 1 sheets (8-11) should be regenerated
    expect(tc.updatedSheets.size).toBeGreaterThan(0);
  });

  it('stylesheet contains correct class names for both sprite banks', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = Array.from({ length: 512 }, () => ({
      pix: new Uint8Array(64),
    }));

    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0);

    const css = tc.styleEl.textContent;
    for (let i = 0; i < 4; i++) {
      expect(css).toContain(`.bg-pal-${i}`);
      expect(css).toContain(`.spr-b0-pal-${i}`);
      expect(css).toContain(`.spr-b1-pal-${i}`);
    }
  });

  it('bgSheetUpdated / sprSheetUpdated reflect what was regenerated', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = Array.from({ length: 512 }, () => ({
      pix: new Uint8Array(64),
    }));

    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0);

    // After first call, all should be updated
    for (let i = 0; i < 4; i++) {
      expect(tc.bgSheetUpdated(i)).toBe(true);
      expect(tc.sprSheetUpdated(i)).toBe(true);
    }

    // After second call with no changes, none should be updated
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0);
    for (let i = 0; i < 4; i++) {
      expect(tc.bgSheetUpdated(i)).toBe(false);
      expect(tc.sprSheetUpdated(i)).toBe(false);
    }
  });
});
