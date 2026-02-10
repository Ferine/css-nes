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

/** Create 512 mock Tile objects with unique identity per object. */
function createPtTile() {
  return Array.from({ length: 512 }, () => ({
    pix: new Uint8Array(64),
  }));
}

/** Build a chrBankSignature from a ptTile array (mirrors PPUStateExtractor). */
function bankSig(ptTile) {
  return Array.from({ length: 8 }, (_, i) => ptTile[i * 64]);
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

    const ptTile = createPtTile();

    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

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
    const ptTile = createPtTile();

    // First call: initializes everything
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // Second call: no changes
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    expect(tc.updatedSheets.size).toBe(0);
  });

  it('update regenerates only dirty palette groups', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = createPtTile();

    // Initialize
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // Change only bg group 2 (indices 8-11)
    const bg2 = [...bg];
    bg2[9] = 0xFF;
    pm.update(bg2, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

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

  it('detects CHR-RAM changes (in-place pix modification)', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = createPtTile();

    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // Now no palette changes, but tile data changes in place (CHR-RAM)
    pm.update(bg, spr);
    ptTile[5].pix[0] = 3;
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // All sheets should be regenerated (CHR dirty)
    expect(tc.updatedSheets.size).toBeGreaterThan(0);
  });

  it('detects CHR changes in bank 1 (tiles 256-511)', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = createPtTile();

    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // Change tile in bank 1 only
    pm.update(bg, spr);
    ptTile[300].pix[0] = 3;
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // Sprite bank 1 sheets (8-11) should be regenerated
    expect(tc.updatedSheets.size).toBeGreaterThan(0);
  });

  it('stylesheet contains correct class names for both sprite banks', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = createPtTile();

    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

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
    const ptTile = createPtTile();

    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // After first call, all should be updated
    for (let i = 0; i < 4; i++) {
      expect(tc.bgSheetUpdated(i)).toBe(true);
      expect(tc.sprSheetUpdated(i)).toBe(true);
    }

    // After second call with no changes, none should be updated
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));
    for (let i = 0; i < 4; i++) {
      expect(tc.bgSheetUpdated(i)).toBe(false);
      expect(tc.sprSheetUpdated(i)).toBe(false);
    }
  });

  // --- CHR bank switching tests ---

  it('detects CHR bank switch in pattern table 0 via signature change', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = createPtTile();

    // Initialize
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // Simulate MMC3 bank switch: replace tile objects in first 1KB region (tiles 0-63)
    for (let i = 0; i < 64; i++) {
      ptTile[i] = { pix: new Uint8Array(64).fill(2) };
    }
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // BG sheets (bgBase=0 uses PT0) and sprite bank 0 sheets should be dirty
    expect(tc.updatedSheets.has(0)).toBe(true); // bg pal 0
    expect(tc.updatedSheets.has(4)).toBe(true); // spr bank 0 pal 0
    // Sprite bank 1 should NOT be dirty (PT1 unchanged)
    expect(tc.updatedSheets.has(8)).toBe(false);
  });

  it('detects CHR bank switch in pattern table 1 via signature change', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = createPtTile();

    // Initialize with bgBase=0
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // Replace tiles in PT1 region (tiles 256-319, first 1KB of PT1)
    for (let i = 256; i < 320; i++) {
      ptTile[i] = { pix: new Uint8Array(64).fill(3) };
    }
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // BG sheets should NOT be dirty (bgBase=0 uses PT0, not PT1)
    expect(tc.updatedSheets.has(0)).toBe(false);
    // Sprite bank 1 sheets SHOULD be dirty
    expect(tc.updatedSheets.has(8)).toBe(true);
  });

  it('bank switch does not trigger sprite bank 1 sheets when only PT0 changed', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = createPtTile();

    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // Only replace tiles in PT0 region 2 (tiles 128-191)
    for (let i = 128; i < 192; i++) {
      ptTile[i] = { pix: new Uint8Array(64).fill(1) };
    }
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // Sprite bank 0 dirty (PT0 changed), sprite bank 1 clean
    expect(tc.updatedSheets.has(4)).toBe(true);
    expect(tc.updatedSheets.has(8)).toBe(false);
  });

  it('handles bgBase=256 correctly: BG uses PT1 bank signature', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = createPtTile();

    // Initialize with bgBase=256 (BG reads from pattern table $1000)
    pm.update(bg, spr);
    tc.update(ptTile, pm, 256, 0, bankSig(ptTile));

    // Only replace tiles in PT1 (tiles 256-319)
    for (let i = 256; i < 320; i++) {
      ptTile[i] = { pix: new Uint8Array(64).fill(1) };
    }
    pm.update(bg, spr);
    tc.update(ptTile, pm, 256, 0, bankSig(ptTile));

    // BG sheets SHOULD be dirty (bgBase=256 uses PT1)
    expect(tc.updatedSheets.has(0)).toBe(true);
  });

  it('no bank switch detected when same tile objects remain', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = createPtTile();

    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    // No changes at all
    pm.update(bg, spr);
    tc.update(ptTile, pm, 0, 0, bankSig(ptTile));

    expect(tc.updatedSheets.size).toBe(0);
  });

  it('works without chrBankSignature (backwards compat)', () => {
    const tc = new TileCache();
    const pm = new PaletteManager();
    const bg = new Array(16).fill(0);
    const spr = new Array(16).fill(0);
    const ptTile = createPtTile();

    pm.update(bg, spr);
    // Omit chrBankSignature parameter
    tc.update(ptTile, pm, 0, 0);

    // Should still work — all 12 sheets generated via palette dirty
    for (let i = 0; i < 12; i++) {
      expect(tc.updatedSheets.has(i)).toBe(true);
    }
  });
});
