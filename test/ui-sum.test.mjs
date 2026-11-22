// اختبار شاشات المصايف في Chromium — بلا تحصيل: مسئول zz_sumoff + عضوان ZZ-SUM1/ZZ-SUM2، تُحذف بعده مع موسم «ZZ مصيف اختبار»
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2] || '.', BASE = 'http://127.0.0.1:8787/';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ proxy });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };
const errors = []; let promptAns = null;
const page = async () => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  p.on('dialog', d => d.type() === 'prompt' ? d.accept(promptAns ?? d.defaultValue()) : d.accept()); await p.goto(BASE); return p; };
const yr = new Date().getFullYear() + 1;
const member = async job => { const m = await page(); await m.fill('[name=jobId]', job); await m.fill('[name=secret]', job === 'ZZ-SUM1' ? '4577' : '4578');
  await m.click('#lf [type=submit]'); await m.waitForSelector('a[href="#/summer"]'); return m; };
// المسئول ينشئ الموسم
let p = await page();
await p.click('[data-tab=staff]'); await p.fill('[name=username]', 'zz_sumoff'); await p.fill('[name=password]', 'Sum#2026x'); await p.click('#lf [type=submit]');
await p.waitForSelector('a[href="#/summer"]'); await p.click('a[href="#/summer"]'); await p.waitForSelector('[data-act=sumNew]');
await p.click('[data-act=sumNew]'); await p.waitForSelector('#ssf');
await p.fill('#ssf [name=title]', 'ZZ مصيف اختبار'); await p.selectOption('#ssf [name=decision_id]', { index: 1 });
await p.fill('#ssf [name=batches]', `الفوج الأول | ${yr}-07-01 | ${yr}-07-07\nالفوج الثاني | ${yr}-07-08 | ${yr}-07-14`);
await p.fill('#ssf [name=units]', 'ZZ رأس البر | ZZ شركة | A1 | شقة | 4 | 3000 | 1000 | 500 | 2500\nZZ رأس البر | ZZ شركة | A2 | شاليه | 6 | 4000 | 1500 | 500 | 3500');
await p.screenshot({ path: `${OUT}/s1-form.png`, fullPage: true });
await p.click('#ssf [type=submit]'); await p.waitForSelector('[data-act=sumStatus]');
let t = await p.textContent('.wrap');
ok(t.includes('ZZ مصيف اختبار') && /٤|4/.test(t), 'season created (4 slots)');
await p.click('[data-act=sumStatus]'); await p.waitForTimeout(1500);
ok((await p.textContent('.wrap')).includes('التقديم مفتوح'), 'applications opened'); await p.screenshot({ path: `${OUT}/s2-admin.png`, fullPage: true });
// عضوان يقدّمان
const m1 = await member('ZZ-SUM1');
await m1.click('a[href="#/summer"]'); await m1.waitForSelector('[data-season]');
await m1.locator('[data-season]', { hasText: 'ZZ مصيف اختبار' }).click(); await m1.waitForSelector('#saf');
t = await m1.textContent('.wrap'); ok(t.includes('الفوج الأول') && t.includes('A2'), 'member sees batches & units');
await m1.locator('[data-pref]').nth(0).locator('[name=batch_id]').selectOption({ index: 1 });
await m1.locator('[data-pref]').nth(1).locator('[name=batch_id]').selectOption({ index: 2 });
await m1.check('#saf [name=fam]'); await m1.screenshot({ path: `${OUT}/s3-apply.png`, fullPage: true });
await m1.click('#saf [type=submit]'); await m1.waitForSelector('[data-act=sumWithdraw]');
ok((await m1.textContent('.wrap')).includes('مقدَّم'), 'member1 applied');
const m2 = await member('ZZ-SUM2');
await m2.click('a[href="#/summer"]'); await m2.waitForSelector('[data-season]');
await m2.locator('[data-season]', { hasText: 'ZZ مصيف اختبار' }).click(); await m2.waitForSelector('#saf');
await m2.locator('[data-pref]').nth(0).locator('[name=batch_id]').selectOption({ index: 1 });
await m2.click('#saf [type=submit]'); await m2.waitForSelector('[data-act=sumWithdraw]'); ok(true, 'member2 applied');
// قفل التقديم والتوزيع بالقرعة
await p.reload(); await p.waitForSelector('[data-act=sumStatus]');
ok((await p.textContent('.wrap')).includes('عضو اختبار المصايف'), 'admin sees applications');
await p.click('[data-act=sumStatus]'); await p.waitForSelector('[data-act=sumAlloc]');
promptAns = 'ZZ-777'; await p.click('[data-act=sumAlloc]'); await p.waitForSelector('[data-act=sumClose]'); promptAns = null;
t = await p.textContent('.wrap'); ok(t.includes('بانتظار السداد') && t.includes('تم التوزيع'), 'allocated'); await p.screenshot({ path: `${OUT}/s4-allocated.png`, fullPage: true });
// العضو يرى القبول والقرعة ويعتذر (بلا مدفوع)
await m1.reload(); await m1.waitForSelector('[data-act=sumApolMy]');
t = await m1.textContent('.wrap'); ok(t.includes('اتقبلت') && t.includes('ZZ-777') && t.includes('sha256'), 'member sees acceptance + verifiable draw');
ok(/١٬?٠٠٠|1,?000/.test(t), 'member price 1000 (4 beds for 2)'); await m1.screenshot({ path: `${OUT}/s5-accepted.png`, fullPage: true });
promptAns = 'اختبار'; await m1.click('[data-act=sumApolMy]'); await m1.waitForTimeout(1500); promptAns = null;
ok((await m1.textContent('.wrap')).includes('معتذر'), 'member apologized');
await p.reload(); await p.waitForSelector('[data-act=sumClose]');
ok((await p.textContent('.wrap')).includes('معتذر'), 'admin sees apology'); await p.screenshot({ path: `${OUT}/s6-admin-after.png`, fullPage: true });
ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
await browser.close(); console.log(`\n${pass} نجح · ${fail} فشل`); process.exit(fail ? 1 : 0);
