/**
 * Palette Viewer — displays all 8 palette groups (4 BG + 4 SPR) as color swatches.
 * Highlights groups that changed this frame with a brief flash.
 */
export class PaletteViewer {
  constructor(inspectorEl, renderer) {
    this.renderer = renderer;
    this.visible = false;

    // Container
    this.container = document.createElement('div');
    this.container.className = 'inspector-subpanel palette-viewer';
    this.container.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'subpanel-header';
    header.textContent = 'Palettes';
    this.container.appendChild(header);

    // 8 rows: BG 0-3, SPR 0-3
    this.swatches = [];
    this.rows = [];

    for (let i = 0; i < 8; i++) {
      const row = document.createElement('div');
      row.className = 'pal-row';

      const label = document.createElement('span');
      label.className = 'pal-label';
      label.textContent = i < 4 ? `BG ${i}` : `SPR ${i - 4}`;
      row.appendChild(label);

      const rowSwatches = [];
      for (let j = 0; j < 4; j++) {
        const swatch = document.createElement('div');
        swatch.className = 'pal-swatch';
        row.appendChild(swatch);
        rowSwatches.push(swatch);
      }

      this.swatches.push(rowSwatches);
      this.rows.push(row);
      this.container.appendChild(row);
    }

    inspectorEl.appendChild(this.container);
  }

  toggle() {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? '' : 'none';
    return this.visible;
  }

  update(ppuState) {
    if (!this.visible) return;

    const pm = this.renderer.paletteManager;

    // BG groups 0-3
    for (let g = 0; g < 4; g++) {
      const colors = pm.getBgPaletteGroup(g);
      const dirty = pm.dirtyBgGroups.has(g);
      for (let c = 0; c < 4; c++) {
        this.swatches[g][c].style.backgroundColor = colors[c];
      }
      this.rows[g].classList.toggle('pal-dirty', dirty);
    }

    // SPR groups 0-3
    for (let g = 0; g < 4; g++) {
      const colors = pm.getSprPaletteGroup(g);
      const dirty = pm.dirtySprGroups.has(g);
      for (let c = 0; c < 4; c++) {
        this.swatches[4 + g][c].style.backgroundColor = colors[c];
      }
      this.rows[4 + g].classList.toggle('pal-dirty', dirty);
    }
  }
}
