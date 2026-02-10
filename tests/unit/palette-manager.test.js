import { describe, it, expect } from 'vitest';
import { PaletteManager } from '../../src/palette-manager.js';

describe('PaletteManager', () => {
  describe('_toCSS', () => {
    it('converts 0xBBGGRR black to #000000', () => {
      const pm = new PaletteManager();
      expect(pm._toCSS(0x000000)).toBe('#000000');
    });

    it('converts pure red (0x0000FF in BBGGRR) to #ff0000', () => {
      const pm = new PaletteManager();
      expect(pm._toCSS(0x0000FF)).toBe('#ff0000');
    });

    it('converts pure green (0x00FF00 in BBGGRR) to #00ff00', () => {
      const pm = new PaletteManager();
      expect(pm._toCSS(0x00FF00)).toBe('#00ff00');
    });

    it('converts pure blue (0xFF0000 in BBGGRR) to #0000ff', () => {
      const pm = new PaletteManager();
      expect(pm._toCSS(0xFF0000)).toBe('#0000ff');
    });

    it('converts mixed color correctly', () => {
      const pm = new PaletteManager();
      // BBGGRR = 0x102030 → R=0x30, G=0x20, B=0x10 → #302010
      expect(pm._toCSS(0x102030)).toBe('#302010');
    });

    it('converts white (0xFFFFFF) to #ffffff', () => {
      const pm = new PaletteManager();
      expect(pm._toCSS(0xFFFFFF)).toBe('#ffffff');
    });
  });

  describe('update', () => {
    it('returns true on first call (all colors changed from -1)', () => {
      const pm = new PaletteManager();
      const bg = new Array(16).fill(0);
      const spr = new Array(16).fill(0);
      expect(pm.update(bg, spr)).toBe(true);
    });

    it('returns false when called again with same data', () => {
      const pm = new PaletteManager();
      const bg = new Array(16).fill(0);
      const spr = new Array(16).fill(0);
      pm.update(bg, spr);
      expect(pm.update(bg, spr)).toBe(false);
    });

    it('returns true when bg palette changes', () => {
      const pm = new PaletteManager();
      const bg = new Array(16).fill(0);
      const spr = new Array(16).fill(0);
      pm.update(bg, spr);

      const bg2 = [...bg];
      bg2[5] = 0xFF;
      expect(pm.update(bg2, spr)).toBe(true);
    });

    it('returns true when spr palette changes', () => {
      const pm = new PaletteManager();
      const bg = new Array(16).fill(0);
      const spr = new Array(16).fill(0);
      pm.update(bg, spr);

      const spr2 = [...spr];
      spr2[10] = 0xFF;
      expect(pm.update(spr2, bg)).toBe(true);
    });
  });

  describe('dirty group tracking', () => {
    it('marks correct bg group dirty when single entry changes', () => {
      const pm = new PaletteManager();
      const bg = new Array(16).fill(0);
      const spr = new Array(16).fill(0);
      pm.update(bg, spr);

      // Change index 5 → group 1 (5 >> 2 = 1)
      const bg2 = [...bg];
      bg2[5] = 0xFF;
      pm.update(bg2, spr);

      expect(pm.dirtyBgGroups.has(1)).toBe(true);
      expect(pm.dirtyBgGroups.has(0)).toBe(false);
      expect(pm.dirtyBgGroups.has(2)).toBe(false);
      expect(pm.dirtyBgGroups.has(3)).toBe(false);
    });

    it('marks correct spr group dirty when single entry changes', () => {
      const pm = new PaletteManager();
      const bg = new Array(16).fill(0);
      const spr = new Array(16).fill(0);
      pm.update(bg, spr);

      // Change index 14 → group 3 (14 >> 2 = 3)
      const spr2 = [...spr];
      spr2[14] = 0xFF;
      pm.update(bg, spr2);

      expect(pm.dirtySprGroups.has(3)).toBe(true);
      expect(pm.dirtySprGroups.has(0)).toBe(false);
      expect(pm.dirtySprGroups.has(1)).toBe(false);
      expect(pm.dirtySprGroups.has(2)).toBe(false);
    });

    it('clears dirty groups between update calls', () => {
      const pm = new PaletteManager();
      const bg = new Array(16).fill(0);
      const spr = new Array(16).fill(0);

      // First call: all groups dirty
      pm.update(bg, spr);
      expect(pm.dirtyBgGroups.size).toBe(4);

      // Second call, no changes: all clear
      pm.update(bg, spr);
      expect(pm.dirtyBgGroups.size).toBe(0);
      expect(pm.dirtySprGroups.size).toBe(0);
    });
  });

  describe('getBgPaletteGroup / getSprPaletteGroup', () => {
    it('returns correct 4-color slices for bg palette groups', () => {
      const pm = new PaletteManager();
      // BBGGRR format: pure red = 0x0000FF
      const bg = new Array(16).fill(0);
      bg[4] = 0x0000FF; // R=FF
      bg[5] = 0x00FF00; // G=FF
      bg[6] = 0xFF0000; // B=FF
      bg[7] = 0xFFFFFF; // white

      pm.update(bg, new Array(16).fill(0));

      const group1 = pm.getBgPaletteGroup(1);
      expect(group1).toEqual(['#ff0000', '#00ff00', '#0000ff', '#ffffff']);
    });

    it('returns correct 4-color slices for spr palette groups', () => {
      const pm = new PaletteManager();
      const spr = new Array(16).fill(0);
      spr[8] = 0x102030; // group 2, index 0

      pm.update(new Array(16).fill(0), spr);

      const group2 = pm.getSprPaletteGroup(2);
      expect(group2[0]).toBe('#302010');
    });

    it('group 0 returns indices 0-3, group 3 returns indices 12-15', () => {
      const pm = new PaletteManager();
      const bg = new Array(16).fill(0);
      bg[0] = 0x0000AA;
      bg[12] = 0x00BB00;

      pm.update(bg, new Array(16).fill(0));

      expect(pm.getBgPaletteGroup(0)[0]).toBe('#aa0000');
      expect(pm.getBgPaletteGroup(3)[0]).toBe('#00bb00');
    });
  });

  describe('getBackgroundColor', () => {
    it('returns bgColors[0]', () => {
      const pm = new PaletteManager();
      const bg = new Array(16).fill(0);
      bg[0] = 0x0F0F0F; // R=0F, G=0F, B=0F → #0f0f0f
      pm.update(bg, new Array(16).fill(0));
      expect(pm.getBackgroundColor()).toBe('#0f0f0f');
    });
  });
});
