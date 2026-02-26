/**
 * Click-to-inspect annotation popover for paused NES viewport.
 * Shows PPU-level details for BG tiles and sprites: memory addresses,
 * raw bytes, CHR pixel grid, and palette swatches.
 * Shift+click inspects an exact screen pixel and shows composition provenance.
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

    const ppuState = this.getPPUState();
    if (!ppuState) return;

    // Shift+click: inspect exact pixel provenance
    if (e.shiftKey) {
      const pixel = this._eventToViewportPixel(e);
      if (!pixel) {
        this.dismiss();
        return;
      }
      e.stopPropagation();
      this._showPixelProvenance(pixel.x, pixel.y, ppuState);
      return;
    }

    const targetEl = e.target instanceof Element ? e.target : null;
    const bgTile = targetEl ? targetEl.closest('[data-type="bg-tile"]') : null;
    const sprite = targetEl ? targetEl.closest('[data-type="sprite"]') : null;
    const target = bgTile || sprite;

    if (!target) {
      this.dismiss();
      return;
    }

    e.stopPropagation();

    if (bgTile) {
      this._showBgTile(bgTile, ppuState);
    } else {
      this._showSprite(sprite, ppuState);
    }
  }

  _showBgTile(el, ppuState) {
    this.popover.classList.remove('annotation-popover-pixel');

    const col = parseInt(el.dataset.col, 10);
    const row = parseInt(el.dataset.row, 10);
    const quadrant = parseInt(el.dataset.quadrant, 10);
    const tileIdx = parseInt(el.dataset.tileIdx || '0', 10);
    const tileHex = el.dataset.tileHex || '$00';
    const ntAddr = el.dataset.ntAddr;
    const palGroup = parseInt(el.dataset.palette || '0', 10);

    // Physical nametable from parent
    const ntEl = el.closest('.nametable');
    const physNT = ntEl ? parseInt(ntEl.dataset.physNt || '0', 10) : 0;

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
    html += this._row('NT Byte', this._hex(rawTileByte, 2));
    html += this._row('Attrib Byte', `${this._hex(rawAttribByte, 2)} (pal ${palGroup})`);
    html += this._chrGrid(pix, palette, 8, 8);
    html += this._paletteSwatches(palGroup, palette);

    this.popover.innerHTML = html;
    this._positionPopover(el);
    this._positionHighlight(el);
  }

  _showSprite(el, ppuState) {
    this.popover.classList.remove('annotation-popover-pixel');

    const idx = parseInt(el.dataset.idx, 10);
    const oamAddr = el.dataset.oamAddr;
    const tileIdx = parseInt(el.dataset.tileIdx, 10);
    const tileHex = el.dataset.tileHex;
    const x = parseInt(el.dataset.x, 10);
    const y = parseInt(el.dataset.y, 10);
    const flipH = el.dataset.flipH === '1';
    const flipV = el.dataset.flipV === '1';
    const priority = el.dataset.priority;
    const palGroup = parseInt(el.dataset.palette, 10);
    const is8x16 = el.classList.contains('sprite-8x16');

    // Raw OAM bytes from PPU state
    const spr = ppuState.sprites[idx];
    const rawAttr = (spr.palette >> 2)
      | (spr.behindBg ? 0x20 : 0)
      | (spr.flipH ? 0x40 : 0)
      | (spr.flipV ? 0x80 : 0);
    const oamBytes = [spr.y, spr.tileIndex, rawAttr, spr.x];
    const oamHex = oamBytes.map(b => this._hex(b, 2)).join(' ');

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
    let pix;
    let height;
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
    const sizeLabel = is8x16 ? 'Sprite 8x16' : 'Sprite';
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

  _showPixelProvenance(screenX, screenY, ppuState) {
    this.popover.classList.add('annotation-popover-pixel');

    const bg = this._sampleBgPixel(ppuState, screenX, screenY);
    const spriteHits = this._sampleSpritePixels(ppuState, screenX, screenY);
    const final = this._resolveFinalPixel(ppuState, bg, spriteHits);

    const activeScroll = this._scrollForScreenY(ppuState, screenY);
    const { scrollX, scrollY } = this._scrollPixels(activeScroll);
    const bgStatus = ppuState.bgVisible
      ? `ci ${bg.colorIndex}, pal ${bg.palGroup}, ${bg.color}`
      : 'Layer disabled';

    let html = '<div class="annot-header">Pixel Provenance</div>';
    html += this._row('Screen Pixel', `${screenX}, ${screenY}`);
    html += this._row('Scroll', `${scrollX}, ${scrollY}`);
    html += this._row('World Pixel', `${bg.worldX}, ${bg.worldY}`);
    html += this._row(
      'BG Source',
      `LNT ${bg.logicalNT} -> PNT ${bg.physicalNT}, NT ${this._hex(bg.ntAddr, 4)}, tile ${this._hex(bg.tileIndex, 2)}, tile px (${bg.pixelX}, ${bg.pixelY})`
    );
    html += this._row('BG Pixel', bgStatus);
    html += this._row('Sprite Hits', this._formatSpriteHits(spriteHits));
    html += this._row('Winner', `${final.winner} (${final.reason})`);
    html += this._row('Final Color', final.color);

    this.popover.innerHTML = html;
    this._positionPopoverAtBox(screenX, screenY, 1, 1);
    this._positionHighlightAtBox(screenX, screenY, 1, 1);
  }

  _sampleBgPixel(ppuState, screenX, screenY) {
    const activeScroll = this._scrollForScreenY(ppuState, screenY);
    const { scrollX, scrollY } = this._scrollPixels(activeScroll);
    const worldX = (scrollX + screenX) % 512;
    const worldY = (scrollY + screenY) % 480;

    const ntX = worldX >= 256 ? 1 : 0;
    const ntY = worldY >= 240 ? 1 : 0;
    const logicalNT = ntY * 2 + ntX;
    const physicalNT = ppuState.mirrorMap[logicalNT] ?? logicalNT;

    const localX = worldX % 256;
    const localY = worldY % 240;
    const tileCol = localX >> 3;
    const tileRow = localY >> 3;
    const slot = tileRow * 32 + tileCol;

    const nt = ppuState.nameTables[physicalNT];
    const tileIndex = nt && nt.tile ? nt.tile[slot] : 0;
    const rawAttrib = nt && nt.attrib ? nt.attrib[slot] : 0;
    const palGroup = this._decodePaletteGroup(rawAttrib);
    const ntAddr = 0x2000 + physicalNT * 0x400 + slot;

    const pixelX = localX & 7;
    const pixelY = localY & 7;
    const tileData = ppuState.ptTile[ppuState.bgPatternBase + tileIndex];
    const colorIndex = tileData ? tileData.pix[(pixelY << 3) + pixelX] : 0;
    const color = this._bgColorFromState(ppuState, palGroup, colorIndex);

    return {
      worldX,
      worldY,
      logicalNT,
      physicalNT,
      tileCol,
      tileRow,
      tileIndex,
      ntAddr,
      pixelX,
      pixelY,
      palGroup,
      colorIndex,
      color,
    };
  }

  _sampleSpritePixels(ppuState, screenX, screenY) {
    if (!ppuState.spritesVisible) return [];

    const hits = [];
    const sprites = ppuState.sprites;
    const is8x16 = ppuState.spriteSize === 1;
    const height = is8x16 ? 16 : 8;

    for (let i = 0; i < 64; i++) {
      const spr = sprites[i];
      const sprX = spr.x;
      const sprY = spr.y + 1;

      if (sprY >= 240 || sprY + height <= 0) continue;
      if (screenX < sprX || screenX >= sprX + 8) continue;
      if (screenY < sprY || screenY >= sprY + height) continue;

      const localX = screenX - sprX;
      const localY = screenY - sprY;

      const sample = is8x16
        ? this._sample8x16SpritePixel(ppuState, spr, localX, localY)
        : this._sample8x8SpritePixel(ppuState, spr, localX, localY);

      if (!sample || sample.colorIndex === 0) continue;

      const palGroup = this._decodePaletteGroup(spr.palette);
      const color = this._sprColorFromState(ppuState, palGroup, sample.colorIndex);

      hits.push({
        idx: i,
        x: sprX,
        y: sprY,
        behindBg: !!spr.behindBg,
        palGroup,
        color,
        ...sample,
      });
    }

    return hits;
  }

  _sample8x8SpritePixel(ppuState, spr, localX, localY) {
    const tileAddress = ppuState.sprPatternBase + spr.tileIndex;
    const tile = ppuState.ptTile[tileAddress];
    if (!tile) return null;

    const pixelX = spr.flipH ? 7 - localX : localX;
    const pixelY = spr.flipV ? 7 - localY : localY;
    const colorIndex = tile.pix[(pixelY << 3) + pixelX];

    return {
      tileIndex: spr.tileIndex,
      tileAddress,
      pixelX,
      pixelY,
      colorIndex,
    };
  }

  _sample8x16SpritePixel(ppuState, spr, localX, localY) {
    const bankBase = (spr.tileIndex & 1) ? 256 : 0;
    const pairTop = spr.tileIndex & 0xFE;
    const spriteY = spr.flipV ? 15 - localY : localY;
    const tileOffset = spriteY >= 8 ? 1 : 0;
    const tileIndex = pairTop + tileOffset;
    const tileAddress = bankBase + tileIndex;
    const tile = ppuState.ptTile[tileAddress];
    if (!tile) return null;

    const pixelX = spr.flipH ? 7 - localX : localX;
    const pixelY = spriteY & 7;
    const colorIndex = tile.pix[(pixelY << 3) + pixelX];

    return {
      tileIndex,
      tileAddress,
      pixelX,
      pixelY,
      colorIndex,
    };
  }

  _resolveFinalPixel(ppuState, bg, spriteHits) {
    const backdrop = this._bgColorFromState(ppuState, 0, 0);
    const bgOpaque = ppuState.bgVisible && bg.colorIndex > 0;
    const sprite = ppuState.spritesVisible && spriteHits.length > 0 ? spriteHits[0] : null;

    if (sprite) {
      if (!bgOpaque || !sprite.behindBg) {
        return {
          winner: `Sprite #${sprite.idx}`,
          color: sprite.color,
          reason: bgOpaque ? 'Sprite is in front of BG' : 'BG pixel is transparent',
        };
      }

      return {
        winner: 'Background',
        color: bg.color,
        reason: `Sprite #${sprite.idx} is behind opaque BG`,
      };
    }

    if (bgOpaque) {
      return {
        winner: 'Background',
        color: bg.color,
        reason: 'No opaque sprite pixel overlaps',
      };
    }

    return {
      winner: 'Backdrop',
      color: backdrop,
      reason: 'No visible BG or sprite pixel here',
    };
  }

  _formatSpriteHits(spriteHits) {
    if (spriteHits.length === 0) return 'none';

    const maxRows = 4;
    const rows = spriteHits.slice(0, maxRows).map((spr) => {
      const priority = spr.behindBg ? 'behind' : 'front';
      return `#${spr.idx} ${priority}, ci ${spr.colorIndex}, pal ${spr.palGroup}, tile ${this._hex(spr.tileIndex, 2)} @ ${this._hex(spr.tileAddress * 16, 4)}`;
    });

    if (spriteHits.length > maxRows) {
      rows.push(`+${spriteHits.length - maxRows} more`);
    }

    return rows.join('<br>');
  }

  _eventToViewportPixel(e) {
    const vpRect = this.viewport.getBoundingClientRect();
    if (vpRect.width <= 0 || vpRect.height <= 0) return null;

    const scaleX = vpRect.width / 256;
    const scaleY = vpRect.height / 240;
    const x = Math.floor((e.clientX - vpRect.left) / scaleX);
    const y = Math.floor((e.clientY - vpRect.top) / scaleY);

    if (x < 0 || x >= 256 || y < 0 || y >= 240) return null;
    return { x, y };
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

  _scrollPixels(scroll) {
    return {
      scrollX: scroll.coarseX * 8 + scroll.fineX + scroll.nameTableH * 256,
      scrollY: scroll.coarseY * 8 + scroll.fineY + scroll.nameTableV * 240,
    };
  }

  _scrollForScreenY(ppuState, screenY) {
    const regions = ppuState.renderPlan?.regions;
    if (Array.isArray(regions)) {
      for (const region of regions) {
        if (screenY >= region.yStart && screenY < region.yEnd && region.scroll) {
          return region.scroll;
        }
      }
    }
    return ppuState.scroll;
  }

  _decodePaletteGroup(rawValue) {
    const value = Number(rawValue) || 0;
    return value > 3 ? (value >> 2) & 3 : value & 3;
  }

  _bgColorFromState(ppuState, palGroup, colorIndex) {
    if (colorIndex === 0) {
      return this._packedToCss(ppuState.bgPalette[0]);
    }
    const idx = (palGroup << 2) + colorIndex;
    return this._packedToCss(ppuState.bgPalette[idx]);
  }

  _sprColorFromState(ppuState, palGroup, colorIndex) {
    if (colorIndex === 0) return 'transparent';
    const idx = (palGroup << 2) + colorIndex;
    return this._packedToCss(ppuState.sprPalette[idx]);
  }

  _packedToCss(packed) {
    const value = Number(packed) || 0;
    const r = value & 0xff;
    const g = (value >> 8) & 0xff;
    const b = (value >> 16) & 0xff;
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  _hex(value, width) {
    return '$' + (value >>> 0).toString(16).padStart(width, '0');
  }

  _getViewportLocalBox(targetEl) {
    const vpRect = this.viewport.getBoundingClientRect();
    const elRect = targetEl.getBoundingClientRect();
    if (vpRect.width <= 0 || vpRect.height <= 0) return null;

    const scaleX = vpRect.width / 256;
    const scaleY = vpRect.height / 240;
    return {
      left: (elRect.left - vpRect.left) / scaleX,
      top: (elRect.top - vpRect.top) / scaleY,
      width: elRect.width / scaleX,
      height: elRect.height / scaleY,
    };
  }

  _positionPopover(targetEl) {
    const box = this._getViewportLocalBox(targetEl);
    if (!box) return;
    this._positionPopoverAtBox(box.left, box.top, box.width, box.height);
  }

  _positionPopoverAtBox(left, top, width, height) {
    this.popover.style.display = '';

    const popW = this.popover.offsetWidth;
    const popH = this.popover.offsetHeight;

    let x = left + width + 4;
    let y = top;

    if (x + popW > 256) {
      x = left - popW - 4;
    }

    if (x < 0) x = 0;
    if (x + popW > 256) x = 256 - popW;
    if (y + popH > 240) y = 240 - popH;
    if (y < 0) y = 0;

    this.popover.style.left = `${x}px`;
    this.popover.style.top = `${y}px`;
  }

  _positionHighlight(targetEl) {
    const box = this._getViewportLocalBox(targetEl);
    if (!box) return;
    this._positionHighlightAtBox(box.left, box.top, box.width, box.height);
  }

  _positionHighlightAtBox(left, top, width, height) {
    this.highlight.style.display = '';
    this.highlight.style.left = `${left}px`;
    this.highlight.style.top = `${top}px`;
    this.highlight.style.width = `${width}px`;
    this.highlight.style.height = `${height}px`;
  }
}
