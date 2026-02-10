/**
 * Extracts a clean snapshot of PPU state from jsnes internals.
 * All reads are from public properties on nes.ppu — no jsnes modifications needed.
 */
export class PPUStateExtractor {
  constructor(nes) {
    this.nes = nes;
  }

  extract() {
    const ppu = this.nes.ppu;

    return {
      // Palettes — 16 entries each, packed 0xRRGGBB
      bgPalette: ppu.imgPalette.slice(0, 16),
      sprPalette: ppu.sprPalette.slice(0, 16),

      // Nametables — tile indices and attributes for each physical nametable
      nameTables: this._extractNameTables(ppu),

      // Mirroring map — logical quadrant → physical nametable index
      mirrorMap: [ppu.ntable1[0], ppu.ntable1[1], ppu.ntable1[2], ppu.ntable1[3]],

      // Pattern table tile data (reference, not copy — tiles are Tile objects with .pix arrays)
      ptTile: ppu.ptTile,

      // Sprites — 64 entries
      sprites: this._extractSprites(ppu),

      // Scroll state — use reg* variants (cnt* are mutated during rendering)
      scroll: {
        coarseX: ppu.regHT,
        coarseY: ppu.regVT,
        fineX: ppu.regFH,
        fineY: ppu.regFV,
        nameTableH: ppu.regH,
        nameTableV: ppu.regV,
      },

      // Control flags
      bgPatternBase: ppu.f_bgPatternTable === 0 ? 0 : 256,
      sprPatternBase: ppu.f_spPatternTable === 0 ? 0 : 256,
      spriteSize: ppu.f_spriteSize, // 0=8x8, 1=8x16
      bgVisible: ppu.f_bgVisibility === 1,
      spritesVisible: ppu.f_spVisibility === 1,

      // Sprite 0 hit (for future scroll split detection)
      spr0HitY: ppu.spr0HitY,

      // CHR bank signature — one Tile object reference per 1KB CHR region.
      // When load1kVromBank replaces Tile objects, the refs change, enabling
      // fast O(8) bank-switch detection instead of hashing all tile pixel data.
      chrBankSignature: this._extractCHRBankSignature(ppu),

      // Framebuffer reference for canvas comparison
      buffer: ppu.buffer,
    };
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
   * Sample the first Tile object reference from each 1KB CHR region (64 tiles).
   * 8 regions: ptTile[0..63], [64..127], [128..191], [192..255],
   *            [256..319], [320..383], [384..447], [448..511]
   * Regions 0-3 = pattern table $0000-$0FFF, regions 4-7 = $1000-$1FFF.
   */
  _extractCHRBankSignature(ppu) {
    const refs = new Array(8);
    for (let i = 0; i < 8; i++) {
      refs[i] = ppu.ptTile[i * 64];
    }
    return refs;
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
