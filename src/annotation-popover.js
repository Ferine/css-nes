/**
 * Click-to-inspect annotation popover for paused NES viewport.
 * Shows PPU-level details for BG tiles and sprites: memory addresses,
 * raw bytes, CHR pixel grid, and palette swatches.
 */
export class AnnotationPopover {
  constructor(viewport, renderer, getPPUState) {
    this.viewport = viewport;
    this.renderer = renderer;
    this.getPPUState = getPPUState;

    // Popover element
    this.popover = document.createElement('div');
    this.popover.className = 'annotation-popover';
    this.popover.style.display = 'none';
    viewport.appendChild(this.popover);

    // Highlight outline
    this.highlight = document.createElement('div');
    this.highlight.className = 'annotation-highlight';
    this.highlight.style.display = 'none';
    viewport.appendChild(this.highlight);

    // Delegated click handler
    this._onClick = this._onClick.bind(this);
    viewport.addEventListener('click', this._onClick);
  }

  get isVisible() {
    return this.popover.style.display !== 'none';
  }

  dismiss() {
    this.popover.style.display = 'none';
    this.highlight.style.display = 'none';
  }

  _onClick(e) {
    // Only activate when paused (viewport has .paused class)
    if (!this.viewport.classList.contains('paused')) return;

    // Walk up to find a bg-tile or sprite element
    const bgTile = e.target.closest('[data-type="bg-tile"]');
    const sprite = e.target.closest('[data-type="sprite"]');
    const target = bgTile || sprite;

    if (!target) {
      this.dismiss();
      return;
    }

    e.stopPropagation();

    const ppuState = this.getPPUState();
    if (!ppuState) return;

    if (bgTile) {
      this._showBgTile(bgTile, ppuState);
    } else {
      this._showSprite(sprite, ppuState);
    }
  }

  _showBgTile(el, ppuState) {
    const col = parseInt(el.dataset.col);
    const row = parseInt(el.dataset.row);
    const quadrant = parseInt(el.dataset.quadrant);
    const tileIdx = parseInt(el.dataset.tileIdx || '0');
    const tileHex = el.dataset.tileHex || '$00';
    const ntAddr = el.dataset.ntAddr;
    const palGroup = parseInt(el.dataset.palette || '0');

    // Physical nametable from parent
    const ntEl = el.closest('.nametable');
    const physNT = ntEl ? parseInt(ntEl.dataset.physNt) : 0;

    // Raw bytes from PPU state
    const ntData = ppuState.nameTables[physNT];
    const slot = row * 32 + col;
    const rawTileByte = ntData ? ntData.tile[slot] : 0;
    const rawAttribByte = ntData ? ntData.attrib[slot] : 0;

    // Pattern table base
    const bgBase = ppuState.bgPatternBase;
    const bgBaseHex = bgBase === 0 ? '$0000' : '$1000';

    // CHR pixel data
    const tileData = ppuState.ptTile[bgBase + tileIdx];
    const pix = tileData ? tileData.pix : null;

    // Palette colors
    const palette = this.renderer.paletteManager.getBgPaletteGroup(palGroup);

    // Build content
    let html = '<div class="annot-header">BG Tile</div>';
    html += this._row('NT Address', ntAddr);
    html += this._row('Tile Index', `${tileHex} (${tileIdx})`);
    html += this._row('Position', `col ${col}, row ${row}`);
    html += this._row('Quadrant', `${quadrant} \u2192 phys NT ${physNT}`);
    html += this._row('Pattern Table', bgBaseHex);
    html += this._row('NT Byte', `$${rawTileByte.toString(16).padStart(2, '0')}`);
    html += this._row('Attrib Byte', `$${(rawAttribByte >> 2).toString(16).padStart(2, '0')} (pal ${palGroup})`);
    html += this._chrGrid(pix, palette, 8, 8);
    html += this._paletteSwatches(palGroup, palette);

    this.popover.innerHTML = html;
    this._positionPopover(el);
    this._positionHighlight(el);
  }

  _showSprite(el, ppuState) {
    const idx = parseInt(el.dataset.idx);
    const oamAddr = el.dataset.oamAddr;
    const tileIdx = parseInt(el.dataset.tileIdx);
    const tileHex = el.dataset.tileHex;
    const x = parseInt(el.dataset.x);
    const y = parseInt(el.dataset.y);
    const flipH = el.dataset.flipH === '1';
    const flipV = el.dataset.flipV === '1';
    const priority = el.dataset.priority;
    const palGroup = parseInt(el.dataset.palette);
    const is8x16 = el.classList.contains('sprite-8x16');

    // Raw OAM bytes from PPU state
    const spr = ppuState.sprites[idx];
    const rawAttr = (spr.palette >> 2) | (spr.behindBg ? 0x20 : 0)
      | (spr.flipH ? 0x40 : 0) | (spr.flipV ? 0x80 : 0);
    const oamBytes = [
      spr.y, spr.tileIndex, rawAttr, spr.x
    ];
    const oamHex = oamBytes.map(b => '$' + b.toString(16).padStart(2, '0')).join(' ');

    // Pattern table base
    let sprBase;
    if (is8x16) {
      sprBase = (tileIdx & 1) ? 256 : 0;
    } else {
      sprBase = ppuState.sprPatternBase;
    }
    const sprBaseHex = sprBase === 0 ? '$0000' : '$1000';

    // CHR pixel data
    const palette = this.renderer.paletteManager.getSprPaletteGroup(palGroup);
    let pix, height;
    if (is8x16) {
      const topIdx = tileIdx & 0xFE;
      const botIdx = topIdx + 1;
      const topTile = ppuState.ptTile[sprBase + topIdx];
      const botTile = ppuState.ptTile[sprBase + botIdx];
      pix = new Array(128);
      for (let i = 0; i < 64; i++) pix[i] = topTile ? topTile.pix[i] : 0;
      for (let i = 0; i < 64; i++) pix[64 + i] = botTile ? botTile.pix[i] : 0;
      height = 16;
    } else {
      const tileData = ppuState.ptTile[sprBase + tileIdx];
      pix = tileData ? tileData.pix : null;
      height = 8;
    }

    // Build content
    const sizeLabel = is8x16 ? 'Sprite 8\u00d716' : 'Sprite';
    let html = `<div class="annot-header">${sizeLabel}</div>`;
    html += this._row('OAM Address', oamAddr);
    html += this._row('OAM Index', `${idx}`);
    html += this._row('Tile Index', `${tileHex} (${tileIdx})`);
    html += this._row('Screen Pos', `${x}, ${y}`);
    html += this._row('Flags', `flipH=${flipH ? 'Y' : 'N'} flipV=${flipV ? 'Y' : 'N'} ${priority}`);
    html += this._row('OAM Bytes', oamHex);
    html += this._row('Pattern Table', sprBaseHex);
    html += this._chrGrid(pix, palette, 8, height);
    html += this._paletteSwatches(palGroup, palette);

    this.popover.innerHTML = html;
    this._positionPopover(el);
    this._positionHighlight(el);
  }

  _row(label, value) {
    return `<div class="annot-row"><span class="annot-label">${label}:</span> ${value}</div>`;
  }

  _chrGrid(pix, palette, width, height) {
    if (!pix) return '<div class="annot-row">No CHR data</div>';

    const scale = 6;
    const canvasW = width * scale;
    const canvasH = height * scale;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = py * width + px;
        const pi = pix[i];
        const off = i * 4;

        if (pi === 0) {
          // Transparent — checkerboard
          const checker = ((px + py) & 1) ? 0x40 : 0x30;
          data[off] = checker;
          data[off + 1] = checker;
          data[off + 2] = checker;
          data[off + 3] = 255;
        } else {
          const color = palette[pi];
          const r = parseInt(color.slice(1, 3), 16);
          const g = parseInt(color.slice(3, 5), 16);
          const b = parseInt(color.slice(5, 7), 16);
          data[off] = r;
          data[off + 1] = g;
          data[off + 2] = b;
          data[off + 3] = 255;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    const dataURL = canvas.toDataURL();

    return `<div class="annot-chr-canvas"><img src="${dataURL}" width="${canvasW}" height="${canvasH}" style="image-rendering:pixelated"></div>`;
  }

  _paletteSwatches(group, palette) {
    let html = `<div class="annot-palette-swatches"><span class="annot-label">Palette ${group}:</span>`;
    for (let i = 0; i < 4; i++) {
      const color = palette[i];
      const border = i === 0 ? 'border:1px dashed #888;' : '';
      html += `<span class="annot-swatch" style="background:${color};${border}" title="${color}"></span>`;
    }
    html += '</div>';
    return html;
  }

  _positionPopover(targetEl) {
    this.popover.style.display = '';

    // Get target position relative to viewport
    const vpRect = this.viewport.getBoundingClientRect();
    const elRect = targetEl.getBoundingClientRect();

    // Convert to viewport-local coordinates (account for CSS transform/scale)
    const vpScale = vpRect.width / 256;
    const elLocalLeft = (elRect.left - vpRect.left) / vpScale;
    const elLocalTop = (elRect.top - vpRect.top) / vpScale;
    const elLocalW = elRect.width / vpScale;
    const elLocalH = elRect.height / vpScale;

    // Measure popover
    const popW = this.popover.offsetWidth;
    const popH = this.popover.offsetHeight;

    // Default: right of element
    let left = elLocalLeft + elLocalW + 4;
    let top = elLocalTop;

    // Flip left if overflowing right
    if (left + popW > 256) {
      left = elLocalLeft - popW - 4;
    }

    // Clamp horizontally
    if (left < 0) left = 0;
    if (left + popW > 256) left = 256 - popW;

    // Clamp vertically
    if (top + popH > 240) top = 240 - popH;
    if (top < 0) top = 0;

    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${top}px`;
  }

  _positionHighlight(targetEl) {
    const vpRect = this.viewport.getBoundingClientRect();
    const elRect = targetEl.getBoundingClientRect();
    const vpScale = vpRect.width / 256;

    this.highlight.style.display = '';
    this.highlight.style.left = `${(elRect.left - vpRect.left) / vpScale}px`;
    this.highlight.style.top = `${(elRect.top - vpRect.top) / vpScale}px`;
    this.highlight.style.width = `${elRect.width / vpScale}px`;
    this.highlight.style.height = `${elRect.height / vpScale}px`;
  }
}
