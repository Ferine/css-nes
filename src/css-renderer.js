/**
 * Orchestrates all CSS rendering layers.
 * Creates viewport, manages PaletteManager, TileCache, BGLayer, SpriteLayer.
 */
import { PaletteManager } from './palette-manager.js';
import { TileCache } from './tile-cache.js';
import { BGLayer } from './bg-layer.js';
import { BGRegionLayer } from './bg-region-layer.js';
import { SpriteLayer } from './sprite-layer.js';
import { DebugOverlay } from './debug-overlay.js';
import { AnnotationPopover } from './annotation-popover.js';
import { NametableViewer } from './nametable-viewer.js';
import { PaletteViewer } from './palette-viewer.js';
import { OAMViewer } from './oam-viewer.js';
import { CHRViewer } from './chr-viewer.js';

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
    this.bgRegionLayer = new BGRegionLayer(this.viewport);
    this.spriteLayer = new SpriteLayer(this.viewport);
    this.debugOverlay = new DebugOverlay(this.viewport);
    this.annotationPopover = null; // initialized by app.js with PPU state getter

    // Inspector panels — initialized later via initInspector()
    this.inspectorPanels = null;

    // UI-level layer visibility overrides (independent of PPU flags)
    this.layerVisible = { bg: true, sprites: true };

    this._usingRegionBg = false;
    this.frameCount = 0;
  }

  /**
   * Initialize annotation popover with a PPU state getter.
   */
  initAnnotation(getPPUState) {
    this.annotationPopover = new AnnotationPopover(this.viewport, this, getPPUState);
  }

  /**
   * Initialize inspector panels (nametable, palette, OAM viewers).
   */
  initInspector(inspectorEl) {
    this.inspectorPanels = {
      nametable: new NametableViewer(inspectorEl, this),
      palette: new PaletteViewer(inspectorEl, this),
      oam: new OAMViewer(inspectorEl, this),
      chr: new CHRViewer(inspectorEl, this),
    };
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

    const renderRegions = Array.isArray(ppuState.renderPlan?.regions)
      ? ppuState.renderPlan.regions
      : null;
    const hiddenBgState = { ...ppuState, bgVisible: false };

    // 3. Update BG layer(s) (respect UI override)
    if (!this.layerVisible.bg) {
      this._usingRegionBg = false;
      this.bgRegionLayer.hide();
      this.bgLayer.update(hiddenBgState, this.tileCache);
    } else if (renderRegions && renderRegions.length > 1) {
      this._usingRegionBg = true;
      this.bgLayer.update(hiddenBgState, this.tileCache);
      this.bgRegionLayer.update(ppuState, this.tileCache, renderRegions);
    } else {
      this._usingRegionBg = false;
      this.bgRegionLayer.hide();
      this.bgLayer.update(ppuState, this.tileCache);
    }

    // 4. Update sprite layer (respect UI override)
    const sprState = this.layerVisible.sprites ? ppuState : { ...ppuState, spritesVisible: false };
    this.spriteLayer.update(sprState, this.tileCache);

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
    this.viewport.dataset.bgRegions = String(renderRegions ? renderRegions.length : 1);
    this.viewport.dataset.timingMode = ppuState.renderPlan?.mode || 'single';
    this.viewport.dataset.timingEvents = String(ppuState.renderPlan?.eventCount || 0);

    // 7. Update debug overlays
    this.debugOverlay.update(ppuState);

    // 8. Update inspector panels
    if (this.inspectorPanels) {
      this.inspectorPanels.nametable.update(ppuState);
      this.inspectorPanels.palette.update(ppuState);
      this.inspectorPanels.oam.update(ppuState);
      this.inspectorPanels.chr.update(ppuState);
    }

    this.frameCount++;
  }

  /**
   * Apply layer visibility immediately (for toggling while paused).
   */
  applyLayerVisibility() {
    if (!this.layerVisible.bg) {
      this.bgLayer.bgLayer.style.display = 'none';
      this.bgRegionLayer.hide();
    } else if (this._usingRegionBg) {
      this.bgLayer.bgLayer.style.display = 'none';
      this.bgRegionLayer.root.style.display = '';
    } else {
      this.bgLayer.bgLayer.style.display = '';
      this.bgRegionLayer.hide();
    }
    this.spriteLayer.spriteLayer.style.display = this.layerVisible.sprites ? '' : 'none';
  }

  /**
   * Set rendering scale.
   */
  setScale(n) {
    this.wrapper.style.transform = `scale(${n})`;
  }
}
