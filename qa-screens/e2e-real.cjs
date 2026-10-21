// E2E against the REAL production build (real core + web tracker), simulated GPS.
const { chromium } = require('playwright');
const OUT = __dirname;
const BASE = 'http://localhost:4400/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' in {} ? undefined : undefined });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-JO',
    timezoneId: 'Asia/Amman', permissions: ['geolocation'],
    geolocation: { latitude: 31.9539, longitude: 35.9106, accuracy: 6 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE);
  await page.waitForTimeout(800);
  const tip = page.getByRole('button', { name: 'فهمت' });
  if (await tip.count()) await tip.click();
  await page.getByRole('button', { name: 'ابدأ الرحلة' }).click();

  // 60 s moving east at ~40 km/h (11.1 m/s), then 25 s stopped with small jitter
  let lat = 31.9539, lon = 35.9106;
  const mPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);
  for (let i = 0; i < 60; i++) {
    lon += 11.1 / mPerDegLon;
    await ctx.setGeolocation({ latitude: lat, longitude: lon, accuracy: 6 });
    await sleep(1000);
    if (i === 30) await page.screenshot({ path: OUT + '/e2e-1-moving.png' });
  }
  const statusMoving = await page.locator('body').innerText();
  for (let i = 0; i < 25; i++) {
    await ctx.setGeolocation({ latitude: lat + (Math.random() - .5) * 2e-5, longitude: lon + (Math.random() - .5) * 2e-5, accuracy: 6 });
    await sleep(1000);
  }
  await page.screenshot({ path: OUT + '/e2e-2-waiting.png' });
  const statusWaiting = await page.locator('body').innerText();

  // reload mid-trip → unfinished-trip banner, resume
  await page.reload(); await page.waitForTimeout(1000);
  const hasBanner = await page.getByRole('button', { name: 'كمّل الرحلة' }).count();
  await page.screenshot({ path: OUT + '/e2e-3-resume-banner.png' });
  if (hasBanner) await page.getByRole('button', { name: 'كمّل الرحلة' }).click();
  await sleep(3000);

  await page.getByRole('button', { name: 'إنهاء الرحلة' }).click();
  await page.waitForURL(/trip-result/, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/e2e-4-result.png', fullPage: true });
  const resultText = await page.locator('body').innerText();
  const meter = page.locator('input[type=number], input[inputmode=decimal]').first();
  await meter.fill('1.050');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/e2e-5-verdict.png', fullPage: true });
  await page.getByRole('button', { name: 'حفظ الرحلة' }).click();
  await page.waitForTimeout(1000);

  await page.reload(); await page.waitForTimeout(1000);
  await page.goto(BASE + 'history'); await page.waitForTimeout(1000);
  await page.screenshot({ path: OUT + '/e2e-6-history.png', fullPage: true });
  const historyText = await page.locator('body').innerText();

  console.log(JSON.stringify({
    movingHasStatus: /يتحرك/.test(statusMoving), waitingHasStatus: /في الانتظار/.test(statusWaiting),
    resumeBanner: hasBanner,
    result: resultText.replace(/\s+/g, ' ').slice(0, 700),
    history: historyText.replace(/\s+/g, ' ').slice(0, 500), errors,
  }, null, 1));
  await browser.close();
})();
