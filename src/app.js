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
      latestPPUState = instanceExtractor.extract({
        timingTrace,
        includeCanonicalRegions: false,
      });
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

// --- Iso camera micro-motion (typed CSS vars + inertial updates) ---
const isoCamera = {
  yawOffset: 0,
  tiltOffset: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  lastScrollX: null,
  lastScrollY: null,
};

const movementIntent = {
  up: false,
  down: false,
  left: false,
  right: false,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrappedDelta(current, previous, period) {
  let delta = current - previous;
  const half = period / 2;
  if (delta > half) delta -= period;
  if (delta < -half) delta += period;
  return delta;
}

function getWorldScroll(ppuState) {
  const s = ppuState?.scroll;
  if (!s) return null;
  return {
    x: s.coarseX * 8 + s.fineX + s.nameTableH * 256,
    y: s.coarseY * 8 + s.fineY + s.nameTableV * 240,
  };
}

function toUltraWideState(ppuState) {
  if (!ultraWideMode || !ppuState) return ppuState;

  const world = getWorldScroll(ppuState);
  const scrollX = world ? ((world.x % 512) + 512) % 512 : 0;
  const baseScroll = ppuState.scroll || {
    coarseX: 0,
    coarseY: 0,
    fineX: 0,
    fineY: 0,
    nameTableH: 0,
    nameTableV: 0,
  };
  const wideScroll = {
    ...baseScroll,
    coarseX: 0,
    fineX: 0,
    nameTableH: 0,
  };

  const scrollY = wideScroll.coarseY * 8 + wideScroll.fineY + wideScroll.nameTableV * 240;
  const remappedSprites = Array.isArray(ppuState.sprites)
    ? ppuState.sprites.map((spr) => ({
      ...spr,
      x: ((spr.x + scrollX) % 512 + 512) % 512,
    }))
    : ppuState.sprites;

  const firstRegion = Array.isArray(ppuState.renderPlan?.regions) && ppuState.renderPlan.regions.length > 0
    ? ppuState.renderPlan.regions[0]
    : null;
  const region = {
    yStart: 0,
    yEnd: 240,
    scroll: wideScroll,
    scrollX: 0,
    scrollY,
    bgVisible: ppuState.bgVisible,
    spritesVisible: ppuState.spritesVisible,
    bgPatternBase: ppuState.bgPatternBase,
    sprPatternBase: ppuState.sprPatternBase,
    spriteSize: ppuState.spriteSize,
    mirrorMap: ppuState.mirrorMap,
    chrSignature: ppuState.chrBankSignature,
    chrSetKey: firstRegion?.chrSetKey ?? ppuState.chrSetKey,
  };

  return {
    ...ppuState,
    scroll: wideScroll,
    sprites: remappedSprites,
    renderPlan: {
      ...ppuState.renderPlan,
      mode: 'single',
      splitCount: 0,
      canonicalSplitCount: 0,
      canonicalRegionCount: 1,
      regions: [region],
      canonicalRegions: [region],
    },
  };
}

function applyIsoCameraVars() {
  if (!renderAreaEl) return;
  renderAreaEl.style.setProperty('--cam-tilt-offset', `${isoCamera.tiltOffset.toFixed(3)}deg`);
  renderAreaEl.style.setProperty('--cam-yaw-offset', `${isoCamera.yawOffset.toFixed(3)}deg`);
  renderAreaEl.style.setProperty('--cam-zoom', isoCamera.zoom.toFixed(4));
  renderAreaEl.style.setProperty('--cam-pan-x', `${isoCamera.panX.toFixed(3)}px`);
  renderAreaEl.style.setProperty('--cam-pan-y', `${isoCamera.panY.toFixed(3)}px`);
}

function resetIsoCameraMotion() {
  isoCamera.yawOffset = 0;
  isoCamera.tiltOffset = 0;
  isoCamera.zoom = 1;
  isoCamera.panX = 0;
  isoCamera.panY = 0;
  isoCamera.lastScrollX = null;
  isoCamera.lastScrollY = null;
  applyIsoCameraVars();
}

function updateIsoCameraMotion(ppuState) {
  if (!isometricMode) return;

  let velX = 0;
  let velY = 0;
  const world = getWorldScroll(ppuState);

  if (world) {
    if (isoCamera.lastScrollX === null || isoCamera.lastScrollY === null) {
      isoCamera.lastScrollX = world.x;
      isoCamera.lastScrollY = world.y;
    } else {
      velX = wrappedDelta(world.x, isoCamera.lastScrollX, 512);
      velY = wrappedDelta(world.y, isoCamera.lastScrollY, 480);
      isoCamera.lastScrollX = world.x;
      isoCamera.lastScrollY = world.y;
    }
  } else {
    isoCamera.lastScrollX = null;
    isoCamera.lastScrollY = null;
  }

  velX = clamp(velX, -8, 8);
  velY = clamp(velY, -6, 6);

  const inputX = (movementIntent.right ? 1 : 0) - (movementIntent.left ? 1 : 0);
  const inputY = (movementIntent.down ? 1 : 0) - (movementIntent.up ? 1 : 0);
  const speed = Math.hypot(velX, velY);

  const targetYawOffset = clamp((-velX * 0.42) + (inputX * -1.1), -3.2, 3.2);
  const targetTiltOffset = clamp((velY * 0.3) + (inputY * 0.95), -2.6, 2.6);
  const targetZoom = clamp(1 + speed * 0.0038 + ((inputX || inputY) ? 0.01 : 0), 1, 1.05);
  const targetPanX = clamp((-velX * 0.9) + (inputX * -2.2), -9, 9);
  const targetPanY = clamp((-velY * 0.65) + (inputY * -1.4), -7, 7);

  const motionLerp = running && !paused ? 0.14 : 0.2;
  const zoomLerp = running && !paused ? 0.1 : 0.16;
  isoCamera.yawOffset += (targetYawOffset - isoCamera.yawOffset) * motionLerp;
  isoCamera.tiltOffset += (targetTiltOffset - isoCamera.tiltOffset) * motionLerp;
  isoCamera.panX += (targetPanX - isoCamera.panX) * motionLerp;
  isoCamera.panY += (targetPanY - isoCamera.panY) * motionLerp;
  isoCamera.zoom += (targetZoom - isoCamera.zoom) * zoomLerp;

  applyIsoCameraVars();
}

function setMovementIntent(button, isDown) {
  switch (button) {
    case 4: movementIntent.up = isDown; break;
    case 5: movementIntent.down = isDown; break;
    case 6: movementIntent.left = isDown; break;
    case 7: movementIntent.right = isDown; break;
    default: break;
  }
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
    const effectivePPUState = toUltraWideState(latestPPUState);
    if (canvasMode) {
      renderCanvasFrame(latestPPUState.buffer);
      mutCounter.snapshot();
      updateStats(null, 0, 0, 0);
    } else {
      renderer.renderFrame(effectivePPUState);
      const mutCount = mutCounter.snapshot();
      const domNodes = renderer.viewport.getElementsByTagName('*').length;
      const visSprites = effectivePPUState.sprites.filter(s => s.y > 0 && s.y < 239).length;
      const sheetRegens = renderer.tileCache.updatedSheets.size;
      updateStats(mutCount, domNodes, visSprites, sheetRegens);
    }
    updateIsoCameraMotion(effectivePPUState);
  } else {
    updateIsoCameraMotion(latestPPUState);
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
  resetIsoCameraMotion();
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
const btnIsometric = document.getElementById('btn-isometric');
const btnUltraWide = document.getElementById('btn-ultrawide');
const renderAreaEl = document.querySelector('.render-area');
let canvasMode = false;
let isometricMode = false;
let ultraWideMode = false;

function updateButtonStates() {
  btnPause.disabled = !running;
  btnStep.disabled = !running || !paused;
  btnToggleCanvas.disabled = !running;
  btnUltraWide.disabled = !running || canvasMode;
  btnPause.textContent = paused ? 'Resume' : 'Pause';
  btnToggleCanvas.textContent = canvasMode ? 'CSS Mode' : 'Canvas Mode';
  btnIsometric.classList.toggle('active', isometricMode);
  btnIsometric.textContent = isometricMode ? 'Iso: On' : 'Iso Mode';
  btnUltraWide.classList.toggle('active', ultraWideMode);
  btnUltraWide.textContent = ultraWideMode ? 'Ultra: On' : 'Ultra Wide';
  // Sync layer toggle button states
  document.getElementById('layer-bg').classList.toggle('active', renderer.layerVisible.bg);
  document.getElementById('layer-sprites').classList.toggle('active', renderer.layerVisible.sprites);
}

function applyIsometricMode() {
  renderAreaEl.classList.toggle('isometric-mode', isometricMode);
  renderer.viewport.dataset.isometric = isometricMode ? '1' : '0';
  resetIsoCameraMotion();
  updateIsoCameraMotion(latestPPUState);
  updateButtonStates();
}

function applyUltraWideMode() {
  renderAreaEl.classList.toggle('ultra-wide', ultraWideMode);
  renderer.viewport.dataset.ultraWide = ultraWideMode ? '1' : '0';
  updateButtonStates();
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
    const effectivePPUState = toUltraWideState(latestPPUState);
    if (canvasMode) {
      renderCanvasFrame(latestPPUState.buffer);
    } else {
      renderer.renderFrame(effectivePPUState);
    }
    updateIsoCameraMotion(effectivePPUState);
  } else {
    updateIsoCameraMotion(latestPPUState);
  }
  document.getElementById('status-bar').textContent = `Paused — Frame ${renderer.frameCount}`;
});

btnToggleCanvas.addEventListener('click', () => {
  canvasMode = !canvasMode;
  if (canvasMode && ultraWideMode) {
    ultraWideMode = false;
    applyUltraWideMode();
  }
  wrapperEl.style.display = canvasMode ? 'none' : '';
  compareCanvas.classList.toggle('active', canvasMode);
  updateButtonStates();
});

btnIsometric.addEventListener('click', () => {
  if (!isometricMode && ultraWideMode) {
    ultraWideMode = false;
    applyUltraWideMode();
  }
  isometricMode = !isometricMode;
  applyIsometricMode();
});

btnUltraWide.addEventListener('click', () => {
  if (canvasMode) return;
  if (!ultraWideMode && isometricMode) {
    isometricMode = false;
    applyIsometricMode();
  }
  ultraWideMode = !ultraWideMode;
  applyUltraWideMode();
});

// --- Keyboard Input ---
// Uses e.code for shift (RightShift only) and e.key for everything else
document.addEventListener('keydown', (e) => {
  if (!nes) return;
  const btn = getButton(e);
  if (btn !== null) {
    nes.buttonDown(1, btn);
    setMovementIntent(btn, true);
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  if (!nes) return;
  const btn = getButton(e);
  if (btn !== null) {
    nes.buttonUp(1, btn);
    setMovementIntent(btn, false);
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

window.addEventListener('blur', () => {
  movementIntent.up = false;
  movementIntent.down = false;
  movementIntent.left = false;
  movementIntent.right = false;
});

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

  // Isometric toggle
  if (e.key === 'i' || e.key === 'I') {
    btnIsometric.click();
    return;
  }

  // Ultra-wide toggle
  if (e.key === 'u' || e.key === 'U') {
    btnUltraWide.click();
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
  setIsometric(enabled) {
    if (enabled && ultraWideMode) {
      ultraWideMode = false;
      applyUltraWideMode();
    }
    isometricMode = !!enabled;
    applyIsometricMode();
  },
  toggleIsometric() {
    if (!isometricMode && ultraWideMode) {
      ultraWideMode = false;
      applyUltraWideMode();
    }
    isometricMode = !isometricMode;
    applyIsometricMode();
  },
  setUltraWide(enabled) {
    if (enabled && isometricMode) {
      isometricMode = false;
      applyIsometricMode();
    }
    ultraWideMode = !!enabled;
    applyUltraWideMode();
  },
  toggleUltraWide() {
    if (!ultraWideMode && isometricMode) {
      isometricMode = false;
      applyIsometricMode();
    }
    ultraWideMode = !ultraWideMode;
    applyUltraWideMode();
  },
};

applyUltraWideMode();
applyIsometricMode();
updateButtonStates();
