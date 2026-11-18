// اختبار حي لخادم erp-api (يحتاج حسابي اختبار ZZ-TEST و zz_live_test)
const URL_ = process.env.ERP_URL || 'https://bulfwclnhbwpzqwnxjie.supabase.co/functions/v1/erp-api';
const call = async (action, payload = {}, token) => (await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip' }, body: JSON.stringify({ action, payload, token }) })).json();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('✗', m); } };

ok((await (await fetch(URL_)).json()).service === 'nekaba-erp', 'health');
ok(!(await call('GET_ME', {}, 'x.y')).success, 'forged token rejected');
let r = await call('LOGIN_MEMBER', { jobId: 'ZZ-TEST', secret: '0000' }); ok(!r.success, 'wrong secret');
r = await call('LOGIN_MEMBER', { jobId: 'ZZ-TEST', secret: '4577' }); ok(r.success && r.token && !r.session, 'member login → token only');
const mt = r.token;
r = await call('GET_ME', {}, mt); ok(r.success && r.profile.person.job_id === 'ZZ-TEST' && r.roles.includes('MEMBER'), 'get me');
ok(typeof r.profile.completeness.percent === 'number', 'completeness');
r = await call('SAVE_MY_FAMILY_MEMBER', { member: { full_name: 'ابن اختبار', relation: 'ابن', birth_date: '2016-02-02' } }, mt);
ok(r.success && r.profile.family.length === 1, 'add family');
r = await call('REMOVE_MY_FAMILY_MEMBER', { id: r.id }, mt); ok(r.success && r.profile.family.length === 0, 'remove family');
r = await call('SEARCH_PERSONS', {}, mt); ok(!r.success, 'member cannot search');
const tamper = mt.split('.'); const body = JSON.parse(Buffer.from(tamper[0], 'base64url'));
body.s.kind = 'staff'; ok(!(await call('GET_ME', {}, Buffer.from(JSON.stringify(body)).toString('base64url') + '.' + tamper[1])).success, 'tampered token rejected');
r = await call('LOGIN_ADMIN', { username: 'zz_live_test', password: 'LiveTest#2026' }); ok(r.success && r.token, 'admin login');
r = await call('SEARCH_PERSONS', { q: 'ZZ-TEST' }, r.token); ok(r.success && r.items.length === 1, 'admin search');
r = await call('GET_LISTS', {}, mt); ok(r.success && r.lists.grade.length === 9, 'lists');
for (let i = 0; i < 5; i++) await call('LOGIN_ADMIN', { username: 'zz_lock_probe', password: 'x' });
r = await call('LOGIN_ADMIN', { username: 'zz_lock_probe', password: 'x' }); ok(/إيقاف الدخول مؤقتاً/.test(r.message || ''), 'lockout after 5');
console.log(`\n${pass} نجح · ${fail} فشل`); process.exit(fail ? 1 : 0);
