/**
 * Creates a mock NES object matching jsnes PPU internals
 * that PPUStateExtractor.extract() reads.
 */
export function createMockNES(overrides = {}) {
  const ppu = {
    // Palettes — 16 entries each, packed 0xBBGGRR
    imgPalette: new Array(32).fill(0),
    sprPalette: new Array(32).fill(0),

    // Nametables — 4 physical nametables, each with .tile and .attrib
    nameTable: [
      { tile: new Uint8Array(1024), attrib: new Uint8Array(1024) },
      { tile: new Uint8Array(1024), attrib: new Uint8Array(1024) },
      { tile: new Uint8Array(1024), attrib: new Uint8Array(1024) },
      { tile: new Uint8Array(1024), attrib: new Uint8Array(1024) },
    ],

    // Mirroring map — logical → physical nametable index
    ntable1: [0, 1, 2, 3],

    // Pattern table tiles — 512 Tile objects, each with .pix (64-element array)
    ptTile: Array.from({ length: 512 }, () => ({
      pix: new Uint8Array(64),
    })),

    // Sprite OAM registers — 64 entries each
    sprX: new Uint8Array(64),
    sprY: new Uint8Array(64),
    sprTile: new Uint8Array(64),
    sprCol: new Uint8Array(64),
    horiFlip: new Array(64).fill(false),
    vertFlip: new Array(64).fill(false),
    bgPriority: new Array(64).fill(false),

    // Scroll registers
    regHT: 0,
    regVT: 0,
    regFH: 0,
    regFV: 0,
    regH: 0,
    regV: 0,

    // Control flags
    f_bgPatternTable: 0,
    f_spPatternTable: 0,
    f_spriteSize: 0,
    f_bgVisibility: 1,
    f_spVisibility: 1,

    // Debug
    spr0HitY: 0,
    buffer: new Uint32Array(256 * 240),

    ...overrides,
  };

  return { ppu };
}
