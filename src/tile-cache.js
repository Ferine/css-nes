/**
 * Generates spritesheet images from pattern table tiles + palette colors.
 *
 * Sprite sheets are global (bank 0 + bank 1), while BG sheets are cached by
 * (bgPatternBase + CHR signature slice) so different render regions can bind
 * different CHR states in the same frame.
 */
export class TileCache {
  constructor(options = {}) {
    // Public canvas slots retained for inspector compatibility.
    // 0-3: active BG set (pal 0-3)
    // 4-7: SPR bank 0 (pal 0-3)
    // 8-11: SPR bank 1 (pal 0-3)
    this.canvases = [];
    this.contexts = [];
    for (let i = 0; i < 12; i++) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      this.canvases.push(c);
      this.contexts.push(c.getContext('2d'));
    }

    this.blobUrls = new Array(12).fill(null);

    this.styleEl = document.createElement('style');
    this.styleEl.id = 'tile-cache-styles';
    document.head.appendChild(this.styleEl);

    this.tileChecksums = new Uint32Array(512);
    this.prevBankRefs = new Array(8).fill(0);

    // Legacy numeric update markers (0-3 BG groups, 4-11 sprite sheets).
    this.updatedSheets = new Set();

    this.bgSets = new Map();
    this.maxBgSets = Math.max(1, options.maxBgSets ?? 12);
    this._bgSetSeq = 1;
    this._frameSeq = 0;

    this.activeBgSetId = 0;
    this.activeBgKey = null;

    this._updatedBgSetGroups = new Map();

    this._sigRefIds = new WeakMap();
    this._nextSigRefId = 1;

    this._lastPtTile = null;
    this._lastPaletteManager = null;

    this.prevBgBase = -1;
    this._prevSpriteSignature = null;
    this._consecRegenFrames = 0;
  }

  /**
   * @param {object[]} ptTile
   * @param {PaletteManager} paletteManager
   * @param {number} bgBase
   * @param {number} sprBase
   * @param {Array} chrBankSignature
   * @param {Array} chrStateCatalog - optional [{ key, bgBase, signature[4], tiles[256] }]
   * @param {Array|null} spriteChrSignature - optional 8-region signature for sprite sheets
   */
  update(
    ptTile,
    paletteManager,
    bgBase,
    sprBase,
    chrBankSignature,
    chrStateCatalog = [],
    spriteChrSignature = null
  ) {
    this._frameSeq++;
    this.updatedSheets.clear();
    this._updatedBgSetGroups.clear();
    this._lastPtTile = ptTile;
    this._lastPaletteManager = paletteManager;

    const normalizedBgBase = bgBase >= 256 ? 256 : 0;
    const bgBaseChanged = normalizedBgBase !== this.prevBgBase;
    this.prevBgBase = normalizedBgBase;

    let bgBankDirty = false;
    let sprBank0Dirty = false;
    let sprBank1Dirty = false;
    const currentSignature = this._normalizeFullSignature(chrBankSignature);
    if (Array.isArray(chrBankSignature) && chrBankSignature.length >= 8) {
      bgBankDirty = this._checkBankDirty(chrBankSignature, normalizedBgBase);
      sprBank0Dirty = this._checkBankDirty(chrBankSignature, 0);
      sprBank1Dirty = this._checkBankDirty(chrBankSignature, 256);
      this._updateBankRefs(chrBankSignature);
    }

    const { pt0Dirty: chrDirtyPT0, pt1Dirty: chrDirtyPT1 } = this._checkCHRDirty(ptTile);

    // CHR-RAM writes mutate tile pixels in place; drop affected BG set caches.
    if (chrDirtyPT0) this._invalidateBgSetsForPT(0);
    if (chrDirtyPT1) this._invalidateBgSetsForPT(1);

    // Prime BG states captured by tracer so region keys can render historical CHR states.
    if (Array.isArray(chrStateCatalog) && chrStateCatalog.length > 0) {
      this._primeBgSetsFromCatalog(chrStateCatalog, paletteManager);
    }

    const { set: activeSet, isNew: activeSetNew } = this._ensureBgSet(normalizedBgBase, chrBankSignature);
    if (activeSet && !activeSet.tileSlice) {
      activeSet.tileSlice = this._slicePT(ptTile, normalizedBgBase);
    }

    const bgPTIndex = normalizedBgBase >= 256 ? 1 : 0;
    const activeBgChrDirty = bgBankDirty || (bgPTIndex === 0 ? chrDirtyPT0 : chrDirtyPT1);
    const skipPaletteSetIds = new Set();

    if (activeSet && (activeSetNew || activeBgChrDirty || bgBaseChanged)) {
      // Refresh active set from current frame-end PT mapping.
      activeSet.tileSlice = this._slicePT(ptTile, normalizedBgBase);
      this._renderAllBgGroups(activeSet, paletteManager);
      skipPaletteSetIds.add(activeSet.id);
    }

    this._renderDirtyPaletteGroupsAcrossBgSets(paletteManager, skipPaletteSetIds);

    // Sprite sheets are global, but we can target a specific CHR signature
    // (typically the gameplay region signature) when timing data is available.
    const targetSpriteSignature = this._normalizeFullSignature(
      Array.isArray(spriteChrSignature) && spriteChrSignature.length >= 8
        ? spriteChrSignature
        : currentSignature
    );
    const spriteBank0SigChanged = this._signatureSliceChanged(this._prevSpriteSignature, targetSpriteSignature, 0);
    const spriteBank1SigChanged = this._signatureSliceChanged(this._prevSpriteSignature, targetSpriteSignature, 4);
    this._prevSpriteSignature = this._cloneFullSignature(targetSpriteSignature);

    const spriteBank0Tiles = this._resolveSpriteBankTiles(
      0,
      targetSpriteSignature,
      currentSignature,
      ptTile,
      chrStateCatalog
    );
    const spriteBank1Tiles = this._resolveSpriteBankTiles(
      256,
      targetSpriteSignature,
      currentSignature,
      ptTile,
      chrStateCatalog
    );

    const spr0Dirty = sprBank0Dirty || chrDirtyPT0 || spriteBank0SigChanged;
    const spr1Dirty = sprBank1Dirty || chrDirtyPT1 || spriteBank1SigChanged;

    for (let palGroup = 0; palGroup < 4; palGroup++) {
      if (paletteManager.dirtySprGroups.has(palGroup) || spr0Dirty) {
        const colors = paletteManager.getSprPaletteGroup(palGroup);
        this._renderSpriteSheetFromSlice(4 + palGroup, spriteBank0Tiles, colors);
        this.updatedSheets.add(4 + palGroup);
      }
    }

    for (let palGroup = 0; palGroup < 4; palGroup++) {
      if (paletteManager.dirtySprGroups.has(palGroup) || spr1Dirty) {
        const colors = paletteManager.getSprPaletteGroup(palGroup);
        this._renderSpriteSheetFromSlice(8 + palGroup, spriteBank1Tiles, colors);
        this.updatedSheets.add(8 + palGroup);
      }
    }

    if (this.updatedSheets.size > 0) {
      this._updateStylesheet();
    }

    if (this.updatedSheets.size === 12) {
      this._consecRegenFrames++;
      if (this._consecRegenFrames === 60) {
        console.warn(
          'TileCache: all 12 logical sheets regenerated every frame for 60 consecutive frames. '
          + 'Expected in heavy bank-switch scenes, but expensive.'
        );
      }
    } else {
      this._consecRegenFrames = 0;
    }
  }

  /**
   * Activate/select BG set for a region.
   * @param {number} bgBase
   * @param {Array} chrBankSignature
   * @param {string|null} explicitKey
   */
  activateBgSet(bgBase, chrBankSignature, explicitKey = null) {
    const normalizedBgBase = bgBase >= 256 ? 256 : 0;

    let set = null;
    let isNew = false;

    if (explicitKey && this.bgSets.has(explicitKey)) {
      set = this.bgSets.get(explicitKey);
      set.lastUsedFrame = this._frameSeq;
    } else {
      const ensured = this._ensureBgSet(normalizedBgBase, chrBankSignature, explicitKey);
      set = ensured.set;
      isNew = ensured.isNew;
    }

    if (!set) return '';

    if (!set.tileSlice) {
      set.tileSlice = this._slicePT(this._lastPtTile, set.bgBase);
    }

    if (set.tileSlice && this._lastPaletteManager) {
      if (isNew || this._setNeedsImages(set)) {
        this._renderAllBgGroups(set, this._lastPaletteManager);
      }
    }

    this.activeBgSetId = set.id;
    this.activeBgKey = set.key;
    this._syncActiveBgSetCanvases(set);

    if (this.updatedSheets.size > 0) {
      this._updateStylesheet();
    }

    return `bg-set-${set.id}`;
  }

  getTilePosition(index) {
    const col = index & 15;
    const row = (index >> 4) & 15;
    return `-${col * 8}px -${row * 8}px`;
  }

  bgSheetUpdated(palGroup, setId = this.activeBgSetId) {
    const groups = this._updatedBgSetGroups.get(setId);
    return !!groups && groups.has(palGroup);
  }

  sprSheetUpdated(palGroup) {
    return this.updatedSheets.has(4 + palGroup) || this.updatedSheets.has(8 + palGroup);
  }

  _primeBgSetsFromCatalog(chrStateCatalog, paletteManager) {
    for (const state of chrStateCatalog) {
      const bgBase = state?.bgBase >= 256 ? 256 : 0;
      const signature = this._normalizeSignatureSlice(state?.signature);
      const key = state?.key || this._buildBgSetKeyFromSlice(bgBase, signature);
      if (!Array.isArray(state?.tiles) || state.tiles.length < 256) continue;

      const { set, isNew } = this._getOrCreateBgSet(bgBase, key, signature);
      if (isNew || !set.tileSlice) {
        set.tileSlice = state.tiles.slice(0, 256);
      }
      set.lastUsedFrame = this._frameSeq;

      if (isNew || this._setNeedsImages(set)) {
        this._renderAllBgGroups(set, paletteManager);
      }
    }
  }

  _renderDirtyPaletteGroupsAcrossBgSets(paletteManager, skipSetIds) {
    if (!paletteManager.dirtyBgGroups || paletteManager.dirtyBgGroups.size === 0) return;

    for (const set of this.bgSets.values()) {
      if (skipSetIds && skipSetIds.has(set.id)) continue;
      for (const palGroup of paletteManager.dirtyBgGroups) {
        this._renderBgGroup(set, palGroup, paletteManager);
      }
    }
  }

  _renderAllBgGroups(set, paletteManager) {
    for (let palGroup = 0; palGroup < 4; palGroup++) {
      this._renderBgGroup(set, palGroup, paletteManager);
    }
  }

  _renderBgGroup(set, palGroup, paletteManager) {
    const tiles = set.tileSlice || this._slicePT(this._lastPtTile, set.bgBase);
    if (!tiles) return;

    const colors = paletteManager.getBgPaletteGroup(palGroup);
    set.urls[palGroup] = this._renderTilesToSheetSlice(set.canvases[palGroup], set.contexts[palGroup], tiles, colors);
    set.lastUsedFrame = this._frameSeq;

    let groups = this._updatedBgSetGroups.get(set.id);
    if (!groups) {
      groups = new Set();
      this._updatedBgSetGroups.set(set.id, groups);
    }
    groups.add(palGroup);

    this.updatedSheets.add(palGroup);

    if (set.id === this.activeBgSetId) {
      this._syncActiveBgSetCanvases(set);
    }
  }

  _renderSpriteSheet(sheetIndex, ptTile, base, colors) {
    const canvas = this.canvases[sheetIndex];
    const ctx = this.contexts[sheetIndex];
    this.blobUrls[sheetIndex] = this._renderTilesToSheetRange(canvas, ctx, ptTile, base, colors);
  }

  _renderSpriteSheetFromSlice(sheetIndex, tileSlice, colors) {
    const canvas = this.canvases[sheetIndex];
    const ctx = this.contexts[sheetIndex];
    this.blobUrls[sheetIndex] = this._renderTilesToSheetSlice(canvas, ctx, tileSlice, colors);
  }

  _renderTilesToSheetRange(canvas, ctx, ptTile, base, colors) {
    const slice = new Array(256);
    for (let i = 0; i < 256; i++) {
      slice[i] = ptTile[base + i];
    }
    return this._renderTilesToSheetSlice(canvas, ctx, slice, colors);
  }

  _renderTilesToSheetSlice(canvas, ctx, tileSlice, colors) {
    const imgData = ctx.createImageData(128, 128);
    const data = imgData.data;

    const rgb = colors.map((c) => {
      const v = parseInt(c.slice(1), 16);
      return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    });

    for (let tileIdx = 0; tileIdx < 256; tileIdx++) {
      const tile = tileSlice[tileIdx];
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
    return canvas.toDataURL('image/png');
  }

  _ensureBgSet(bgBase, chrBankSignature, explicitKey = null) {
    const signature = this._extractBgChrRefs(bgBase, chrBankSignature);
    const key = explicitKey || this._buildBgSetKeyFromSlice(bgBase, signature);
    const result = this._getOrCreateBgSet(bgBase, key, signature);

    this.activeBgSetId = result.set.id;
    this.activeBgKey = result.set.key;

    return result;
  }

  _getOrCreateBgSet(bgBase, key, signature) {
    let set = this.bgSets.get(key);
    let isNew = false;

    if (!set) {
      set = this._createBgSetRecord(key, bgBase, signature);
      this.bgSets.set(key, set);
      isNew = true;
      this._evictBgSetsIfNeeded(key);
    }

    set.lastUsedFrame = this._frameSeq;
    return { set, isNew };
  }

  _createBgSetRecord(key, bgBase, signature) {
    const canvases = new Array(4);
    const contexts = new Array(4);
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      canvases[i] = c;
      contexts[i] = c.getContext('2d');
    }

    return {
      id: this._bgSetSeq++,
      key,
      bgBase,
      signature: signature.slice(0, 4),
      tileSlice: null,
      canvases,
      contexts,
      urls: [null, null, null, null],
      lastUsedFrame: this._frameSeq,
    };
  }

  _setNeedsImages(set) {
    return !set.urls[0] || !set.urls[1] || !set.urls[2] || !set.urls[3];
  }

  _slicePT(ptTile, bgBase) {
    if (!Array.isArray(ptTile) || ptTile.length < 512) return null;
    const start = bgBase >= 256 ? 256 : 0;
    const out = new Array(256);
    for (let i = 0; i < 256; i++) {
      out[i] = ptTile[start + i];
    }
    return out;
  }

  _syncActiveBgSetCanvases(set) {
    for (let i = 0; i < 4; i++) {
      this.canvases[i] = set.canvases[i];
      this.contexts[i] = set.contexts[i];
      this.blobUrls[i] = set.urls[i];
    }
  }

  _evictBgSetsIfNeeded(preferredKey) {
    while (this.bgSets.size > this.maxBgSets) {
      let oldestKey = null;
      let oldestFrame = Infinity;

      for (const [key, set] of this.bgSets) {
        if (key === preferredKey) continue;
        if (set.lastUsedFrame < oldestFrame) {
          oldestFrame = set.lastUsedFrame;
          oldestKey = key;
        }
      }

      if (!oldestKey) break;
      this.bgSets.delete(oldestKey);

      if (this.activeBgKey === oldestKey) {
        this.activeBgKey = null;
        this.activeBgSetId = 0;
      }
    }
  }

  _invalidateBgSetsForPT(ptIndex) {
    const targetBase = ptIndex === 0 ? 0 : 256;
    for (const [key, set] of this.bgSets) {
      if (set.bgBase !== targetBase) continue;
      this.bgSets.delete(key);
      if (this.activeBgKey === key) {
        this.activeBgKey = null;
        this.activeBgSetId = 0;
      }
    }
  }

  _buildBgSetKeyFromSlice(bgBase, signatureSlice) {
    const norm = this._normalizeSignatureSlice(signatureSlice);
    const tokens = norm.map((entry) => this._signatureEntryToken(entry));
    return `${bgBase >= 256 ? 256 : 0}:${tokens.join(',')}`;
  }

  _extractBgChrRefs(bgBase, chrBankSignature) {
    const start = bgBase >= 256 ? 4 : 0;
    if (!Array.isArray(chrBankSignature) || chrBankSignature.length < start + 4) {
      return [0, 0, 0, 0];
    }
    return this._normalizeSignatureSlice([
      chrBankSignature[start + 0] ?? 0,
      chrBankSignature[start + 1] ?? 0,
      chrBankSignature[start + 2] ?? 0,
      chrBankSignature[start + 3] ?? 0,
    ]);
  }

  _normalizeSignatureSlice(signatureSlice) {
    const out = [0, 0, 0, 0];
    if (!Array.isArray(signatureSlice)) return out;
    for (let i = 0; i < 4; i++) {
      const entry = signatureSlice[i];
      out[i] = Array.isArray(entry)
        ? [entry[0] ?? null, entry[1] ?? null, entry[2] ?? null, entry[3] ?? null]
        : (entry ?? 0);
    }
    return out;
  }

  _normalizeFullSignature(signature) {
    const out = new Array(8);
    for (let i = 0; i < 8; i++) {
      const entry = Array.isArray(signature) ? signature[i] : null;
      out[i] = Array.isArray(entry)
        ? [entry[0] ?? null, entry[1] ?? null, entry[2] ?? null, entry[3] ?? null]
        : (entry ?? 0);
    }
    return out;
  }

  _cloneFullSignature(signature) {
    if (!Array.isArray(signature)) return null;
    const out = new Array(8);
    for (let i = 0; i < 8; i++) {
      const entry = signature[i];
      out[i] = Array.isArray(entry)
        ? [entry[0] ?? null, entry[1] ?? null, entry[2] ?? null, entry[3] ?? null]
        : (entry ?? 0);
    }
    return out;
  }

  _signatureSliceChanged(prev, next, start) {
    if (!Array.isArray(next) || next.length < start + 4) return true;
    if (!Array.isArray(prev) || prev.length < start + 4) return true;
    for (let i = 0; i < 4; i++) {
      if (!this._sameSignatureEntry(prev[start + i], next[start + i])) return true;
    }
    return false;
  }

  _signatureSliceEquals(a, b, start) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length < start + 4 || b.length < start + 4) return false;
    for (let i = 0; i < 4; i++) {
      if (!this._sameSignatureEntry(a[start + i], b[start + i])) return false;
    }
    return true;
  }

  _resolveSpriteBankTiles(ptBase, targetSignature, currentSignature, ptTile, chrStateCatalog) {
    const start = ptBase >= 256 ? 4 : 0;
    if (this._signatureSliceEquals(targetSignature, currentSignature, start)) {
      return this._slicePT(ptTile, ptBase);
    }

    const fromCatalog = this._lookupCatalogTiles(ptBase, targetSignature, chrStateCatalog);
    if (fromCatalog) return fromCatalog;

    // Fallback to current frame mapping when historical state isn't available.
    return this._slicePT(ptTile, ptBase);
  }

  _lookupCatalogTiles(bgBase, fullSignature, chrStateCatalog) {
    if (!Array.isArray(chrStateCatalog) || chrStateCatalog.length === 0) return null;

    const key = this._buildCatalogKey(bgBase, fullSignature);
    for (const state of chrStateCatalog) {
      if (!Array.isArray(state?.tiles) || state.tiles.length < 256) continue;
      if (state.key === key) return state.tiles.slice(0, 256);
    }

    const targetBase = bgBase >= 256 ? 256 : 0;
    const expected = this._extractSignatureSliceFromFull(fullSignature, targetBase);
    for (const state of chrStateCatalog) {
      if (!Array.isArray(state?.tiles) || state.tiles.length < 256) continue;
      if ((state.bgBase >= 256 ? 256 : 0) !== targetBase) continue;
      const sig = this._normalizeSignatureSlice(state.signature);
      if (
        this._sameSignatureEntry(sig[0], expected[0]) &&
        this._sameSignatureEntry(sig[1], expected[1]) &&
        this._sameSignatureEntry(sig[2], expected[2]) &&
        this._sameSignatureEntry(sig[3], expected[3])
      ) {
        return state.tiles.slice(0, 256);
      }
    }

    return null;
  }

  _buildCatalogKey(bgBase, fullSignature) {
    const base = bgBase >= 256 ? 256 : 0;
    const slice = this._extractSignatureSliceFromFull(fullSignature, base);
    const tokens = slice.map((entry) => this._signatureScalar(entry));
    return `${base}:${tokens.join(',')}`;
  }

  _extractSignatureSliceFromFull(fullSignature, bgBase) {
    const start = bgBase >= 256 ? 4 : 0;
    return this._normalizeSignatureSlice([
      fullSignature?.[start + 0] ?? 0,
      fullSignature?.[start + 1] ?? 0,
      fullSignature?.[start + 2] ?? 0,
      fullSignature?.[start + 3] ?? 0,
    ]);
  }

  _signatureScalar(entry) {
    if (Array.isArray(entry)) return entry[0] ?? 0;
    return entry ?? 0;
  }

  _signatureEntryToken(entry) {
    if (!Array.isArray(entry)) return this._valueToken(entry);
    return [
      this._valueToken(entry[0]),
      this._valueToken(entry[1]),
      this._valueToken(entry[2]),
      this._valueToken(entry[3]),
    ].join('.');
  }

  _valueToken(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
      return String(value ?? 0);
    }
    let id = this._sigRefIds.get(value);
    if (!id) {
      id = this._nextSigRefId++;
      this._sigRefIds.set(value, id);
    }
    return `o${id}`;
  }

  _checkBankDirty(chrBankSignature, ptBase) {
    const startRegion = ptBase >= 256 ? 4 : 0;
    for (let i = 0; i < 4; i++) {
      if (!this._sameSignatureEntry(chrBankSignature[startRegion + i], this.prevBankRefs[startRegion + i])) {
        return true;
      }
    }
    return false;
  }

  _updateBankRefs(chrBankSignature) {
    for (let i = 0; i < 8; i++) {
      const entry = chrBankSignature[i];
      if (!Array.isArray(entry)) {
        this.prevBankRefs[i] = entry ?? 0;
      } else {
        this.prevBankRefs[i] = [
          entry[0] ?? null,
          entry[1] ?? null,
          entry[2] ?? null,
          entry[3] ?? null,
        ];
      }
    }
  }

  _sameSignatureEntry(a, b) {
    if (!Array.isArray(a) && !Array.isArray(b)) return a === b;
    if (!Array.isArray(a)) a = [a ?? null, null, null, null];
    if (!Array.isArray(b)) b = [b ?? null, null, null, null];
    return (
      a[0] === b[0] &&
      a[1] === b[1] &&
      a[2] === b[2] &&
      a[3] === b[3]
    );
  }

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

  _hashPix(pix) {
    let h = 0x811c9dc5;
    for (let i = 0; i < 64; i++) {
      h ^= pix[i];
      h = (h * 0x01000193) | 0;
    }
    return h >>> 0;
  }

  _updateStylesheet() {
    let css = '';

    for (const set of this.bgSets.values()) {
      for (let palGroup = 0; palGroup < 4; palGroup++) {
        const url = set.urls[palGroup];
        if (!url) continue;
        css += `.bg-set-${set.id} .bg-pal-${palGroup} { background-image: url("${url}"); }\n`;
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
}
