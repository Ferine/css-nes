// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { BGLayer } from '../../src/bg-layer.js';
import { createMockPPUState } from '../helpers/mock-ppu-state.js';
import { createMockTileCache } from '../helpers/mock-tile-cache.js';

describe('BGLayer (DOM)', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('constructor creates .bg-layer with 4 .nametable quadrants', () => {
    const bg = new BGLayer(container);
    const bgLayer = container.querySelector('.bg-layer');
    expect(bgLayer).not.toBeNull();

    const quadrants = bgLayer.querySelectorAll('.nametable');
    expect(quadrants).toHaveLength(4);
  });

  it('constructor creates 3840 .bg-tile divs total (960 per quadrant)', () => {
    const bg = new BGLayer(container);
    const tiles = container.querySelectorAll('.bg-tile');
    expect(tiles).toHaveLength(3840);
  });

  it('tiles have correct data attributes', () => {
    const bg = new BGLayer(container);

    // Check first tile of Q0
    const q0Tile0 = bg.quadTileDivs[0][0];
    expect(q0Tile0.dataset.col).toBe('0');
    expect(q0Tile0.dataset.row).toBe('0');
    expect(q0Tile0.dataset.quadrant).toBe('0');
    expect(q0Tile0.dataset.ntAddr).toBe('$2000');

    // Check first tile of Q1 (offset by 0x400)
    const q1Tile0 = bg.quadTileDivs[1][0];
    expect(q1Tile0.dataset.quadrant).toBe('1');
    expect(q1Tile0.dataset.ntAddr).toBe('$2400');

    // Check last tile of Q0 (index 959 = row 29, col 31)
    const q0Last = bg.quadTileDivs[0][959];
    expect(q0Last.dataset.col).toBe('31');
    expect(q0Last.dataset.row).toBe('29');
  });

  it('update hides layer when bgVisible=false', () => {
    const bg = new BGLayer(container);
    const tc = createMockTileCache();
    const state = createMockPPUState({ bgVisible: false });

    bg.update(state, tc);

    expect(bg.bgLayer.style.display).toBe('none');
  });

  it('update shows layer when bgVisible=true', () => {
    const bg = new BGLayer(container);
    const tc = createMockTileCache();

    // First hide it
    bg.update(createMockPPUState({ bgVisible: false }), tc);
    expect(bg.bgLayer.style.display).toBe('none');

    // Then show it
    bg.update(createMockPPUState({ bgVisible: true }), tc);
    expect(bg.bgLayer.style.display).toBe('');
  });

  it('update sets backgroundPosition on tile change', () => {
    const bg = new BGLayer(container);
    const tc = createMockTileCache();
    tc._markBgSheetUpdated(0);

    const state = createMockPPUState();
    // Set tile index 42 at slot 0 in nametable 0
    state.nameTables[0].tile[0] = 42;
    state.nameTables[0].attrib[0] = 0; // palette group 0

    bg.update(state, tc);

    const div = bg.quadTileDivs[0][0];
    // tile 42: col=42&15=10, row=42>>4=2 → -80px -16px
    expect(div.style.backgroundPosition).toBe('-80px -16px');
  });

  it('update sets className on attrib change', () => {
    const bg = new BGLayer(container);
    const tc = createMockTileCache();
    tc._markBgSheetUpdated(0);
    tc._markBgSheetUpdated(1);

    const state = createMockPPUState();
    state.nameTables[0].tile[5] = 10;
    state.nameTables[0].attrib[5] = 4; // palGroup = 4 >> 2 = 1

    bg.update(state, tc);

    const div = bg.quadTileDivs[0][5];
    expect(div.className).toBe('bg-tile bg-pal-1');
  });

  it('update skips unchanged tiles (diff optimization)', () => {
    const bg = new BGLayer(container);
    const tc = createMockTileCache();
    tc._markBgSheetUpdated(0);

    const state = createMockPPUState();
    state.nameTables[0].tile[0] = 1;
    state.nameTables[0].attrib[0] = 0;

    bg.update(state, tc);

    const div = bg.quadTileDivs[0][0];
    const pos1 = div.style.backgroundPosition;

    // Update again with same data, no sheet update
    tc._clearUpdated();
    bg.update(state, tc);

    // Position should not have changed — it was skipped
    expect(div.style.backgroundPosition).toBe(pos1);
  });

  it('scroll sets correct transform on bg-layer', () => {
    const bg = new BGLayer(container);
    const tc = createMockTileCache();

    const state = createMockPPUState({
      scroll: {
        coarseX: 10,
        coarseY: 5,
        fineX: 3,
        fineY: 2,
        nameTableH: 1,
        nameTableV: 0,
      },
    });

    bg.update(state, tc);

    // scrollX = 10*8 + 3 + 1*256 = 80+3+256 = 339
    // scrollY = 5*8 + 2 + 0*240 = 40+2 = 42
    expect(bg.bgLayer.style.transform).toBe('translate(-339px, -42px)');
  });

  it('uses mirrorMap to map logical → physical nametables', () => {
    const bg = new BGLayer(container);
    const tc = createMockTileCache();
    tc._markBgSheetUpdated(0);

    const state = createMockPPUState({
      // Horizontal mirroring: logical 0,1 → physical 0; logical 2,3 → physical 1
      mirrorMap: [0, 0, 1, 1],
    });

    // Set a unique tile in physical NT 0
    state.nameTables[0].tile[100] = 77;
    state.nameTables[0].attrib[100] = 0;

    bg.update(state, tc);

    // Both Q0 and Q1 map to physical NT 0, so both should show tile 77 at slot 100
    expect(bg.quadTileDivs[0][100].style.backgroundPosition).toBe(
      tc.getTilePosition(77)
    );
    expect(bg.quadTileDivs[1][100].style.backgroundPosition).toBe(
      tc.getTilePosition(77)
    );
  });
});
