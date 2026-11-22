// اختبار شاشات الأنشطة في Chromium — بلا تحصيل (القيود لا تُحذف): مسئول رحلات zz_trips + عضو ZZ-TRIP، تُحذف بعده مع النشاط «ZZ رحلة اختبار»
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2] || '.', BASE = 'http://127.0.0.1:8787/';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ proxy });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };
const errors = [];
const page = async () => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept()); await p.goto(BASE); return p; };
const future = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
// مسئول الرحلات ينشئ النشاط ويفتحه
let p = await page();
await p.click('[data-tab=staff]'); await p.fill('[name=username]', 'zz_trips'); await p.fill('[name=password]', 'Trips#2026x'); await p.click('#lf [type=submit]');
await p.waitForSelector('a[href="#/trips"]'); await p.click('a[href="#/trips"]'); await p.waitForSelector('[data-act=actNew]');
await p.click('[data-act=actNew]'); await p.waitForSelector('#acf');
await p.fill('#acf [name=title]', 'ZZ رحلة اختبار'); await p.fill('#acf [name=start_date]', future); await p.fill('#acf [name=location]', 'الفيوم');
await p.fill('#acf [name=capacity]', '45'); await p.fill('#acf [name=max_companions]', '2');
await p.selectOption('#acf [name=decision_id]', { index: 1 });
await p.fill('#acf [name=program]', '06:00 - التجمع أمام السنترال\n08:00 - التحرك');
const prices = [['500', '150'], ['500', '250'], ['0', '0'], ['500', '500']];
for (let i = 0; i < 4; i++) { const row = p.locator('[data-pr]').nth(i);
  await row.locator('[name=full_price]').fill(prices[i][0]); await row.locator('[name=member_price]').fill(prices[i][1]); }
await p.screenshot({ path: `${OUT}/a1-form.png`, fullPage: true });
await p.click('#acf [type=submit]'); await p.waitForSelector('[data-act=actStatus]');
ok((await p.textContent('.wrap')).includes('ZZ رحلة اختبار'), 'activity created → admin page');
await p.click('[data-act=actStatus]'); await p.waitForTimeout(1500);
ok((await p.textContent('.wrap')).includes('الحجز مفتوح'), 'booking opened'); await p.screenshot({ path: `${OUT}/a2-admin.png`, fullPage: true });
// العضو يحجز
let m = await page();
await m.fill('[name=jobId]', 'ZZ-TRIP'); await m.fill('[name=secret]', '4577'); await m.click('#lf [type=submit]');
await m.waitForSelector('a[href="#/trips"]'); await m.click('a[href="#/trips"]'); await m.waitForSelector('[data-trip]');
ok((await m.textContent('.wrap')).includes('ZZ رحلة اختبار'), 'member sees trip'); await m.screenshot({ path: `${OUT}/a3-list.png`, fullPage: true });
await m.locator('[data-trip]', { hasText: 'ZZ رحلة اختبار' }).click(); await m.waitForSelector('#bkf');
const t = await m.textContent('.wrap');
ok(t.includes('البرنامج') && t.includes('التجمع') && t.includes('الإلغاء والاسترداد'), 'trip details'); await m.screenshot({ path: `${OUT}/a4-trip.png`, fullPage: true });
await m.check('#bkf [name=fam]'); await m.click('[data-act=compAdd]'); await m.fill('[name=c_name]', 'صديق اختبار'); await m.fill('[name=c_age]', '30');
await m.click('#bkf [type=submit]'); await m.waitForSelector('[data-act=myCancel]');
const tb = await m.textContent('.wrap');
ok(/٩٠٠|900/.test(tb), 'total 150+250+500 = 900'); ok(tb.includes('بانتظار السداد') && tb.includes('ادفع قبل'), 'pending with deadline');
ok(/٦٠٠|600/.test(tb), 'subsidy 350+250 = 600'); await m.screenshot({ path: `${OUT}/a5-booked.png`, fullPage: true });
// الإدارة ترى الحجز
await p.reload(); await p.waitForSelector('[data-act=bkCancel]');
ok((await p.textContent('.wrap')).includes('عضو اختبار الرحلات'), 'admin sees booking'); await p.screenshot({ path: `${OUT}/a6-admin-bookings.png`, fullPage: true });
// العضو يلغي (بلا مدفوع)
await m.click('[data-act=myCancel]'); await m.waitForTimeout(1500);
ok(!(await m.$('[data-act=myCancel]')), 'member cancelled');
ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
await browser.close(); console.log(`\n${pass} نجح · ${fail} فشل`); process.exit(fail ? 1 : 0);
