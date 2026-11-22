// اختبار شاشات الأجهزة (خدمة إعلان وحجز فقط — بلا ماليات): مسئول zz_devoff + عضو ZZ-D1، يُحذفان بعده مع عرض «ZZ عرض اختبار»
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2] || '.', BASE = 'http://127.0.0.1:8787/';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ proxy });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };
const errors = [];
const page = async () => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept()); await p.goto(BASE); return p; };
// المسئول ينشئ العرض ويفتحه
const p = await page();
await p.click('[data-tab=staff]'); await p.fill('[name=username]', 'zz_devoff'); await p.fill('[name=password]', 'Dev#2026x'); await p.click('#lf [type=submit]');
await p.waitForSelector('a[href="#/devadmin"]'); await p.click('a[href="#/devadmin"]'); await p.waitForSelector('[data-act=devNew]');
await p.click('[data-act=devNew]'); await p.waitForSelector('#dof');
await p.fill('#dof [name=title]', 'ZZ عرض اختبار'); await p.fill('#dof [name=supplier]', 'ZZ معرض'); await p.fill('#dof [name=contact]', '0100');
await p.fill('#dof [name=items]', 'ثلاجة اختبار | 9000 | 10000 | 10 | |\nغسالة اختبار | 6500 | | 6 | 5 | ضمان سنتين');
await p.screenshot({ path: `${OUT}/d1-form.png`, fullPage: true });
await p.click('#dof [type=submit]'); await p.waitForTimeout(1500);
const card = p.locator('.card', { hasText: 'ZZ عرض اختبار' });
ok(await card.count() > 0, 'offer created');
await card.locator('[data-act=devStatus]').click(); await p.waitForTimeout(1500);
ok((await p.locator('.card', { hasText: 'ZZ عرض اختبار' }).textContent()).includes('الطلب مفتوح'), 'offer opened');
// العضو يطلب
const m = await page();
await m.fill('[name=jobId]', 'ZZ-D1'); await m.fill('[name=secret]', '3333'); await m.click('#lf [type=submit]');
await m.waitForSelector('a[href="#/devices"]'); await m.click('a[href="#/devices"]'); await m.waitForSelector('form[data-devorder]');
let t = await m.textContent('.wrap'); ok(t.includes('ثلاجة اختبار') && t.includes('متبقي 5'), 'member sees items + stock');
ok(t.includes('خدمة إعلان وحجز') && t.includes('ضمان سنتين'), 'service notice + item notes');
await m.screenshot({ path: `${OUT}/d2-offers.png`, fullPage: true });
await m.locator('.kv', { hasText: 'ثلاجة اختبار' }).locator('button').click(); await m.waitForSelector('[data-act=devCancel]');
t = await m.textContent('.wrap'); ok(t.includes('مطلوب') && t.includes('تقسيط 10 شهر'), 'booked: installments 10 months');
// المسئول يعتمد
await p.reload(); await p.waitForSelector('[data-act=devOrders]');
await p.locator('.card', { hasText: 'ZZ عرض اختبار' }).locator('[data-act=devOrders]').click(); await p.waitForSelector('[data-act=devDecide]');
await p.click('[data-act=devDecide][data-s="مؤكد"]'); await p.waitForSelector('[data-act=devDecide][data-s="مسلّم"]');
ok((await p.textContent('.wrap')).includes('اتسلّم'), 'confirmed → delivered button'); await p.screenshot({ path: `${OUT}/d3-admin.png`, fullPage: true });
await m.reload(); await m.waitForSelector('[data-act=devCancel]'); t = await m.textContent('.wrap');
ok(t.includes('مؤكد'), 'member sees confirmed'); await m.screenshot({ path: `${OUT}/d4-member.png`, fullPage: true });
ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
await browser.close(); console.log(`\n${pass} نجح · ${fail} فشل`); process.exit(fail ? 1 : 0);
