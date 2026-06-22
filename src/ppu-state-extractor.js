/**
 * Extracts a clean snapshot of PPU state from jsnes internals.
 * All reads are from public properties on nes.ppu — no jsnes modifications needed.
 */
import { buildScanlineState } from './scanline-state-builder.js';
import { planScrollRegions } from './scroll-region-planner.js';

export class PPUStateExtractor {
  constructor(nes) {
    this.nes = nes;
    this._tileRefIds = new WeakMap();
    this._nextTileRefId = 1;
  }

  extract(options = {}) {
    const ppu = this.nes.ppu;
    const mirrorMap = [ppu.ntable1[0], ppu.ntable1[1], ppu.ntable1[2], ppu.ntable1[3]];
    const chrBankSignature = this._extractCHRBankSignature(ppu);
    const includeCanonicalRegions = options.includeCanonicalRegions !== false;
    const scroll = {
      coarseX: ppu.regHT,
      coarseY: ppu.regVT,
      fineX: ppu.regFH,
      fineY: ppu.regFV,
      nameTableH: ppu.regH,
      nameTableV: ppu.regV,
    };
    const bgPatternBase = ppu.f_bgPatternTable === 0 ? 0 : 256;
    const sprPatternBase = ppu.f_spPatternTable === 0 ? 0 : 256;
    const spriteSize = ppu.f_spriteSize; // 0=8x8, 1=8x16
    const bgVisible = ppu.f_bgVisibility === 1;
    const spritesVisible = ppu.f_spVisibility === 1;
    const chrStateCatalog = this._extractCHRStateCatalog(options.timingTrace?.chrStates);

    const renderPlan = this._buildRenderPlan(options.timingTrace, {
      scroll,
      bgVisible,
      spritesVisible,
      bgPatternBase,
      sprPatternBase,
      spriteSize,
      mirrorMap,
      chrSignature: chrBankSignature,
    }, {
      includeCanonicalRegions,
      chrStateCatalog,
    });

    return {
      // Palettes — 16 entries each, packed 0xBBGGRR (jsnes Uint32 canvas-LE format)
      bgPalette: ppu.imgPalette.slice(0, 16),
      sprPalette: ppu.sprPalette.slice(0, 16),

      // Nametables — tile indices and attributes for each physical nametable
      nameTables: this._extractNameTables(ppu),

      // Mirroring map — logical quadrant → physical nametable index
      mirrorMap,

      // Pattern table tile data (reference, not copy — tiles are Tile objects with .pix arrays)
      ptTile: ppu.ptTile,

      // Sprites — 64 entries
      sprites: this._extractSprites(ppu),

      // Scroll state — use reg* variants (cnt* are mutated during rendering)
      scroll,

      // Control flags
      bgPatternBase,
      sprPatternBase,
      spriteSize,
      bgVisible,
      spritesVisible,

      // Sprite 0 hit (for future scroll split detection)
      spr0HitY: ppu.spr0HitY,

      // Regionized render plan (single region fallback when no timing data)
      renderPlan,

      // Catalog of captured BG CHR states keyed by signature/base.
      chrStateCatalog,

      // CHR bank signature — sampled Tile object refs per 1KB CHR region.
      // Each region entry stores multiple refs to reduce aliasing between banks
      // that share a single leading tile.
      chrBankSignature,

      // Framebuffer reference for canvas comparison
      buffer: ppu.buffer,
    };
  }

  _buildRenderPlan(timingTrace, fallbackState, options = {}) {
    const includeCanonicalRegions = options.includeCanonicalRegions !== false;
    const chrStateCatalog = Array.isArray(options.chrStateCatalog) ? options.chrStateCatalog : [];
    const events = Array.isArray(timingTrace?.events) ? timingTrace.events : [];
    const scanlineModel = buildScanlineState(timingTrace, fallbackState, {
      includeMapperWrites: true,
      mapperApplyWithinScanline: true,
    });
    const regionsRaw = planScrollRegions(scanlineModel, fallbackState, {
      maxRegions: 2,
      minRegionHeight: 6,
    });
    const canonicalRegionsRaw = includeCanonicalRegions
      ? planScrollRegions(scanlineModel, fallbackState, {
        compress: false,
        minRegionHeight: 1,
        maxRegions: 240,
      })
      : regionsRaw;
    const canonicalRegions = canonicalRegionsRaw.map((region) => ({
      ...region,
      chrSetKey: this._buildChrSetKey(region.bgPatternBase, region.chrSignature),
    }));
    const regions = regionsRaw.map((region) => ({
      ...region,
      chrSetKey: this._buildChrSetKey(region.bgPatternBase, region.chrSignature),
    }));
    const eventCount = events.length;

    return {
      mode: regions.length > 1 ? 'region' : 'single',
      source: eventCount > 0 ? 'timing-trace' : 'snapshot',
      eventCount,
      splitCount: Math.max(0, regions.length - 1),
      canonicalSplitCount: Math.max(0, canonicalRegions.length - 1),
      canonicalRegionCount: canonicalRegions.length,
      canonicalRegions,
      scanlineModel,
      chrStateKeys: chrStateCatalog.map((state) => state.key),
      regions,
    };
  }

  _buildChrSetKey(bgBase, chrSignature) {
    const base = bgBase >= 256 ? 256 : 0;
    const start = base >= 256 ? 4 : 0;
    const sig = new Array(4);
    for (let i = 0; i < 4; i++) {
      const entry = chrSignature?.[start + i];
      sig[i] = Array.isArray(entry) ? (entry[0] ?? 0) : (entry ?? 0);
    }
    return `${base}:${sig.join(',')}`;
  }

  _extractCHRStateCatalog(chrStates) {
    if (!Array.isArray(chrStates)) return [];

    const out = [];
    for (const state of chrStates) {
      const bgBase = state?.bgBase >= 256 ? 256 : 0;
      const signature = Array.isArray(state?.signature)
        ? [
          state.signature[0] ?? 0,
          state.signature[1] ?? 0,
          state.signature[2] ?? 0,
          state.signature[3] ?? 0,
        ]
        : [0, 0, 0, 0];
      const key = state?.key || `${bgBase}:${signature.join(',')}`;
      if (!Array.isArray(state?.tiles) || state.tiles.length < 256) continue;

      out.push({
        key,
        bgBase,
        signature,
        tiles: state.tiles.slice(0, 256),
      });
    }

    return out;
  }

  _extractNameTables(ppu) {
    const nts = [];
    for (let i = 0; i < 4; i++) {
      const nt = ppu.nameTable[i];
      if (nt) {
        nts.push({
          tile: nt.tile,     // Array(1024) — tile indices
          attrib: nt.attrib, // Array(1024) — palette attribute per tile
        });
      } else {
        nts.push(null);
      }
    }
    return nts;
  }

  /**
   * Compute a stable numeric signature per 1KB CHR region using object-identity
   * IDs for all 64 tiles in the region (FNV-1a style fold).
   */
  _extractCHRBankSignature(ppu) {
    const refs = new Array(8);
    for (let i = 0; i < 8; i++) {
      const base = i * 64;
      let h = 0x811c9dc5;
      for (let j = 0; j < 64; j++) {
        const id = this._tileRefId(ppu.ptTile[base + j]);
        h ^= id;
        h = Math.imul(h, 0x01000193);
      }
      refs[i] = h >>> 0;
    }
    return refs;
  }

  _tileRefId(tile) {
    if (!tile || (typeof tile !== 'object' && typeof tile !== 'function')) return 0;
    let id = this._tileRefIds.get(tile);
    if (!id) {
      id = this._nextTileRefId++;
      this._tileRefIds.set(tile, id);
    }
    return id;
  }

  _extractSprites(ppu) {
    const sprites = new Array(64);
    for (let i = 0; i < 64; i++) {
      sprites[i] = {
        x: ppu.sprX[i],
        y: ppu.sprY[i],
        tileIndex: ppu.sprTile[i],
        palette: ppu.sprCol[i],   // 0, 4, 8, or 12 — offset into sprPalette
        flipH: ppu.horiFlip[i],
        flipV: ppu.vertFlip[i],
        behindBg: ppu.bgPriority[i],
      };
    }
    return sprites;
  }
}
