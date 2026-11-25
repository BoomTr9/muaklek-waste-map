// Interaction tests: filters, user point add/persist/delete, denied-geolocation fallback.
import { chromium } from 'playwright';

const base = 'http://localhost:8080/';
const browser = await chromium.launch();
const errors = [];

async function newDesktop() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'th-TH',
    permissions: ['geolocation'],
    geolocation: { latitude: 14.6493, longitude: 101.2011, accuracy: 20 }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#map-loading')?.classList.contains('done'), null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  return { context, page };
}

// 1) Filter behavior
{
  const { context, page } = await newDesktop();
  const allPois = await page.locator('.poi').count();
  await page.locator('[data-filter="recycle"]').click();
  await page.waitForTimeout(300);
  const recyclePois = await page.locator('.poi').count();
  const visibleMarkers = await page.locator('.marker:visible').count();
  console.log(JSON.stringify({ test: 'filter', allPois, recyclePois, visibleMarkers }));
  await page.locator('[data-filter="all"]').click();
  await context.close();
}

// 2) Add user point, persist, delete
{
  const { context, page } = await newDesktop();
  await page.locator('#btn-add').click();
  await page.mouse.click(1120, 680);
  await page.waitForSelector('#add-dialog[open]');
  await page.fill('#add-name', 'จุดทดสอบรีไซเคิล');
  await page.selectOption('#add-category', 'recycle');
  await page.fill('#add-note', 'ทดสอบจากสคริปต์');
  await page.locator('#add-save').click();
  await page.waitForTimeout(1000);
  const afterAdd = await page.locator('.marker').count();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('muaklek-waste-user-points-v1') || '[]').length);
  const exportVisible = await page.locator('#btn-export').isVisible();
  console.log(JSON.stringify({ test: 'add', afterAdd, persisted, exportVisible }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#map-loading')?.classList.contains('done'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const afterReload = await page.locator('.marker').count();
  console.log(JSON.stringify({ test: 'persist', afterReload }));
  page.on('dialog', (d) => d.accept());
  await page.locator('.poi-del').first().click();
  await page.waitForTimeout(600);
  const afterDelete = await page.locator('.marker').count();
  const storedAfterDelete = await page.evaluate(() => JSON.parse(localStorage.getItem('muaklek-waste-user-points-v1') || '[]').length);
  console.log(JSON.stringify({ test: 'delete', afterDelete, storedAfterDelete }));
  await context.close();
}

// 3) Denied geolocation -> map pick origin -> route
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'th-TH' });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#map-loading')?.classList.contains('done'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.locator('.poi .poi-go').first().click();
  await page.waitForSelector('#map-hint:not([hidden])', { timeout: 25000 });
  const hint = await page.locator('#hint-text').innerText();
  await page.mouse.click(900, 620);
  await page.waitForSelector('#route-result:not([hidden])', { timeout: 30000 });
  const distance = await page.locator('#route-distance').innerText();
  console.log(JSON.stringify({ test: 'pick-origin-route', hint, distance }));
  await context.close();
}

await browser.close();
console.log('--- errors ---');
console.log(errors.length ? errors.join('\n') : 'none');
