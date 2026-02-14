/**
 * OAM Viewer — displays OAM table (64 sprites) with hover-to-highlight.
 * Shows tile index, position, palette group, and flip/priority flags.
 */
export class OAMViewer {
  constructor(inspectorEl, renderer) {
    this.renderer = renderer;
    this.visible = false;
    this._highlightedIdx = -1;

    // Container
    this.container = document.createElement('div');
    this.container.className = 'inspector-subpanel oam-viewer';
    this.container.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'subpanel-header';
    header.textContent = 'OAM Sprites';
    this.container.appendChild(header);

    // Table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'oam-table-wrap';

    const table = document.createElement('table');
    table.className = 'oam-table';

    // Header row
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const h of ['#', 'Tile', 'X', 'Y', 'Pal', 'Flags']) {
      const th = document.createElement('th');
      th.textContent = h;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    // 64 body rows
    const tbody = document.createElement('tbody');
    this.rowEls = [];
    this.cells = [];

    for (let i = 0; i < 64; i++) {
      const tr = document.createElement('tr');
      tr.dataset.sprIdx = i;

      const cellData = [];
      // # column
      const tdIdx = document.createElement('td');
      tdIdx.textContent = i;
      tr.appendChild(tdIdx);
      cellData.push(tdIdx);

      // Tile, X, Y, Pal, Flags
      for (let c = 0; c < 5; c++) {
        const td = document.createElement('td');
        tr.appendChild(td);
        cellData.push(td);
      }

      // Hover interactions
      tr.addEventListener('mouseenter', () => this._onHover(i));
      tr.addEventListener('mouseleave', () => this._onUnhover(i));

      this.rowEls.push(tr);
      this.cells.push(cellData);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    this.container.appendChild(tableWrap);
    inspectorEl.appendChild(this.container);
  }

  toggle() {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? '' : 'none';
    if (!this.visible) this._clearHighlight();
    return this.visible;
  }

  update(ppuState) {
    if (!this.visible) return;

    const sprites = ppuState.sprites;
    const is8x16 = ppuState.spriteSize === 1;

    for (let i = 0; i < 64; i++) {
      const spr = sprites[i];
      const cells = this.cells[i];
      const row = this.rowEls[i];

      // Tile as hex
      cells[1].textContent = '$' + spr.tileIndex.toString(16).toUpperCase().padStart(2, '0');
      cells[2].textContent = spr.x;
      cells[3].textContent = spr.y;
      cells[4].textContent = spr.palette >> 2; // convert 0/4/8/12 to 0-3

      // Flags
      const flags = [];
      if (spr.flipH) flags.push('H');
      if (spr.flipV) flags.push('V');
      if (spr.behindBg) flags.push('B');
      cells[5].textContent = flags.join('') || '-';

      // Dim off-screen sprites
      const offscreen = spr.y >= 239 || spr.y === 0;
      row.classList.toggle('oam-offscreen', offscreen);
    }
  }

  _onHover(idx) {
    this._clearHighlight();
    this._highlightedIdx = idx;

    // Find the sprite element in the viewport
    const spriteLayer = this.renderer.spriteLayer.spriteLayer;
    const el = spriteLayer.querySelector(`[data-idx="${idx}"]`);
    if (el) el.classList.add('oam-highlight');
  }

  _onUnhover(idx) {
    this._clearHighlight();
  }

  _clearHighlight() {
    if (this._highlightedIdx >= 0) {
      const spriteLayer = this.renderer.spriteLayer.spriteLayer;
      const el = spriteLayer.querySelector('.oam-highlight');
      if (el) el.classList.remove('oam-highlight');
      this._highlightedIdx = -1;
    }
  }
}
