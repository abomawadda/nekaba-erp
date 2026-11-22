// اختبار PWA: المانيفست والأيقونات، تسجيل خدمة العمل، فتح الواجهة بدون نت بعد أول زيارة، وعدم تخزين طلبات الخادم
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2] || '.', BASE = 'http://127.0.0.1:8787/';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ proxy });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
await p.goto(BASE); await p.waitForSelector('#lf');
const man = await p.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
ok(man.display === 'standalone' && man.start_url && man.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable') && man.icons.some(i => i.sizes === '192x192'), 'manifest installable fields');
const icons = await p.evaluate(async m => Promise.all(m.icons.map(async i => (await fetch(i.src)).ok)), man);
ok(icons.every(Boolean), 'icons load');
const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
ok(sw, 'service worker active');
await p.reload(); await p.waitForSelector('#lf');   // الصفحة الآن تحت تحكم خدمة العمل
ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'page controlled by SW');
const cached = await p.evaluate(async () => (await caches.keys()).length && (await (await caches.open((await caches.keys())[0])).keys()).map(r => new URL(r.url).pathname));
ok(cached.includes('/js/app.js') && cached.includes('/index.html'), 'shell cached');
ok(!cached.some(u => u.includes('functions')), 'no API responses cached');
await ctx.setOffline(true);
await p.reload(); await p.waitForSelector('#lf', { timeout: 10000 });
ok((await p.textContent('body')).includes('منصة النقابة'), 'opens offline');
await p.screenshot({ path: `${OUT}/p1-offline.png` });
await ctx.setOffline(false);
ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
await browser.close(); console.log(`\n${pass} نجح · ${fail} فشل`); process.exit(fail ? 1 : 0);
