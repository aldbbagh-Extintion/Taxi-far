const { chromium } = require('playwright');
const OUT = '/home/claude/taxi-meter-app/qa-screens/';
const BASE = 'http://localhost:4300';
(async () => {
  const browser = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, locale: 'ar-JO' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    const shot = async (name, full = false) => {
      await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(350);
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150);
      await page.screenshot({ path: `${OUT}ui-${name}-${scheme}.png` });
      if (full) {
        const more = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 4);
        if (more) { await page.evaluate(() => window.scrollTo(0, 1e6)); await page.waitForTimeout(250);
          await page.screenshot({ path: `${OUT}ui-${name}-bottom-${scheme}.png` }); }
      }
    };
    await page.goto(BASE + '/'); await page.waitForSelector('.meter');
    await shot('main-idle', true);
    // dismiss banner, start trip
    await page.evaluate(() => window.__mock.session.hasUnfinished.set(null));
    await page.click('text=ابدأ الرحلة'); await page.waitForTimeout(300);
    await shot('main-searching');
    await page.evaluate(() => { window.__mock.session.fastForward(640); window.__mock.session.warning.set('إشارة الـ GPS ضعيفة هلأ، المسافة ممكن تتأخر شوي.'); });
    await shot('main-running', true);
    await page.click('.meter'); await page.waitForTimeout(300);
    await shot('sheet');
    await page.click('.sheet .close');
    await page.click('text=إعادة ضبط'); await page.waitForTimeout(200);
    await shot('confirm');
    await page.click('.dialog .btn-ghost');
    await page.evaluate(() => window.__mock.session.warning.set(''));
    await page.click('text=إنهاء الرحلة'); await page.waitForURL('**/trip-result');
        await page.fill('#meterIn', '3.950'); await page.fill('#noteIn', 'اجتماع وزارة الزراعة');
    await shot('result', true);
    await page.click('text=حفظ الرحلة'); await page.waitForURL('**/history**'); await page.waitForSelector('.trip'); await page.waitForTimeout(2800);
    await shot('history', true);
    await page.click('.trip >> nth=0'); await page.waitForSelector('app-trip-report');
    await shot('detail', true);
    await page.goto(BASE + '/settings'); await page.waitForSelector('.seg');
    await shot('settings', true);
    console.log(scheme, 'errors:', JSON.stringify(errs));
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
