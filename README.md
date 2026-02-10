# CSS-NES

A NES emulator that renders entirely through the DOM. No `<canvas>`. No WebGL. Every single pixel you see is a CSS `background-position` offset into a spritesheet, laid out on a CSS Grid, scrolled with `transform: translate()`. You can right-click any tile Mario is standing on and inspect it in DevTools — or just click it while paused to get a full PPU annotation popover.

This is not a good idea. It works anyway.

## By the Numbers

Every frame of NES gameplay maintains:

- **3,904 DOM elements** — 3,840 background tiles (4 nametable quadrants x 960 tiles each) + 64 sprite divs
- **12 dynamically generated PNG spritesheets** — 4 BG palette variants + 4 sprite bank 0 variants + 4 sprite bank 1 variants, base64-encoded and injected into a `<style>` element as `background-image` rules
- **~30 data attributes per visible element** — VRAM addresses, tile indices in hex, palette groups, pixel coordinates, flip state, priority, OAM addresses
- **1 `<style>` tag rewritten at runtime** — because updating a CSS rule is faster than touching 960 `div.style.backgroundImage` properties
- **5 debug overlay layers** — tile grid, sprite bounding boxes with OAM indices, palette region heatmap, sprite-0 scroll split line, nametable seam markers

A normal renderer writes 61,440 pixel values to a framebuffer. This one maintains a living DOM tree where the browser's layout engine does the compositing. The Chrome DevTools Elements panel becomes a PPU debugger.

## Why

Because the question "what if the browser's layout engine was the PPU compositor" deserved an answer, even if that answer is "please don't." Every background tile, sprite, palette, and scroll value is exposed as data attributes on real DOM elements. Pause the emulator, open Elements, hover a tile, see its VRAM address. Or just click it — the annotation popover shows you the nametable address, raw bytes, a color-mapped CHR pixel grid, and palette swatches without opening DevTools at all. The rest is a crime against rendering pipelines.

## Quick Start

```bash
npm install
npm run dev
```

Drop a `.nes` ROM file onto the page or use the Load ROM button.

## Controls

| Key | NES Button |
|-----|-----------|
| Arrow keys | D-pad |
| Z | A |
| X | B |
| Right Shift | Select |
| Enter | Start |

## How It Works

The renderer reads PPU structural state directly from `nes.ppu` — nametables, OAM, pattern tables, palettes, scroll registers — rather than the framebuffer. This state drives a layered CSS rendering pipeline:

```
nes.frame() -> onFrame -> PPUStateExtractor.extract()
  -> PaletteManager    (NES palette -> CSS hex colors, dirty tracking)
  -> TileCache          (CHR tiles + palettes -> 128x128 spritesheet PNGs)
  -> BGLayer            (4 nametable quadrants as 32x30 CSS Grids, diff updates)
  -> SpriteLayer        (64 absolutely-positioned sprite divs)
  -> DebugOverlay       (5 toggleable visualization layers)
```

**Spritesheets, not inline styles.** The TileCache generates 12 PNG spritesheets (4 BG + 4 sprite bank 0 + 4 sprite bank 1) and injects them via a dynamic `<style>` element. Palette change = 1 CSS rule update, not 960 divs.

**Diff-based BG updates.** Only tiles that actually changed (index or attribute) get their DOM touched.

**Scroll wrapping.** Nametable quadrants reposition dynamically to handle the 512x480 wraparound without duplicating DOM elements.

**CHR bank-switch detection.** The TileCache detects mapper bank switches (MMC3, etc.) via O(8) object-identity comparison of CHR region references. When `load1kVromBank` replaces Tile objects, the reference changes are caught instantly. A FNV-1a checksum fallback handles CHR-RAM games that modify tile pixel data in place.

## Annotation Popover

Pause the emulator and click any tile or sprite to inspect it. The popover shows:

**BG Tiles:** nametable address, tile index, grid position, quadrant/physical NT mapping, pattern table base, raw nametable and attribute bytes, an 8x8 CHR pixel grid rendered with palette colors, and palette swatches.

**Sprites:** OAM address and index, tile index, screen position, flip/priority flags, reconstructed raw OAM bytes (Y, tile, attributes, X), pattern table base, CHR pixel grid (8x8 or 8x16), and palette swatches.

Click elsewhere to dismiss, click another element to switch targets, or unpause to auto-dismiss.

## Debug Overlays

Five toggleable overlay layers, accessible via toolbar buttons or the console API:

| Overlay | Description |
|---------|-------------|
| **Tile Grid** | Red 8px grid lines over the background |
| **Sprite Boxes** | Green outlines with OAM index labels on each sprite |
| **Palette Regions** | Color-coded 16x16 blocks showing attribute table palette assignments |
| **Scroll Split** | Orange dashed line at sprite-0 hit scanline |
| **NT Seam** | Cyan dashed lines at nametable boundaries within the viewport |

## DevTools Inspection

Every element is labeled with NES-specific data attributes:

**Viewport** (`div.nes-viewport`):
`data-frame`, `data-scroll-x`, `data-scroll-y`, `data-bg-color`, `data-bg-pattern-table`, `data-spr-pattern-table`, `data-sprite-size`, `data-mirroring`

**BG tiles** (`div.bg-tile`):
`data-col`, `data-row`, `data-px-x`, `data-px-y`, `data-nt-addr` (VRAM address like `$2000`), `data-tile-idx`, `data-tile-hex`, `data-palette`, `data-quadrant`

**Sprites** (`div.sprite`):
`data-idx`, `data-oam-addr` (like `$04`), `data-x`, `data-y`, `data-tile-idx`, `data-tile-hex`, `data-palette`, `data-flip-h`, `data-flip-v`, `data-priority`

## Debug Console API

```js
nesDebug.showTileGrid()       // toggle 8px grid overlay
nesDebug.showSpriteBoxes()    // toggle sprite outlines + OAM labels
nesDebug.showPaletteRegions() // toggle palette attribute heatmap
nesDebug.showScrollSplit()    // toggle sprite-0 hit scanline
nesDebug.showNametableSeam()  // toggle nametable boundary lines
nesDebug.toggleAll()          // toggle all overlays on/off
nesDebug.highlightPalette(2)  // log palette group colors to console
nesDebug.annotate             // AnnotationPopover instance (.dismiss(), .isVisible)
nesDebug.state                // current PPU state snapshot
nesDebug.nes                  // raw jsnes NES instance
```

## Canvas Mode

Click **Canvas Mode** to swap to a traditional framebuffer canvas renderer using `ppu.buffer`. Click **CSS Mode** to swap back. Useful for verifying correctness.

## Architecture

```
css-nes/
├── index.html                 # Shell, controls, ROM loader
├── styles/nes-layers.css      # Grid layout, tile/sprite styles, overlays, popover
└── src/
    ├── ppu-state-extractor.js # Reads nes.ppu internals into clean snapshots
    ├── palette-manager.js     # 0xBBGGRR -> CSS hex, dirty group tracking
    ├── tile-cache.js          # CHR tiles -> per-palette spritesheet PNGs, bank detection
    ├── bg-layer.js            # 4 nametable quadrants, CSS Grid, diff updates
    ├── sprite-layer.js        # 64 sprite divs, 8x8 + 8x16 support
    ├── debug-overlay.js       # 5 toggleable visual debug layers
    ├── annotation-popover.js  # Click-to-inspect PPU annotation popover
    ├── css-renderer.js        # Orchestrates layers, owns viewport
    └── app.js                 # jsnes integration, game loop, input, ROM loading
```

## Testing

```bash
npm test         # unit + DOM tests (vitest + happy-dom)
npm run test:e2e # visual regression tests (playwright)
```

92 unit/DOM tests cover palette management, tile caching, CHR bank-switch detection, BG layer diffing, sprite layer updates, and renderer orchestration. E2e tests use Playwright for CSS-vs-canvas visual comparison.

## The Absurdity in Detail

A `<canvas>` renderer does this per frame: loop over 61,440 pixels, write RGBA values to an `ImageData`, call `putImageData()`. Done. One

This renderer, per frame:

1. Reads ~20 PPU register values and references to 4 nametable arrays, 512 tile objects, and 64 sprites
2. Compares 32 palette entries against their previous values to determine which of 8 palette groups are dirty
3. Checks 8 CHR bank region references for object-identity changes (mapper bank switches), then checksums all 512 tiles for in-place CHR-RAM modifications
4. For each dirty palette group + dirty CHR bank combination, iterates 256 tiles x 64 pixels = 16,384 pixel lookups, writes them into a 128x128 `ImageData`, calls `putImageData()`, then `toDataURL('image/png')` to produce a base64 PNG string
5. Concatenates up to 12 of these base64 PNGs (each ~10-20KB of ASCII) into CSS rules and writes them to a `<style>` element's `textContent`, triggering a full CSSOM reparse
6. Iterates 3,840 tile slots across 4 nametable quadrants, comparing tile index and attribute against previous values, and for each changed tile sets `className`, `style.backgroundPosition`, and up to 4 `dataset` properties
7. Repositions 4 absolutely-positioned 256x240 CSS Grid containers based on scroll registers to handle nametable wrapping in a 512x480 virtual space
8. Updates 64 sprite divs with position, z-index, transform (for flip), class (for palette spritesheet), background-position (for tile selection), and 8 data attributes each
9. Updates 5 debug overlay layers: recalculates palette region colors from attribute tables, repositions scroll-split and nametable-seam markers
10. Sets the viewport's `backgroundColor` to the NES universal background color

The browser then takes this pile of DOM mutations, recalculates styles, reflows the grid layouts, composites the layers, and somehow produces a frame that looks correct. At 60fps. Mostly.

For comparison: the NES PPU does all of this in hardware with a 5.37 MHz clock, 2KB of VRAM, and no opinions about CSS specificity.

## Known Limitations

- **No mid-frame scroll splits** — uses end-of-frame scroll registers (status bars will scroll with playfield)
- **BG priority is z-index based** — no per-pixel transparency check for sprites behind BG
- **No audio** — visual rendering only
- **8x16 sprites** — basic support, may have edge cases with CHR bank selection

## Credits

Built on [jsnes](https://github.com/bfirsh/jsnes) by [Ben Firshman](https://github.com/bfirsh) and contributors — a JavaScript NES emulator that does all the actual hard work of emulating a 6502 CPU, PPU, and cartridge mappers. This project just reads the PPU state jsnes computes and renders it in the worst way possible.
