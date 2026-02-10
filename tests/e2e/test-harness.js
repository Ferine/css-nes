/**
 * E2E test harness: loads a ROM, steps frames, renders to both CSS and canvas.
 * Exposes window.testHarness for Playwright to drive.
 */
import { NES } from 'jsnes';
import { PPUStateExtractor } from '../../src/ppu-state-extractor.js';
import { CSSRenderer } from '../../src/css-renderer.js';

const wrapperEl = document.getElementById('viewport-wrapper');
const canvas = document.getElementById('ref-canvas');
const ctx = canvas.getContext('2d');

let nes = null;
let extractor = null;
let renderer = null;
let latestPPUState = null;
let frameCount = 0;
let ready = false;

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
        latestPPUState = extractor.extract();
        latestPPUState.buffer = buffer;
      },
      onAudioSample() {},
    });
    extractor = new PPUStateExtractor(nes);
    renderer = new CSSRenderer(wrapperEl);

    // Convert number[] to char string for jsnes
    let str = '';
    for (let i = 0; i < romBytes.length; i++) {
      str += String.fromCharCode(romBytes[i]);
    }
    nes.loadROM(str);
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

  buttonDown(btn) {
    if (nes) nes.buttonDown(1, btn);
  },

  buttonUp(btn) {
    if (nes) nes.buttonUp(1, btn);
  },

  isReady() {
    return ready;
  },

  getFrameCount() {
    return frameCount;
  },
};
