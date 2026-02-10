/**
 * Orchestrates all CSS rendering layers.
 * Creates viewport, manages PaletteManager, TileCache, BGLayer, SpriteLayer.
 */
import { PaletteManager } from './palette-manager.js';
import { TileCache } from './tile-cache.js';
import { BGLayer } from './bg-layer.js';
import { SpriteLayer } from './sprite-layer.js';
import { DebugOverlay } from './debug-overlay.js';

export class CSSRenderer {
  constructor(wrapperEl) {
    this.wrapper = wrapperEl;

    // Create viewport
    this.viewport = document.createElement('div');
    this.viewport.className = 'nes-viewport';
    this.viewport.dataset.layer = 'viewport';
    this.viewport.dataset.resolution = '256x240';
    this.wrapper.appendChild(this.viewport);

    // Subsystems
    this.paletteManager = new PaletteManager();
    this.tileCache = new TileCache();
    this.bgLayer = new BGLayer(this.viewport);
    this.spriteLayer = new SpriteLayer(this.viewport);
    this.debugOverlay = new DebugOverlay(this.viewport);

    this.frameCount = 0;
  }

  /**
   * Render one frame from extracted PPU state.
   */
  renderFrame(ppuState) {
    // 1. Update palettes
    this.paletteManager.update(ppuState.bgPalette, ppuState.sprPalette);

    // 2. Update tile cache (spritesheets)
    this.tileCache.update(
      ppuState.ptTile,
      this.paletteManager,
      ppuState.bgPatternBase,
      ppuState.sprPatternBase,
      ppuState.chrBankSignature
    );

    // 3. Update BG layer
    this.bgLayer.update(ppuState, this.tileCache);

    // 4. Update sprite layer
    this.spriteLayer.update(ppuState, this.tileCache);

    // 5. Viewport background color
    this.viewport.style.backgroundColor = this.paletteManager.getBackgroundColor();

    // 6. Label viewport with frame-level PPU state
    const s = ppuState.scroll;
    this.viewport.dataset.frame = this.frameCount;
    this.viewport.dataset.scrollX = s.coarseX * 8 + s.fineX + s.nameTableH * 256;
    this.viewport.dataset.scrollY = s.coarseY * 8 + s.fineY + s.nameTableV * 240;
    this.viewport.dataset.bgColor = this.paletteManager.getBackgroundColor();
    this.viewport.dataset.bgPatternTable = ppuState.bgPatternBase === 0 ? '$0000' : '$1000';
    this.viewport.dataset.sprPatternTable = ppuState.sprPatternBase === 0 ? '$0000' : '$1000';
    this.viewport.dataset.spriteSize = ppuState.spriteSize === 0 ? '8x8' : '8x16';
    this.viewport.dataset.mirroring = ppuState.mirrorMap.join(',');

    // 7. Update debug overlays
    this.debugOverlay.update(ppuState);

    this.frameCount++;
  }

  /**
   * Set rendering scale.
   */
  setScale(n) {
    this.wrapper.style.transform = `scale(${n})`;
  }
}
