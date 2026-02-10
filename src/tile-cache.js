/**
 * Generates spritesheet images from pattern table tiles + palette colors.
 * 12 sheets total: 4 BG palette variants + 4 sprite bank-0 + 4 sprite bank-1.
 * Each sheet is 128×128px (16×16 grid of 8×8 tiles), exported as blob URLs.
 *
 * Both sprite banks are always rendered because 8×16 sprites select their
 * pattern table per-sprite (via tileIndex bit 0), independent of sprPatternBase.
 *
 * Uses a dynamic <style> element so tile divs reference classes, not inline styles.
 * Palette change = update 1 CSS rule, not 960+ divs.
 *
 * CHR bank switching (MMC3 etc.) is detected via chrBankSignature — an array
 * of Tile object references sampled per 1KB CHR region. When load1kVromBank
 * replaces Tile objects, the refs change, triggering sheet regeneration for the
 * affected pattern table. CHR-RAM modifications (in-place pix changes) are
 * still caught by the FNV-1a checksum fallback.
 */
export class TileCache {
  constructor() {
    // 12 offscreen canvases (4 bg + 4 spr bank 0 + 4 spr bank 1)
    this.canvases = [];
    this.contexts = [];
    for (let i = 0; i < 12; i++) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      this.canvases.push(c);
      this.contexts.push(c.getContext('2d'));
    }

    // Blob URLs for each sheet
    this.blobUrls = new Array(12).fill(null);

    // Dynamic stylesheet
    this.styleEl = document.createElement('style');
    this.styleEl.id = 'tile-cache-styles';
    document.head.appendChild(this.styleEl);

    // CHR tile checksums for dirty detection (CHR-RAM fallback)
    this.tileChecksums = new Uint32Array(512);

    // CHR bank signature — one Tile object ref per 1KB region (8 regions)
    // Regions 0-3 = pattern table $0000, regions 4-7 = pattern table $1000
    this.prevBankRefs = new Array(8).fill(null);

    // Track which sheets were regenerated this frame
    this.updatedSheets = new Set();

    // Previous BG pattern table base
    this.prevBgBase = -1;

    // Consecutive-frame regeneration counter for performance warning
    this._consecRegenFrames = 0;
  }

  /**
   * Update sheets as needed based on palette, CHR bank, and tile changes.
   * Sprite sheets are rendered for BOTH banks (0 and 256) because 8×16 sprites
   * select their pattern table per-sprite via tileIndex bit 0.
   * @param {object[]} ptTile - ppu.ptTile array (512 Tile objects with .pix)
   * @param {PaletteManager} paletteManager
   * @param {number} bgBase - 0 or 256
   * @param {number} sprBase - 0 or 256 (kept for API compat, not used for sheet selection)
   * @param {object[]|undefined} chrBankSignature - 8 Tile refs, one per 1KB CHR region
   */
  update(ptTile, paletteManager, bgBase, sprBase, chrBankSignature) {
    this.updatedSheets.clear();

    // Check if BG pattern table base changed
    const bgBaseChanged = bgBase !== this.prevBgBase;
    this.prevBgBase = bgBase;

    // --- CHR bank switch detection (fast O(8) identity check) ---
    // Check each pattern table independently: BG uses bgBase, sprites use both.
    let bgBankDirty = false;
    let sprBank0Dirty = false;
    let sprBank1Dirty = false;

    if (chrBankSignature) {
      bgBankDirty = this._checkBankDirty(chrBankSignature, bgBase);
      sprBank0Dirty = this._checkBankDirty(chrBankSignature, 0);
      sprBank1Dirty = this._checkBankDirty(chrBankSignature, 256);
      this._updateBankRefs(chrBankSignature);
    }

    // --- CHR-RAM fallback: per-PT checksum scan ---
    // Catches in-place pix modifications. Always runs to keep checksums current.
    const { pt0Dirty: chrDirtyPT0, pt1Dirty: chrDirtyPT1 } = this._checkCHRDirty(ptTile);

    // Combine bank-switch and CHR-RAM dirty signals per pattern table
    const bgPTIndex = bgBase >= 256 ? 1 : 0;
    const bgDirty = bgBankDirty || (bgPTIndex === 0 ? chrDirtyPT0 : chrDirtyPT1);
    const spr0Dirty = sprBank0Dirty || chrDirtyPT0;
    const spr1Dirty = sprBank1Dirty || chrDirtyPT1;

    // --- Regenerate BG sheets (indices 0-3) ---
    for (let palGroup = 0; palGroup < 4; palGroup++) {
      if (paletteManager.dirtyBgGroups.has(palGroup) || bgDirty || bgBaseChanged) {
        const colors = paletteManager.getBgPaletteGroup(palGroup);
        this._renderSheet(palGroup, ptTile, bgBase, colors);
        this.updatedSheets.add(palGroup);
      }
    }

    // --- Regenerate sprite sheets, per-bank ---
    // Bank 0 sheets (indices 4-7): ptTile[0..255]
    for (let palGroup = 0; palGroup < 4; palGroup++) {
      if (paletteManager.dirtySprGroups.has(palGroup) || spr0Dirty) {
        const colors = paletteManager.getSprPaletteGroup(palGroup);
        this._renderSheet(4 + palGroup, ptTile, 0, colors);
        this.updatedSheets.add(4 + palGroup);
      }
    }
    // Bank 1 sheets (indices 8-11): ptTile[256..511]
    for (let palGroup = 0; palGroup < 4; palGroup++) {
      if (paletteManager.dirtySprGroups.has(palGroup) || spr1Dirty) {
        const colors = paletteManager.getSprPaletteGroup(palGroup);
        this._renderSheet(8 + palGroup, ptTile, 256, colors);
        this.updatedSheets.add(8 + palGroup);
      }
    }

    // Update CSS if any sheets changed
    if (this.updatedSheets.size > 0) {
      this._updateStylesheet();
    }

    // Performance warning: log if all sheets regenerate every frame
    if (this.updatedSheets.size === 12) {
      this._consecRegenFrames++;
      if (this._consecRegenFrames === 60) {
        console.warn(
          'TileCache: all 12 spritesheets regenerated every frame for 60 consecutive frames. ' +
          'This is expected for CHR bank-switching games (MMC3) but impacts performance.'
        );
      }
    } else {
      this._consecRegenFrames = 0;
    }
  }

  /**
   * Get background-position CSS string for a given tile index (0-255).
   */
  getTilePosition(index) {
    const col = index & 15;       // index % 16
    const row = (index >> 4) & 15; // index / 16
    return `-${col * 8}px -${row * 8}px`;
  }

  /**
   * Check if any 1KB CHR region changed for a given pattern table base.
   * Each pattern table (0 or 256 tile index offset) spans 4 × 1KB regions.
   * Returns true if any region's Tile object reference differs from last frame.
   */
  _checkBankDirty(chrBankSignature, ptBase) {
    const startRegion = ptBase >= 256 ? 4 : 0;
    for (let i = 0; i < 4; i++) {
      if (chrBankSignature[startRegion + i] !== this.prevBankRefs[startRegion + i]) {
        return true;
      }
    }
    return false;
  }

  /**
   * Store the current bank signature for next-frame comparison.
   */
  _updateBankRefs(chrBankSignature) {
    for (let i = 0; i < 8; i++) {
      this.prevBankRefs[i] = chrBankSignature[i];
    }
  }

  /**
   * Check if any CHR tiles changed via content checksums, per pattern table.
   * Catches CHR-RAM in-place modifications that bank-signature detection misses.
   * Always updates stored checksums to keep baseline correct.
   * @returns {{ pt0Dirty: boolean, pt1Dirty: boolean }}
   */
  _checkCHRDirty(ptTile) {
    let pt0Dirty = false;
    let pt1Dirty = false;
    for (let i = 0; i < 512; i++) {
      const tile = ptTile[i];
      if (!tile) continue;
      const checksum = this._hashPix(tile.pix);
      if (checksum !== this.tileChecksums[i]) {
        this.tileChecksums[i] = checksum;
        if (i < 256) pt0Dirty = true;
        else pt1Dirty = true;
      }
    }
    return { pt0Dirty, pt1Dirty };
  }

  /** Simple FNV-1a-ish hash of a 64-element pix array */
  _hashPix(pix) {
    let h = 0x811c9dc5;
    for (let i = 0; i < 64; i++) {
      h ^= pix[i];
      h = (h * 0x01000193) | 0;
    }
    return h >>> 0;
  }

  /**
   * Render a 128×128 spritesheet for 256 tiles with the given palette colors.
   */
  _renderSheet(sheetIndex, ptTile, base, colors) {
    const ctx = this.contexts[sheetIndex];
    const imgData = ctx.createImageData(128, 128);
    const data = imgData.data;

    // Parse CSS color strings to [r,g,b] — color[0] is transparent
    const rgb = colors.map(c => {
      const v = parseInt(c.slice(1), 16);
      return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    });

    for (let tileIdx = 0; tileIdx < 256; tileIdx++) {
      const tile = ptTile[base + tileIdx];
      if (!tile) continue;

      const tileCol = tileIdx & 15;
      const tileRow = (tileIdx >> 4) & 15;
      const baseX = tileCol * 8;
      const baseY = tileRow * 8;

      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const colorIdx = tile.pix[(py << 3) + px];
          const destOffset = ((baseY + py) * 128 + (baseX + px)) * 4;
          if (colorIdx === 0) {
            // Transparent
            data[destOffset] = 0;
            data[destOffset + 1] = 0;
            data[destOffset + 2] = 0;
            data[destOffset + 3] = 0;
          } else {
            const [r, g, b] = rgb[colorIdx];
            data[destOffset] = r;
            data[destOffset + 1] = g;
            data[destOffset + 2] = b;
            data[destOffset + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Revoke old blob URL
    if (this.blobUrls[sheetIndex]) {
      URL.revokeObjectURL(this.blobUrls[sheetIndex]);
    }

    // Convert canvas to blob URL synchronously via toDataURL (blob URLs are async)
    // Using data URLs for simplicity — they work in background-image
    this.blobUrls[sheetIndex] = this.canvases[sheetIndex].toDataURL('image/png');
  }

  /**
   * Write all sheet URLs into the dynamic stylesheet.
   * Classes: bg-pal-0..3, spr-b0-pal-0..3 (bank 0), spr-b1-pal-0..3 (bank 1)
   */
  _updateStylesheet() {
    let css = '';
    for (let i = 0; i < 4; i++) {
      if (this.blobUrls[i]) {
        css += `.bg-pal-${i} { background-image: url("${this.blobUrls[i]}"); }\n`;
      }
    }
    for (let i = 0; i < 4; i++) {
      if (this.blobUrls[4 + i]) {
        css += `.spr-b0-pal-${i} { background-image: url("${this.blobUrls[4 + i]}"); }\n`;
      }
    }
    for (let i = 0; i < 4; i++) {
      if (this.blobUrls[8 + i]) {
        css += `.spr-b1-pal-${i} { background-image: url("${this.blobUrls[8 + i]}"); }\n`;
      }
    }
    this.styleEl.textContent = css;
  }

  /**
   * Whether a specific BG palette sheet was updated this frame.
   */
  bgSheetUpdated(palGroup) {
    return this.updatedSheets.has(palGroup);
  }

  /**
   * Whether a specific sprite palette sheet was updated this frame.
   * Returns true if either bank's sheet for this palette group was updated.
   */
  sprSheetUpdated(palGroup) {
    return this.updatedSheets.has(4 + palGroup) || this.updatedSheets.has(8 + palGroup);
  }
}
