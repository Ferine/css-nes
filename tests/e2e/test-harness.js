/**
 * E2E test harness: loads a ROM, steps frames, renders to both CSS and canvas.
 * Exposes window.testHarness for Playwright to drive.
 */
import { NES } from 'jsnes';
import { PPUStateExtractor } from '../../src/ppu-state-extractor.js';
import { PPUWriteTracer } from '../../src/ppu-write-tracer.js';
import { CSSRenderer } from '../../src/css-renderer.js';

const wrapperEl = document.getElementById('viewport-wrapper');
const canvas = document.getElementById('ref-canvas');
const ctx = canvas.getContext('2d');

let nes = null;
let extractor = null;
let tracer = null;
let renderer = null;
let latestPPUState = null;
let latestTimingTrace = null;
let frameCount = 0;
let ready = false;
let timingTraceEnabled = false;
let mapperTraceEnabled = false;

function renderCanvasFrame(buffer) {
  const imgData = ctx.createImageData(256, 240);
  const data = imgData.data;
  for (let i = 0; i < 256 * 240; i++) {
    const color = buffer[i];
    data[i * 4] = color & 0xff;
    data[i * 4 + 1] = (color >> 8) & 0xff;
    data[i * 4 + 2] = (color >> 16) & 0xff;
    data[i * 4 + 3] = 0xff;
  }
  ctx.putImageData(imgData, 0, 0);
}

window.testHarness = {
  /**
   * Load a ROM from a byte array (number[]).
   * Playwright can't transfer Uint8Array, so we accept plain arrays.
   */
  loadROM(romBytes) {
    nes = new NES({
      onFrame(buffer) {
        const timingTrace = timingTraceEnabled && tracer ? tracer.consumeFrameTrace() : null;
        latestTimingTrace = timingTrace;
        latestPPUState = extractor.extract({ timingTrace });
        latestPPUState.buffer = buffer;
      },
      onAudioSample() {},
    });
    extractor = new PPUStateExtractor(nes);
    tracer = new PPUWriteTracer(nes);
    tracer.setTrackMapperWrites(mapperTraceEnabled);
    renderer = new CSSRenderer(wrapperEl);

    // Convert number[] to char string for jsnes
    let str = '';
    for (let i = 0; i < romBytes.length; i++) {
      str += String.fromCharCode(romBytes[i]);
    }
    nes.loadROM(str);
    tracer.install();
    latestTimingTrace = null;
    frameCount = 0;
    ready = true;
  },

  /**
   * Step N frames, rendering to both CSS and canvas each frame.
   * Runs in chunks of 60 to avoid blocking the browser main thread.
   */
  async stepFrames(n) {
    const CHUNK = 60;
    let remaining = n;
    while (remaining > 0) {
      const batch = Math.min(remaining, CHUNK);
      for (let i = 0; i < batch; i++) {
        if (timingTraceEnabled && tracer) tracer.beginFrame();
        nes.frame();
        if (latestPPUState) {
          renderer.renderFrame(latestPPUState);
          renderCanvasFrame(latestPPUState.buffer);
        }
        frameCount++;
      }
      remaining -= batch;
      // Yield to browser for style recalc between chunks
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  },

  /**
   * Step N frames and return timing/region/CHR diagnostics for the segment.
   */
  async stepFramesWithDiagnostics(n, options = {}) {
    const CHUNK = 60;
    const sampleEvery = Math.max(0, options.sampleEvery ?? 60);
    const maxSamples = Math.max(0, options.maxSamples ?? 256);
    const summary = createDiagnosticsSummary(frameCount, timingTraceEnabled, sampleEvery, maxSamples);
    let previousCHRSignature = latestPPUState?.chrBankSignature ?? null;

    let remaining = n;
    while (remaining > 0) {
      const batch = Math.min(remaining, CHUNK);
      for (let i = 0; i < batch; i++) {
        if (timingTraceEnabled && tracer) tracer.beginFrame();
        nes.frame();

        if (latestPPUState) {
          renderer.renderFrame(latestPPUState);
          renderCanvasFrame(latestPPUState.buffer);
        }

        frameCount++;

        if (latestPPUState) {
          previousCHRSignature = recordDiagnosticsFrame(
            summary,
            frameCount,
            latestPPUState,
            latestTimingTrace,
            previousCHRSignature
          );
        }
      }
      remaining -= batch;
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    return finalizeDiagnosticsSummary(summary, frameCount);
  },

  buttonDown(btn) {
    if (nes) nes.buttonDown(1, btn);
  },

  buttonUp(btn) {
    if (nes) nes.buttonUp(1, btn);
  },

  setTimingTraceEnabled(enabled) {
    timingTraceEnabled = !!enabled;
    latestTimingTrace = null;
    return timingTraceEnabled;
  },

  getTimingTraceEnabled() {
    return timingTraceEnabled;
  },

  setMapperTraceEnabled(enabled) {
    mapperTraceEnabled = !!enabled;
    if (tracer) tracer.setTrackMapperWrites(mapperTraceEnabled);
    return mapperTraceEnabled;
  },

  getMapperTraceEnabled() {
    return mapperTraceEnabled;
  },

  getLatestTimingTrace() {
    if (!latestTimingTrace) return null;
    return {
      startState: latestTimingTrace.startState,
      events: latestTimingTrace.events.map((event) => ({
        seq: event.seq,
        address: event.address,
        value: event.value,
        phase: event.phase,
        scanline: event.scanline,
        dot: event.dot,
        screenY: event.screenY,
        before: event.before,
        after: event.after,
      })),
    };
  },

  getLatestPPUSummary() {
    if (!latestPPUState) return null;
    return {
      frame: frameCount,
      scroll: latestPPUState.scroll,
      mirrorMap: latestPPUState.mirrorMap,
      bgPatternBase: latestPPUState.bgPatternBase,
      sprPatternBase: latestPPUState.sprPatternBase,
      spriteSize: latestPPUState.spriteSize,
      renderPlan: latestPPUState.renderPlan,
      bgVisible: latestPPUState.bgVisible,
      spritesVisible: latestPPUState.spritesVisible,
    };
  },

  getNametableDebug(rows = 30, cols = 32) {
    if (!latestPPUState?.nameTables) return null;
    const r = Math.max(1, Math.min(30, rows | 0));
    const c = Math.max(1, Math.min(32, cols | 0));
    const out = [];
    for (let nt = 0; nt < 4; nt++) {
      const table = latestPPUState.nameTables[nt];
      if (!table?.tile) {
        out.push(null);
        continue;
      }
      const grid = [];
      for (let y = 0; y < r; y++) {
        const row = [];
        for (let x = 0; x < c; x++) {
          row.push(table.tile[y * 32 + x]);
        }
        grid.push(row);
      }
      out.push(grid);
    }
    return out;
  },

  isReady() {
    return ready;
  },

  getFrameCount() {
    return frameCount;
  },
};

function createDiagnosticsSummary(startFrame, timingEnabled, sampleEvery, maxSamples) {
  return {
    startFrame,
    timingTraceEnabled: timingEnabled,
    mapperTraceEnabled,
    sampleEvery,
    maxSamples,
    totalFrames: 0,
    framesWithTrace: 0,
    framesWithVisibleTrace: 0,
    totalTraceEvents: 0,
    totalVisibleTraceEvents: 0,
    visibleWriteCounts: { '0x2000': 0, '0x2001': 0, '0x2005': 0, '0x2006': 0 },
    framesWithVisibleWrites: { '0x2000': 0, '0x2001': 0, '0x2005': 0, '0x2006': 0 },
    regionHistogram: { '1': 0, '2': 0, '3+': 0 },
    framesWithMultiRegion: 0,
    framesWithMixedBgPatternBase: 0,
    framesWithMixedSprPatternBase: 0,
    maxRegionCount: 0,
    chrBankSwitchFrames: 0,
    chrBankSwitchByRegion: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0 },
    maxChrRegionsSwitchedPerFrame: 0,
    framesWithSheetRegens: 0,
    totalSheetRegens: 0,
    maxSheetRegensPerFrame: 0,
    maxTraceEventsPerFrame: 0,
    maxVisibleTraceEventsPerFrame: 0,
    totalMapperWrites: 0,
    totalVisibleMapperWrites: 0,
    framesWithMapperWrites: 0,
    framesWithVisibleMapperWrites: 0,
    visibleMapperWriteCounts: {},
    samples: [],
  };
}

function recordDiagnosticsFrame(summary, frame, ppuState, timingTrace, previousCHRSignature) {
  summary.totalFrames++;

  const events = Array.isArray(timingTrace?.events) ? timingTrace.events : [];
  const visibleEvents = events.filter((event) => event.phase === 'visible');
  const traceCount = events.length;
  const visibleCount = visibleEvents.length;
  const mapperEvents = events.filter((event) => event.address >= 0x8000);
  const visibleMapperEvents = visibleEvents.filter((event) => event.address >= 0x8000);

  if (traceCount > 0) summary.framesWithTrace++;
  if (visibleCount > 0) summary.framesWithVisibleTrace++;
  if (mapperEvents.length > 0) summary.framesWithMapperWrites++;
  if (visibleMapperEvents.length > 0) summary.framesWithVisibleMapperWrites++;
  summary.totalTraceEvents += traceCount;
  summary.totalVisibleTraceEvents += visibleCount;
  summary.totalMapperWrites += mapperEvents.length;
  summary.totalVisibleMapperWrites += visibleMapperEvents.length;
  summary.maxTraceEventsPerFrame = Math.max(summary.maxTraceEventsPerFrame, traceCount);
  summary.maxVisibleTraceEventsPerFrame = Math.max(summary.maxVisibleTraceEventsPerFrame, visibleCount);

  const frameVisibleWrites = { '0x2000': false, '0x2001': false, '0x2005': false, '0x2006': false };
  for (const event of visibleEvents) {
    const key = `0x${event.address.toString(16).padStart(4, '0')}`;
    if (key in summary.visibleWriteCounts) {
      summary.visibleWriteCounts[key]++;
      frameVisibleWrites[key] = true;
    }
    if (event.address >= 0x8000) {
      summary.visibleMapperWriteCounts[key] = (summary.visibleMapperWriteCounts[key] ?? 0) + 1;
    }
  }
  for (const key of Object.keys(frameVisibleWrites)) {
    if (frameVisibleWrites[key]) summary.framesWithVisibleWrites[key]++;
  }

  const regions = Array.isArray(ppuState.renderPlan?.regions) ? ppuState.renderPlan.regions : [];
  const regionCount = regions.length > 0 ? regions.length : 1;
  if (regionCount === 1) summary.regionHistogram['1']++;
  else if (regionCount === 2) summary.regionHistogram['2']++;
  else summary.regionHistogram['3+']++;
  summary.maxRegionCount = Math.max(summary.maxRegionCount, regionCount);
  if (regionCount > 1) summary.framesWithMultiRegion++;

  const uniqueBgBases = new Set(regions.map((region) => region.bgPatternBase));
  const uniqueSprBases = new Set(regions.map((region) => region.sprPatternBase));
  if (uniqueBgBases.size > 1) summary.framesWithMixedBgPatternBase++;
  if (uniqueSprBases.size > 1) summary.framesWithMixedSprPatternBase++;

  const currCHRSignature = Array.isArray(ppuState.chrBankSignature) ? ppuState.chrBankSignature : [];
  const switchedRegions = [];
  if (Array.isArray(previousCHRSignature) && previousCHRSignature.length === 8 && currCHRSignature.length === 8) {
    for (let i = 0; i < 8; i++) {
      if (currCHRSignature[i] !== previousCHRSignature[i]) switchedRegions.push(i);
    }
  }

  if (switchedRegions.length > 0) {
    summary.chrBankSwitchFrames++;
    for (const idx of switchedRegions) {
      summary.chrBankSwitchByRegion[String(idx)]++;
    }
    summary.maxChrRegionsSwitchedPerFrame = Math.max(
      summary.maxChrRegionsSwitchedPerFrame,
      switchedRegions.length
    );
  }

  const sheetRegens = ppuState?.tileSheetsUpdated ?? renderer.tileCache.updatedSheets.size;
  summary.totalSheetRegens += sheetRegens;
  if (sheetRegens > 0) summary.framesWithSheetRegens++;
  summary.maxSheetRegensPerFrame = Math.max(summary.maxSheetRegensPerFrame, sheetRegens);

  if (
    summary.sampleEvery > 0 &&
    summary.samples.length < summary.maxSamples &&
    (frame - summary.startFrame) % summary.sampleEvery === 0
  ) {
    summary.samples.push({
      frame,
      regions: regionCount,
      splitCount: Math.max(0, regionCount - 1),
      traceEvents: traceCount,
      visibleTraceEvents: visibleCount,
      mapperWrites: mapperEvents.length,
      visibleMapperWrites: visibleMapperEvents.length,
      visibleWrites: frameVisibleWrites,
      visibleMapperAddresses: Array.from(
        new Set(visibleMapperEvents.map((event) => `0x${event.address.toString(16).padStart(4, '0')}`))
      ).sort(),
      bgPatternBases: Array.from(uniqueBgBases).sort((a, b) => a - b),
      sprPatternBases: Array.from(uniqueSprBases).sort((a, b) => a - b),
      chrSwitchedRegions: switchedRegions,
      sheetRegens,
    });
  }

  return currCHRSignature.length === 8 ? currCHRSignature.slice() : previousCHRSignature;
}

function finalizeDiagnosticsSummary(summary, endFrame) {
  const frameDenom = Math.max(summary.totalFrames, 1);
  return {
    ...summary,
    endFrame,
    avgTraceEventsPerFrame: summary.totalTraceEvents / frameDenom,
    avgVisibleTraceEventsPerFrame: summary.totalVisibleTraceEvents / frameDenom,
    avgMapperWritesPerFrame: summary.totalMapperWrites / frameDenom,
    avgVisibleMapperWritesPerFrame: summary.totalVisibleMapperWrites / frameDenom,
    avgSheetRegensPerFrame: summary.totalSheetRegens / frameDenom,
  };
}
