import { describe, it, expect } from 'vitest';
import { PPUStateExtractor } from '../../src/ppu-state-extractor.js';
import { createMockNES } from '../helpers/mock-nes.js';

describe('PPUStateExtractor', () => {
  it('extracts bgPalette as a copy of the first 16 entries', () => {
    const nes = createMockNES();
    nes.ppu.imgPalette[0] = 0x0F;
    nes.ppu.imgPalette[15] = 0xFF;
    nes.ppu.imgPalette[16] = 0xAA; // should not appear

    const state = new PPUStateExtractor(nes).extract();
    expect(state.bgPalette).toHaveLength(16);
    expect(state.bgPalette[0]).toBe(0x0F);
    expect(state.bgPalette[15]).toBe(0xFF);

    // Should be a copy, not a reference
    nes.ppu.imgPalette[0] = 0x99;
    expect(state.bgPalette[0]).toBe(0x0F);
  });

  it('extracts sprPalette as a copy of the first 16 entries', () => {
    const nes = createMockNES();
    nes.ppu.sprPalette[3] = 0xABCDEF;

    const state = new PPUStateExtractor(nes).extract();
    expect(state.sprPalette).toHaveLength(16);
    expect(state.sprPalette[3]).toBe(0xABCDEF);

    nes.ppu.sprPalette[3] = 0;
    expect(state.sprPalette[3]).toBe(0xABCDEF);
  });

  it('maps mirrorMap from ntable1', () => {
    const nes = createMockNES();
    nes.ppu.ntable1 = [0, 0, 1, 1]; // horizontal mirroring

    const state = new PPUStateExtractor(nes).extract();
    expect(state.mirrorMap).toEqual([0, 0, 1, 1]);
  });

  it('converts scroll registers to named fields', () => {
    const nes = createMockNES();
    nes.ppu.regHT = 5;
    nes.ppu.regVT = 10;
    nes.ppu.regFH = 3;
    nes.ppu.regFV = 7;
    nes.ppu.regH = 1;
    nes.ppu.regV = 0;

    const state = new PPUStateExtractor(nes).extract();
    expect(state.scroll).toEqual({
      coarseX: 5,
      coarseY: 10,
      fineX: 3,
      fineY: 7,
      nameTableH: 1,
      nameTableV: 0,
    });
  });

  it('computes bgPatternBase: 0 when f_bgPatternTable=0, 256 otherwise', () => {
    const nes = createMockNES();
    nes.ppu.f_bgPatternTable = 0;
    expect(new PPUStateExtractor(nes).extract().bgPatternBase).toBe(0);

    nes.ppu.f_bgPatternTable = 1;
    expect(new PPUStateExtractor(nes).extract().bgPatternBase).toBe(256);
  });

  it('computes sprPatternBase: 0 when f_spPatternTable=0, 256 otherwise', () => {
    const nes = createMockNES();
    nes.ppu.f_spPatternTable = 0;
    expect(new PPUStateExtractor(nes).extract().sprPatternBase).toBe(0);

    nes.ppu.f_spPatternTable = 1;
    expect(new PPUStateExtractor(nes).extract().sprPatternBase).toBe(256);
  });

  it('converts visibility flags to booleans', () => {
    const nes = createMockNES();
    nes.ppu.f_bgVisibility = 1;
    nes.ppu.f_spVisibility = 0;
    let state = new PPUStateExtractor(nes).extract();
    expect(state.bgVisible).toBe(true);
    expect(state.spritesVisible).toBe(false);

    nes.ppu.f_bgVisibility = 0;
    nes.ppu.f_spVisibility = 1;
    state = new PPUStateExtractor(nes).extract();
    expect(state.bgVisible).toBe(false);
    expect(state.spritesVisible).toBe(true);
  });

  it('holds ptTile by reference', () => {
    const nes = createMockNES();
    const state = new PPUStateExtractor(nes).extract();
    expect(state.ptTile).toBe(nes.ppu.ptTile);
  });

  it('extracts 64 sprites with all fields', () => {
    const nes = createMockNES();
    nes.ppu.sprX[0] = 100;
    nes.ppu.sprY[0] = 50;
    nes.ppu.sprTile[0] = 42;
    nes.ppu.sprCol[0] = 8;
    nes.ppu.horiFlip[0] = true;
    nes.ppu.vertFlip[0] = false;
    nes.ppu.bgPriority[0] = true;

    nes.ppu.sprX[63] = 200;
    nes.ppu.sprY[63] = 100;
    nes.ppu.sprTile[63] = 255;
    nes.ppu.sprCol[63] = 12;
    nes.ppu.horiFlip[63] = false;
    nes.ppu.vertFlip[63] = true;
    nes.ppu.bgPriority[63] = false;

    const state = new PPUStateExtractor(nes).extract();
    expect(state.sprites).toHaveLength(64);

    expect(state.sprites[0]).toEqual({
      x: 100,
      y: 50,
      tileIndex: 42,
      palette: 8,
      flipH: true,
      flipV: false,
      behindBg: true,
    });

    expect(state.sprites[63]).toEqual({
      x: 200,
      y: 100,
      tileIndex: 255,
      palette: 12,
      flipH: false,
      flipV: true,
      behindBg: false,
    });
  });

  it('handles null nametable entries', () => {
    const nes = createMockNES();
    nes.ppu.nameTable[2] = null;

    const state = new PPUStateExtractor(nes).extract();
    expect(state.nameTables[0]).not.toBeNull();
    expect(state.nameTables[2]).toBeNull();
    expect(state.nameTables).toHaveLength(4);
  });

  it('extracts nametable tile and attrib arrays', () => {
    const nes = createMockNES();
    nes.ppu.nameTable[1].tile[0] = 42;
    nes.ppu.nameTable[1].attrib[0] = 3;

    const state = new PPUStateExtractor(nes).extract();
    expect(state.nameTables[1].tile[0]).toBe(42);
    expect(state.nameTables[1].attrib[0]).toBe(3);
  });

  it('passes through spriteSize, spr0HitY, and buffer', () => {
    const nes = createMockNES();
    nes.ppu.f_spriteSize = 1;
    nes.ppu.spr0HitY = 42;

    const state = new PPUStateExtractor(nes).extract();
    expect(state.spriteSize).toBe(1);
    expect(state.spr0HitY).toBe(42);
    expect(state.buffer).toBe(nes.ppu.buffer);
  });
});
