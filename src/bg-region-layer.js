/**
 * Region-based BG compositor. Each region uses an internal BGLayer instance and
 * is clipped to a vertical band. This enables multi-scroll split rendering.
 */
import { BGLayer } from './bg-layer.js';

export class BGRegionLayer {
  constructor(container) {
    this.container = container;
    this.maxRegions = 2;
    this.entries = [];

    this.root = document.createElement('div');
    this.root.className = 'bg-region-layer';
    this.root.dataset.layer = 'background-regions';
    this.root.style.display = 'none';
    container.appendChild(this.root);
  }

  update(ppuState, tileCache, regions) {
    const safeRegions = Array.isArray(regions) ? regions : [];
    const count = Math.min(this.maxRegions, safeRegions.length);

    if (!ppuState.bgVisible || count === 0) {
      this.hide();
      return;
    }

    this.root.style.display = '';
    this.root.dataset.regionCount = String(count);
    this._ensureEntries(count);

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (i >= count) {
        entry.band.style.display = 'none';
        continue;
      }

      const region = safeRegions[i];
      const yStart = _clampInt(region.yStart, 0, 239);
      const yEnd = _clampInt(region.yEnd, yStart + 1, 240);

      entry.band.style.display = '';
      entry.band.style.top = `${yStart}px`;
      entry.band.style.height = `${yEnd - yStart}px`;
      entry.viewport.style.top = `${-yStart}px`;

      const regionState = this._buildRegionState(ppuState, region);
      entry.layer.update(regionState, tileCache);
    }
  }

  hide() {
    this.root.style.display = 'none';
    for (const entry of this.entries) {
      entry.band.style.display = 'none';
    }
  }

  _buildRegionState(ppuState, region) {
    return {
      ...ppuState,
      scroll: region.scroll || ppuState.scroll,
      bgVisible: ppuState.bgVisible && region.bgVisible !== false,
      bgPatternBase: region.bgPatternBase ?? ppuState.bgPatternBase,
      sprPatternBase: region.sprPatternBase ?? ppuState.sprPatternBase,
      spriteSize: region.spriteSize ?? ppuState.spriteSize,
      mirrorMap: region.mirrorMap ?? ppuState.mirrorMap,
      chrBankSignature: region.chrSignature ?? ppuState.chrBankSignature,
      chrSetKey: region.chrSetKey ?? ppuState.chrSetKey,
    };
  }

  _ensureEntries(count) {
    while (this.entries.length < count) {
      const band = document.createElement('div');
      band.className = 'bg-region-band';
      band.style.display = 'none';

      const viewport = document.createElement('div');
      viewport.className = 'bg-region-viewport';
      band.appendChild(viewport);

      this.root.appendChild(band);
      const layer = new BGLayer(viewport);
      this.entries.push({ band, viewport, layer });
    }
  }
}

function _clampInt(value, min, max) {
  const v = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.max(min, Math.min(max, v));
}
