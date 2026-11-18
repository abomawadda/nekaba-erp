// اختبار الواجهة في Chromium ضد الخادم الحي (حسابا اختبار ZZ-TEST و zz_live_test)
// التشغيل: cd web && python3 -m http.server 8787 & ; node test/ui.test.mjs <مجلد اللقطات>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2] || '.';
const BASE = 'http://127.0.0.1:8787/';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ proxy });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };
const errors = [];

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG', ignoreHTTPSErrors: true });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(BASE); return { ctx, p };
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });

// ── العضو ──
{
  const { ctx, p } = await phone();
  await p.waitForSelector('#lf'); await shot(p, '01-login');
  await p.fill('[name=jobId]', 'ZZ-TEST'); await p.fill('[name=secret]', '1111'); await p.click('#lf [type=submit]');
  await p.waitForSelector('#lerr .alert'); ok(/غير مطابقة/.test(await p.textContent('#lerr')), 'wrong login message');
  await p.fill('[name=secret]', '4577'); await p.click('#lf [type=submit]');
  await p.waitForSelector('.tiles'); ok((await p.textContent('.top')).includes('أنشطتي'), 'home');
  ok((await p.textContent('.wrap')).includes('مستحق الدعم'), 'eligibility pill');
  ok(await p.isVisible('.prog'), 'completeness bar'); await shot(p, '02-home');
  await p.click('a[href="#/profile"]'); await p.waitForSelector('.tl');
  ok((await p.textContent('.tl')).includes('نقابة مستقلة'), 'timeline shows union moves');
  ok((await p.textContent('.tl')).includes('مدة'), 'durations shown'); await shot(p, '03-profile');
  await p.click('[data-act=editSelf]'); await p.waitForSelector('#sf');
  await p.fill('[name=phone]', '123'); await p.click('#sf [type=submit]');
  ok((await p.textContent('#ferr')).includes('11 رقم'), 'phone validation');
  await p.fill('[name=phone]', '01000000009'); await p.fill('[name=address]', 'المنصورة - شارع الجمهورية');
  await p.selectOption('[name=marital_status]', 'متزوج'); await p.fill('[name=em_name]', 'أحمد'); await p.fill('[name=em_phone]', '01111111111');
  await shot(p, '04-edit-self'); await p.click('#sf [type=submit]'); await p.waitForSelector('#modal[hidden]', { state: 'attached' });
  ok((await p.textContent('.wrap')).includes('شارع الجمهورية'), 'self edit saved');
  await p.click('a[href="#/family"]'); await p.waitForSelector('[data-act=addFam]');
  await p.click('[data-act=addFam]'); await p.waitForSelector('#ff');
  await p.fill('#ff [name=full_name]', 'مريم'); await p.selectOption('#ff [name=relation]', 'ابنة');
  await p.fill('#ff [name=birth_date]', '2015-05-01'); await p.selectOption('#ff [name=edu_stage]', 'ابتدائي'); await p.fill('#ff [name=edu_grade]', '5');
  await shot(p, '05-add-kid'); await p.click('#ff [type=submit]'); await p.waitForSelector('.fam');
  ok((await p.textContent('.wrap')).includes('مريم') && (await p.textContent('.wrap')).includes('سنة'), 'kid added with age');
  await shot(p, '06-family');
  await p.click('a[href="#/profile"]'); await p.waitForSelector('[data-act=request]');
  await p.click('[data-act=request]'); await p.selectOption('#rf [name=field]', 'workplace');
  await p.fill('#rf [name=newValue]', 'طلخا'); await p.fill('#rf [name=reason]', 'قرار نقل 12'); await p.click('#rf [type=submit]');
  await p.waitForSelector('.alert.warn'); ok((await p.textContent('.wrap')).includes('تحت المراجعة'), 'change request pending');
  ok(!(await p.isVisible('a[href="#/admin"]')), 'member has no admin nav');
  await ctx.close();
}
// ── الإدارة ──
{
  const { ctx, p } = await phone();
  await p.click('[data-tab=staff]'); await p.fill('[name=username]', 'zz_live_test'); await p.fill('[name=password]', 'LiveTest#2026');
  await p.click('#lf [type=submit]'); await p.waitForSelector('#pw');
  ok((await p.textContent('.wrap')).includes('لازم تغيّر'), 'must change password');
  await p.fill('[name=oldPassword]', 'LiveTest#2026'); await p.fill('[name=newPassword]', 'LiveTest#2027'); await p.click('#pw button');
  await p.waitForSelector('#qs'); await p.fill('#qs [name=q]', 'اختبار'); await p.click('#qs button');
  await p.waitForSelector('[data-person]'); await shot(p, '07-admin-search');
  await p.click('[data-person]'); await p.waitForSelector('[data-act=movement]');
  ok((await p.textContent('.wrap')).includes('مريم'), 'admin sees family'); await shot(p, '08-admin-person');
  await p.click('[data-act=movement]'); await p.waitForSelector('#mf');
  await p.selectOption('#mf [name=kind]', 'ترقية'); await p.selectOption('#mfField', 'grade');
  await p.selectOption('#mf [name=toValue]', 'الأولى'); await p.fill('#mf [name=effectiveDate]', '2026-01-01'); await p.fill('#mf [name=decisionRef]', '55');
  await shot(p, '09-movement'); await p.click('#mf [type=submit]'); await p.waitForSelector('#modal[hidden]', { state: 'attached' });
  ok((await p.textContent('.tl')).includes('الأولى'), 'movement recorded');
  await p.click('a[href="#/requests"]'); await p.waitForSelector('[data-act=approve]'); await shot(p, '10-requests');
  await p.click('[data-act=approve]'); await p.waitForSelector('.empty');
  ok((await p.textContent('.wrap')).includes('مفيش طلبات'), 'request approved');
  await ctx.close();
}
ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
await browser.close();
console.log(`\n${pass} نجح · ${fail} فشل`); process.exit(fail ? 1 : 0);
