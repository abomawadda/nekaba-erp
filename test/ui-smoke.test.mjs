// فحص شامل للقراءة فقط: يفتح كل شاشات الإدارة بحساب مراجع مؤقت (دور AUDITOR) ويتأكد من غياب أخطاء الواجهة والخادم.
// التشغيل: أنشئ zz_smoke بدور AUDITOR، ثم: cd web && python3 -m http.server 8787 & ثم node test/ui-smoke.test.mjs <مجلد اللقطات> — واحذف الحساب بعدها.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2] || '.'; const USER = process.env.SMOKE_USER || USER, PASS = process.env.SMOKE_PASS || PASS;
const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } } : {});
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-EG' });
const p = await ctx.newPage(); const errs = [], apiErr = [];
p.on('pageerror', e => errs.push(p.url().split('#')[1] + ': ' + e.message));
p.on('response', async r => { if (r.url().includes('erp-api')) { try { const j = await r.json(); if (!j.success) apiErr.push(p.url().split('#')[1] + ' → ' + j.message); } catch (_) {} } });
await p.goto('http://127.0.0.1:8787/'); await p.click('[data-tab=staff]'); await p.fill('[name=username]', USER); await p.fill('[name=password]', PASS); await p.click('#lf [type=submit]');
await p.waitForSelector('.kpis', { timeout: 20000 });
const routes = ['#/dash','#/inbox','#/calendar','#/notifications','#/admin','#/memberlists','#/board','#/meetings','#/decisions','#/finance','#/cheques','#/settlements','#/receipts','#/trial','#/statements','#/budget','#/bank','#/chqbooks','#/entries','#/benefits','#/reports','#/archive','#/audit','#/account'];
for (const r of routes) {
  await p.evaluate(h => location.hash = h, r); await p.waitForTimeout(2500);
  const t = (await p.textContent('.wrap')) || '';
  console.log(r.padEnd(16), t.includes('spin') ? '?' : 'ok', t.replace(/\s+/g, ' ').slice(0, 90));
  await p.screenshot({ path: `${OUT}/${r.slice(2)}.png` });
}
// افتح عضو وشيك
await p.evaluate(() => location.hash = '#/memberlists'); await p.waitForSelector('tr[data-person]', { timeout: 15000 }); await p.click('tr[data-person]'); await p.waitForSelector('.p360'); 
for (const t of ['family','ben','career','card','docs']) { const btn = await p.$(`.ptabs [data-ptab=${t}]`); if (btn) { await btn.click(); await p.waitForTimeout(1500); } }
await p.screenshot({ path: `${OUT}/person.png` });
await p.evaluate(() => location.hash = '#/cheques'); await p.waitForSelector('tr[data-chq]', { timeout: 15000 }); await p.click('tr[data-chq]'); await p.waitForSelector('[data-act=voucher]'); await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/cheque.png`, fullPage: true });
console.log('JS errors:', errs.length, errs.slice(0, 10)); console.log('API errors:', apiErr.length, [...new Set(apiErr)].slice(0, 15));
await b.close(); process.exit(errs.length || apiErr.length ? 1 : 0);
