/**
 * Creates a well-formed ppuState object (output of PPUStateExtractor.extract())
 * for use by layer tests.
 */
export function createMockPPUState(overrides = {}) {
  const defaults = {
    bgPalette: new Array(16).fill(0),
    sprPalette: new Array(16).fill(0),

    nameTables: [
      { tile: new Uint8Array(1024), attrib: new Uint8Array(1024) },
      { tile: new Uint8Array(1024), attrib: new Uint8Array(1024) },
      { tile: new Uint8Array(1024), attrib: new Uint8Array(1024) },
      { tile: new Uint8Array(1024), attrib: new Uint8Array(1024) },
    ],

    mirrorMap: [0, 1, 2, 3],

    ptTile: Array.from({ length: 512 }, () => ({
      pix: new Uint8Array(64),
    })),

    sprites: Array.from({ length: 64 }, () => ({
      x: 0,
      y: 240, // off-screen by default
      tileIndex: 0,
      palette: 0,
      flipH: false,
      flipV: false,
      behindBg: false,
    })),

    scroll: {
      coarseX: 0,
      coarseY: 0,
      fineX: 0,
      fineY: 0,
      nameTableH: 0,
      nameTableV: 0,
    },

    bgPatternBase: 0,
    sprPatternBase: 0,
    spriteSize: 0,
    bgVisible: true,
    spritesVisible: true,

    spr0HitY: 0,
    buffer: new Uint32Array(256 * 240),
  };

  return { ...defaults, ...overrides };
}
