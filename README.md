# CSS-NES

NES rendering experiment that does the wrong thing on purpose: it draws with DOM + CSS layers instead of a framebuffer canvas.

No `<canvas>` in CSS mode. No WebGL. Just tiles, spritesheets, transforms, and a browser layout engine pretending to be a PPU compositor.

It is absolutely not the normal way to render an NES. It does work.

Current implementation status in this repo:

- jsnes drives CPU/PPU emulation.
- `CSSRenderer` renders from extracted PPU state (`nes.ppu`) into layered DOM.
- Optional `Canvas Mode` renders from `ppu.buffer` for side-by-side sanity checks.
- Includes debug overlays, inspector panels, timing-trace plumbing, and test harnesses.

The npm package name is currently `css-snes` (`package.json`), while the app/UI label is `CSS-NES`.

## By the Numbers (Current Code)

- `3,840` pre-created BG tile nodes (`4 x 32 x 30`)
- `64` sprite nodes + `128` sprite-half child nodes (for 8x16 support)
- `12` base spritesheet slots in `TileCache` (4 BG + 8 SPR), plus cached per-region sprite set variants (`spr-set-*`) when timing data diverges mid-frame
- `5` debug overlay types
- `4` inspector panels (NT, Palette, OAM, CHR)
- `1` runtime stylesheet (`#tile-cache-styles`) rewritten as tiles/palettes update

## Quick Start

```bash
npm install
npm run dev
```

Open the app, then drag/drop a `.nes` ROM or use the **Load ROM** button.

## Controls

### NES Input

| Key | NES Button |
| --- | --- |
| Arrow keys | D-pad |
| `Z` | A |
| `X` | B |
| Right Shift | Select |
| Enter | Start |

### Runtime Controls

- `Pause` / `Resume` button pauses emulation.
- `Step` runs one frame while paused.
- `Canvas Mode` toggles CSS renderer vs canvas reference.

### Layer / Debug / Inspector Shortcuts

- Layers: `B` (BG), `S` (sprites)
- Debug overlays: `1` grid, `2` sprite boxes, `3` palette regions, `4` split line, `5` nametable seams
- Inspector panels: `N` nametable, `P` palette, `O` OAM, `C` CHR

## Why

Because "what if Chrome DevTools could inspect live NES tiles and sprites as real DOM elements?" was a question that deserved a practical answer and a mildly irresponsible renderer.

## Implemented Features

- BG layer with 4 nametable quadrants (`32x30` tiles each), diff-based tile updates.
- Sprite layer for 64 sprites with `8x8` and `8x16` handling.
- Tile cache that builds PNG spritesheets and rewrites a runtime stylesheet.
- BG set caching keyed by pattern-table base + CHR signature (supports multiple active BG sets for region rendering).
- Per-region sprite sheet binding (`spr-set-*`) so sprites can use the region-appropriate CHR signature during mapper-heavy SMB3-style mid-frame changes.
- PPU write tracing (`$2000/$2001/$2005/$2006` + optional mapper writes) and scanline state model.
- Region planner + region BG compositor (`BGRegionLayer`) for split-scroll style scenes (currently capped to 2 regions).
- Annotation popover while paused:
  - click tile/sprite for metadata + CHR/palette view
  - shift+click for per-pixel provenance
- Inspector side panel:
  - Nametable minimap
  - Palette viewer
  - OAM table with hover highlight
  - CHR pattern-table viewer
- Stats counters in UI: FPS, DOM mutation count, DOM node count, visible sprite count, sheet regeneration count.

## Debug Console API

```js
nesDebug.showTileGrid()
nesDebug.showSpriteBoxes()
nesDebug.showPaletteRegions()
nesDebug.showScrollSplit()
nesDebug.showNametableSeam()
nesDebug.toggleAll()
nesDebug.highlightPalette(2)
nesDebug.annotate // AnnotationPopover instance
nesDebug.state    // latest extracted PPU state
nesDebug.nes      // jsnes instance
```

## How the Pipeline Works

```text
nes.frame()
  -> PPUWriteTracer (optional timing trace)
  -> PPUStateExtractor.extract()
  -> CSSRenderer.renderFrame()
       -> PaletteManager
       -> TileCache
       -> BGLayer or BGRegionLayer
       -> SpriteLayer
       -> DebugOverlay
       -> Inspector panels
```

The key idea is simple: extract structural PPU state, then let CSS positioning + layering do compositing work that would usually happen in a framebuffer loop.

## Project Layout

```text
css-nes/
├── index.html
├── styles/nes-layers.css
├── src/
│   ├── app.js
│   ├── css-renderer.js
│   ├── ppu-state-extractor.js
│   ├── ppu-write-tracer.js
│   ├── scanline-state-builder.js
│   ├── scroll-region-planner.js
│   ├── palette-manager.js
│   ├── tile-cache.js
│   ├── bg-layer.js
│   ├── bg-region-layer.js
│   ├── sprite-layer.js
│   ├── debug-overlay.js
│   ├── annotation-popover.js
│   ├── mutation-counter.js
│   ├── nametable-viewer.js
│   ├── palette-viewer.js
│   ├── oam-viewer.js
│   └── chr-viewer.js
└── tests/
    ├── unit/
    ├── dom/
    └── e2e/
```

## Testing

```bash
npm test
npm run test:e2e
```

Latest local run in this workspace (2026-02-27):

- `npm test`: 11 files, 118 tests passed
- `npm run test:e2e`: 5 Playwright tests passed

E2E tests use ROMs from `roms/` and compare CSS output against a canvas reference (pixel diff thresholds vary by scenario).

## Known Gaps

- Region timing is scanline-level modeling, not cycle-accurate.
- Region compositor currently uses at most 2 vertical regions.
- Sprite priority vs BG is approximated with z-index, so per-pixel NES priority behavior is not exact.
- Some SMB3 1-1 windows still show elevated transient CSS-vs-canvas diff during heavy mid-frame timing churn, even after region-aware sprite CHR binding.
- No audio output (audio samples are discarded).

## Credits

Powered by [jsnes](https://github.com/bfirsh/jsnes) (`jsnes@1.2.1`), created by Ben Firshman and maintained by contributors (Apache-2.0).

jsnes does the actual emulation work (CPU/PPU/mappers/input/audio plumbing). This project reads jsnes PPU state and renders it as DOM/CSS layers, plus debugger-style inspection tools.
