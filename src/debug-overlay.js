/**
 * Visual debug overlays for the CSS-NES renderer.
 * Provides 5 toggleable overlay layers updated per-frame from PPU state.
 */
export class DebugOverlay {
  constructor(viewport) {
    this.viewport = viewport;

    // Overlay state
    this._active = {
      tileGrid: false,
      spriteBoxes: false,
      paletteRegions: false,
      scrollSplit: false,
      nametableSeam: false,
    };

    // 1. Tile Grid — repeating CSS gradient, no per-frame update
    this.tileGridEl = document.createElement('div');
    this.tileGridEl.className = 'debug-overlay debug-overlay-tile-grid';
    this.tileGridEl.style.display = 'none';
    viewport.appendChild(this.tileGridEl);

    // 2. Sprite Boxes — toggle class on sprite-layer (found in viewport)
    this.spriteLayerEl = viewport.querySelector('.sprite-layer');

    // 3. Palette Regions — 16×15 grid of 16px divs
    this.paletteRegionsEl = document.createElement('div');
    this.paletteRegionsEl.className = 'debug-overlay debug-overlay-palette-regions';
    this.paletteRegionsEl.style.display = 'none';
    this._paletteBlocks = [];
    for (let i = 0; i < 16 * 15; i++) {
      const block = document.createElement('div');
      block.className = 'palette-block';
      this.paletteRegionsEl.appendChild(block);
      this._paletteBlocks.push(block);
    }
    viewport.appendChild(this.paletteRegionsEl);

    // 4. Scroll Split — horizontal line at spr0HitY
    this.scrollSplitEl = document.createElement('div');
    this.scrollSplitEl.className = 'debug-overlay debug-overlay-scroll-split';
    this.scrollSplitEl.style.display = 'none';
    viewport.appendChild(this.scrollSplitEl);

    // 5. Nametable Seam — vertical and horizontal cyan lines
    this.ntSeamVEl = document.createElement('div');
    this.ntSeamVEl.className = 'debug-overlay debug-overlay-nt-seam-v';
    this.ntSeamVEl.style.display = 'none';
    viewport.appendChild(this.ntSeamVEl);

    this.ntSeamHEl = document.createElement('div');
    this.ntSeamHEl.className = 'debug-overlay debug-overlay-nt-seam-h';
    this.ntSeamHEl.style.display = 'none';
    viewport.appendChild(this.ntSeamHEl);

    // Palette region color coding for attribute groups 0-3
    this._paletteColors = [
      'rgba(255, 0, 0, 0.15)',
      'rgba(0, 255, 0, 0.15)',
      'rgba(0, 128, 255, 0.15)',
      'rgba(255, 255, 0, 0.15)',
    ];
  }

  /**
   * Called each frame by CSSRenderer. Updates dynamic overlays from PPU state.
   */
  update(ppuState) {
    if (this._active.paletteRegions) {
      this._updatePaletteRegions(ppuState);
    }
    if (this._active.scrollSplit) {
      this._updateScrollSplit(ppuState);
    }
    if (this._active.nametableSeam) {
      this._updateNametableSeam(ppuState);
    }
  }

  /**
   * Toggle an overlay by name.
   * @param {string} name - 'tileGrid'|'spriteBoxes'|'paletteRegions'|'scrollSplit'|'nametableSeam'
   * @returns {boolean} New active state
   */
  toggle(name) {
    if (!(name in this._active)) return false;
    this._active[name] = !this._active[name];
    const on = this._active[name];

    switch (name) {
      case 'tileGrid':
        this.tileGridEl.style.display = on ? '' : 'none';
        break;
      case 'spriteBoxes':
        if (this.spriteLayerEl) {
          this.spriteLayerEl.classList.toggle('debug-sprite-labels', on);
        }
        break;
      case 'paletteRegions':
        this.paletteRegionsEl.style.display = on ? '' : 'none';
        break;
      case 'scrollSplit':
        this.scrollSplitEl.style.display = on ? '' : 'none';
        break;
      case 'nametableSeam':
        this.ntSeamVEl.style.display = on ? '' : 'none';
        this.ntSeamHEl.style.display = on ? '' : 'none';
        break;
    }

    return on;
  }

  /**
   * Check if an overlay is active.
   * @param {string} name
   * @returns {boolean}
   */
  isActive(name) {
    return !!this._active[name];
  }

  _updatePaletteRegions(ppuState) {
    const s = ppuState.scroll;
    const scrollX = s.coarseX * 8 + s.fineX + s.nameTableH * 256;
    const scrollY = s.coarseY * 8 + s.fineY + s.nameTableV * 240;
    const mirrorMap = ppuState.mirrorMap;
    const nameTables = ppuState.nameTables;

    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 16; col++) {
        // Screen pixel position of this 16×16 block
        const pixX = col * 16 + scrollX;
        const pixY = row * 16 + scrollY;

        // Which nametable tile (in nametable space)
        const tileCol = Math.floor(pixX / 8);
        const tileRow = Math.floor(pixY / 8);

        // Nametable quadrant from tile coords
        const ntX = Math.floor(tileCol / 32) % 2;
        const ntY = Math.floor(tileRow / 30) % 2;
        const logicalNT = ntY * 2 + ntX;
        const physicalNT = mirrorMap[logicalNT];

        // Tile position within the nametable
        const localCol = tileCol % 32;
        const localRow = tileRow % 30;

        // Attribute table index: 8×8 attribute grid, each covering 4×4 tiles (32×32 px)
        const attrCol = Math.floor(localCol / 4);
        const attrRow = Math.floor(localRow / 4);
        const attrIdx = attrRow * 8 + attrCol;

        // Sub-quadrant within the attribute byte: 2×2 tile groups
        const subCol = Math.floor(localCol / 2) % 2;
        const subRow = Math.floor(localRow / 2) % 2;

        let palGroup = 0;
        const nt = nameTables[physicalNT];
        if (nt && nt.attrib) {
          // attrib array stores per-tile palette indices (already decoded by jsnes)
          // Use the tile's attribute directly
          const tileIdx = localRow * 32 + localCol;
          palGroup = nt.attrib[tileIdx] & 3;
        }

        const block = this._paletteBlocks[row * 16 + col];
        block.style.backgroundColor = this._paletteColors[palGroup];
      }
    }
  }

  _updateScrollSplit(ppuState) {
    const y = ppuState.spr0HitY;
    if (y > 0 && y < 240) {
      this.scrollSplitEl.style.display = '';
      this.scrollSplitEl.style.top = `${y}px`;
    } else {
      this.scrollSplitEl.style.display = 'none';
    }
  }

  _updateNametableSeam(ppuState) {
    const s = ppuState.scroll;
    const scrollX = s.coarseX * 8 + s.fineX + s.nameTableH * 256;
    const scrollY = s.coarseY * 8 + s.fineY + s.nameTableV * 240;

    // Vertical seam: nametable boundary within the 256px viewport
    const seamX = 256 - (scrollX % 256);
    if (seamX > 0 && seamX < 256 && scrollX > 0) {
      this.ntSeamVEl.style.display = '';
      this.ntSeamVEl.style.left = `${seamX}px`;
    } else {
      this.ntSeamVEl.style.display = 'none';
    }

    // Horizontal seam: nametable boundary within the 240px viewport
    const seamY = 240 - (scrollY % 240);
    if (seamY > 0 && seamY < 240 && scrollY > 0) {
      this.ntSeamHEl.style.display = '';
      this.ntSeamHEl.style.top = `${seamY}px`;
    } else {
      this.ntSeamHEl.style.display = 'none';
    }
  }
}
