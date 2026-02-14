/**
 * Nametable Viewer — renders all 4 nametables as a minimap with scroll overlay.
 * Draws tiles using TileCache spritesheet canvases for accurate rendering.
 */
export class NametableViewer {
  constructor(inspectorEl, renderer) {
    this.renderer = renderer;
    this.visible = false;
    this._frameSkip = 0;

    // Container
    this.container = document.createElement('div');
    this.container.className = 'inspector-subpanel nt-viewer';
    this.container.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'subpanel-header';
    header.textContent = 'Nametables';
    this.container.appendChild(header);

    // Canvas: 512x480 logical, displayed at 256x240
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 480;
    this.canvas.className = 'nt-canvas';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    inspectorEl.appendChild(this.container);
  }

  toggle() {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? '' : 'none';
    return this.visible;
  }

  update(ppuState) {
    if (!this.visible) return;

    // Throttle to ~10fps — 3840 drawImage calls per update is expensive
    if (++this._frameSkip < 6) return;
    this._frameSkip = 0;

    const ctx = this.ctx;
    const tileCache = this.renderer.tileCache;
    const mirror = ppuState.mirrorMap;
    const bgBase = ppuState.bgPatternBase;

    // Clear
    ctx.fillStyle = this.renderer.paletteManager.getBackgroundColor();
    ctx.fillRect(0, 0, 512, 480);

    // Draw each logical nametable quadrant
    // Layout: [0,1] on top row, [2,3] on bottom row
    // Each quadrant is 256x240 (32x30 tiles of 8x8)
    const offsets = [
      [0, 0],     // NT 0: top-left
      [256, 0],   // NT 1: top-right
      [0, 240],   // NT 2: bottom-left
      [256, 240],  // NT 3: bottom-right
    ];

    for (let q = 0; q < 4; q++) {
      const physNT = mirror[q];
      const nt = ppuState.nameTables[physNT];
      if (!nt) continue;

      const [ox, oy] = offsets[q];

      for (let row = 0; row < 30; row++) {
        for (let col = 0; col < 32; col++) {
          const idx = row * 32 + col;
          const tileIndex = nt.tile[idx];
          const palGroup = nt.attrib[idx] >> 2;

          // BG spritesheet canvas index is palGroup (0-3)
          const sheetCanvas = tileCache.canvases[palGroup];

          // Source position on the 128x128 spritesheet
          // Tile index within the BG pattern table (0-255)
          const localTile = tileIndex & 0xff;
          const sx = (localTile & 15) * 8;
          const sy = ((localTile >> 4) & 15) * 8;

          ctx.drawImage(sheetCanvas, sx, sy, 8, 8, ox + col * 8, oy + row * 8, 8, 8);
        }
      }
    }

    // Draw scroll position rectangle
    const s = ppuState.scroll;
    const scrollX = s.coarseX * 8 + s.fineX + s.nameTableH * 256;
    const scrollY = s.coarseY * 8 + s.fineY + s.nameTableV * 240;

    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 2]);

    // The scroll window wraps around
    const w = 256, h = 240;
    const totalW = 512, totalH = 480;

    // Draw the rectangle, handling wrapping
    this._drawWrappedRect(ctx, scrollX, scrollY, w, h, totalW, totalH);

    ctx.setLineDash([]);
  }

  _drawWrappedRect(ctx, x, y, w, h, totalW, totalH) {
    // Simple case: draw all 4 edges as lines that wrap
    const x2 = (x + w) % totalW;
    const y2 = (y + h) % totalH;

    ctx.beginPath();

    // Top edge
    if (x + w <= totalW) {
      ctx.moveTo(x, y % totalH);
      ctx.lineTo(x + w, y % totalH);
    } else {
      ctx.moveTo(x, y % totalH);
      ctx.lineTo(totalW, y % totalH);
      ctx.moveTo(0, y % totalH);
      ctx.lineTo(x2, y % totalH);
    }

    // Bottom edge
    if (x + w <= totalW) {
      ctx.moveTo(x, y2);
      ctx.lineTo(x + w, y2);
    } else {
      ctx.moveTo(x, y2);
      ctx.lineTo(totalW, y2);
      ctx.moveTo(0, y2);
      ctx.lineTo(x2, y2);
    }

    // Left edge
    if (y + h <= totalH) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + h);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x, totalH);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, y2);
    }

    // Right edge
    if (y + h <= totalH) {
      ctx.moveTo(x + w <= totalW ? x + w : x2, y);
      ctx.lineTo(x + w <= totalW ? x + w : x2, y + h);
    } else {
      const rx = x + w <= totalW ? x + w : x2;
      ctx.moveTo(rx, y);
      ctx.lineTo(rx, totalH);
      ctx.moveTo(rx, 0);
      ctx.lineTo(rx, y2);
    }

    ctx.stroke();
  }
}
