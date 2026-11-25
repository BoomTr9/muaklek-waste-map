// Local visual/functional smoke test (Playwright).
// Usage: node tests/smoke.mjs [baseUrl]
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const base = process.argv[2] || 'http://localhost:8080/';
const outDir = path.resolve('tests/screens');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const errors = [];

async function openPage(context) {
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text().slice(0, 300)}`);
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('#map-loading')?.classList.contains('done'), null, { timeout: 30000 });
  await page.waitForTimeout(1800);
  return page;
}

// Desktop
const desktop = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'th-TH',
  permissions: ['geolocation'],
  geolocation: { latitude: 14.6493, longitude: 101.2011, accuracy: 20 }
});
const page = await openPage(desktop);
console.log('markers', await page.locator('.marker').count());
console.log('list items', await page.locator('.poi').count());
await page.screenshot({ path: path.join(outDir, 'desktop.png') });

// Click route on the first item
await page.locator('.poi .poi-go').first().click();
await page.waitForSelector('#route-result:not([hidden])', { timeout: 30000 });
await page.waitForTimeout(2000);
console.log('route distance', await page.locator('#route-distance').innerText());
console.log('route duration', await page.locator('#route-duration').innerText());
console.log('route note', await page.locator('#route-note').innerText());
await page.locator('#btn-steps-toggle').click();
await page.waitForTimeout(400);
console.log('steps', await page.locator('#route-steps li').count());
await page.screenshot({ path: path.join(outDir, 'desktop-route.png') });

// Marker popup (destination marker is in view after routing)
await page.locator('.marker[data-id="muaklek-municipal-wastebank"]').click();
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(outDir, 'desktop-popup.png') });

// Info dialog
await page.locator('#btn-info').click();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(outDir, 'desktop-info.png') });
await page.keyboard.press('Escape');

await desktop.close();

// Mobile
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'th-TH',
  permissions: ['geolocation'],
  geolocation: { latitude: 14.6493, longitude: 101.2011, accuracy: 20 }
});
const mpage = await openPage(mobile);
await mpage.screenshot({ path: path.join(outDir, 'mobile.png') });
await mpage.locator('.marker[data-id="sapsanun-landfill"]').click();
await mpage.waitForTimeout(900);
await mpage.screenshot({ path: path.join(outDir, 'mobile-popup.png') });
await mpage.locator('#sheet-handle').click();
await mpage.waitForTimeout(500);
await mpage.screenshot({ path: path.join(outDir, 'mobile-expanded.png') });

await mpage.locator('.poi .poi-go').first().click();
await mpage.waitForSelector('#route-result:not([hidden])', { timeout: 30000 });
await mpage.waitForTimeout(2000);
await mpage.screenshot({ path: path.join(outDir, 'mobile-route.png') });
await mobile.close();

await browser.close();

console.log('--- console errors ---');
console.log(errors.length ? errors.join('\n') : 'none');
