import { chromium } from '/tmp/node_modules/playwright/index.mjs';
const SIZES = { square: [1080,1080], portrait: [1080,1350], story: [1080,1920] };
const b = await chromium.launch({ channel: 'chrome' });
for (const [name,[w,h]] of Object.entries(SIZES)) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto(`file:///tmp/social/card.html?p=${name}`);
  await p.waitForLoadState('networkidle');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
  await p.locator('#card').screenshot({ path: `/tmp/social/og-geo-${name}.png` });
  console.log(`${name}: ${w}x${h}`);
  await p.close();
}
await b.close();
