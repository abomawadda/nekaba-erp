// اختبار شاشات المزايا في Chromium: عضو تجريبي ZZ-BEN (ميزتان تجريبيتان) + حساب إدارة zz_import — يُحذفان بعده
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2] || '.', BASE = 'http://127.0.0.1:8787/';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ proxy });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };
const errors = [];
const page = async () => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept()); await p.goto(BASE); return p; };
// العضو
let p = await page();
await p.fill('[name=jobId]', 'ZZ-BEN'); await p.fill('[name=secret]', '4577'); await p.click('#lf [type=submit]');
await p.waitForSelector('a[href="#/mybenefits"]'); await p.screenshot({ path: `${OUT}/b1-home.png`, fullPage: true });
await p.click('a[href="#/mybenefits"]'); await p.waitForSelector('.list .li');
let t = await p.textContent('.wrap');
ok(/٣٧٥|375/.test(t), 'member total 375'); ok(t.includes('منحة زواج') && t.includes('بدل جلسات'), 'member items');
ok((await p.$$('.list .li')).length === 2, '2 items'); await p.screenshot({ path: `${OUT}/b2-mybenefits.png`, fullPage: true });
await p.goto(BASE + '#/benefits'); await p.waitForTimeout(1500);
ok(!(await p.textContent('.wrap')).includes('أعلى 20'), 'member cannot see report');
// الإدارة
p = await page();
await p.click('[data-tab=staff]'); await p.fill('[name=username]', 'zz_import'); await p.fill('[name=password]', 'Imp#Ben-3307m'); await p.click('#lf [type=submit]');
await p.waitForSelector('a[href="#/benefits"]'); await p.click('a[href="#/benefits"]'); await p.waitForSelector('#byf');
t = await p.textContent('.wrap');
ok(/٩٣٬٥٦٠|93,560|٩٣٬١٨٥|93,185/.test(t), 'report total'); ok(t.includes('مزايا أعضاء المجلس') && t.includes('أعلى 20'), 'report sections');
ok(t.includes('منحة وفاة') && t.includes('بدل جلسات'), 'by category'); await p.screenshot({ path: `${OUT}/b3-report.png`, fullPage: true });
await p.selectOption('#byf [name=year]', '2024'); await p.click('#byf button'); await p.waitForTimeout(1500);
ok(!(await p.textContent('.wrap')).includes('حسب السنة'), 'year filter applied');
await p.locator('.card:has-text("مزايا أعضاء المجلس") [data-person]').first().click(); await p.waitForSelector('text=ما استفاد به من النقابة');
ok((await p.textContent('.wrap')).includes('بصفته'), 'person benefits with board capacity'); await p.screenshot({ path: `${OUT}/b4-person.png`, fullPage: true });
ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
await browser.close(); console.log(`\n${pass} نجح · ${fail} فشل`); process.exit(fail ? 1 : 0);
