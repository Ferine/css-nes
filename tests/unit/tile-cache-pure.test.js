import { describe, it, expect } from 'vitest';
import { TileCache } from '../../src/tile-cache.js';

// We only test the pure functions that don't need DOM.
// TileCache constructor uses document, so we access methods via prototype.

const getTilePosition = TileCache.prototype.getTilePosition;
const hashPix = TileCache.prototype._hashPix;

describe('TileCache pure functions', () => {
  describe('getTilePosition', () => {
    it('tile 0 → -0px -0px', () => {
      expect(getTilePosition(0)).toBe('-0px -0px');
    });

    it('tile 1 → -8px -0px', () => {
      expect(getTilePosition(1)).toBe('-8px -0px');
    });

    it('tile 16 → -0px -8px (first tile of second row)', () => {
      expect(getTilePosition(16)).toBe('-0px -8px');
    });

    it('tile 15 → -120px -0px (last tile of first row)', () => {
      expect(getTilePosition(15)).toBe('-120px -0px');
    });

    it('tile 255 → -120px -120px (last tile)', () => {
      expect(getTilePosition(255)).toBe('-120px -120px');
    });

    it('tile 17 → -8px -8px', () => {
      expect(getTilePosition(17)).toBe('-8px -8px');
    });
  });

  describe('_hashPix', () => {
    it('is deterministic — same data produces same hash', () => {
      const pix = new Uint8Array(64);
      pix[0] = 1;
      pix[32] = 2;
      expect(hashPix(pix)).toBe(hashPix(pix));
    });

    it('different data produces different hash', () => {
      const pix1 = new Uint8Array(64);
      const pix2 = new Uint8Array(64);
      pix2[0] = 1;
      expect(hashPix(pix1)).not.toBe(hashPix(pix2));
    });

    it('is sensitive to single pixel changes', () => {
      const pix1 = new Uint8Array(64).fill(1);
      const pix2 = new Uint8Array(64).fill(1);
      pix2[63] = 2;
      expect(hashPix(pix1)).not.toBe(hashPix(pix2));
    });

    it('returns an unsigned 32-bit integer', () => {
      const pix = new Uint8Array(64).fill(0xFF);
      const h = hashPix(pix);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xFFFFFFFF);
    });
  });
});
