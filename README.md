# CSS-NES

A NES emulator that renders entirely through the DOM. No `<canvas>`. No WebGL. Every single pixel you see is a CSS `background-position` offset into a spritesheet, laid out on a CSS Grid, scrolled with `transform: translate()`. You can right-click any tile Mario is standing on and inspect it in DevTools.

This is not a good idea. It works anyway.

## By the Numbers

Every frame of NES gameplay maintains:

- **3,904 DOM elements** — 3,840 background tiles (4 nametable quadrants x 960 tiles each) + 64 sprite divs
- **8 dynamically generated PNG spritesheets** — base64-encoded and injected into a `<style>` element as `background-image` rules every time a palette or CHR tile changes
- **~30 data attributes per visible element** — VRAM addresses, tile indices in hex, palette groups, pixel coordinates, flip state, priority, OAM addresses
- **1 `<style>` tag rewritten at runtime** — because updating a CSS rule is faster than touching 960 `div.style.backgroundImage` properties

A normal renderer writes 61,440 pixel values to a framebuffer. This one maintains a living DOM tree where the browser's layout engine does the compositing. The Chrome DevTools Elements panel becomes a PPU debugger.

## Why

Because the question "what if the browser's layout engine was the PPU compositor" deserved an answer, even if that answer is "please don't." Every background tile, sprite, palette, and scroll value is exposed as data attributes on real DOM elements. Pause the emulator, open Elements, hover a tile, see its VRAM address. That part is genuinely useful. The rest is a crime against rendering pipelines.

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
```

**Spritesheets, not inline styles.** The TileCache generates 8 PNG spritesheets (4 BG + 4 sprite palette variants) and injects them via a dynamic `<style>` element. Palette change = 1 CSS rule update, not 960 divs.

**Diff-based BG updates.** Only tiles that actually changed (index or attribute) get their DOM touched.

**Scroll wrapping.** Nametable quadrants reposition dynamically to handle the 512x480 wraparound without duplicating DOM elements.

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
nesDebug.showTileGrid()      // toggle yellow grid overlay on BG tiles
nesDebug.showSpriteBoxes()   // toggle red outlines on sprites
nesDebug.highlightPalette(2) // log palette group colors to console
nesDebug.state               // current PPU state snapshot
nesDebug.nes                 // raw jsnes NES instance
```

## Canvas Mode

Click **Canvas Mode** to swap to a traditional framebuffer canvas renderer using `ppu.buffer`. Click **CSS Mode** to swap back. Useful for verifying correctness.

## Architecture

```
css-snes/
├── index.html                 # Shell, controls, ROM loader
├── styles/nes-layers.css      # Grid layout, tile/sprite base styles
└── src/
    ├── ppu-state-extractor.js # Reads nes.ppu internals into clean snapshots
    ├── palette-manager.js     # 0xBBGGRR -> CSS hex, dirty group tracking
    ├── tile-cache.js          # CHR tiles -> per-palette spritesheet PNGs
    ├── bg-layer.js            # 4 nametable quadrants, CSS Grid, diff updates
    ├── sprite-layer.js        # 64 sprite divs, 8x8 + 8x16 support
    ├── css-renderer.js        # Orchestrates layers, owns viewport
    └── app.js                 # jsnes integration, game loop, input, ROM loading
```

## The Absurdity in Detail

A `<canvas>` renderer does this per frame: loop over 61,440 pixels, write RGBA values to an `ImageData`, call `putImageData()`. Done. One

This renderer, per frame:

1. Reads ~20 PPU register values and references to 4 nametable arrays, 512 tile objects, and 64 sprites
2. Compares 32 palette entries against their previous values to determine which of 8 palette groups are dirty
3. For each dirty palette group, iterates 256 tiles x 64 pixels = 16,384 pixel lookups, writes them into a 128x128 `ImageData`, calls `putImageData()`, then `toDataURL('image/png')` to produce a base64 PNG string
4. Concatenates up to 8 of these base64 PNGs (each ~10-20KB of ASCII) into CSS rules and writes them to a `<style>` element's `textContent`, triggering a full CSSOM reparse
5. Iterates 3,840 tile slots across 4 nametable quadrants, comparing tile index and attribute against previous values, and for each changed tile sets `className`, `style.backgroundPosition`, and up to 4 `dataset` properties
6. Repositions 4 absolutely-positioned 256x240 CSS Grid containers based on scroll registers to handle nametable wrapping in a 512x480 virtual space
7. Updates 64 sprite divs with position, z-index, transform (for flip), class (for palette spritesheet), background-position (for tile selection), and 8 data attributes each
8. Sets the viewport's `backgroundColor` to the NES universal background color

The browser then takes this pile of DOM mutations, recalculates styles, reflows the grid layouts, composites the layers, and somehow produces a frame that looks correct. At 60fps. Mostly.

For comparison: the NES PPU does all of this in hardware with a 5.37 MHz clock, 2KB of VRAM, and no opinions about CSS specificity.

## Known Limitations

- **No mid-frame scroll splits** — uses end-of-frame scroll registers (status bars will scroll with playfield)
- **BG priority is z-index based** — no per-pixel transparency check for sprites behind BG
- **No audio** — visual rendering only
- **8x16 sprites** — basic support, may have edge cases with CHR bank selection
- **No mapper-specific CHR bankswitching detection** — relies on tile checksum dirty tracking

## Credits

Built on [jsnes](https://github.com/bfirsh/jsnes) by [Ben Firshman](https://github.com/bfirsh) and contributors — a JavaScript NES emulator that does all the actual hard work of emulating a 6502 CPU, PPU, and cartridge mappers. This project just reads the PPU state jsnes computes and renders it in the worst way possible.
