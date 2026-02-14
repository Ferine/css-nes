/**
 * CHR Pattern Table Viewer — displays both pattern tables (tiles 0–255 and 256–511)
 * as 128×128 canvases using TileCache spritesheets. Supports palette group selection
 * and BG/SPR palette source toggle.
 */
export class CHRViewer {
  constructor(inspectorEl, renderer) {
    this.renderer = renderer;
    this.visible = false;
    this._palGroup = 0;
    this._useBgPalette = false;
    this._forceRedraw = false;
    this._frameSkip = 0;

    // Container
    this.container = document.createElement('div');
    this.container.className = 'inspector-subpanel chr-viewer';
    this.container.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'subpanel-header';
    header.textContent = 'CHR Pattern Tables';
    this.container.appendChild(header);

    // Controls row
    const controls = document.createElement('div');
    controls.className = 'chr-controls';

    // Palette group buttons (0–3)
    this._palButtons = [];
    for (let i = 0; i < 4; i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      btn.title = `Palette group ${i}`;
      if (i === 0) btn.classList.add('active');
      btn.addEventListener('click', () => this._selectPalGroup(i));
      controls.appendChild(btn);
      this._palButtons.push(btn);
    }

    // BG/SPR toggle
    this._modeBtn = document.createElement('button');
    this._modeBtn.textContent = 'SPR';
    this._modeBtn.title = 'Toggle BG/SPR palette source';
    this._modeBtn.addEventListener('click', () => this._toggleMode());
    controls.appendChild(this._modeBtn);

    this.container.appendChild(controls);

    // Two canvases side-by-side
    const tablesRow = document.createElement('div');
    tablesRow.className = 'chr-tables';

    // Pattern table 0 ($0000, tiles 0–255)
    const col0 = document.createElement('div');
    col0.className = 'chr-table-col';
    const label0 = document.createElement('div');
    label0.className = 'chr-table-label';
    label0.textContent = '$0000';
    this.canvas0 = document.createElement('canvas');
    this.canvas0.width = 128;
    this.canvas0.height = 128;
    this.canvas0.className = 'chr-canvas';
    col0.appendChild(label0);
    col0.appendChild(this.canvas0);
    tablesRow.appendChild(col0);

    // Pattern table 1 ($1000, tiles 256–511)
    const col1 = document.createElement('div');
    col1.className = 'chr-table-col';
    const label1 = document.createElement('div');
    label1.className = 'chr-table-label';
    label1.textContent = '$1000';
    this.canvas1 = document.createElement('canvas');
    this.canvas1.width = 128;
    this.canvas1.height = 128;
    this.canvas1.className = 'chr-canvas';
    col1.appendChild(label1);
    col1.appendChild(this.canvas1);
    tablesRow.appendChild(col1);

    this.container.appendChild(tablesRow);

    this.ctx0 = this.canvas0.getContext('2d');
    this.ctx1 = this.canvas1.getContext('2d');

    // Tooltip for hover
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'chr-tooltip';
    this.tooltip.style.display = 'none';
    this.container.appendChild(this.tooltip);

    // Hover events
    this.canvas0.addEventListener('mousemove', (e) => this._onHover(e, 0));
    this.canvas1.addEventListener('mousemove', (e) => this._onHover(e, 256));
    this.canvas0.addEventListener('mouseleave', () => this._hideTooltip());
    this.canvas1.addEventListener('mouseleave', () => this._hideTooltip());

    inspectorEl.appendChild(this.container);
  }

  toggle() {
    this.visible = !this.visible;
    this.container.style.display = this.visible ? '' : 'none';
    if (this.visible) this._forceRedraw = true;
    return this.visible;
  }

  update(ppuState) {
    if (!this.visible) return;

    // Throttle to every 6 frames unless forced
    if (!this._forceRedraw) {
      if (++this._frameSkip < 6) return;
    }
    this._frameSkip = 0;
    this._forceRedraw = false;

    const tileCache = this.renderer.tileCache;
    const palGroup = this._palGroup;

    let src0, src1;

    if (this._useBgPalette) {
      // BG mode: BG palette canvases are for whichever PT matches bgPatternBase
      // canvases[palGroup] = BG tiles at bgPatternBase
      const bgBase = ppuState.bgPatternBase;
      if (bgBase === 0) {
        // BG covers PT0, use sprite canvases for PT1
        src0 = tileCache.canvases[palGroup];       // BG pal, tiles 0–255
        src1 = tileCache.canvases[8 + palGroup];   // SPR bank1 as fallback for PT1
      } else {
        // BG covers PT1, use sprite canvases for PT0
        src0 = tileCache.canvases[4 + palGroup];   // SPR bank0 as fallback for PT0
        src1 = tileCache.canvases[palGroup];        // BG pal, tiles 256–511
      }
    } else {
      // SPR mode: sprite canvases always cover both banks
      src0 = tileCache.canvases[4 + palGroup];   // SPR bank 0 (tiles 0–255)
      src1 = tileCache.canvases[8 + palGroup];   // SPR bank 1 (tiles 256–511)
    }

    // Single drawImage per canvas — whole 128×128 sheet
    this.ctx0.clearRect(0, 0, 128, 128);
    this.ctx0.drawImage(src0, 0, 0);
    this.ctx1.clearRect(0, 0, 128, 128);
    this.ctx1.drawImage(src1, 0, 0);
  }

  _selectPalGroup(group) {
    this._palGroup = group;
    for (let i = 0; i < 4; i++) {
      this._palButtons[i].classList.toggle('active', i === group);
    }
    this._forceRedraw = true;
  }

  _toggleMode() {
    this._useBgPalette = !this._useBgPalette;
    this._modeBtn.textContent = this._useBgPalette ? 'BG' : 'SPR';
    this._forceRedraw = true;
  }

  _onHover(e, baseIndex) {
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const scaleX = 128 / rect.width;
    const scaleY = 128 / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    const col = Math.floor(px / 8);
    const row = Math.floor(py / 8);
    if (col < 0 || col >= 16 || row < 0 || row >= 16) {
      this._hideTooltip();
      return;
    }

    const tileIndex = row * 16 + col;
    const address = baseIndex + tileIndex;
    const hexAddr = '$' + (address * 16).toString(16).toUpperCase().padStart(4, '0');

    this.tooltip.textContent = `${hexAddr} (#${address})`;
    this.tooltip.style.display = '';
  }

  _hideTooltip() {
    this.tooltip.style.display = 'none';
  }
}
