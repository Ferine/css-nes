/**
 * Main app: jsnes integration, game loop, input handling, ROM loading.
 */
import { NES } from 'jsnes';
import { PPUStateExtractor } from './ppu-state-extractor.js';
import { PPUWriteTracer } from './ppu-write-tracer.js';
import { CSSRenderer } from './css-renderer.js';
import { MutationCounter } from './mutation-counter.js';

// --- NES Setup ---
let nes;
let extractor;
let tracer;
let renderer;
let latestPPUState = null;

function createNESInstance() {
  let instanceExtractor;
  let instanceTracer;
  const instanceNes = new NES({
    onFrame(buffer) {
      // Extract PPU state at end of frame
      const timingTrace = instanceTracer ? instanceTracer.consumeFrameTrace() : null;
      latestPPUState = instanceExtractor.extract({ timingTrace });
      latestPPUState.buffer = buffer;
    },
    onAudioSample() {
      // Audio discarded — this is a visual POC
    },
  });
  instanceExtractor = new PPUStateExtractor(instanceNes);
  instanceTracer = new PPUWriteTracer(instanceNes);
  instanceTracer.setTrackMapperWrites(true);
  return { nes: instanceNes, extractor: instanceExtractor, tracer: instanceTracer };
}

// --- Renderer Setup ---
const wrapperEl = document.getElementById('viewport-wrapper');
renderer = new CSSRenderer(wrapperEl);
renderer.initAnnotation(() => latestPPUState);
renderer.initInspector(document.getElementById('inspector-panel'));

// --- Stats counters ---
const mutCounter = new MutationCounter(renderer.viewport);
const mutEl = document.getElementById('mut-counter');
const domEl = document.getElementById('dom-counter');
const sprEl = document.getElementById('spr-counter');
const sheetEl = document.getElementById('sheet-counter');

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

function cancelGameLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function updateStats(mutCount, domNodes, visSprites, sheetRegens) {
  if (mutCount === null) {
    // Canvas mode / inactive — dim everything
    mutEl.textContent = '-- mut';
    mutEl.className = 'stat-dim';
    domEl.textContent = '-- nodes';
    domEl.className = 'stat-dim';
    sprEl.textContent = '-- spr';
    sprEl.className = 'stat-dim';
    sheetEl.textContent = '-- sheets';
    sheetEl.className = 'stat-dim';
    return;
  }

  // Mutations
  mutEl.textContent = MutationCounter.format(mutCount) + ' mut';
  mutEl.className = mutCount > 3000 ? 'stat-red' : mutCount >= 1000 ? 'stat-yellow' : 'stat-green';

  // DOM node count
  const domLabel = domNodes >= 1000 ? (domNodes / 1000).toFixed(1) + 'k' : String(domNodes);
  domEl.textContent = domLabel + ' nodes';
  domEl.className = domNodes > 5000 ? 'stat-red' : domNodes >= 2000 ? 'stat-yellow' : 'stat-green';

  // Visible sprites
  sprEl.textContent = visSprites + ' spr';
  sprEl.className = visSprites > 0 ? 'stat-blue' : 'stat-dim';

  // Sheet regenerations
  sheetEl.textContent = sheetRegens + '/12 sheets';
  sheetEl.className = sheetRegens >= 12 ? 'stat-red' : sheetRegens > 0 ? 'stat-yellow' : 'stat-green';
}

function gameLoop(timestamp) {
  if (!running || paused) {
    rafId = null;
    return;
  }

  // Throttle to ~60fps
  const elapsed = timestamp - lastFrameTime;
  if (elapsed < 14) {
    rafId = requestAnimationFrame(gameLoop);
    return;
  }
  lastFrameTime = timestamp;

  // Run NES frame — triggers onFrame callback
  tracer?.beginFrame();
  nes.frame();

  // Render to active mode
  if (latestPPUState) {
    if (canvasMode) {
      renderCanvasFrame(latestPPUState.buffer);
      mutCounter.snapshot();
      updateStats(null, 0, 0, 0);
    } else {
      renderer.renderFrame(latestPPUState);
      const mutCount = mutCounter.snapshot();
      const domNodes = renderer.viewport.getElementsByTagName('*').length;
      const visSprites = latestPPUState.sprites.filter(s => s.y > 0 && s.y < 239).length;
      const sheetRegens = renderer.tileCache.updatedSheets.size;
      updateStats(mutCount, domNodes, visSprites, sheetRegens);
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
  // Convert ArrayBuffer to string (char per byte)
  const bytes = new Uint8Array(data);
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }

  const { nes: nextNes, extractor: nextExtractor, tracer: nextTracer } = createNESInstance();

  try {
    nextNes.loadROM(str);
    nextTracer.install();
  } catch (e) {
    document.getElementById('status-bar').textContent = `Error: ${e.message}`;
    return;
  }

  cancelGameLoop();
  nes = nextNes;
  extractor = nextExtractor;
  tracer = nextTracer;
  latestPPUState = null;
  running = true;
  paused = false;
  renderer.viewport.classList.remove('paused');
  renderer.annotationPopover?.dismiss();
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
  // Sync layer toggle button states
  document.getElementById('layer-bg').classList.toggle('active', renderer.layerVisible.bg);
  document.getElementById('layer-sprites').classList.toggle('active', renderer.layerVisible.sprites);
}

btnPause.addEventListener('click', () => {
  paused = !paused;
  updateButtonStates();
  renderer.viewport.classList.toggle('paused', paused);
  if (!paused) {
    renderer.annotationPopover?.dismiss();
    lastFrameTime = performance.now();
    document.getElementById('status-bar').textContent = 'Running';
    cancelGameLoop();
    rafId = requestAnimationFrame(gameLoop);
  } else {
    document.getElementById('status-bar').textContent = 'Paused';
    cancelGameLoop();
  }
});

btnStep.addEventListener('click', () => {
  if (!running || !paused) return;
  tracer?.beginFrame();
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

// --- Layer Toggle Buttons ---
const layerBgBtn = document.getElementById('layer-bg');
const layerSpritesBtn = document.getElementById('layer-sprites');

layerBgBtn.addEventListener('click', () => {
  renderer.layerVisible.bg = !renderer.layerVisible.bg;
  layerBgBtn.classList.toggle('active', renderer.layerVisible.bg);
  renderer.applyLayerVisibility();
});

layerSpritesBtn.addEventListener('click', () => {
  renderer.layerVisible.sprites = !renderer.layerVisible.sprites;
  layerSpritesBtn.classList.toggle('active', renderer.layerVisible.sprites);
  renderer.applyLayerVisibility();
});

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

// --- Inspector Toggle Buttons ---
const inspectButtons = {
  nametable: document.getElementById('inspect-nt'),
  palette: document.getElementById('inspect-pal'),
  oam: document.getElementById('inspect-oam'),
  chr: document.getElementById('inspect-chr'),
};

function wireInspectButton(name, btnEl) {
  btnEl.addEventListener('click', () => {
    const on = renderer.inspectorPanels[name].toggle();
    btnEl.classList.toggle('active', on);
  });
}

wireInspectButton('nametable', inspectButtons.nametable);
wireInspectButton('palette', inspectButtons.palette);
wireInspectButton('oam', inspectButtons.oam);
wireInspectButton('chr', inspectButtons.chr);

// --- Keyboard Shortcuts ---
const debugShortcuts = {
  '1': 'tileGrid',
  '2': 'spriteBoxes',
  '3': 'paletteRegions',
  '4': 'scrollSplit',
  '5': 'nametableSeam',
};

const inspectShortcuts = {
  'n': 'nametable',
  'p': 'palette',
  'o': 'oam',
  'c': 'chr',
};

document.addEventListener('keydown', (e) => {
  // Skip if an input is focused
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // Layer toggles
  if (e.key === 'b' || e.key === 'B') {
    layerBgBtn.click();
    return;
  }
  if (e.key === 's' || e.key === 'S') {
    layerSpritesBtn.click();
    return;
  }

  // Debug overlay shortcuts
  const dbgName = debugShortcuts[e.key];
  if (dbgName) {
    const on = renderer.debugOverlay.toggle(dbgName);
    debugButtons[dbgName].classList.toggle('active', on);
    return;
  }

  // Inspector panel shortcuts
  const inspName = inspectShortcuts[e.key.toLowerCase()];
  if (inspName) {
    const on = renderer.inspectorPanels[inspName].toggle();
    inspectButtons[inspName].classList.toggle('active', on);
    return;
  }
});

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
