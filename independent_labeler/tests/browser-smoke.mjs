import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.LABELER_TEST_URL || 'http://127.0.0.1:8787';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const frameRevision = (page, key) => page.evaluate(async key =>
  (await (await fetch('/api/frame?key=' + encodeURIComponent(key))).json()).revision, key);

async function signIn(page) {
  await page.goto(base);
  await page.getByLabel('Access code').fill('LOCALTESTCODE');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('#frame-title').waitFor();
  await page.waitForFunction(() => document.querySelector('#frame-title')?.textContent !== 'Loading...');
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  await signIn(page);
  await page.locator('#paradigm-select').selectOption('epm');
  await page.waitForFunction(() => document.querySelector('#counter')?.textContent === '1 / 640');
  assert.equal(await page.locator('#folder-select').inputValue(), 'EPM Test 1');
  await page.locator('#next').click();
  await page.waitForFunction(() => document.querySelector('#counter')?.textContent === '2 / 640');
  await page.locator('#paradigm-select').selectOption('ofpo');
  await page.waitForFunction(() => document.querySelector('#counter')?.textContent === '1 / 620');
  assert.equal(await page.locator('#folder-select').inputValue(), 'OFPO Test 1');
  await page.locator('#folder-select').selectOption('OFPO Test 31');
  await page.waitForFunction(() => document.querySelector('#counter')?.textContent === '601 / 620');
  await page.locator('#paradigm-select').selectOption('sp1dlc');
  await page.waitForFunction(() => document.querySelector('#counter')?.textContent === '1 / 1865');
  const key = await page.evaluate(async () => (await (await fetch('/api/project')).json()).frames[0].key);
  const revision = () => frameRevision(page, key);
  const viewer = page.locator('#viewer');
  const box = await viewer.boundingBox();
  const x = box.x + box.width * .5, y = box.y + box.height * .5;
  assert.equal(await page.locator('button[data-mode="select"]').getAttribute('aria-pressed'), 'true');
  const initialRevision = await revision();
  await page.mouse.click(x, y);
  assert.equal(await revision(), initialRevision, 'Move-mode tap must not save a marker');

  await page.locator('.part').filter({ hasText: 'Nose' }).click();
  await page.locator('button[data-mode="add"]').click();
  await page.mouse.move(x - 45, y - 35);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
  assert.equal(await revision(), initialRevision, 'Place-mode drag must pan, not save');

  await page.mouse.click(x, y);
  await page.waitForFunction(async expected => (await (await fetch('/api/frame?key=' + encodeURIComponent(expected.key))).json()).revision > expected.revision,
    { key, revision: initialRevision });
  assert.equal(await page.locator('button[data-mode="add"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#selected').innerText(), 'Left ear');
  await page.mouse.click(x + 30, y + 20);
  await page.waitForFunction(async expected => (await (await fetch('/api/frame?key=' + encodeURIComponent(expected.key))).json()).revision > expected.revision,
    { key, revision: initialRevision + 1 });
  assert.equal(await page.locator('#selected').innerText(), 'Right ear');

  await page.locator('#next').click();
  assert.equal(await page.locator('button[data-mode="select"]').getAttribute('aria-pressed'), 'true');
  await page.locator('.share summary').click();
  await page.locator('.share img').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.share img')?.naturalWidth > 0);
  assert.equal(await page.locator('#share-url').innerText(), 'http://127.0.0.1:8787/');
  await page.screenshot({ path: 'imports/browser-desktop.png' });
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const phone = await mobile.newPage();
  await signIn(phone);
  await phone.locator('#paradigm-select').selectOption('epm');
  await phone.waitForFunction(() => document.querySelector('#counter')?.textContent === '1 / 640');
  await phone.locator('#paradigm-select').selectOption('ofpo');
  await phone.waitForFunction(() => document.querySelector('#counter')?.textContent === '1 / 620');
  await phone.locator('#paradigm-select').selectOption('sp1dlc');
  await phone.waitForFunction(() => document.querySelector('#counter')?.textContent === '1 / 1865');
  const phoneRevision = await frameRevision(phone, key);
  const mobileBox = await phone.locator('#viewer').boundingBox();
  const touchX = mobileBox.x + mobileBox.width * .5, touchY = mobileBox.y + mobileBox.height * .5;
  await phone.touchscreen.tap(touchX, touchY);
  assert.equal(await frameRevision(phone, key), phoneRevision, 'Move-mode touch must not save');
  await phone.locator('.part').filter({ hasText: 'Nose' }).click();
  await phone.locator('button[data-mode="add"]').click();
  const cdp = await mobile.newCDPSession(phone);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX - 35, y: touchY - 25, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX + 25, y: touchY + 10, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await frameRevision(phone, key), phoneRevision, 'Place-mode touch drag must not save');
  await phone.touchscreen.tap(touchX, touchY);
  await phone.waitForFunction(async expected => (await (await fetch('/api/frame?key=' + encodeURIComponent(expected.key))).json()).revision > expected.revision,
    { key, revision: phoneRevision });
  assert.equal(await phone.locator('#selected').innerText(), 'Left ear');
  await phone.locator('.share summary').click();
  await phone.waitForFunction(() => document.querySelector('.share img')?.naturalWidth > 0);
  assert.equal(await phone.locator('button[data-mode="add"]').getAttribute('aria-pressed'), 'true');
  await phone.screenshot({ path: 'imports/browser-mobile.png', fullPage: true });
  await mobile.close();
  console.log('Browser smoke passed: safe navigation, deliberate placement, sequence, QR, desktop, mobile.');
} finally {
  await browser.close();
}
