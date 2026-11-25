import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'th-TH' });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`);
  if (r.url().includes('/tiles/')) logs.push(`[tile ${r.status()}] ${r.url()}`);
});
const target = process.argv[2] || 'http://localhost:8080/';
await page.goto(target, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
console.log('loading text:', await page.locator('#map-loading').innerText().catch(() => 'n/a'));
console.log('loading class:', await page.locator('#map-loading').getAttribute('class').catch(() => 'n/a'));
console.log('canvas:', await page.locator('.maplibregl-canvas').count());
console.log('markers:', await page.locator('.marker').count());
console.log('list:', await page.locator('.poi').count());
console.log('typeof maplibregl:', await page.evaluate(() => typeof window.maplibregl));
console.log('logs:\n' + logs.join('\n'));
console.log('map state:', await page.evaluate(() => {
  const m = window.__map;
  if (!m) return 'no map';
  let style = null;
  try { style = m.getStyle(); } catch (e) { style = 'ERR ' + e.message; }
  return {
    loaded: m.loaded(),
    styleLoaded: m.isStyleLoaded(),
    zoom: m.getZoom(),
    center: m.getCenter().toArray(),
    hasStyle: !!style,
    styleKeys: style && typeof style === 'object' ? Object.keys(style) : String(style),
    source: !!m.getSource('basemap'),
    canvasSize: [m.getCanvas().width, m.getCanvas().height]
  };
}));
console.log('tile requests:', logs.filter((l) => l.includes('[tile')).slice(0, 8).join('\n'));
console.log('logs:\n' + logs.join('\n'));
await page.screenshot({ path: 'tests/screens/debug.png', fullPage: false });
await browser.close();
