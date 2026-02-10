#!/bin/bash
# Re-injects project context after auto-compaction so Claude retains
# key knowledge about the codebase.
cat <<'CTX'
Project: css-nes — NES emulator renderer using CSS/DOM instead of canvas.
Stack: Vite + vanilla JS (ES modules). Tests: Vitest + happy-dom.
Commands: npm test (vitest run), npm run dev (vite).

Source modules (src/):
  ppu-state-extractor.js — Extracts PPU snapshot from jsnes internals
  palette-manager.js     — Converts 0xBBGGRR→#RRGGBB, tracks dirty palette groups
  tile-cache.js          — Renders 8 spritesheet canvases (4 bg + 4 spr), dynamic <style>
  bg-layer.js            — 4-quadrant nametable grid (960 tiles each), scroll wrapping
  sprite-layer.js        — 64 sprite divs with 8x8/8x16 modes, flip/priority
  css-renderer.js        — Orchestrator: palette→tileCache→bgLayer→spriteLayer→viewport

Test structure (tests/):
  helpers/  — mock-nes.js, mock-ppu-state.js, mock-tile-cache.js
  unit/     — Pure Node tests (extractor, palette, tile-cache hash/position)
  dom/      — happy-dom tests (tile-cache, bg-layer, sprite-layer, css-renderer)
             DOM tests use "// @vitest-environment happy-dom" directive.
CTX
exit 0
