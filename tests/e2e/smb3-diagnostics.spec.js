import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const ROM_FILE = 'Super Mario Bros. 3 (USA) (Rev 1).nes';
const ROM_PATH = path.resolve('roms', ROM_FILE);
const RESULTS_DIR = path.resolve('tests/e2e/test-results');
const DIAG_JSON = path.join(RESULTS_DIR, 'smb3-diagnostics.json');

function loadROMBytes() {
  if (!fs.existsSync(ROM_PATH)) return null;
  return Array.from(fs.readFileSync(ROM_PATH));
}

function decodePNG(buffer) {
  const png = PNG.sync.read(buffer);
  return { data: png.data, width: png.width, height: png.height };
}

function diffPercent(cssPNG, canvasPNG) {
  const a = decodePNG(cssPNG);
  const b = decodePNG(canvasPNG);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const diff = new PNG({ width, height });
  const diffCount = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: 0.1,
    diffColor: [255, 0, 255],
  });
  return {
    diffCount,
    diffPercent: (diffCount / (width * height)) * 100,
    diffPNG: PNG.sync.write(diff),
  };
}

async function pulseStart(page, segments, label, holdFrames = 2, settleFrames = 90) {
  await page.evaluate(() => window.testHarness.buttonDown(3));
  segments.push({
    label: `${label}-hold`,
    summary: await page.evaluate(
      (n) => window.testHarness.stepFramesWithDiagnostics(n, { sampleEvery: 1, maxSamples: 64 }),
      holdFrames,
    ),
  });
  await page.evaluate(() => window.testHarness.buttonUp(3));
  if (settleFrames > 0) {
    segments.push({
      label: `${label}-settle`,
      summary: await page.evaluate(
        (n) => window.testHarness.stepFramesWithDiagnostics(n, { sampleEvery: 10, maxSamples: 128 }),
        settleFrames,
      ),
    });
  }
}

async function captureCheckpoint(page, label) {
  const cssPNG = await page.locator('.nes-viewport').screenshot();
  const canvasPNG = await page.locator('#ref-canvas').screenshot();
  const { diffPercent: dp, diffCount, diffPNG } = diffPercent(cssPNG, canvasPNG);
  const trace = await page.evaluate(() => window.testHarness.getLatestTimingTrace());
  const ppu = await page.evaluate(() => window.testHarness.getLatestPPUSummary());

  fs.writeFileSync(path.join(RESULTS_DIR, `diag-${label}-css.png`), cssPNG);
  fs.writeFileSync(path.join(RESULTS_DIR, `diag-${label}-canvas.png`), canvasPNG);
  fs.writeFileSync(path.join(RESULTS_DIR, `diag-${label}-diff.png`), diffPNG);

  return { label, diffPercent: dp, diffCount, trace, ppu };
}

test('SMB3 map diagnostics', async ({ page }) => {
  const romBytes = loadROMBytes();
  test.skip(!romBytes, `ROM not found: ${ROM_FILE}`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  await page.goto('http://localhost:5173/tests/e2e/test-harness.html');
  await page.waitForFunction(() => window.testHarness !== undefined);
  await page.evaluate((bytes) => window.testHarness.loadROM(bytes), romBytes);
  await page.waitForFunction(() => window.testHarness.isReady());
  await page.evaluate(() => window.testHarness.setTimingTraceEnabled(true));
  await page.evaluate(() => window.testHarness.setMapperTraceEnabled(true));

  const segments = [];
  const checkpoints = [];

  segments.push({
    label: 'boot',
    summary: await page.evaluate(
      () => window.testHarness.stepFramesWithDiagnostics(300, { sampleEvery: 30, maxSamples: 256 }),
    ),
  });
  checkpoints.push(await captureCheckpoint(page, 'boot-300'));

  // Title/menu progression.
  await pulseStart(page, segments, 'start-1', 2, 150);
  segments.push({
    label: 'after-start-1',
    summary: await page.evaluate(
      () => window.testHarness.stepFramesWithDiagnostics(240, { sampleEvery: 20, maxSamples: 256 }),
    ),
  });
  checkpoints.push(await captureCheckpoint(page, 'after-start-1'));

  await pulseStart(page, segments, 'start-2', 2, 150);
  segments.push({
    label: 'after-start-2',
    summary: await page.evaluate(
      () => window.testHarness.stepFramesWithDiagnostics(240, { sampleEvery: 20, maxSamples: 256 }),
    ),
  });
  checkpoints.push(await captureCheckpoint(page, 'after-start-2'));

  // Long run where the world map should be visible.
  for (let i = 0; i < 6; i++) {
    segments.push({
      label: `map-run-${i + 1}`,
      summary: await page.evaluate(
        () => window.testHarness.stepFramesWithDiagnostics(180, { sampleEvery: 15, maxSamples: 256 }),
      ),
    });
    checkpoints.push(await captureCheckpoint(page, `map-run-${i + 1}`));
  }

  const payload = {
    rom: ROM_FILE,
    generatedAt: new Date().toISOString(),
    finalFrame: await page.evaluate(() => window.testHarness.getFrameCount()),
    timingTraceEnabled: await page.evaluate(() => window.testHarness.getTimingTraceEnabled()),
    checkpoints,
    segments,
  };

  fs.writeFileSync(DIAG_JSON, JSON.stringify(payload, null, 2));

  // Keep this as a diagnostics run, not a strict rendering assertion.
  expect(payload.segments.length).toBeGreaterThan(0);
});
