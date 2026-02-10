/**
 * Main app: jsnes integration, game loop, input handling, ROM loading.
 */
import { NES } from 'jsnes';
import { PPUStateExtractor } from './ppu-state-extractor.js';
import { CSSRenderer } from './css-renderer.js';

// --- NES Setup ---
let nes;
let extractor;
let renderer;
let latestPPUState = null;

function initNES() {
  nes = new NES({
    onFrame(buffer) {
      // Extract PPU state at end of frame
      latestPPUState = extractor.extract();
      latestPPUState.buffer = buffer;
    },
    onAudioSample() {
      // Audio discarded — this is a visual POC
    },
  });
  extractor = new PPUStateExtractor(nes);
}

// --- Renderer Setup ---
const wrapperEl = document.getElementById('viewport-wrapper');
renderer = new CSSRenderer(wrapperEl);
renderer.initAnnotation(() => latestPPUState);

// --- Canvas mode ---
const compareCanvas = document.getElementById('compare-canvas');
const compareCtx = compareCanvas.getContext('2d');

function renderCanvasFrame(buffer) {
  const imgData = compareCtx.createImageData(256, 240);
  const data = imgData.data;
  for (let i = 0; i < 256 * 240; i++) {
    // jsnes buffer is 0xBBGGRR (little-endian Uint32 canvas compat)
    const color = buffer[i];
    data[i * 4] = color & 0xff;            // R
    data[i * 4 + 1] = (color >> 8) & 0xff; // G
    data[i * 4 + 2] = (color >> 16) & 0xff; // B
    data[i * 4 + 3] = 0xff;
  }
  compareCtx.putImageData(imgData, 0, 0);
}

// --- Game Loop ---
let running = false;
let paused = false;
let lastFrameTime = 0;
let frameCount = 0;
let fpsAccum = 0;
let rafId = null;

const fpsEl = document.getElementById('fps-counter');

function gameLoop(timestamp) {
  if (!running || paused) return;

  // Throttle to ~60fps
  const elapsed = timestamp - lastFrameTime;
  if (elapsed < 14) {
    rafId = requestAnimationFrame(gameLoop);
    return;
  }
  lastFrameTime = timestamp;

  // Run NES frame — triggers onFrame callback
  nes.frame();

  // Render to active mode
  if (latestPPUState) {
    if (canvasMode) {
      renderCanvasFrame(latestPPUState.buffer);
    } else {
      renderer.renderFrame(latestPPUState);
    }
  }

  // FPS counter
  frameCount++;
  fpsAccum += elapsed;
  if (fpsAccum >= 1000) {
    fpsEl.textContent = `${Math.round(frameCount * 1000 / fpsAccum)} fps`;
    frameCount = 0;
    fpsAccum = 0;
  }

  rafId = requestAnimationFrame(gameLoop);
}

// --- ROM Loading ---
function loadROM(data) {
  initNES();

  // Convert ArrayBuffer to string (char per byte)
  const bytes = new Uint8Array(data);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }

  try {
    nes.loadROM(str);
  } catch (e) {
    document.getElementById('status-bar').textContent = `Error: ${e.message}`;
    return;
  }

  running = true;
  paused = false;
  updateButtonStates();
  document.getElementById('status-bar').textContent = 'Running';
  lastFrameTime = performance.now();
  frameCount = 0;
  fpsAccum = 0;
  rafId = requestAnimationFrame(gameLoop);
}

// File input
const romInput = document.getElementById('rom-input');
romInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadROM(reader.result);
  reader.readAsArrayBuffer(file);
});

// Drag and drop on body
document.body.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

document.body.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadROM(reader.result);
  reader.readAsArrayBuffer(file);
});

// --- Controls ---
const btnPause = document.getElementById('btn-pause');
const btnStep = document.getElementById('btn-step');
const btnToggleCanvas = document.getElementById('btn-toggle-canvas');
let canvasMode = false;

function updateButtonStates() {
  btnPause.disabled = !running;
  btnStep.disabled = !running || !paused;
  btnToggleCanvas.disabled = !running;
  btnPause.textContent = paused ? 'Resume' : 'Pause';
  btnToggleCanvas.textContent = canvasMode ? 'CSS Mode' : 'Canvas Mode';
}

btnPause.addEventListener('click', () => {
  paused = !paused;
  updateButtonStates();
  renderer.viewport.classList.toggle('paused', paused);
  if (!paused) {
    renderer.annotationPopover?.dismiss();
    lastFrameTime = performance.now();
    document.getElementById('status-bar').textContent = 'Running';
    rafId = requestAnimationFrame(gameLoop);
  } else {
    document.getElementById('status-bar').textContent = 'Paused';
    if (rafId) cancelAnimationFrame(rafId);
  }
});

btnStep.addEventListener('click', () => {
  if (!running || !paused) return;
  nes.frame();
  if (latestPPUState) {
    if (canvasMode) {
      renderCanvasFrame(latestPPUState.buffer);
    } else {
      renderer.renderFrame(latestPPUState);
    }
  }
  document.getElementById('status-bar').textContent = `Paused — Frame ${renderer.frameCount}`;
});

btnToggleCanvas.addEventListener('click', () => {
  canvasMode = !canvasMode;
  wrapperEl.style.display = canvasMode ? 'none' : '';
  compareCanvas.classList.toggle('active', canvasMode);
  updateButtonStates();
});

// --- Keyboard Input ---
// Uses e.code for shift (RightShift only) and e.key for everything else
document.addEventListener('keydown', (e) => {
  if (!nes) return;
  const btn = getButton(e);
  if (btn !== null) {
    nes.buttonDown(1, btn);
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  if (!nes) return;
  const btn = getButton(e);
  if (btn !== null) {
    nes.buttonUp(1, btn);
    e.preventDefault();
  }
});

function getButton(e) {
  switch (e.key) {
    case 'ArrowUp': return 4;
    case 'ArrowDown': return 5;
    case 'ArrowLeft': return 6;
    case 'ArrowRight': return 7;
    case 'z': case 'Z': return 0;
    case 'x': case 'X': return 1;
    case 'Enter': return 3;
  }
  // RightShift only for Select
  if (e.code === 'ShiftRight') return 2;
  return null;
}

// --- Debug Toggle Buttons ---
const debugButtons = {
  tileGrid: document.getElementById('dbg-tile-grid'),
  spriteBoxes: document.getElementById('dbg-sprite-boxes'),
  paletteRegions: document.getElementById('dbg-palette-regions'),
  scrollSplit: document.getElementById('dbg-scroll-split'),
  nametableSeam: document.getElementById('dbg-nt-seam'),
};

function wireDebugButton(name, btnEl) {
  btnEl.addEventListener('click', () => {
    const on = renderer.debugOverlay.toggle(name);
    btnEl.classList.toggle('active', on);
  });
}

wireDebugButton('tileGrid', debugButtons.tileGrid);
wireDebugButton('spriteBoxes', debugButtons.spriteBoxes);
wireDebugButton('paletteRegions', debugButtons.paletteRegions);
wireDebugButton('scrollSplit', debugButtons.scrollSplit);
wireDebugButton('nametableSeam', debugButtons.nametableSeam);

// --- Debug API ---
window.nesDebug = {
  showTileGrid() {
    const on = renderer.debugOverlay.toggle('tileGrid');
    debugButtons.tileGrid.classList.toggle('active', on);
  },
  showSpriteBoxes() {
    const on = renderer.debugOverlay.toggle('spriteBoxes');
    debugButtons.spriteBoxes.classList.toggle('active', on);
  },
  showPaletteRegions() {
    const on = renderer.debugOverlay.toggle('paletteRegions');
    debugButtons.paletteRegions.classList.toggle('active', on);
  },
  showScrollSplit() {
    const on = renderer.debugOverlay.toggle('scrollSplit');
    debugButtons.scrollSplit.classList.toggle('active', on);
  },
  showNametableSeam() {
    const on = renderer.debugOverlay.toggle('nametableSeam');
    debugButtons.nametableSeam.classList.toggle('active', on);
  },
  toggleAll() {
    const names = ['tileGrid', 'spriteBoxes', 'paletteRegions', 'scrollSplit', 'nametableSeam'];
    // If any are active, turn all off; otherwise turn all on
    const anyActive = names.some(n => renderer.debugOverlay.isActive(n));
    for (const name of names) {
      if (renderer.debugOverlay.isActive(name) === anyActive) {
        const on = renderer.debugOverlay.toggle(name);
        debugButtons[name].classList.toggle('active', on);
      }
    }
  },
  highlightPalette(group) {
    console.log('BG palette group', group, ':', renderer.paletteManager.getBgPaletteGroup(group));
    console.log('SPR palette group', group, ':', renderer.paletteManager.getSprPaletteGroup(group));
  },
  get state() { return latestPPUState; },
  get nes() { return nes; },
  get annotate() { return renderer.annotationPopover; },
};

updateButtonStates();
