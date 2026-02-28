import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROM_FILE = 'Legend of Zelda, The (USA) (Rev 1).nes';
const ROM_PATH = path.resolve('roms', ROM_FILE);

function loadROMBytes() {
  if (!fs.existsSync(ROM_PATH)) return null;
  return Array.from(fs.readFileSync(ROM_PATH));
}

test('Zelda boots and renders without tile-cache crashes', async ({ page }) => {
  const romBytes = loadROMBytes();
  test.skip(!romBytes, `ROM not found: ${ROM_FILE}`);

  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('http://localhost:5173/tests/e2e/test-harness.html');
  await page.waitForFunction(() => window.testHarness !== undefined);
  await page.evaluate((bytes) => window.testHarness.loadROM(bytes), romBytes);
  await page.waitForFunction(() => window.testHarness.isReady());

  // Boot through title, then pulse Start to enter file screen / intro flow.
  await page.evaluate(() => window.testHarness.stepFrames(300));
  await page.evaluate(() => window.testHarness.buttonDown(3));
  await page.evaluate(() => window.testHarness.stepFrames(2));
  await page.evaluate(() => window.testHarness.buttonUp(3));
  await page.evaluate(() => window.testHarness.stepFrames(900));

  const nonBlackPixels = await page.evaluate(() => {
    const c = document.getElementById('ref-canvas');
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) count++;
    }
    return count;
  });

  expect(errors).toEqual([]);
  expect(nonBlackPixels).toBeGreaterThan(1000);
});
