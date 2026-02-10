/**
 * Converts NES palette data to CSS colors and tracks which palette groups changed.
 * A palette group is 4 consecutive colors (indices 0-3, 4-7, 8-11, 12-15).
 */
export class PaletteManager {
  constructor() {
    this.prevBg = new Array(16).fill(-1);
    this.prevSpr = new Array(16).fill(-1);
    this.bgColors = new Array(16).fill('#000000');
    this.sprColors = new Array(16).fill('#000000');
    this.dirtyBgGroups = new Set();
    this.dirtySprGroups = new Set();
  }

  /**
   * Update palettes from PPU state. Returns true if anything changed.
   */
  update(bgPalette, sprPalette) {
    this.dirtyBgGroups.clear();
    this.dirtySprGroups.clear();

    for (let i = 0; i < 16; i++) {
      if (bgPalette[i] !== this.prevBg[i]) {
        this.bgColors[i] = this._toCSS(bgPalette[i]);
        this.prevBg[i] = bgPalette[i];
        this.dirtyBgGroups.add(i >> 2);
      }
      if (sprPalette[i] !== this.prevSpr[i]) {
        this.sprColors[i] = this._toCSS(sprPalette[i]);
        this.prevSpr[i] = sprPalette[i];
        this.dirtySprGroups.add(i >> 2);
      }
    }

    return this.dirtyBgGroups.size > 0 || this.dirtySprGroups.size > 0;
  }

  /** Get 4 CSS color strings for BG palette group n (0-3) */
  getBgPaletteGroup(n) {
    const base = n << 2;
    return [this.bgColors[base], this.bgColors[base + 1], this.bgColors[base + 2], this.bgColors[base + 3]];
  }

  /** Get 4 CSS color strings for sprite palette group n (0-3) */
  getSprPaletteGroup(n) {
    const base = n << 2;
    return [this.sprColors[base], this.sprColors[base + 1], this.sprColors[base + 2], this.sprColors[base + 3]];
  }

  /** Background color (palette index 0 — shared across all BG palettes) */
  getBackgroundColor() {
    return this.bgColors[0];
  }

  _toCSS(packed) {
    // jsnes stores colors as 0xBBGGRR (for Uint32 canvas LE compatibility)
    const r = packed & 0xff;
    const g = (packed >> 8) & 0xff;
    const b = (packed >> 16) & 0xff;
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }
}
