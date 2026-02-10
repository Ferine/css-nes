import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const ROMS_DIR = path.resolve('roms');
const RESULTS_DIR = path.resolve('tests/e2e/test-results');

/**
 * ROM catalog: each entry lists the ROM filename and checkpoints to compare.
 * maxDiffPercent accounts for known CSS-vs-canvas differences
 * (behind-BG sprite priority, no 8-sprite-per-scanline limit, etc.)
 */
const ROM_CATALOG = [
  {
    file: 'Super Mario Bros. (World).nes',
    label: 'SMB1',
    checkpoints: [
      { frame: 250, label: 'title-screen', maxDiffPercent: 15 },
      { frame: 400, label: 'title-settled', maxDiffPercent: 15 },
    ],
  },
  {
    file: 'Super Mario Bros. 3 (USA) (Rev 1).nes',
    label: 'SMB3',
    checkpoints: [
      { frame: 200, label: 'intro-early', maxDiffPercent: 8 },
      // SMB3 intro runs ~frame 100-350; the title screen uses heavy mid-frame
      // PPU scroll splits that the CSS renderer cannot capture (single VBlank snapshot),
      // so we test a second intro frame rather than the title screen itself.
      { frame: 300, label: 'intro-late', maxDiffPercent: 10 },
    ],
  },
];

/**
 * Read a ROM file and return its bytes as a number[], or null if not found.
 */
function loadROMFile(filename) {
  const romPath = path.join(ROMS_DIR, filename);
  if (!fs.existsSync(romPath)) return null;
  const buf = fs.readFileSync(romPath);
  return Array.from(buf);
}

/**
 * Decode a PNG buffer into { data, width, height }.
 */
function decodePNG(buffer) {
  const png = PNG.sync.read(buffer);
  return { data: png.data, width: png.width, height: png.height };
}

/**
 * Compare two PNG buffers with pixelmatch. Returns { diffCount, diffPercent, diffPNG }.
 */
function compareImages(pngBufA, pngBufB) {
  const a = decodePNG(pngBufA);
  const b = decodePNG(pngBufB);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const diff = new PNG({ width, height });

  const diffCount = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: 0.1,
    diffColor: [255, 0, 255], // magenta
  });

  const totalPixels = width * height;
  const diffPercent = (diffCount / totalPixels) * 100;
  const diffPNG = PNG.sync.write(diff);

  return { diffCount, diffPercent, diffPNG };
}

// Ensure results directory exists
fs.mkdirSync(RESULTS_DIR, { recursive: true });

for (const rom of ROM_CATALOG) {
  test.describe(rom.label, () => {
    const romBytes = loadROMFile(rom.file);

    test.beforeEach(async ({ page }) => {
      if (!romBytes) return;
      await page.goto('http://localhost:5173/tests/e2e/test-harness.html');
      await page.waitForFunction(() => window.testHarness !== undefined);
      await page.evaluate((bytes) => window.testHarness.loadROM(bytes), romBytes);
      await page.waitForFunction(() => window.testHarness.isReady());
    });

    for (const checkpoint of rom.checkpoints) {
      test(`${checkpoint.label} (frame ${checkpoint.frame})`, async ({ page }) => {
        test.skip(!romBytes, `ROM not found: ${rom.file}`);

        // Step to target frame in chunks
        await page.evaluate(
          (n) => window.testHarness.stepFrames(n),
          checkpoint.frame,
        );

        // Allow CSS style recalc
        await page.waitForTimeout(100);

        // Screenshot the CSS viewport
        const cssEl = page.locator('.nes-viewport');
        const cssPNG = await cssEl.screenshot();

        // Screenshot the reference canvas
        const canvasEl = page.locator('#ref-canvas');
        const canvasPNG = await canvasEl.screenshot();

        // Save screenshots
        const prefix = `${rom.label}-${checkpoint.label}`;
        fs.writeFileSync(path.join(RESULTS_DIR, `${prefix}-css.png`), cssPNG);
        fs.writeFileSync(path.join(RESULTS_DIR, `${prefix}-canvas.png`), canvasPNG);

        // Compare
        const { diffPercent, diffPNG } = compareImages(cssPNG, canvasPNG);
        fs.writeFileSync(path.join(RESULTS_DIR, `${prefix}-diff.png`), diffPNG);

        console.log(
          `${prefix}: ${diffPercent.toFixed(2)}% diff (max ${checkpoint.maxDiffPercent}%)`,
        );

        expect(diffPercent).toBeLessThanOrEqual(checkpoint.maxDiffPercent);
      });
    }
  });
}
