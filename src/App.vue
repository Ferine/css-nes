<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { NES } from 'jsnes';
import { PPUStateExtractor } from './ppu-state-extractor.js';
import { PPUWriteTracer } from './ppu-write-tracer.js';
import { CSSRenderer } from './css-renderer.js';
import { MutationCounter } from './mutation-counter.js';

// --- Template refs ---
const viewportWrapper = ref(null);
const inspectorPanel = ref(null);
const compareCanvas = ref(null);
const renderAreaEl = ref(null);

// --- NES state ---
let nes = null;
let extractor = null;
let tracer = null;
let renderer = null;
let mutCounter = null;
let latestPPUState = null;

// --- UI state ---
const running = ref(false);
const paused = ref(false);
const canvasMode = ref(false);
const isometricMode = ref(false);
const ultraWideMode = ref(false);
const statusText = ref('Drop a .nes ROM or click Load ROM');

const layerVisible = reactive({ bg: true, sprites: true });

const debugActive = reactive({
  tileGrid: false,
  spriteBoxes: false,
  paletteRegions: false,
  scrollSplit: false,
  nametableSeam: false,
});

const inspectActive = reactive({
  nametable: false,
  palette: false,
  oam: false,
  chr: false,
});

// --- Stats ---
const fpsText = ref('-- fps');
const stats = reactive({
  mut: { text: '-- mut', cls: 'stat-dim' },
  dom: { text: '-- nodes', cls: 'stat-dim' },
  spr: { text: '-- spr', cls: 'stat-dim' },
  sheets: { text: '-- sheets', cls: 'stat-dim' },
});

// --- Game loop vars ---
let lastFrameTime = 0;
let frameCount = 0;
let fpsAccum = 0;
let rafId = null;
let compareCtx = null;

// --- Iso camera ---
const isoCamera = {
  yawOffset: 0,
  tiltOffset: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  lastScrollX: null,
  lastScrollY: null,
};

const movementIntent = { up: false, down: false, left: false, right: false };

// --- Helpers ---
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

// --- NES factory ---
function createNESInstance() {
  let instanceExtractor;
  let instanceTracer;
  const instanceNes = new NES({
    onFrame(buffer) {
      const timingTrace = instanceTracer ? instanceTracer.consumeFrameTrace() : null;
      latestPPUState = instanceExtractor.extract({
        timingTrace,
        includeCanonicalRegions: false,
      });
      latestPPUState.buffer = buffer;
    },
    onAudioSample() {},
  });
  instanceExtractor = new PPUStateExtractor(instanceNes);
  instanceTracer = new PPUWriteTracer(instanceNes);
  instanceTracer.setTrackMapperWrites(true);
  return { nes: instanceNes, extractor: instanceExtractor, tracer: instanceTracer };
}

// --- Canvas rendering ---
function renderCanvasFrame(buffer) {
  const imgData = compareCtx.createImageData(256, 240);
  const data = imgData.data;
  for (let i = 0; i < 256 * 240; i++) {
    const color = buffer[i];
    data[i * 4] = color & 0xff;
    data[i * 4 + 1] = (color >> 8) & 0xff;
    data[i * 4 + 2] = (color >> 16) & 0xff;
    data[i * 4 + 3] = 0xff;
  }
  compareCtx.putImageData(imgData, 0, 0);
}

// --- Ultra-wide transform ---
function toUltraWideState(ppuState) {
  if (!ultraWideMode.value || !ppuState) return ppuState;

  const world = getWorldScroll(ppuState);
  const scrollX = world ? ((world.x % 512) + 512) % 512 : 0;
  const baseScroll = ppuState.scroll || {
    coarseX: 0, coarseY: 0, fineX: 0, fineY: 0, nameTableH: 0, nameTableV: 0,
  };
  const wideScroll = { ...baseScroll, coarseX: 0, fineX: 0, nameTableH: 0 };
  const scrollY = wideScroll.coarseY * 8 + wideScroll.fineY + wideScroll.nameTableV * 240;
  const remappedSprites = Array.isArray(ppuState.sprites)
    ? ppuState.sprites.map((spr) => ({ ...spr, x: ((spr.x + scrollX) % 512 + 512) % 512 }))
    : ppuState.sprites;

  const firstRegion = Array.isArray(ppuState.renderPlan?.regions) && ppuState.renderPlan.regions.length > 0
    ? ppuState.renderPlan.regions[0] : null;
  const region = {
    yStart: 0, yEnd: 240, scroll: wideScroll, scrollX: 0, scrollY,
    bgVisible: ppuState.bgVisible, spritesVisible: ppuState.spritesVisible,
    bgPatternBase: ppuState.bgPatternBase, sprPatternBase: ppuState.sprPatternBase,
    spriteSize: ppuState.spriteSize, mirrorMap: ppuState.mirrorMap,
    chrSignature: ppuState.chrBankSignature,
    chrSetKey: firstRegion?.chrSetKey ?? ppuState.chrSetKey,
  };

  return {
    ...ppuState, scroll: wideScroll, sprites: remappedSprites,
    renderPlan: {
      ...ppuState.renderPlan, mode: 'single', splitCount: 0,
      canonicalSplitCount: 0, canonicalRegionCount: 1,
      regions: [region], canonicalRegions: [region],
    },
  };
}

// --- Iso camera ---
function applyIsoCameraVars() {
  const el = renderAreaEl.value;
  if (!el) return;
  el.style.setProperty('--cam-tilt-offset', `${isoCamera.tiltOffset.toFixed(3)}deg`);
  el.style.setProperty('--cam-yaw-offset', `${isoCamera.yawOffset.toFixed(3)}deg`);
  el.style.setProperty('--cam-zoom', isoCamera.zoom.toFixed(4));
  el.style.setProperty('--cam-pan-x', `${isoCamera.panX.toFixed(3)}px`);
  el.style.setProperty('--cam-pan-y', `${isoCamera.panY.toFixed(3)}px`);
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

function setMovementIntent(button, isDown) {
  switch (button) {
    case 4: movementIntent.up = isDown; break;
    case 5: movementIntent.down = isDown; break;
    case 6: movementIntent.left = isDown; break;
    case 7: movementIntent.right = isDown; break;
  }
}

function updateIsoCameraMotion(ppuState) {
  if (!isometricMode.value) return;

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

  const motionLerp = running.value && !paused.value ? 0.14 : 0.2;
  const zoomLerp = running.value && !paused.value ? 0.1 : 0.16;
  isoCamera.yawOffset += (targetYawOffset - isoCamera.yawOffset) * motionLerp;
  isoCamera.tiltOffset += (targetTiltOffset - isoCamera.tiltOffset) * motionLerp;
  isoCamera.panX += (targetPanX - isoCamera.panX) * motionLerp;
  isoCamera.panY += (targetPanY - isoCamera.panY) * motionLerp;
  isoCamera.zoom += (targetZoom - isoCamera.zoom) * zoomLerp;

  applyIsoCameraVars();
}

// --- Stats update ---
function updateStats(mutCount, domNodes, visSprites, sheetRegens) {
  if (mutCount === null) {
    stats.mut = { text: '-- mut', cls: 'stat-dim' };
    stats.dom = { text: '-- nodes', cls: 'stat-dim' };
    stats.spr = { text: '-- spr', cls: 'stat-dim' };
    stats.sheets = { text: '-- sheets', cls: 'stat-dim' };
    return;
  }
  stats.mut = {
    text: MutationCounter.format(mutCount) + ' mut',
    cls: mutCount > 3000 ? 'stat-red' : mutCount >= 1000 ? 'stat-yellow' : 'stat-green',
  };
  const domLabel = domNodes >= 1000 ? (domNodes / 1000).toFixed(1) + 'k' : String(domNodes);
  stats.dom = {
    text: domLabel + ' nodes',
    cls: domNodes > 5000 ? 'stat-red' : domNodes >= 2000 ? 'stat-yellow' : 'stat-green',
  };
  stats.spr = {
    text: visSprites + ' spr',
    cls: visSprites > 0 ? 'stat-blue' : 'stat-dim',
  };
  stats.sheets = {
    text: sheetRegens + '/12 sheets',
    cls: sheetRegens >= 12 ? 'stat-red' : sheetRegens > 0 ? 'stat-yellow' : 'stat-green',
  };
}

// --- Game loop ---
function cancelGameLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function gameLoop(timestamp) {
  if (!running.value || paused.value) {
    rafId = null;
    return;
  }
  const elapsed = timestamp - lastFrameTime;
  if (elapsed < 14) {
    rafId = requestAnimationFrame(gameLoop);
    return;
  }
  lastFrameTime = timestamp;

  tracer?.beginFrame();
  nes.frame();

  if (latestPPUState) {
    const effectivePPUState = toUltraWideState(latestPPUState);
    if (canvasMode.value) {
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

  frameCount++;
  fpsAccum += elapsed;
  if (fpsAccum >= 1000) {
    fpsText.value = `${Math.round(frameCount * 1000 / fpsAccum)} fps`;
    frameCount = 0;
    fpsAccum = 0;
  }

  rafId = requestAnimationFrame(gameLoop);
}

// --- ROM loading ---
function loadROM(data) {
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
    statusText.value = `Error: ${e.message}`;
    return;
  }

  cancelGameLoop();
  nes = nextNes;
  extractor = nextExtractor;
  tracer = nextTracer;
  latestPPUState = null;
  running.value = true;
  paused.value = false;
  renderer.viewport.classList.remove('paused');
  renderer.annotationPopover?.dismiss();
  resetIsoCameraMotion();
  statusText.value = 'Running';
  lastFrameTime = performance.now();
  frameCount = 0;
  fpsAccum = 0;
  rafId = requestAnimationFrame(gameLoop);
}

function onFileInput(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadROM(reader.result);
  reader.readAsArrayBuffer(file);
}

// --- Drag and drop ---
const isDragover = ref(false);

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  isDragover.value = true;
}

function onDragLeave(e) {
  if (e.relatedTarget === null || !document.body.contains(e.relatedTarget)) {
    isDragover.value = false;
  }
}

function onDrop(e) {
  e.preventDefault();
  isDragover.value = false;
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadROM(reader.result);
  reader.readAsArrayBuffer(file);
}

// --- UI actions ---
function togglePause() {
  paused.value = !paused.value;
  renderer.viewport.classList.toggle('paused', paused.value);
  if (!paused.value) {
    renderer.annotationPopover?.dismiss();
    lastFrameTime = performance.now();
    statusText.value = 'Running';
    cancelGameLoop();
    rafId = requestAnimationFrame(gameLoop);
  } else {
    statusText.value = 'Paused';
    cancelGameLoop();
  }
}

function stepFrame() {
  if (!running.value || !paused.value) return;
  tracer?.beginFrame();
  nes.frame();
  if (latestPPUState) {
    const effectivePPUState = toUltraWideState(latestPPUState);
    if (canvasMode.value) {
      renderCanvasFrame(latestPPUState.buffer);
    } else {
      renderer.renderFrame(effectivePPUState);
    }
    updateIsoCameraMotion(effectivePPUState);
  } else {
    updateIsoCameraMotion(latestPPUState);
  }
  statusText.value = `Paused \u2014 Frame ${renderer.frameCount}`;
}

function toggleCanvasMode() {
  canvasMode.value = !canvasMode.value;
  if (canvasMode.value && ultraWideMode.value) {
    ultraWideMode.value = false;
    applyUltraWideMode();
  }
  viewportWrapper.value.style.display = canvasMode.value ? 'none' : '';
  compareCanvas.value.classList.toggle('active', canvasMode.value);
}

function toggleIsometric() {
  if (!isometricMode.value && ultraWideMode.value) {
    ultraWideMode.value = false;
    applyUltraWideMode();
  }
  isometricMode.value = !isometricMode.value;
  applyIsometricMode();
}

function toggleUltraWide() {
  if (canvasMode.value) return;
  if (!ultraWideMode.value && isometricMode.value) {
    isometricMode.value = false;
    applyIsometricMode();
  }
  ultraWideMode.value = !ultraWideMode.value;
  applyUltraWideMode();
}

function applyIsometricMode() {
  const el = renderAreaEl.value;
  if (!el) return;
  el.classList.toggle('isometric-mode', isometricMode.value);
  renderer.viewport.dataset.isometric = isometricMode.value ? '1' : '0';
  resetIsoCameraMotion();
  updateIsoCameraMotion(latestPPUState);
}

function applyUltraWideMode() {
  const el = renderAreaEl.value;
  if (!el) return;
  el.classList.toggle('ultra-wide', ultraWideMode.value);
  renderer.viewport.dataset.ultraWide = ultraWideMode.value ? '1' : '0';
}

// --- Layer toggles ---
function toggleLayer(layer) {
  layerVisible[layer] = !layerVisible[layer];
  renderer.layerVisible[layer] = layerVisible[layer];
  renderer.applyLayerVisibility();
}

// --- Debug toggles ---
function toggleDebug(name) {
  const on = renderer.debugOverlay.toggle(name);
  debugActive[name] = on;
}

// --- Inspector toggles ---
function toggleInspect(name) {
  const on = renderer.inspectorPanels[name].toggle();
  inspectActive[name] = on;
}

// --- Keyboard input ---
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
  if (e.code === 'ShiftRight') return 2;
  return null;
}

const debugShortcuts = { '1': 'tileGrid', '2': 'spriteBoxes', '3': 'paletteRegions', '4': 'scrollSplit', '5': 'nametableSeam' };
const inspectShortcuts = { 'n': 'nametable', 'p': 'palette', 'o': 'oam', 'c': 'chr' };

function onKeydown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // NES input
  if (nes) {
    const btn = getButton(e);
    if (btn !== null) {
      nes.buttonDown(1, btn);
      setMovementIntent(btn, true);
      e.preventDefault();
      return;
    }
  }

  // Layer toggles
  if (e.key === 'b' || e.key === 'B') { toggleLayer('bg'); return; }
  if (e.key === 's' || e.key === 'S') { toggleLayer('sprites'); return; }

  // View mode toggles
  if (e.key === 'i' || e.key === 'I') { toggleIsometric(); return; }
  if (e.key === 'u' || e.key === 'U') { toggleUltraWide(); return; }

  // Debug overlays
  const dbgName = debugShortcuts[e.key];
  if (dbgName) { toggleDebug(dbgName); return; }

  // Inspector panels
  const inspName = inspectShortcuts[e.key.toLowerCase()];
  if (inspName) { toggleInspect(inspName); }
}

function onKeyup(e) {
  if (!nes) return;
  const btn = getButton(e);
  if (btn !== null) {
    nes.buttonUp(1, btn);
    setMovementIntent(btn, false);
    e.preventDefault();
  }
}

function onBlur() {
  movementIntent.up = false;
  movementIntent.down = false;
  movementIntent.left = false;
  movementIntent.right = false;
}

// --- Computed ---
const pauseLabel = computed(() => paused.value ? 'Resume' : 'Pause');
const canvasLabel = computed(() => canvasMode.value ? 'CSS Mode' : 'Canvas Mode');
const isoLabel = computed(() => isometricMode.value ? 'Iso: On' : 'Iso Mode');
const ultraLabel = computed(() => ultraWideMode.value ? 'Ultra: On' : 'Ultra Wide');

// --- Lifecycle ---
onMounted(() => {
  renderer = new CSSRenderer(viewportWrapper.value);
  renderer.initAnnotation(() => latestPPUState);
  renderer.initInspector(inspectorPanel.value);

  mutCounter = new MutationCounter(renderer.viewport);
  compareCtx = compareCanvas.value.getContext('2d');

  applyUltraWideMode();
  applyIsometricMode();

  document.addEventListener('keydown', onKeydown);
  document.addEventListener('keyup', onKeyup);
  window.addEventListener('blur', onBlur);

  // Debug API
  window.nesDebug = {
    showTileGrid() { toggleDebug('tileGrid'); },
    showSpriteBoxes() { toggleDebug('spriteBoxes'); },
    showPaletteRegions() { toggleDebug('paletteRegions'); },
    showScrollSplit() { toggleDebug('scrollSplit'); },
    showNametableSeam() { toggleDebug('nametableSeam'); },
    toggleAll() {
      const names = ['tileGrid', 'spriteBoxes', 'paletteRegions', 'scrollSplit', 'nametableSeam'];
      const anyActive = names.some(n => renderer.debugOverlay.isActive(n));
      for (const name of names) {
        if (renderer.debugOverlay.isActive(name) === anyActive) {
          toggleDebug(name);
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
      if (enabled && ultraWideMode.value) { ultraWideMode.value = false; applyUltraWideMode(); }
      isometricMode.value = !!enabled;
      applyIsometricMode();
    },
    toggleIsometric,
    setUltraWide(enabled) {
      if (enabled && isometricMode.value) { isometricMode.value = false; applyIsometricMode(); }
      ultraWideMode.value = !!enabled;
      applyUltraWideMode();
    },
    toggleUltraWide,
  };
});

onUnmounted(() => {
  cancelGameLoop();
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('keyup', onKeyup);
  window.removeEventListener('blur', onBlur);
});
</script>

<template>
  <div
    class="app-root"
    :class="{ dragover: isDragover }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <header class="app-header">
      <h1>CSS<span class="title-dash">-</span>NES</h1>
      <span class="title-sub">CSS Layer Renderer</span>
    </header>

    <nav class="toolbar">
      <!-- Controls -->
      <div class="toolbar-group">
        <label class="rom-label">
          <span class="rom-label-icon">&#9654;</span> Load ROM
          <input type="file" accept=".nes" hidden @change="onFileInput">
        </label>
        <button :disabled="!running" @click="togglePause">{{ pauseLabel }}</button>
        <button :disabled="!running || !paused" @click="stepFrame">Step</button>
        <button :disabled="!running" @click="toggleCanvasMode">{{ canvasLabel }}</button>
        <button
          :class="{ active: isometricMode }"
          title="Toggle pseudo-3D isometric view [I]"
          @click="toggleIsometric"
        >{{ isoLabel }}</button>
        <button
          :class="{ active: ultraWideMode }"
          :disabled="!running || canvasMode"
          title="Show full horizontal level strip [U]"
          @click="toggleUltraWide"
        >{{ ultraLabel }}</button>
      </div>

      <!-- Layers -->
      <div class="toolbar-group">
        <span class="group-label">Layers</span>
        <button
          class="layer-toggle"
          :class="{ active: layerVisible.bg }"
          title="Toggle background layer [B]"
          @click="toggleLayer('bg')"
        >BG</button>
        <button
          class="layer-toggle"
          :class="{ active: layerVisible.sprites }"
          title="Toggle sprite layer [S]"
          @click="toggleLayer('sprites')"
        >Sprites</button>
      </div>

      <!-- Debug -->
      <div class="toolbar-group">
        <span class="group-label">Debug</span>
        <button
          v-for="(label, key) in { tileGrid: 'Grid', spriteBoxes: 'Boxes', paletteRegions: 'Palette', scrollSplit: 'Split', nametableSeam: 'Seam' }"
          :key="key"
          class="debug-toggle"
          :class="{ active: debugActive[key] }"
          @click="toggleDebug(key)"
        >{{ label }}</button>
      </div>

      <!-- Inspect -->
      <div class="toolbar-group">
        <span class="group-label">Inspect</span>
        <button
          v-for="(label, key) in { nametable: 'NT Map', palette: 'Palette', oam: 'OAM', chr: 'CHR' }"
          :key="key"
          class="inspect-toggle"
          :class="{ active: inspectActive[key] }"
          @click="toggleInspect(key)"
        >{{ label }}</button>
      </div>
    </nav>

    <div class="shortcut-strip" aria-label="Keyboard shortcuts">
      <span class="shortcut-title">Keys</span>
      <span class="shortcut-item"><kbd>Arrows</kbd> Move</span>
      <span class="shortcut-item"><kbd>Z</kbd> A</span>
      <span class="shortcut-item"><kbd>X</kbd> B</span>
      <span class="shortcut-item"><kbd>Enter</kbd> Start</span>
      <span class="shortcut-item"><kbd>RShift</kbd> Select</span>
      <span class="shortcut-item"><kbd>B</kbd> BG</span>
      <span class="shortcut-item"><kbd>S</kbd> Sprites</span>
      <span class="shortcut-item"><kbd>I</kbd> Iso</span>
      <span class="shortcut-item"><kbd>U</kbd> Ultra</span>
      <span class="shortcut-item"><kbd>1-5</kbd> Debug</span>
      <span class="shortcut-item"><kbd>N</kbd><kbd>P</kbd><kbd>O</kbd><kbd>C</kbd> Inspect</span>
    </div>

    <div class="main-content">
      <div ref="renderAreaEl" class="render-area">
        <div class="crt-bezel">
          <div ref="viewportWrapper" id="viewport-wrapper" class="viewport-wrapper">
            <!-- CSSRenderer mounts here -->
          </div>
          <canvas ref="compareCanvas" class="canvas-mode" width="256" height="240"></canvas>
          <div class="crt-scanlines"></div>
          <div class="crt-glow"></div>
        </div>
      </div>
      <div ref="inspectorPanel" class="inspector-panel"></div>
    </div>

    <footer class="status-bar">
      <span class="status-led" :class="{ 'status-led-on': running }"></span>
      <span>{{ statusText }}</span>
      <span class="status-counters">
        <span class="stat-green">{{ fpsText }}</span>
        <span :class="stats.mut.cls">{{ stats.mut.text }}</span>
        <span :class="stats.dom.cls">{{ stats.dom.text }}</span>
        <span :class="stats.spr.cls">{{ stats.spr.text }}</span>
        <span :class="stats.sheets.cls">{{ stats.sheets.text }}</span>
      </span>
    </footer>
  </div>
</template>

<style>
/* Status LED - controlled by class instead of :has() for broader compat */
.status-led-on {
  background: var(--accent) !important;
  box-shadow:
    0 0 4px rgba(94, 234, 212, 0.6),
    0 0 10px rgba(94, 234, 212, 0.3) !important;
  animation: led-pulse 2s ease-in-out infinite;
}

@keyframes led-pulse {
  0%, 100% {
    box-shadow:
      0 0 4px rgba(94, 234, 212, 0.6),
      0 0 10px rgba(94, 234, 212, 0.3);
  }
  50% {
    box-shadow:
      0 0 6px rgba(94, 234, 212, 0.8),
      0 0 16px rgba(94, 234, 212, 0.4);
  }
}
</style>
