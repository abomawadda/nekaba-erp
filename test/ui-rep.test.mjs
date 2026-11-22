// اختبار شاشة التقارير الشاملة (قراءة فقط) بحساب مراجع مؤقت zz_rep يُحذف بعده
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.argv[2] || '.', BASE = 'http://127.0.0.1:8787/';
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
const browser = await chromium.launch({ proxy });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG' });
const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(BASE);
await p.click('[data-tab=staff]'); await p.fill('[name=username]', 'zz_rep'); await p.fill('[name=password]', 'Rep#2026x'); await p.click('#lf [type=submit]');
await p.waitForSelector('a[href="#/reports"]'); await p.click('a[href="#/reports"]'); await p.waitForSelector('#repf');
let t = await p.textContent('.wrap'); ok(t.includes('الأعضاء') && t.includes('المزايا حسب البند') && t.includes('الفائض'), 'report sections');
await p.selectOption('#repf [name=year]', '2025'); await p.click('#repf button'); await p.waitForTimeout(2500);
t = await p.textContent('.wrap'); ok(/٢٢٬٥٣٠|22,530/.test(t), 'benefits 2025 = 22,530'); ok(/٧٥٬٠٨٥|75,085/.test(t), 'revenue 2025 = 75,085');
await p.screenshot({ path: `${OUT}/r1-report.png`, fullPage: true });
ok(errors.length === 0, 'no JS errors: ' + errors.join(' | '));
await browser.close(); console.log(`\n${pass} نجح · ${fail} فشل`); process.exit(fail ? 1 : 0);
