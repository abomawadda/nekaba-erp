// منصة النقابة — الواجهة (بلا إطار عمل). كل اتصال عبر call(action, payload).
(() => {
'use strict';
const C = window.ERP_CONFIG;
const $ = (s, el = document) => el.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { token: null, me: null, lists: {}, kind: null };
try { S.token = localStorage.getItem('erp_token'); S.kind = localStorage.getItem('erp_kind'); } catch (_) {}

// ───────── الاتصال ─────────
async function call(action, payload = {}) {
  let r;
  try {
    const res = await fetch(C.API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload, token: S.token }) });
    r = await res.json();
  } catch (_) { r = { success: false, message: 'تعذّر الاتصال. تأكد من الإنترنت وحاول تاني.' }; }
  if (r && r.expired) { logout(true); }
  return r || { success: false, message: 'رد غير متوقع.' };
}
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3200);
}
function saveSession(token, kind) {
  S.token = token; S.kind = kind;
  try { localStorage.setItem('erp_token', token); localStorage.setItem('erp_kind', kind); } catch (_) {}
}
function logout(expired) {
  S.token = null; S.me = null;
  try { localStorage.removeItem('erp_token'); } catch (_) {}
  if (expired) toast('انتهت الجلسة. سجّل الدخول تاني.', true);
  location.hash = '#/login'; render();
}

// ───────── مفردات ─────────
const RELATIONS = ['زوج', 'زوجة', 'ابن', 'ابنة', 'أب', 'أم', 'أخ', 'أخت', 'حفيد', 'حفيدة', 'أخرى'];
const MARITAL = ['أعزب', 'متزوج', 'مطلق', 'أرمل'];
const ORGS = ['النقابة العامة', 'نقابة مستقلة', 'غير منضم'];
const STATES = ['نشط', 'موقوف', 'إجازة بدون أجر', 'نقل', 'معاش', 'استقالة', 'وفاة'];
const FIELD_LBL = { full_name: 'الاسم', national_id: 'الرقم القومي', job_id: 'الرقم الوظيفي', insurance_no: 'الرقم التأميني',
  hire_date: 'تاريخ التعيين', retirement_date: 'تاريخ المعاش', monthly_dues: 'الاستقطاع الشهري', person_type: 'نوع الشخص',
  job_title: 'الوظيفة', grade: 'الدرجة', workplace: 'جهة العمل', union_org: 'التنظيم النقابي', member_state: 'الحالة',
  phone: 'الموبايل', phone2: 'موبايل 2', email: 'البريد', address: 'العنوان', qualification: 'المؤهل',
  specialization: 'التخصص', marital_status: 'الحالة الاجتماعية', blood_type: 'فصيلة الدم', special_needs: 'احتياجات خاصة' };
const dt = v => v ? `<span class="dt">${esc(v)}</span>` : '';
const relIcon = r => ({ 'ابن': '👦', 'ابنة': '👧', 'زوج': '👨', 'زوجة': '👩', 'أب': '👴', 'أم': '👵', 'حفيد': '🧒', 'حفيدة': '🧒' }[r] || '🧑');
const ageOf = d => { if (!d) return ''; const b = new Date(d), n = new Date(); let a = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a >= 0 ? a + ' سنة' : ''; };
const listOpts = (key, fallback = []) => (S.lists[key] ? S.lists[key].map(x => x.value) : fallback);
const options = (arr, sel, blank = true) => (blank ? '<option value="">— اختر —</option>' : '') +
  arr.map(v => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
const can = p => !!(S.me && S.me.perms && p in S.me.perms);
const isStaff = () => S.kind === 'staff';

// ───────── النافذة ─────────
function openModal(html, onMount) {
  const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false;
  m.onclick = e => { if (e.target === m) closeModal(); };
  onMount && onMount(m);
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
const formData = el => Object.fromEntries([...el.querySelectorAll('[name]')].map(i =>
  [i.name, i.type === 'checkbox' ? i.checked : i.value.trim()]));
async function busy(btn, fn) { btn.disabled = true; try { return await fn(); } finally { btn.disabled = false; } }

// ───────── الدخول ─────────
function loginView() {
  const tab = S._loginTab || 'member';
  return `<div class="login"><div class="box">
    <div class="hd"><img src="img/logo-union.png" alt=""><h1>منصة النقابة</h1><div class="muted">${esc(C.ORG_NAME)}</div></div>
    <div class="tabs"><button data-tab="member" class="${tab === 'member' ? 'on' : ''}">أنا عضو / موظف</button>
      <button data-tab="staff" class="${tab === 'staff' ? 'on' : ''}">الإدارة</button></div>
    <form id="lf">${tab === 'member' ? `
      <label class="f"><span>الرقم الوظيفي</span><input class="input" name="jobId" inputmode="numeric" autocomplete="username" placeholder="مثال: 97117" required></label>
      <label class="f"><span>آخر 4 أرقام من الرقم القومي — أو رقم الموبايل المسجّل</span>
        <input class="input" name="secret" inputmode="numeric" autocomplete="current-password" placeholder="مثال: 0032 أو 01xxxxxxxxx" required></label>` : `
      <label class="f"><span>اسم المستخدم</span><input class="input" name="username" autocomplete="username" required></label>
      <label class="f"><span>كلمة المرور</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>`}
      <div id="lerr"></div>
      <button class="btn block" type="submit">دخول</button>
    </form></div></div>`;
}
function bindLogin() {
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S._loginTab = b.dataset.tab; render(); });
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const d = formData(e.target), member = (S._loginTab || 'member') === 'member';
    const r = await busy(e.target.querySelector('button[type=submit]'), () => call(member ? 'LOGIN_MEMBER' : 'LOGIN_ADMIN', d));
    if (!r.success) { $('#lerr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    saveSession(r.token, member ? 'member' : 'staff');
    location.hash = member ? '#/home' : '#/dash'; await boot();
  };
}

// ───────── الهيكل (ERP: قائمة جانبية بالوحدات على الكمبيوتر، شريط سفلي على الموبايل) ─────────
function navModel() {
  const gov = can('governance.view') || can('governance.manage');
  const fin = can('finance.view');
  if (isStaff()) return [
    ['الرئيسية', [['#/dash', '📊', 'لوحة القيادة', true], ['#/notifications', '🔔', 'المهام والإشعارات', true]]],
    ['العضوية', [['#/admin', '👥', 'الأعضاء', can('profile.view')], ['#/requests', '📝', 'طلبات التعديل', can('profile.change.approve')], ['#/lists', '🗂️', 'القوائم', can('lists.manage')]]],
    ['الحوكمة', [['#/board', '🏛️', 'المجلس', gov], ['#/meetings', '🗓️', 'الاجتماعات', gov], ['#/decisions', '⚖️', 'القرارات', gov]]],
    ['المالية والخزينة', [['#/finance', '💰', 'المالية', fin], ['#/cheques', '🧾', 'الشيكات والعُهد', fin], ['#/receipts', '📥', 'المقبوضات', fin], ['#/entries', '📒', 'القيود', fin], ['#/trial', '⚖️', 'ميزان المراجعة', fin]]],
    ['الخدمات والمزايا', [['#/trips', '🚌', 'الأنشطة', can('activities.manage')], ['#/summer', '🏖️', 'المصايف', can('summer.manage')], ['#/grantsadmin', '🎁', 'المنح', canGrtAdmin()], ['#/devadmin', '📱', 'الأجهزة والعمرة', can('devices.manage')], ['#/benefits', '🏅', 'المزايا', can('benefits.view')]]],
    ['التقارير والاتصال', [['#/reports', '📈', 'التقارير', can('reports.view') || fin], ['#/news', '📰', 'الأخبار', can('news.manage')]]],
    ['النظام', [['#/account', '⚙️', 'حسابي', true]]],
  ];
  return [
    ['الرئيسية', [['#/home', '🏠', 'أنشطتي', true], ['#/notifications', '🔔', 'الإشعارات', true]]],
    ['خدماتي', [['#/trips', '🚌', 'الرحلات والفعاليات', true], ['#/mytrips', '🎫', 'حجوزاتي', true], ['#/summer', '🏖️', 'المصايف', true], ['#/grants', '🎁', 'المنح', true], ['#/devices', '📱', 'الأجهزة', true], ['#/umrah', '🕋', 'العمرة والحج', true]]],
    ['ملفي', [['#/profile', '🪪', 'ملفي', true], ['#/family', '👨‍👩‍👧', 'أسرتي', true], ['#/mybenefits', '🏅', 'استفاداتي', true]]],
    ['الإدارة', [['#/board', '🏛️', 'المجلس', gov], ['#/finance', '💰', 'المالية', fin], ['#/reports', '📈', 'التقارير', can('reports.view')], ['#/news', '📰', 'الأخبار', can('news.manage')]]],
    ['النظام', [['#/account', '⚙️', 'حسابي', true]]],
  ];
}
function shell(title, body) {
  const me = S.me, p = me && me.profile && me.profile.person;
  const name = p ? p.full_name : (me && me.username) || '';
  const h = location.hash;
  const groups = navModel().map(([g, items]) => [g, items.filter(n => n[3])]).filter(g => g[1].length);
  const all = groups.flatMap(g => g[1]);
  const cur = all.filter(n => h.startsWith(n[0])).sort((x, y) => y[0].length - x[0].length)[0];
  const grp = cur && groups.find(g => g[1].includes(cur));
  // شريط الموبايل: نفس الروابط السابقة (بدون التكرار داخل المالية والحوكمة)
  const mob = all.filter(n => !['#/notifications', '#/meetings', '#/decisions', '#/cheques', '#/receipts', '#/entries', '#/trial', '#/mytrips', '#/umrah', '#/mybenefits'].includes(n[0])
    && !(!isStaff() && ['#/devices', '#/summer', '#/grants', '#/trips'].includes(n[0])));
  return `<div class="erp">
    <aside class="side"><div class="brand"><img src="img/logo-union.png" alt=""><div><b>منصة النقابة</b><small>${esc(C.ORG_NAME)}</small></div></div>
      ${groups.map(([g, items]) => `<div class="sg"><div class="sgt">${esc(g)}</div>${items.map(n => `<a href="${n[0]}" class="${n === cur ? 'on' : ''}"><i>${n[1]}</i>${n[2]}</a>`).join('')}</div>`).join('')}
      <div class="sfoot"><div class="who"><span class="av">${esc((name || '؟').trim()[0] || '؟')}</span><div><b>${esc(name)}</b><small>${isStaff() ? 'الإدارة' : 'عضو'}</small></div></div></div>
    </aside>
    <div class="main"><div class="top"><img src="img/logo-union.png" alt=""><div class="t"><small class="crumb">${grp ? esc(grp[0]) + ' ‹ ' : ''}</small><b>${esc(title)}</b><small class="nm">${esc(name)}</small></div>
      ${isStaff() && can('profile.view') ? `<form class="gs" id="gs"><input name="q" placeholder="🔎 بحث عن عضو: اسم، رقم وظيفي، موبايل…" value="${esc(S.q || '')}"></form>` : ''}
      <a href="#/notifications" class="bell" title="الإشعارات">🔔${S.ntfCount ? `<span class="badge">${S.ntfCount > 9 ? '9+' : S.ntfCount}</span>` : ''}</a>
      <button data-act="logout">خروج</button></div>
    <div class="wrap">${body}</div></div></div>
    <nav class="nav">${mob.map(n => `<a href="${n[0]}" class="${h.startsWith(n[0]) ? 'on' : ''}"><i>${n[1]}</i>${n[2]}</a>`).join('')}</nav>`;
}

// ───────── لوحة القيادة (الإدارة) ─────────
const numAr = v => Number(v || 0).toLocaleString('ar-EG');
const bars = (o, money_ = false) => { const e = Object.entries(o || {}).sort((x, y) => y[1] - x[1]); const mx = Math.max(1, ...e.map(x => +x[1]));
  return e.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div><i style="width:${Math.max(2, 100 * v / mx)}%"></i></div><b>${money_ ? money(v) : numAr(v)}</b></div>`).join('') || '<div class="empty">لا بيانات</div>'; };
function dashView() {
  const d = S.dash || {}, r = d.rep || {}, f = d.fin || {}, n = S.ntf || {}, m = r.members || {}, b = r.benefits || {}, rf = r.finance || {};
  const tasks = n.tasks || [], y = new Date().getFullYear();
  const kpi = (i, v, l, href, cls = '') => `<a class="kpi ${cls}" ${href ? `href="${href}"` : ''}><i>${i}</i><div><b>${v}</b><small>${l}</small></div></a>`;
  const qa = [['#/admin', '👤', 'بحث عن عضو', can('profile.view')], ['chqNew', '🧾', 'صرف شيك', can('treasury.cheque.issue')], ['rcptNew', '📥', 'إيداع / تحصيل', can('treasury.receipt')],
    ['#/trips', '🚌', 'نشاط جديد', can('activities.manage')], ['#/grantsadmin', '🎁', 'مراجعة المنح', canGrtAdmin()], ['#/meetings', '🗓️', 'الاجتماعات', can('governance.view') || can('governance.manage')],
    ['#/news', '📰', 'نشر خبر', can('news.manage')], ['#/reports', '📈', 'التقارير', can('reports.view') || can('finance.view')]].filter(x => x[3]);
  const surplus = +rf.revenue - +rf.expense;
  return `<div class="hello"><div><h1>أهلاً${S.me.username ? '، ' + esc(S.me.username) : ''} 👋</h1><div class="muted">ملخص المنظومة لسنة ${y} — ${dt(new Date().toISOString().slice(0, 10))}</div></div></div>
    <div class="kpis">
      ${r.members ? kpi('👥', numAr(m.total), 'عضو مسجّل', '#/admin') : ''}
      ${f.bank !== undefined ? kpi('🏦', money(f.bank), 'رصيد البنك الدفتري', '#/ledger/1102') : ''}
      ${f.custody !== undefined ? kpi('🧾', money(f.custody), `عُهد تحت التسوية (${numAr(f.unsettled)} شيك)`, '#/cheques', +f.custody ? 'warn' : '') : ''}
      ${r.finance ? kpi(surplus >= 0 ? '📈' : '📉', money(surplus), `فائض / (عجز) ${r.year || y}`, '#/reports', surplus >= 0 ? 'ok' : 'bad') : ''}
      ${r.benefits ? kpi('🏅', money(b.total), `مزايا ${r.year || y} لـ ${numAr(b.people)} مستفيد`, '#/benefits') : ''}
      ${kpi('📌', numAr(tasks.reduce((a, t) => a + +t.count, 0)), 'مهام تنتظر إجراءك', '#/notifications', tasks.length ? 'warn' : 'ok')}
    </div>
    <div class="dgrid">
      <div class="card"><h2>📌 صندوق المهام<span class="sp"></span><a class="pill" href="#/notifications" style="text-decoration:none">الكل</a></h2>
        ${tasks.map(t => `<a class="task" href="${esc(t.link)}"><span>${esc(t.title)}</span><span class="pill warn">${numAr(t.count)}</span><em>←</em></a>`).join('') || '<div class="empty">✅ لا مهام معلّقة — كل شيء تمام</div>'}</div>
      <div class="card"><h2>⚡ إجراءات سريعة</h2><div class="qa">${qa.map(([k, i, t]) => k.startsWith('#') ? `<a href="${k}"><i>${i}</i>${t}</a>` : `<button data-act="${k}"><i>${i}</i>${t}</button>`).join('')}</div></div>
      ${r.finance ? `<div class="card"><h2>💰 الأداء المالي ${r.year || y}<span class="sp"></span><a class="pill" href="#/finance" style="text-decoration:none">المالية</a></h2>
        ${bars({ 'الإيرادات': +rf.revenue || 0, 'المصروفات': +rf.expense || 0 }, true)}
        <div style="margin-top:8px">${kvh('الخزينة الآن', money(rf.cash))}${kvh('عُهد تحت التسوية', money(rf.custody))}</div></div>` : ''}
      ${(f.byGroup || []).length ? `<div class="card"><h2>📊 المصروفات حسب المجموعة</h2>${bars(Object.fromEntries(f.byGroup.map(g => [g.name, +g.amount])), true)}</div>` : ''}
      ${r.members ? `<div class="card"><h2>👥 الأعضاء حسب التنظيم</h2>${bars(m.byOrg)}</div><div class="card"><h2>🪪 الأعضاء حسب الحالة</h2>${bars(m.byState)}</div>` : ''}
      ${(b.byCategory || []).length ? `<div class="card"><h2>🏅 المزايا حسب البند</h2>${bars(Object.fromEntries(b.byCategory.map(c => [c.category, +c.total])), true)}</div>` : ''}
      ${(f.openCustody || []).length ? `<div class="card"><h2>🧾 العُهد المفتوحة</h2>${f.openCustody.map(o => kvh(esc(o.party), money(o.balance))).join('')}</div>` : ''}
      ${(r.activities || []).length ? `<div class="card"><h2>🚌 الأنشطة ${r.year || y}</h2>${r.activities.slice(0, 6).map(a => kvh(`${esc(a.title)} <small class="muted">${dt(a.date)}</small>`, numAr(a.people) + ' مشارك')).join('')}</div>` : ''}
      ${(n.items || []).length ? `<div class="card"><h2>🕘 آخر الأحداث</h2>${n.items.slice(0, 6).map(x => `<a class="kv" href="${esc(x.link || '#/notifications')}" style="text-decoration:none;color:inherit"><span>${NTF_ICON[x.kind] || '🔔'} ${esc(x.title)}</span><span class="muted">${dt(String(x.at).slice(0, 10))}</span></a>`).join('')}</div>` : ''}
    </div>`;
}

// ───────── ملخص العضو ─────────
function memberStrip() {
  const s = S.mySum; if (!s) return '';
  const it = (i, v, l, href) => `<a class="kpi" href="${href}"><i>${i}</i><div><b>${v}</b><small>${l}</small></div></a>`;
  return `<div class="kpis">${it('🏅', money(s.ben), 'إجمالي استفاداتك', '#/mybenefits')}${it('🎫', numAr(s.bk), 'حجوزات قائمة', '#/mytrips')}
    ${it('🎁', numAr(s.grt), 'طلبات منح تحت الإجراء', '#/grants')}${it('👨‍👩‍👧', numAr(s.fam), 'أفراد الأسرة', '#/family')}</div>`;
}

// ───────── أنشطتي ─────────
function homeView() {
  const pr = S.me.profile, p = pr.person, c = pr.completeness;
  const elig = pr.eligibleToday;
  const tiles = [
    { i: '📚', b: 'الكتب الخارجية', s: 'احجز كتب ولادك بالتقسيط', href: C.BOOKS_URL },
    { i: '🚌', b: 'الرحلات والفعاليات', s: 'احجز لك ولأسرتك', href: '#/trips', internal: true },
    { i: '🏖️', b: 'المصايف', s: 'قدّم على مصيف الصيف', href: '#/summer', internal: true },
    { i: '🎁', b: 'المنح والمناسبات', s: elig ? 'زواج، مولود، وفاة، تفوق، علاج' : 'لأعضاء النقابة العامة', href: '#/grants', internal: true },
    { i: '📱', b: 'أجهزة بالتقسيط', s: 'عروض بالتقسيط — احجز', href: '#/devices', internal: true },
    { i: '🕋', b: 'العمرة والحج', s: 'عروض الشركات — احجز', href: '#/umrah', internal: true },
    { i: '🌙', b: 'الإفطار والفعاليات', s: 'من الرحلات والفعاليات', href: '#/trips', internal: true },
  ];
  return `<div class="card"><h2>أهلاً ${esc((p.full_name || '').split(' ')[0])} 👋</h2>
      <div class="row"><span class="pill ${elig ? 'ok' : 'warn'}">${elig ? 'عضو النقابة العامة — مستحق الدعم' : esc(p.union_org || 'التنظيم غير محدد')}</span>
      ${p.member_state ? `<span class="pill">${esc(p.member_state)}</span>` : ''}</div></div>
    ${memberStrip()}
    ${c.percent < 100 ? `<a class="card" style="display:block;text-decoration:none;color:inherit" href="#/profile">
      <h2>ملفك مكتمل ${c.percent}%<span class="sp"></span><span class="pill warn">كمّله</span></h2>
      <div class="prog"><div style="width:${c.percent}%"></div></div>
      <div class="muted">ناقص: ${c.missing.map(esc).join('، ')}</div></a>` : ''}
    ${installCard()}
    ${(S.homeNews || []).length ? `<div class="card"><h2>📰 أخبار النقابة<span class="sp"></span><a href="#/news" class="pill" style="text-decoration:none">الكل</a></h2>
      ${S.homeNews.map(n => newsItem(n, false)).join('')}</div>` : ''}
    <a class="card" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit" href="#/mybenefits">
      <span style="font-size:30px">🎁</span><div style="flex:1"><b>استفاداتي من النقابة</b><div class="muted">المنح والبدلات والدعم والتوفير — كل اللي استفدت بيه</div></div><span class="pill ok">عرض</span></a>
    <div class="tiles">${tiles.map(t => t.soon
      ? `<div class="tile soon"><i>${t.i}</i><b>${t.b}</b><small>${esc(t.s)}</small></div>`
      : `<a class="tile" href="${esc(t.href)}" ${t.internal ? '' : 'target="_blank" rel="noopener"'}><i>${t.i}</i><b>${t.b}</b><small>${esc(t.s)}</small></a>`).join('')}</div>`;
}

// ───────── ملفي ─────────
const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><span>${v == null || v === '' ? '<span class="muted">—</span>' : esc(v)}</span></div>`;
function profileBody(pr, admin) {
  const p = pr.person, c = pr.completeness, em = p.emergency || {};
  const reqPending = (pr.requests || []).filter(r => r.status === 'معلّق');
  return `
  <div class="card"><h2>${esc(p.full_name)}<span class="sp"></span>
      <span class="pill ${pr.eligibleToday ? 'ok' : 'warn'}">${pr.eligibleToday ? 'مستحق الدعم' : 'غير مستحق الدعم'}</span></h2>
    <div class="muted">الرقم الوظيفي ${esc(p.job_id || '—')}</div>
    <div class="prog"><div style="width:${c.percent}%"></div></div>
    <div class="row"><b>الملف مكتمل ${c.percent}%</b></div>
    ${c.missing.length ? `<div class="chips" style="margin-top:6px">${c.missing.map(m => `<span class="chip">${esc(m)}</span>`).join('')}</div>` : ''}
  </div>
  <div class="card"><h2>🏢 البيانات الوظيفية والنقابية<span class="sp"></span>
      ${admin ? (can('profile.movement') ? '<button class="btn sm" data-act="movement">+ حركة</button>' : '')
              : '<button class="btn sm sec" data-act="request">طلب تعديل</button>'}
      ${admin && can('profile.edit') ? '<button class="btn sm sec" data-act="editAdmin">تعديل</button>' : ''}</h2>
    ${kv('التنظيم النقابي', p.union_org)}${kv('الحالة', p.member_state)}${kv('جهة العمل', p.workplace)}
    ${kv('الوظيفة', p.job_title)}${kv('الدرجة', p.grade)}${kv('الرقم القومي', p.national_id)}
    ${kv('تاريخ التعيين', p.hire_date)}${kv('الرقم التأميني', p.insurance_no)}
    ${p.monthly_dues != null ? kv('الاستقطاع الشهري', p.monthly_dues + ' ج') : ''}
    ${reqPending.length ? `<div class="alert warn" style="margin-top:10px">طلبات تعديل تحت المراجعة: ${reqPending.map(r => esc(FIELD_LBL[r.field] || r.field) + ' ← ' + esc(r.new_value)).join(' · ')}</div>` : ''}
  </div>
  <div class="card"><h2>📇 بياناتي الشخصية<span class="sp"></span>
      ${(!admin || can('profile.edit')) ? '<button class="btn sm sec" data-act="editSelf">تعديل</button>' : ''}</h2>
    ${kv('الموبايل', p.phone)}${kv('موبايل 2', p.phone2)}${kv('البريد', p.email)}${kv('العنوان', p.address)}
    ${kv('المؤهل', p.qualification)}${kv('التخصص', p.specialization)}${kv('الحالة الاجتماعية', p.marital_status)}
    ${kv('النوع', p.gender)}${kv('تاريخ الميلاد', p.birth_date)}${kv('فصيلة الدم', p.blood_type)}
    ${kv('للطوارئ', em.name ? `${em.name} (${em.relation || ''}) ${em.phone || ''}` : '')}
  </div>
  ${(pr.board || []).length ? `<div class="card"><h2>🏛️ ${admin ? 'عضوية المجلس' : 'عضويتي في المجلس'}</h2>
    <div class="tl">${pr.board.map(b => `<div class="it"><b>${esc(b.role)}</b>
      <div class="muted">${esc(b.term)} · من ${dt(b.from_date)}${b.to_date ? ' إلى ' + dt(b.to_date) : ' — حتى الآن'} · ${esc(b.join_method)}</div></div>`).join('')}</div></div>` : ''}
  <div class="card"><h2>🕓 مسيرتي</h2>${movementsHTML(pr)}</div>`;
}
function movementsHTML(pr) {
  const m = pr.movements || [];
  if (!m.length) return '<div class="empty">لا توجد حركات مسجّلة</div>';
  const per = {}; (pr.periods || []).forEach(x => { per[x.field + '|' + x.from_date] = x.days; });
  return `<div class="tl">${m.map(x => {
    const d = per[x.field + '|' + x.effective_date];
    return `<div class="it"><b>${esc(x.kind)}</b>
      <div>${esc(FIELD_LBL[x.field] || x.field)}: ${x.from_value ? esc(x.from_value) + ' ← ' : ''}<b style="display:inline">${esc(x.to_value)}</b></div>
      <div class="muted">من ${dt(x.effective_date)}${d != null ? ' · ' + durTxt(d) : ''}${x.decision_ref ? ' · قرار ' + esc(x.decision_ref) : ''}</div></div>`;
  }).join('')}</div>`;
}
const durTxt = d => { const y = Math.floor(d / 365), mo = Math.floor((d % 365) / 30);
  return 'مدة ' + ([y ? y + ' سنة' : '', mo ? mo + ' شهر' : ''].filter(Boolean).join(' و') || d + ' يوم'); };

function selfForm(p) {
  const em = p.emergency || {};
  return `<h3>تعديل بياناتي الشخصية</h3><form id="sf">
    <div class="grid2">
      <label class="f"><span>الموبايل (واتساب)</span><input class="input" name="phone" inputmode="tel" value="${esc(p.phone)}" placeholder="01xxxxxxxxx"></label>
      <label class="f"><span>موبايل 2</span><input class="input" name="phone2" inputmode="tel" value="${esc(p.phone2)}"></label></div>
    <label class="f"><span>البريد الإلكتروني</span><input class="input" name="email" type="email" value="${esc(p.email)}"></label>
    <label class="f"><span>العنوان</span><input class="input" name="address" value="${esc(p.address)}"></label>
    <div class="grid2">
      <label class="f"><span>المؤهل</span><select class="input" name="qualification">${options(listOpts('qualification'), p.qualification)}</select></label>
      <label class="f"><span>الحالة الاجتماعية</span><select class="input" name="marital_status">${options(MARITAL, p.marital_status)}</select></label></div>
    <label class="f"><span>التخصص / طبيعة العمل</span><input class="input" name="specialization" value="${esc(p.specialization)}"></label>
    <div class="grid2">
      <label class="f"><span>فصيلة الدم</span><select class="input" name="blood_type">${options(['A+','A-','B+','B-','AB+','AB-','O+','O-'], p.blood_type)}</select></label>
      <label class="f"><span>احتياجات خاصة / أمراض مزمنة</span><input class="input" name="special_needs" value="${esc(p.special_needs)}" placeholder="اختياري — يفيد في الرحلات"></label></div>
    <b>للطوارئ</b>
    <div class="grid2">
      <label class="f"><span>الاسم</span><input class="input" name="em_name" value="${esc(em.name)}"></label>
      <label class="f"><span>صلته</span><input class="input" name="em_relation" value="${esc(em.relation)}"></label></div>
    <label class="f"><span>موبايله</span><input class="input" name="em_phone" inputmode="tel" value="${esc(em.phone)}"></label>
    <div id="ferr"></div>
    <div class="acts"><button class="btn" type="submit">حفظ</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
function bindSelfForm(personId) {
  $('#modal [data-close]').onclick = closeModal;
  $('#sf').onsubmit = async e => {
    e.preventDefault();
    const d = formData(e.target);
    const fields = { phone: d.phone, phone2: d.phone2, email: d.email, address: d.address, qualification: d.qualification,
      marital_status: d.marital_status, specialization: d.specialization, blood_type: d.blood_type, special_needs: d.special_needs,
      emergency: d.em_name || d.em_phone ? { name: d.em_name, relation: d.em_relation, phone: d.em_phone } : null };
    for (const k of ['phone', 'phone2']) if (fields[k] && !/^01\d{9}$/.test(fields[k])) {
      $('#ferr').innerHTML = `<div class="alert bad">${FIELD_LBL[k]} لازم 11 رقم ويبدأ بـ 01</div>`; return; }
    if (fields.emergency === null) delete fields.emergency;
    const r = await busy(e.target.querySelector('[type=submit]'), () => personId
      ? call('SAVE_PERSON', { id: personId, fields }) : call('UPDATE_MY_PROFILE', { fields }));
    if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    closeModal(); toast('اتحفظ ✓');
    if (personId) { S.person = r.profile; } else { S.me.profile = r.profile; }
    render();
  };
}

function requestForm(p) {
  const fields = ['workplace', 'job_title', 'grade', 'union_org', 'member_state', 'full_name', 'national_id', 'insurance_no', 'hire_date'];
  return `<h3>طلب تعديل بيان</h3><p class="muted">البيانات دي بتتعدّل بعد مراجعة المسؤول.</p><form id="rf">
    <label class="f"><span>البيان</span><select class="input" name="field" required>${fields.map(f => `<option value="${f}">${FIELD_LBL[f]}</option>`).join('')}</select></label>
    <label class="f"><span>القيمة الجديدة</span><input class="input" name="newValue" required></label>
    <label class="f"><span>السبب / المستند</span><input class="input" name="reason" placeholder="مثلاً: قرار نقل رقم ..."></label>
    <div id="ferr"></div>
    <div class="acts"><button class="btn" type="submit">إرسال الطلب</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}

// ───────── الأسرة ─────────
function familyView(pr, admin) {
  const f = pr.family || [];
  return `<div class="card"><h2>👨‍👩‍👧 ${admin ? 'الأسرة' : 'أسرتي'}<span class="sp"></span>
      ${(!admin || can('profile.edit')) ? '<button class="btn sm" data-act="addFam">+ إضافة فرد</button>' : ''}</h2>
    <p class="muted">${admin ? '' : 'الأبناء اللي تسجّلهم هنا هيظهروا لك في الكتب وكل الأنشطة — مش هتسجّلهم تاني.'}</p>
    ${f.length ? f.map(m => `<div class="fam"><div class="av">${relIcon(m.relation)}</div>
      <div class="nm"><b>${esc(m.full_name)}</b><span class="muted">${esc(m.relation)}${m.birth_date ? ' · ' + ageOf(m.birth_date) : ''}
        ${m.edu_stage ? ' · ' + esc(m.edu_stage) + (m.edu_grade ? ' ' + esc(m.edu_grade) : '') : ''}${m.school_type ? ' · ' + esc(m.school_type) : ''}</span></div>
      ${(!admin || can('profile.edit')) ? `<button class="btn sm sec" data-act="editFam" data-id="${m.id}">تعديل</button>` : ''}</div>`).join('')
      : '<div class="empty">لسه ما سجّلتش حد من أسرتك</div>'}</div>`;
}
function famForm(m = {}, canDel = true) {
  return `<h3>${m.id ? 'تعديل' : 'إضافة'} فرد من الأسرة</h3><form id="ff">
    <label class="f"><span>الاسم</span><input class="input" name="full_name" value="${esc(m.full_name)}" required></label>
    <div class="grid2">
      <label class="f"><span>صلة القرابة</span><select class="input" name="relation" required>${options(RELATIONS, m.relation)}</select></label>
      <label class="f"><span>النوع</span><select class="input" name="gender">${options(['ذكر', 'أنثى'], m.gender)}</select></label></div>
    <div class="grid2">
      <label class="f"><span>تاريخ الميلاد</span><input class="input" type="date" name="birth_date" value="${esc(m.birth_date)}"></label>
      <label class="f"><span>الرقم القومي (اختياري)</span><input class="input" name="national_id" inputmode="numeric" maxlength="14" value="${esc(m.national_id)}"></label></div>
    <b>الدراسة (للأبناء)</b>
    <div class="grid2">
      <label class="f"><span>المرحلة</span><select class="input" name="edu_stage">${options(listOpts('edu_stage'), m.edu_stage)}</select></label>
      <label class="f"><span>الصف</span><input class="input" name="edu_grade" value="${esc(m.edu_grade)}" placeholder="مثال: 3"></label></div>
    <div class="grid2">
      <label class="f"><span>نوع المدرسة</span><select class="input" name="school_type">${options(listOpts('school_type'), m.school_type)}</select></label>
      <label class="f"><span>الشعبة (ثانوي)</span><input class="input" name="edu_track" value="${esc(m.edu_track)}"></label></div>
    <label class="f row"><input type="checkbox" name="special_needs" ${m.special_needs ? 'checked' : ''}> من ذوي الهمم</label>
    <div id="ferr"></div>
    <div class="acts"><button class="btn" type="submit">حفظ</button>
      ${m.id && canDel ? '<button class="btn bad" type="button" data-act="delFam">حذف</button>' : ''}
      <button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
function bindFamForm(m, personId) {
  $('#modal [data-close]').onclick = closeModal;
  const after = r => { closeModal(); if (personId) S.person = r.profile; else S.me.profile = r.profile; render(); };
  const del = $('#modal [data-act=delFam]');
  if (del) del.onclick = async () => {
    if (!confirm('حذف ' + m.full_name + '؟ (البيانات القديمة بتفضل محفوظة في السجل)')) return;
    const r = await busy(del, () => call('REMOVE_MY_FAMILY_MEMBER', { id: m.id }));
    if (!r.success) return toast(r.message, true); toast('اتشال'); after(r);
  };
  $('#ff').onsubmit = async e => {
    e.preventDefault();
    const d = formData(e.target); if (m.id) d.id = m.id;
    if (d.national_id && !/^[23]\d{13}$/.test(d.national_id)) { $('#ferr').innerHTML = '<div class="alert bad">الرقم القومي 14 رقم</div>'; return; }
    const r = await busy(e.target.querySelector('[type=submit]'), () => personId
      ? call('SAVE_FAMILY_MEMBER', { personId, member: d }) : call('SAVE_MY_FAMILY_MEMBER', { member: d }));
    if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    toast('اتحفظ ✓'); after(r);
  };
}

// ───────── حسابي ─────────
function accountView() {
  return `<div class="card"><h2>⚙️ حسابي</h2>
      ${isStaff() ? `${S.me.mustChange ? '<div class="alert warn">لازم تغيّر كلمة المرور المؤقتة دلوقتي.</div>' : ''}
      <form id="pw"><label class="f"><span>كلمة المرور الحالية</span><input class="input" type="password" name="oldPassword" required></label>
        <label class="f"><span>كلمة المرور الجديدة (8 أحرف على الأقل)</span><input class="input" type="password" name="newPassword" minlength="8" required></label>
        <div id="ferr"></div><button class="btn" type="submit">تغيير كلمة المرور</button></form>`
      : '<p class="muted">بتدخل برقمك الوظيفي وآخر 4 أرقام من قوميك أو موبايلك المسجّل. الجلسة بتفضل محفوظة على موبايلك.</p>'}
      <button class="btn bad block" style="margin-top:14px" data-act="logout">تسجيل الخروج</button></div>`;
}

// ───────── الإدارة ─────────
function adminView() {
  const q = S.q || '';
  return `<div class="card"><h2>👥 الأعضاء</h2>
    <form id="qs" class="row"><input class="input" style="flex:1" name="q" value="${esc(q)}" placeholder="اسم أو رقم وظيفي أو موبايل أو قومي">
      <button class="btn">بحث</button></form></div>
    <div id="res">${grid('mem', [
      { t: 'الاسم', v: x => `<b>${esc(x.full_name)}</b>`, raw: x => x.full_name },
      { t: 'الرقم الوظيفي', v: x => esc(x.job_id || ''), raw: x => x.job_id || '' },
      { t: 'جهة العمل', v: x => esc(x.workplace || '—'), raw: x => x.workplace || '' },
      { t: 'الوظيفة', v: x => esc(x.job_title || '—'), raw: x => x.job_title || '' },
      { t: 'التنظيم', v: x => `<span class="pill ${x.union_org === 'النقابة العامة' ? 'ok' : 'warn'}">${esc(x.union_org || '؟')}</span>`, raw: x => x.union_org || '' },
    ], S.results, { title: '👥 نتائج البحث', file: 'members', attr: x => `data-person="${x.id}"`, empty: 'ابحث عن عضو بالاسم أو الرقم الوظيفي' })}</div>`;
}
function personView() {
  const pr = S.person; if (!pr) return '<div class="empty">...</div>';
  return `<a href="#/admin" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ رجوع</a>
    ${profileBody(pr, true)}${familyView(pr, true)}`;
}
function movementForm(pr) {
  const p = pr.person;
  return `<h3>تسجيل حركة — ${esc(p.full_name)}</h3><form id="mf">
    <label class="f"><span>نوع الحركة</span><select class="input" name="kind" required>${options(listOpts('movement_kind'))}</select></label>
    <label class="f"><span>البُعد اللي بيتغير</span><select class="input" name="field" id="mfField" required>
      ${['workplace', 'job_title', 'grade', 'union_org', 'member_state'].map(f => `<option value="${f}">${FIELD_LBL[f]} (حالياً: ${esc(p[f] || '—')})</option>`).join('')}</select></label>
    <label class="f"><span>القيمة الجديدة</span><span id="mfTo"></span></label>
    <div class="grid2">
      <label class="f"><span>تاريخ السريان</span><input class="input" type="date" name="effectiveDate" required></label>
      <label class="f"><span>تاريخ العودة المتوقع</span><input class="input" type="date" name="expectedReturn"></label></div>
    <div class="grid2">
      <label class="f"><span>رقم القرار</span><input class="input" name="decisionRef"></label>
      <label class="f"><span>تاريخ القرار</span><input class="input" type="date" name="decisionDate"></label></div>
    <label class="f"><span>ملاحظات</span><input class="input" name="notes"></label>
    <div id="ferr"></div>
    <div class="acts"><button class="btn" type="submit">تسجيل</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
function toValueInput(field) {
  const src = { union_org: ORGS, member_state: STATES, grade: listOpts('grade'), workplace: listOpts('workplace'), job_title: listOpts('job_title') }[field] || [];
  return src.length ? `<select class="input" name="toValue" required>${options(src)}</select>`
                    : `<input class="input" name="toValue" required>`;
}
function adminFieldsForm(p) {
  return `<h3>تعديل البيانات الإدارية</h3><p class="muted">الوظيفة وجهة العمل والتنظيم والحالة بتتغير بـ «+ حركة» علشان التاريخ يتسجل.</p><form id="af">
    <label class="f"><span>الاسم</span><input class="input" name="full_name" value="${esc(p.full_name)}" required></label>
    <div class="grid2">
      <label class="f"><span>الرقم الوظيفي</span><input class="input" name="job_id" value="${esc(p.job_id)}"></label>
      <label class="f"><span>الرقم القومي</span><input class="input" name="national_id" maxlength="14" value="${esc(p.national_id)}"></label></div>
    <div class="grid2">
      <label class="f"><span>تاريخ التعيين</span><input class="input" type="date" name="hire_date" value="${esc(p.hire_date)}"></label>
      <label class="f"><span>الرقم التأميني</span><input class="input" name="insurance_no" value="${esc(p.insurance_no)}"></label></div>
    <div class="grid2">
      <label class="f"><span>تاريخ المعاش</span><input class="input" type="date" name="retirement_date" value="${esc(p.retirement_date)}"></label>
      <label class="f"><span>الاستقطاع الشهري</span><input class="input" name="monthly_dues" inputmode="decimal" value="${esc(p.monthly_dues)}"></label></div>
    <label class="f"><span>سبب التعديل (يُسجَّل)</span><input class="input" name="reason" required></label>
    <div id="ferr"></div>
    <div class="acts"><button class="btn" type="submit">حفظ</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
function requestsView() {
  const items = S.requests || [];
  return `<div class="card"><h2>📝 طلبات تعديل البيانات</h2>
    ${items.length ? items.map(r => `<div class="card" style="box-shadow:none;border:1px solid var(--line)">
      <b>${esc(r.full_name)}</b> <span class="muted">(${esc(r.job_id || '')})</span>
      <div>${esc(FIELD_LBL[r.field] || r.field)}: <span class="muted">${esc(r.old_value || '—')}</span> ← <b>${esc(r.new_value)}</b></div>
      ${r.reason ? `<div class="muted">السبب: ${esc(r.reason)}</div>` : ''}
      <div class="row" style="margin-top:8px"><button class="btn sm" data-act="approve" data-id="${r.id}">اعتماد</button>
        <button class="btn sm bad" data-act="reject" data-id="${r.id}">رفض</button></div></div>`).join('')
      : '<div class="empty">مفيش طلبات معلّقة 👌</div>'}</div>`;
}
function listsView() {
  const keys = { workplace: 'جهات العمل', job_title: 'الوظائف', grade: 'الدرجات', qualification: 'المؤهلات',
    edu_stage: 'المراحل الدراسية', school_type: 'أنواع المدارس', movement_kind: 'أنواع الحركات' };
  const k = S.listKey || 'workplace';
  return `<div class="card"><h2>🗂️ القوائم</h2>
    <select class="input" id="lk">${Object.entries(keys).map(([a, b]) => `<option value="${a}" ${a === k ? 'selected' : ''}>${b}</option>`).join('')}</select>
    <form id="la" class="row" style="margin-top:10px"><input class="input" style="flex:1" name="value" placeholder="قيمة جديدة" required><button class="btn">إضافة</button></form>
    <div class="list" style="margin-top:10px">${(S.lists[k] || []).map(x => `<div class="li"><div class="nm">${esc(x.value)}</div>
      <button class="btn sm bad" data-act="hideItem" data-v="${esc(x.value)}">إخفاء</button></div>`).join('') || '<div class="empty">القائمة فاضية</div>'}</div></div>`;
}

// ───────── المجلس (الحوكمة) ─────────
const ROLES = ['رئيس المجلس', 'نائب الرئيس', 'الأمين العام', 'أمين الصندوق', 'عضو مجلس إدارة'];
const DEC_CATS = ['صرف', 'دعم نشاط', 'منحة', 'إعفاء', 'تكليف', 'موازنة', 'لائحة', 'إداري', 'أخرى'];
const govTabs = act => `<div class="tabs" style="margin-bottom:12px">${[['#/board', 'الدورة والمقاعد'], ['#/meetings', 'الاجتماعات'], ['#/decisions', 'القرارات']]
  .map(([h, t]) => `<button data-go="${h}" class="${act === h ? 'on' : ''}">${t}</button>`).join('')}</div>`;
function boardView() {
  const g = S.gov, t = g && g.term;
  if (!t) return govTabs('#/board') + `<div class="card empty">لا توجد دورة جارية${g && g.canManage ? '<br><button class="btn" style="margin-top:10px" data-act="termEdit">+ دورة جديدة</button>' : ''}</div>`;
  const cur = t.seats.filter(s => !s.to_date), old = t.seats.filter(s => s.to_date);
  const seat = s => `<div class="fam"><div class="av">${s.role === 'رئيس المجلس' ? '⭐' : s.role === 'أمين الصندوق' ? '💰' : s.role === 'الأمين العام' ? '📜' : '👤'}</div>
    <div class="nm"><b>${esc(s.full_name)}</b><span class="muted">${esc(s.role)} · من ${dt(s.from_date)}${s.to_date ? ' إلى ' + dt(s.to_date) : ''}
      · ${esc(s.join_method)}${s.workplace ? ' · ' + esc(s.workplace) : ''}${s.end_reason ? ' · ' + esc(s.end_reason) : ''}</span></div>
    ${g.canManage && !s.to_date ? `<button class="btn sm sec" data-act="seatEnd" data-id="${s.id}">إنهاء/تغيير</button>` : ''}</div>`;
  return govTabs('#/board') + `<div class="card"><h2>🏛️ ${esc(t.title)}<span class="sp"></span>
      ${g.canManage ? '<button class="btn sm sec" data-act="termEdit">تعديل</button>' : ''}</h2>
    ${kv('المدة', `${t.start_date} ← ${t.end_date || '—'}`)}${kv('قرار الاعتماد', t.approval_ref)}${kv('المقاعد المستهدفة', t.target_seats)}
    ${t.opening_balance != null ? kv('الرصيد الافتتاحي', Number(t.opening_balance).toLocaleString('ar-EG') + ' ج') : ''}
    <div class="row" style="margin-top:8px"><span class="pill ok">${cur.length} عضواً حالياً</span>
      <span class="pill">${t.stats.meetings} اجتماعاً</span><span class="pill">${t.stats.decisions} قراراً</span></div></div>
  <div class="card"><h2>👥 المجلس الحالي<span class="sp"></span>${g.canManage ? '<button class="btn sm" data-act="seatAdd">+ مقعد</button>' : ''}</h2>
    ${cur.map(seat).join('') || '<div class="empty">لا مقاعد</div>'}</div>
  ${old.length ? `<div class="card"><h2>📁 مقاعد منتهية</h2>${old.map(seat).join('')}</div>` : ''}
  ${t.candidates.length ? `<div class="card"><h2>🗳️ نتيجة الانتخابات</h2>${t.candidates.map(c => `<div class="kv">
    <span>${esc(c.full_name)} <small class="muted">(${esc(c.position)})</small></span>
    <span>${c.votes ?? '—'} صوت · <span class="pill ${c.result === 'فائز أصلي' ? 'ok' : c.result === 'احتياطي' ? 'warn' : ''}">${esc(c.result || '')}</span></span></div>`).join('')}</div>` : ''}`;
}
function meetingsView() {
  const items = S.meetings || [], g = S.gov || {};
  return govTabs('#/meetings') + `<div class="card"><h2>📅 الاجتماعات<span class="sp"></span>${g.canManage ? '<button class="btn sm" data-act="meetNew">+ اجتماع</button>' : ''}</h2>
    <div class="list">${items.map(m => {
      const q = m.seats ? m.present >= Math.floor(m.seats / 2) + 1 : false;
      return `<div class="li" data-meet="${m.id}"><div class="nm"><b>${esc(m.title)}</b>
        <span class="muted">${dt(m.meeting_date)} · ${esc(m.kind)} · ${m.decisions_count} قرار</span></div>
        <span class="pill ${m.present ? (q ? 'ok' : 'bad') : ''}">${m.present ? `${m.present}/${m.seats} ${q ? 'نصاب' : 'بلا نصاب'}` : 'حضور غير مسجّل'}</span></div>`;
    }).join('') || '<div class="empty">لا اجتماعات</div>'}</div></div>`;
}
function meetingView() {
  const m = S.meeting, g = S.gov || {}; if (!m) return '';
  const q = m.seats ? m.present >= Math.floor(m.seats / 2) + 1 : false;
  return `<a href="#/meetings" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ الاجتماعات</a>
  <div class="card"><h2>${esc(m.title)}<span class="sp"></span>${g.canManage ? '<button class="btn sm sec" data-act="meetEdit">تعديل</button>' : ''}</h2>
    ${kv('التاريخ', m.meeting_date + (m.meeting_time ? ' · ' + m.meeting_time : ''))}${kv('النوع', m.kind)}${kv('المكان', m.venue)}
    ${kv('النصاب', m.present ? `${m.present} من ${m.seats} — ${q ? 'مكتمل' : 'غير مكتمل'}` : 'الحضور غير مسجّل')}
    ${(m.agenda || []).length ? `<b>جدول الأعمال</b><ol style="margin:6px 0">${m.agenda.map(a => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}</div>
  <div class="card"><h2>✅ القرارات (${m.decisions.length})</h2>${m.decisions.map(d => `<div class="kv" style="display:block">
      <b>${esc(d.decision_no)}</b> — ${esc(d.text)}
      <div class="row" style="margin-top:4px"><span class="pill">${esc(d.category)}</span>
        ${d.amount != null ? `<span class="pill warn">${Number(d.amount).toLocaleString('ar-EG')} ج</span>` : ''}
        <span class="pill ${d.status === 'معتمد' ? 'ok' : 'bad'}">${esc(d.status)}</span>
        ${d.votes_for != null ? `<span class="muted">موافق ${d.votes_for} · معترض ${d.votes_against ?? 0} · ممتنع ${d.votes_abstain ?? 0}</span>` : ''}</div></div>`).join('') || '<div class="empty">لا قرارات</div>'}</div>
  <div class="card"><h2>🧾 الحضور</h2>${m.attendance.map(a => `<div class="kv"><span>${esc(a.full_name)} <small class="muted">${esc(a.role || '')}</small></span>
      <span class="pill ${a.status === 'حاضر' ? 'ok' : a.status === 'غائب' ? 'bad' : 'warn'}">${esc(a.status)}</span></div>`).join('') || '<div class="empty">الحضور غير مسجّل</div>'}</div>`;
}
function decisionsView() {
  const items = S.decisions || [], f = S.decF || {};
  return govTabs('#/decisions') + `<div class="card"><h2>📚 سجل القرارات</h2>
    <form id="df" class="row"><input class="input" style="flex:2;min-width:140px" name="q" value="${esc(f.q || '')}" placeholder="بحث في النص أو رقم القرار">
      <select class="input" style="flex:1;min-width:110px" name="category"><option value="">كل الفئات</option>${options(DEC_CATS, f.category, false)}</select>
      <button class="btn">بحث</button></form></div>
  <div class="card list">${items.map(d => `<div class="li" data-meet="${d.meeting_id}"><div class="nm"><b>${esc(d.decision_no)} — ${esc(d.text)}</b>
      <span class="muted">${esc(d.meeting_title)} · ${dt(d.meeting_date)}</span></div>
      <span class="pill">${esc(d.category)}</span></div>`).join('') || '<div class="empty">لا نتائج</div>'}</div>`;
}
function termForm(t = {}) {
  return `<h3>${t.id ? 'تعديل الدورة' : 'دورة جديدة'}</h3><form id="tf">
    <label class="f"><span>اسم الدورة</span><input class="input" name="title" value="${esc(t.title)}" required></label>
    <div class="grid2"><label class="f"><span>رقم الدورة</span><input class="input" name="term_no" inputmode="numeric" value="${esc(t.term_no)}"></label>
      <label class="f"><span>تاريخ الانتخاب</span><input class="input" type="date" name="election_date" value="${esc(t.election_date)}"></label></div>
    <div class="grid2"><label class="f"><span>البداية</span><input class="input" type="date" name="start_date" value="${esc(t.start_date)}" required></label>
      <label class="f"><span>النهاية</span><input class="input" type="date" name="end_date" value="${esc(t.end_date)}"></label></div>
    <div class="grid2"><label class="f"><span>قرار الاعتماد</span><input class="input" name="approval_ref" value="${esc(t.approval_ref)}"></label>
      <label class="f"><span>تاريخ الاعتماد</span><input class="input" type="date" name="approval_date" value="${esc(t.approval_date)}"></label></div>
    <div class="grid2"><label class="f"><span>المقاعد المستهدفة</span><input class="input" name="target_seats" inputmode="numeric" value="${esc(t.target_seats)}"></label>
      <label class="f"><span>الرصيد الافتتاحي</span><input class="input" name="opening_balance" inputmode="decimal" value="${esc(t.opening_balance)}"></label></div>
    <label class="f"><span>الحالة</span><select class="input" name="status">${options(['مخططة', 'جارية', 'منتهية'], t.status || 'جارية', false)}</select></label>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">حفظ</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
function seatAddForm() {
  return `<h3>إضافة مقعد</h3><form id="saf">
    <label class="f"><span>الرقم الوظيفي للعضو</span><input class="input" name="jobId" inputmode="numeric" required></label>
    <label class="f"><span>المنصب</span><select class="input" name="role">${options(ROLES, 'عضو مجلس إدارة', false)}</select></label>
    <div class="grid2"><label class="f"><span>من تاريخ</span><input class="input" type="date" name="fromDate" required></label>
      <label class="f"><span>طريقة الشغل</span><select class="input" name="joinMethod">${options(['انتخاب', 'تصعيد', 'تعيين', 'توزيع مناصب'], 'انتخاب', false)}</select></label></div>
    <label class="f"><span>رقم القرار</span><input class="input" name="decisionRef"></label>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">إضافة</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
function seatEndForm(s) {
  return `<h3>${esc(s.full_name)} — ${esc(s.role)}</h3><form id="sef">
    <div class="grid2"><label class="f"><span>تاريخ الانتهاء</span><input class="input" type="date" name="toDate" required></label>
      <label class="f"><span>رقم القرار</span><input class="input" name="decisionRef"></label></div>
    <label class="f"><span>السبب</span><select class="input" name="reason" required>${options(['إعادة توزيع المناصب', 'استقالة من المجلس', 'معاش', 'وفاة', 'إسقاط عضوية', 'انتهاء الدورة', 'أخرى'])}</select></label>
    <label class="f"><span>يكمل بمنصب جديد؟ (اختياري — يبدأ من اليوم التالي)</span><select class="input" name="newRole">${options(ROLES)}</select></label>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">تأكيد</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
const decRow = (d, i) => `<div class="card" style="box-shadow:none;border:1px solid var(--line);padding:10px" data-dec>
      <label class="f"><span>القرار ${i + 1}</span><textarea class="input" name="d_text" rows="2">${esc(d.text)}</textarea></label>
      <div class="grid2"><label class="f"><span>الفئة</span><select class="input" name="d_category">${options(DEC_CATS, d.category || 'إداري', false)}</select></label>
        <label class="f"><span>المبلغ (إن وُجد)</span><input class="input" name="d_amount" inputmode="decimal" value="${esc(d.amount)}"></label></div>
      <div class="grid2"><label class="f"><span>موافق / معترض / ممتنع</span><div class="row">
        <input class="input" style="flex:1" name="d_for" inputmode="numeric" value="${esc(d.votes_for)}">
        <input class="input" style="flex:1" name="d_against" inputmode="numeric" value="${esc(d.votes_against)}">
        <input class="input" style="flex:1" name="d_abstain" inputmode="numeric" value="${esc(d.votes_abstain)}"></div></label>
        <label class="f"><span>الحالة</span><select class="input" name="d_status">${options(['معتمد', 'مرفوض', 'مؤجل', 'ملغى'], d.status || 'معتمد', false)}</select></label></div></div>`;
function meetingForm(m) {
  const board = (m && m.board) || (S.gov ? S.gov.term.seats.filter(s => !s.to_date) : []);
  const att = {}; ((m && m.attendance) || []).forEach(a => (att[a.person_id] = a.status));
  const decs = (m && m.decisions && m.decisions.length) ? m.decisions : [{}];
  return `<h3>${m && m.id ? 'تعديل الاجتماع' : 'اجتماع جديد'}</h3><form id="mtf">
    <label class="f"><span>العنوان</span><input class="input" name="title" value="${esc(m && m.title)}" required placeholder="اجتماع رقم ..."></label>
    <div class="grid2"><label class="f"><span>التاريخ</span><input class="input" type="date" name="meeting_date" value="${esc(m && m.meeting_date)}" required></label>
      <label class="f"><span>النوع</span><select class="input" name="kind">${options(['عادي', 'طارئ', 'سنوي', 'جمعية عمومية'], (m && m.kind) || 'عادي', false)}</select></label></div>
    <div class="grid2"><label class="f"><span>الوقت</span><input class="input" name="meeting_time" value="${esc(m && m.meeting_time)}"></label>
      <label class="f"><span>المكان</span><input class="input" name="venue" value="${esc(m && m.venue)}"></label></div>
    <label class="f"><span>جدول الأعمال (بند في كل سطر)</span><textarea class="input" name="agenda" rows="3">${esc(((m && m.agenda) || []).join('\n'))}</textarea></label>
    <b>الحضور</b>${board.map(b => `<div class="kv"><span>${esc(b.full_name)} <small class="muted">${esc(b.role)}</small></span>
      <select class="input" style="width:auto" data-att="${b.person_id}">${options(['حاضر', 'غائب بعذر', 'غائب'], att[b.person_id] || 'حاضر', false)}</select></div>`).join('')}
    <b style="display:block;margin-top:10px">القرارات</b><div id="decs">${decs.map(decRow).join('')}</div>
    <button class="btn sm sec" type="button" data-act="decAdd">+ قرار</button>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">حفظ</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
// ───────── الأنشطة والرحلات ─────────
const BK_PILL = { 'مؤكد': 'ok', 'بانتظار السداد': 'warn', 'قائمة انتظار': 'warn', 'ملغى': 'bad', 'منتهٍ': '' };
const bkPill = s => `<span class="pill ${BK_PILL[s] ?? ''}">${esc(s)}</span>`;
function tripsView() {
  const items = S.acts || [];
  return `${can('activities.manage') ? '<div class="card row"><button class="btn" data-act="actNew">+ نشاط جديد</button><a class="btn sec" href="#/mytrips" style="text-decoration:none">حجوزاتي</a></div>'
          : '<div class="card"><a class="btn sec" href="#/mytrips" style="text-decoration:none;display:inline-block">🎫 حجوزاتي</a></div>'}
  ${items.map(a => `<div class="card" data-trip="${a.id}" style="cursor:pointer"><h2>🚌 ${esc(a.title)}<span class="sp"></span>${a.myStatus ? bkPill(a.myStatus) : `<span class="pill ${a.status === 'الحجز مفتوح' ? 'ok' : ''}">${esc(a.status)}</span>`}</h2>
    <div class="muted">${dt(a.start_date)}${a.location ? ' · ' + esc(a.location) : ''} · ${esc(a.kind)}</div>
    <div class="row" style="margin-top:6px">${a.memberPrice != null ? `<span class="pill ok">للعضو من ${money(a.memberPrice)} ج</span>` : ''}
      <span class="pill">${a.seatsLeft} مقعد متاح من ${a.capacity}</span></div></div>`).join('') || '<div class="card empty">لا توجد أنشطة معلنة حالياً</div>'}`;
}
function tripView() {
  const a = S.trip; if (!a) return '';
  const mb = a.myBooking, fam = (S.me.profile && S.me.profile.family) || [];
  const prices = (a.prices || []).map(p => kvh(`${esc(p.label)} <small class="muted">(${esc(p.applies_to)}${p.max_age != null ? ' حتى ' + p.max_age + ' سنة' : ''}${p.takes_seat ? '' : ' · بدون كرسي'})</small>`,
    p.applies_to !== 'المرافق' && a.eligible !== false && +p.member_price < +p.full_price ? `${money(p.member_price)} <s class="muted">${money(p.full_price)}</s>` : money(p.full_price))).join('');
  const pol = (mb ? mb.cancelPolicy : a.cancel_policy) || [];
  return `<a href="#/trips" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ الأنشطة</a>
  <div class="card"><h2>🚌 ${esc(a.title)}<span class="sp"></span><span class="pill">${esc(a.status)}</span></h2>
    ${kvh('الموعد', dt(a.start_date))}${a.location ? kvh('المكان', esc(a.location)) : ''}${kvh('المقاعد المتاحة', `${a.seatsLeft} من ${a.capacity}`)}
    ${a.decision ? kvh('القرار', esc(a.decision.decision_no)) : ''}${a.description ? `<p>${esc(a.description)}</p>` : ''}
    ${a.eligible === false ? '<div class="alert warn">بتشارك بالسعر الكامل — الدعم لأعضاء النقابة العامة النشطين.</div>' : ''}</div>
  ${(a.program || []).length ? `<div class="card"><h2>🗓️ البرنامج</h2><div class="tl">${a.program.map(x => `<div class="it"><b>${esc(x.time || '')}</b>${esc(x.text || x)}</div>`).join('')}</div></div>` : ''}
  <div class="card"><h2>💵 الأسعار للفرد</h2>${prices}<div class="muted" style="margin-top:6px">حد المرافقين: ${a.max_companions} · مهلة السداد بعد الحجز: ${a.hold_hours} ساعة</div></div>
  <div class="card"><h2>↩️ الإلغاء والاسترداد</h2>${pol.map(x => kvh(+x.days_before ? `قبل الموعد بـ ${x.days_before} أيام أو أكثر` : 'أقل من ذلك', x.refund_pct + '%')).join('')}
    <div class="muted">لو النشاط اتلغى من النقابة: استرداد كامل.</div></div>
  ${mb ? myBookingCard(mb, a) : a.status === 'الحجز مفتوح' && can('activities.book.self') ? `<div class="card"><h2>🎫 احجز</h2><form id="bkf">
      <div class="muted">أنت محجوز تلقائياً. اختار مين جاي معاك:</div>
      ${fam.map(f => `<label class="f row"><input type="checkbox" name="fam" value="${f.id}"> ${esc(f.full_name)} <small class="muted">(${esc(f.relation)}${f.birth_date ? ' · ' + ageOf(f.birth_date) : ''})</small></label>`).join('')
        || '<div class="muted">سجّل أسرتك في «أسرتي» علشان تختارهم هنا.</div>'}
      <b style="display:block;margin-top:8px">مرافقين من خارج الأسرة</b><div id="comps"></div>
      ${a.max_companions ? '<button class="btn sm sec" type="button" data-act="compAdd">+ مرافق</button>' : ''}
      <div id="ferr"></div><button class="btn block" style="margin-top:12px" type="submit">تأكيد الحجز</button></form></div>` : ''}
  ${a.whatsapp_link && mb ? `<a class="card" style="display:block;text-decoration:none" href="${esc(a.whatsapp_link)}" target="_blank" rel="noopener">💬 جروب الرحلة على واتساب</a>` : ''}
  ${can('activities.manage') ? `<a class="btn" style="display:block;text-align:center;text-decoration:none" href="#/actadmin/${a.id}">⚙️ إدارة النشاط</a>` : ''}`;
}
function myBookingCard(b, a) {
  return `<div class="card"><h2>🎫 حجزي ${esc(b.booking_no)}<span class="sp"></span>${bkPill(b.status)}</h2>
    ${b.status === 'قائمة انتظار' ? `<div class="alert warn">أنت رقم ${b.waitlistNo} في قائمة الانتظار — هيتأكد لك تلقائياً لو فضي مكان.</div>` : ''}
    ${b.status === 'بانتظار السداد' && b.hold_until ? `<div class="alert warn">ادفع قبل ${dt(String(b.hold_until).slice(0, 16).replace('T', ' '))} وإلا الحجز يسقط ويروح للمنتظرين.</div>` : ''}
    ${b.people.map(p => kvh(`${esc(p.full_name)} <small class="muted">(${esc(p.relation)}${p.seat_no ? ' · كرسي ' + p.seat_no : ''})</small>`, money(p.price))).join('')}
    ${kvh('<b>الإجمالي</b>', `<b>${money(b.total)}</b>`)}${+b.subsidy ? kvh('دعم النقابة', money(b.subsidy)) : ''}${kvh('المدفوع', money(b.paid))}
    ${['مؤكد', 'بانتظار السداد', 'قائمة انتظار'].includes(b.status) ? `<div class="muted" style="margin-top:6px">لو ألغيت دلوقتي: تسترد ${b.refundPctNow}% من المدفوع.</div>
      <button class="btn bad block" style="margin-top:8px" data-act="myCancel" data-id="${b.id}">إلغاء الحجز</button>` : ''}</div>`;
}
function myTripsView() {
  return `<a href="#/trips" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ الأنشطة</a>` +
    ((S.myBk || []).map(b => `<div class="card" data-trip="${b.activity.id}" style="cursor:pointer"><h2>${esc(b.activity.title)}<span class="sp"></span>${bkPill(b.status)}</h2>
      <div class="muted">${dt(b.activity.start_date)} · ${b.people.length} فرد · ${money(b.total)} ج${+b.paid ? ' · مدفوع ' + money(b.paid) : ''}</div></div>`).join('')
     || '<div class="card empty">لا توجد حجوزات</div>');
}
function actAdminView() {
  const a = S.trip, s = S.actSum || {}, items = S.actBk || []; if (!a) return '';
  const next = { 'مسودة': ['الحجز مفتوح'], 'الحجز مفتوح': ['الحجز مقفول'], 'الحجز مقفول': ['الحجز مفتوح'] }[a.status] || [];
  return `<a href="#/trip/${a.id}" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ صفحة النشاط</a>
  <div class="card"><h2>⚙️ ${esc(a.title)} <small class="muted">${esc(a.code)}</small><span class="sp"></span><span class="pill">${esc(a.status)}</span></h2>
    <div class="tiles" style="grid-template-columns:repeat(3,1fr)">
      <div class="tile"><b>${s.used}/${s.seats}</b><small>مقاعد</small></div><div class="tile"><b>${s.confirmed}</b><small>مؤكد</small></div>
      <div class="tile"><b>${s.pending}+${s.waitlist}</b><small>سداد/انتظار</small></div>
      <div class="tile"><b>${money(s.collected)}</b><small>محصّل</small></div><div class="tile"><b>${money(s.subsidy)}</b><small>دعم</small></div>
      <div class="tile"><b>${money(s.expenses)}</b><small>مصروفات</small></div></div>
    <div class="row" style="margin-top:10px">${next.map(x => `<button class="btn sm" data-act="actStatus" data-s="${x}">${x === 'الحجز مفتوح' ? 'فتح الحجز' : 'قفل الحجز'}</button>`).join('')}
      <button class="btn sm sec" data-act="actEdit">تعديل</button><button class="btn sm sec" data-act="actSeats">توزيع الكراسي</button>
      <button class="btn sm sec" data-act="actSup">+ مشرف</button>
      ${['الحجز مفتوح', 'الحجز مقفول'].includes(a.status) ? '<button class="btn sm gold" data-act="actClose">إقفال بعد الرحلة</button>' : ''}
      ${!['انتهى', 'مغلق', 'ملغى'].includes(a.status) ? '<button class="btn sm bad" data-act="actCancelAll">إلغاء النشاط</button>' : ''}</div></div>
  ${(a.supervisors || []).length ? `<div class="card"><h2>🧑‍✈️ المشرفون</h2>${a.supervisors.map(x => kvh(esc(x.full_name) + ' <small class="muted">' + esc(x.task) + '</small>', 'إعفاء ' + x.self_exempt_pct + '%')).join('')}</div>` : ''}
  <div class="card"><h2>🎫 الحجوزات (${items.length})</h2>${items.map(b => `<div class="kv" style="display:block">
      <div class="row"><b style="flex:1">${esc(b.person.full_name)} <small class="muted">${esc(b.person.job_id || '')} · ${esc(b.booking_no)}</small></b>${bkPill(b.status)}</div>
      <div class="muted">${b.people.map(p => esc(p.full_name) + (p.seat_no ? ' [' + p.seat_no + ']' : '')).join('، ')}</div>
      <div class="row" style="margin-top:4px"><span>المطلوب ${money(b.total)} · مدفوع ${money(b.paid)}${+b.refunded ? ' · مردود ' + money(b.refunded) : ''}${b.eligible ? '' : ' · <span class="pill warn">سعر كامل</span>'}</span><span class="sp" style="flex:1"></span>
        ${['بانتظار السداد', 'مؤكد'].includes(b.status) && +b.paid < +b.total && can('treasury.receipt') ? `<button class="btn sm" data-act="bkPay" data-id="${b.id}" data-rest="${(+b.total - +b.paid).toFixed(2)}">تحصيل</button>` : ''}
        ${['بانتظار السداد', 'مؤكد', 'قائمة انتظار'].includes(b.status) ? `<button class="btn sm bad" data-act="bkCancel" data-id="${b.id}">إلغاء</button>` : ''}</div></div>`).join('') || '<div class="empty">لا حجوزات بعد</div>'}</div>`;
}
function activityForm(a) {
  a = a || {};
  const decs = (S.decOpts || []).map(d => `<option value="${d.id}" ${d.id === a.decision_id ? 'selected' : ''}>${esc(d.decision_no)} — ${esc(d.text.slice(0, 50))}</option>`).join('');
  const pr = (a.prices && a.prices.length) ? a.prices : [{ label: 'العضو', applies_to: 'العضو' }, { label: 'فرد من الأسرة', applies_to: 'الأسرة' },
    { label: 'طفل حتى 6 سنين', applies_to: 'الأسرة', max_age: 6, takes_seat: false }, { label: 'مرافق', applies_to: 'المرافق' }];
  const pol = (a.cancel_policy || [{ days_before: 7, refund_pct: 100 }, { days_before: 3, refund_pct: 50 }, { days_before: 0, refund_pct: 0 }]);
  return `<h3>${a.id ? 'تعديل النشاط' : 'نشاط جديد'}</h3><form id="acf">
    <label class="f"><span>العنوان</span><input class="input" name="title" value="${esc(a.title)}" required></label>
    <div class="grid2"><label class="f"><span>النوع</span><select class="input" name="kind">${options(['رحلة يوم واحد', 'رحلة بإقامة', 'مصيف', 'إفطار', 'فعالية', 'عمرة/حج'], a.kind || 'رحلة يوم واحد', false)}</select></label>
      <label class="f"><span>الموعد</span><input class="input" type="date" name="start_date" value="${esc(a.start_date)}" required></label></div>
    <label class="f"><span>المكان</span><input class="input" name="location" value="${esc(a.location)}"></label>
    <div class="grid2"><label class="f"><span>عدد المقاعد</span><input class="input" name="capacity" inputmode="numeric" value="${esc(a.capacity || 50)}" required></label>
      <label class="f"><span>حد المرافقين للعضو</span><input class="input" name="max_companions" inputmode="numeric" value="${esc(a.max_companions ?? 4)}"></label></div>
    <div class="grid2"><label class="f"><span>مهلة السداد (ساعة)</span><input class="input" name="hold_hours" inputmode="numeric" value="${esc(a.hold_hours || 48)}"></label>
      <label class="f"><span>رابط جروب واتساب</span><input class="input" name="whatsapp_link" value="${esc(a.whatsapp_link)}"></label></div>
    <label class="f"><span>قرار المجلس</span><select class="input" name="decision_id"><option value="">— اختر —</option>${decs}</select></label>
    <label class="f"><span>الوصف</span><textarea class="input" name="description" rows="2">${esc(a.description)}</textarea></label>
    <label class="f"><span>البرنامج (سطر لكل بند: الوقت - النشاط)</span><textarea class="input" name="program" rows="3">${esc((a.program || []).map(x => (x.time ? x.time + ' - ' : '') + (x.text || '')).join('\n'))}</textarea></label>
    <b>الأسعار للفرد (السعر الكامل / سعر المستحق للدعم)</b>
    ${pr.map((p, i) => `<div class="row" data-pr style="margin:4px 0"><input class="input" style="flex:2" name="label" value="${esc(p.label)}">
      <select class="input" style="flex:1" name="applies_to">${options(['العضو', 'الأسرة', 'المرافق'], p.applies_to, false)}</select>
      <input class="input" style="flex:1" name="max_age" placeholder="حتى سن" value="${esc(p.max_age ?? '')}">
      <input class="input" style="flex:1" name="full_price" placeholder="كامل" inputmode="decimal" value="${esc(p.full_price ?? '')}">
      <input class="input" style="flex:1" name="member_price" placeholder="للمستحق" inputmode="decimal" value="${esc(p.member_price ?? '')}">
      <label style="flex:1;font-size:12px"><input type="checkbox" name="takes_seat" ${p.takes_seat === false ? '' : 'checked'}> كرسي</label></div>`).join('')}
    <b style="display:block;margin-top:8px">الاسترداد عند الإلغاء</b>
    ${pol.map(x => `<div class="row" data-pol style="margin:4px 0"><span>قبل</span><input class="input" style="width:70px" name="days" value="${x.days_before}"><span>يوم ⇐ استرداد</span>
      <input class="input" style="width:70px" name="pct" value="${x.refund_pct}"><span>%</span></div>`).join('')}
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">حفظ</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}

// ───────── المصايف ─────────
const SUM_ST = { 'مؤكد': 'ok', 'منتهٍ': 'ok', 'بانتظار السداد': 'warn', 'احتياطي': 'warn', 'مقدَّم': '', 'معتذر': 'bad', 'ملغى': 'bad', 'لم يُقبل': 'bad' };
const sumPill = st => `<span class="pill ${SUM_ST[st] || ''}">${esc(st)}</span>`;
const back = (h, t) => `<a href="${h}" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ ${t}</a>`;
function summerListView() {
  return `${can('summer.manage') ? '<div class="card row"><button class="btn" data-act="sumNew">+ موسم جديد</button></div>' : ''}
  <div class="card list">${(S.seasons || []).map(s => `<div class="li" data-season="${s.id}" style="cursor:pointer"><div class="nm"><b>🏖️ ${esc(s.title)}</b>
      <span class="muted">${s.start ? 'من ' + dt(s.start) + ' · ' : ''}التوزيع: ${esc(s.method)}${s.apply_close ? ' · آخر تقديم ' + dt(String(s.apply_close).slice(0, 10)) : ''}</span></div>
      <div style="text-align:left"><span class="pill">${esc(s.status)}</span>${s.myStatus ? '<br>' + sumPill(s.myStatus) : ''}</div></div>`).join('') || '<div class="empty">لا توجد مواسم حالياً</div>'}</div>`;
}
const unitLbl = u => u ? `${esc(u.resort)} — ${esc(u.unit_type)} ${esc(u.code)} (${u.beds} سراير)` : '';
function sumAppCard(ap, mine) {
  const pend = ap.status === 'بانتظار السداد';
  return `<div class="card"><h2>📝 طلب ${esc(ap.app_no)}<span class="sp"></span>${sumPill(ap.status)}</h2>
    ${ap.status === 'مقدَّم' ? '<div class="alert">طلبك اتسجل — النتيجة بعد غلق التقديم والتوزيع.</div>' : ''}
    ${ap.status === 'احتياطي' ? `<div class="alert warn">أنت رقم ${ap.reserve_rank} في الاحتياطي — لو حد اعتذر هتتصعّد تلقائياً.</div>` : ''}
    ${pend && ap.hold_until ? `<div class="alert warn">اتقبلت! ادفع قبل ${dt(String(ap.hold_until).slice(0, 16).replace('T', ' '))} وإلا يسقط ويروح للاحتياطي.</div>` : ''}
    ${ap.unit ? kvh('الوحدة', unitLbl(ap.unit)) : ''}${ap.batch ? kvh('الفوج', `${esc(ap.batch.name)} <small class="muted">${dt(ap.batch.start_date)} ← ${dt(ap.batch.end_date)}</small>`) : ''}
    ${kvh('الأفراد', ap.family_size + ' <small class="muted">' + (ap.people || []).map(p => esc(p.full_name)).join('، ') + '</small>')}
    ${+ap.total ? kvh('<b>المطلوب</b>', `<b>${money(ap.total)}</b>`) + (+ap.subsidy ? kvh('دعم النقابة', money(ap.subsidy)) : '') + kvh('المدفوع', money(ap.paid)) : ''}
    ${ap.unit && +ap.unit.deposit ? kvh('تأمين يُدفع عند الاستلام ويُرد', money(ap.unit.deposit)) : ''}
    ${(ap.swaps || []).map(w => `<div class="alert">${w.mine ? 'طلبت' : 'طلب منك'} ${esc(w.kind)}${w.other_app ? ' مع ' + esc(w.other_app) : ''} — ${esc(w.status)}
      ${!w.mine && w.status === 'مطلوب' && mine ? `<div class="row" style="margin-top:6px"><button class="btn sm" data-act="swAccept" data-id="${w.id}" data-v="1">موافق</button><button class="btn sm bad" data-act="swAccept" data-id="${w.id}" data-v="0">رفض</button></div>` : ''}</div>`).join('')}
    ${mine ? `<div class="row" style="margin-top:8px">
      ${ap.status === 'مقدَّم' ? `<button class="btn sm bad" data-act="sumWithdraw" data-id="${ap.id}">سحب الطلب</button>` : ''}
      ${['بانتظار السداد', 'مؤكد', 'احتياطي'].includes(ap.status) && !(ap.handovers || []).length ? `<button class="btn sm bad" data-act="sumApolMy" data-id="${ap.id}">اعتذار (تسترد ${ap.refundPctNow}%)</button>` : ''}
      ${['بانتظار السداد', 'مؤكد'].includes(ap.status) && !(ap.handovers || []).length ? `<button class="btn sm sec" data-act="sumSwapMy" data-id="${ap.id}">طلب تبديل</button>` : ''}</div>` : ''}
    <details style="margin-top:8px"><summary class="muted">سجل الحركات (${(ap.events || []).length})</summary>
      ${(ap.events || []).map(e => kvh(esc(e.kind), `<small class="muted">${dt(String(e.at).slice(0, 10))}</small>`)).join('')}</details></div>`;
}
function seasonView() {
  const s = S.season; if (!s) return '';
  const my = s.myApp, open = s.status === 'التقديم مفتوح';
  const units = s.resorts.flatMap(r => r.units.filter(u => u.active).map(u => ({ ...u, resort: r.name })));
  return back('#/summer', 'المصايف') + `<div class="card"><h2>🏖️ ${esc(s.title)}<span class="sp"></span><span class="pill">${esc(s.status)}</span></h2>
    ${kvh('طريقة التوزيع', esc(s.method) + (s.method === 'أولوية لمن لم يستفد' ? ` <small class="muted">(خلال ${s.lookback_years} سنة)</small>` : ''))}
    ${s.apply_close ? kvh('آخر موعد للتقديم', dt(String(s.apply_close).slice(0, 10))) : ''}
    ${s.decision ? kvh('القرار', esc(s.decision.decision_no)) : ''}
    ${s.lottery_hash ? `<div class="alert" style="font-size:12px;word-break:break-all">🎲 القرعة: البذرة المعلنة «${esc(s.lottery_seed)}» — مفتاح كل طلب = sha256(البذرة|رقم الطلب) بالترتيب التصاعدي.<br>بصمة النتيجة: ${esc(s.lottery_hash)}</div>` : ''}
    ${can('summer.manage') ? `<a class="btn sm gold" href="#/sumadmin/${s.id}" style="display:inline-block;margin-top:8px;text-decoration:none">⚙️ إدارة الموسم</a>` : ''}</div>
  <div class="card"><h2>📅 الأفواج</h2>${s.batches.map(b => kvh(esc(b.name), `${dt(b.start_date)} ← ${dt(b.end_date)}`)).join('')}</div>
  <div class="card"><h2>🏠 الوحدات</h2>${units.map(u => kvh(`${esc(u.resort)} — ${esc(u.unit_type)} ${esc(u.code)} <small class="muted">${u.beds} سراير</small>`,
      `${money(s.eligible === false ? u.full_price : u.member_price)}${+u.deposit ? ' <small class="muted">+ تأمين ' + Number(u.deposit) + '</small>' : ''}`)).join('')}
    ${s.eligible === false ? '<div class="muted">السعر الكامل (غير مستحق للدعم في تاريخ الموسم).</div>' : '<div class="muted">الأسعار للفوج بعد دعم النقابة.</div>'}</div>
  ${my ? sumAppCard(my, true) : open && S.me.profile ? `<div class="card"><h2>📝 قدّم طلبك</h2><form id="saf">
      <b>رتّب تفضيلاتك (حتى ${s.max_prefs})</b>
      ${Array.from({ length: s.max_prefs }, (_, i) => `<div class="row" data-pref style="margin:4px 0"><span>${i + 1}.</span>
        <select class="input" style="flex:2" name="batch_id"><option value="">— الفوج —</option>${s.batches.map(b => `<option value="${b.id}">${esc(b.name)} (${dt(b.start_date)})</option>`).join('')}</select>
        <select class="input" style="flex:2" name="resort_id"><option value="">أي مصيف</option>${s.resorts.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
        <select class="input" style="flex:1" name="unit_type"><option value="">أي نوع</option>${options([...new Set(units.map(u => u.unit_type))], '', false)}</select></div>`).join('')}
      <b style="display:block;margin-top:8px">مين معاك من أسرتك؟</b>
      ${(S.me.profile.family || []).filter(f => f.active !== false).map(f => `<label class="row"><input type="checkbox" name="fam" value="${f.id}"> ${esc(f.full_name)} <small class="muted">(${esc(f.relation)})</small></label>`).join('') || '<div class="muted">لا أفراد في ملفك — ضيفهم من «أسرتي».</div>'}
      <div class="muted" style="margin-top:6px">الوحدة لازم تسع كل الأفراد (أكبر وحدة ${Math.max(...units.map(u => u.beds), 0)} سراير).</div>
      <div id="ferr"></div><button class="btn block" type="submit" style="margin-top:8px">تقديم الطلب</button></form></div>`
    : `<div class="card empty">${open ? 'التقديم للأعضاء فقط' : 'التقديم غير متاح الآن'}</div>`}`;
}
function sumAdminView() {
  const s = S.season, m = S.sumSum || {}, items = S.sumApps || [], swaps = S.sumSwaps || []; if (!s) return '';
  const st = s.status, by = m.byStatus || {};
  return back('#/season/' + s.id, 'صفحة الموسم') + `<div class="card"><h2>⚙️ ${esc(s.title)} <small class="muted">${esc(s.code)}</small><span class="sp"></span><span class="pill">${esc(st)}</span></h2>
    <div class="tiles" style="grid-template-columns:repeat(3,1fr)">
      <div class="tile"><b>${m.slots || 0}</b><small>خانة (وحدة×فوج)</small></div><div class="tile"><b>${m.applied || 0}</b><small>طلب</small></div>
      <div class="tile"><b>${(by['مؤكد'] || 0) + (by['منتهٍ'] || 0)}</b><small>مؤكد</small></div>
      <div class="tile"><b>${by['بانتظار السداد'] || 0}+${by['احتياطي'] || 0}</b><small>سداد/احتياطي</small></div>
      <div class="tile"><b>${money(m.collected)}</b><small>محصّل</small></div><div class="tile"><b>${money(m.subsidy)}</b><small>دعم</small></div></div>
    ${+m.depositsHeld ? `<div class="muted" style="margin-top:6px">تأمينات محتجزة: ${money(m.depositsHeld)}</div>` : ''}
    <div class="row" style="margin-top:10px">
      ${['مسودة', 'التقديم مفتوح', 'التقديم مقفول'].includes(st) ? '<button class="btn sm sec" data-act="sumEdit">تعديل الموسم والوحدات</button>' : ''}
      ${['مسودة', 'التقديم مقفول'].includes(st) ? '<button class="btn sm" data-act="sumStatus" data-s="التقديم مفتوح">فتح التقديم</button>' : ''}
      ${st === 'التقديم مفتوح' ? '<button class="btn sm" data-act="sumStatus" data-s="التقديم مقفول">قفل التقديم</button>' : ''}
      ${st === 'التقديم مقفول' ? '<button class="btn sm gold" data-act="sumAlloc">التوزيع' + (s.method === 'أسبقية' ? '' : ' بالقرعة') + '</button>' : ''}
      ${st === 'تم التوزيع' ? '<button class="btn sm gold" data-act="sumClose">إقفال الموسم</button>' : ''}
      ${!['منتهٍ', 'ملغى'].includes(st) ? '<button class="btn sm bad" data-act="sumCancelAll">إلغاء الموسم</button>' : ''}</div></div>
  ${swaps.length ? `<div class="card"><h2>🔁 طلبات التبديل</h2>${swaps.map(w => `<div class="kv" style="display:block"><b>${esc(w.kind)}</b> — ${esc(w.from)}${w.to ? ' ⇄ ' + esc(w.to) : ''}${w.to_batch ? ' ← ' + esc(w.to_batch) : ''}${w.to_unit ? ' / ' + esc(w.to_unit) : ''}
      <small class="muted">${esc(w.status)}${w.reason ? ' · ' + esc(w.reason) : ''}</small>
      <div class="row" style="margin-top:4px">${w.kind !== 'تبادل' || w.status === 'وافق الطرف الآخر' ? `<button class="btn sm" data-act="swDecide" data-id="${w.id}" data-v="1">اعتماد</button>` : '<span class="muted">بانتظار موافقة العضو الآخر</span>'}
        <button class="btn sm bad" data-act="swDecide" data-id="${w.id}" data-v="0">رفض</button></div></div>`).join('')}</div>` : ''}
  <div class="card"><h2>📋 الطلبات (${items.length})</h2>${items.map(ap => {
    const ho = (ap.handovers || []).map(h => h.kind);
    return `<div class="kv" style="display:block" data-app="${ap.id}">
      <div class="row"><b style="flex:1">${ap.rank ? '#' + ap.rank + ' ' : ''}${esc(ap.person.full_name)} <small class="muted">${esc(ap.person.job_id || '')} · ${esc(ap.app_no)} · ${ap.family_size} فرد</small></b>${sumPill(ap.status)}</div>
      <div class="muted">${ap.unit ? unitLbl(ap.unit) + ' · ' + esc(ap.batch.name) : ap.reserve_rank ? 'احتياطي رقم ' + ap.reserve_rank : ''}${ap.prior_benefit ? ' · <span class="pill warn">استفاد سابقاً</span>' : ''}${ap.eligible ? '' : ' · <span class="pill warn">سعر كامل</span>'}</div>
      <div class="row" style="margin-top:4px"><span>${+ap.total ? 'المطلوب ' + money(ap.total) + ' · مدفوع ' + money(ap.paid) : ''}${+ap.refunded ? ' · مردود ' + money(ap.refunded) : ''}${+ap.deposit_held ? ' · تأمين ' + money(ap.deposit_held) : ''}</span><span style="flex:1"></span>
        ${['بانتظار السداد', 'مؤكد'].includes(ap.status) && +ap.paid < +ap.total && can('treasury.receipt') ? `<button class="btn sm" data-act="sumPay" data-id="${ap.id}" data-rest="${(+ap.total - +ap.paid).toFixed(2)}">تحصيل</button>` : ''}
        ${ap.status === 'مؤكد' && !ho.length && can('treasury.receipt') ? `<button class="btn sm sec" data-act="sumHand" data-k="تسليم" data-id="${ap.id}">محضر تسليم</button>` : ''}
        ${ho.includes('تسليم') && !ho.includes('استلام') && can('treasury.receipt') ? `<button class="btn sm sec" data-act="sumHand" data-k="استلام" data-id="${ap.id}">محضر استلام</button>` : ''}
        ${['بانتظار السداد', 'مؤكد'].includes(ap.status) && !ho.length ? `<button class="btn sm sec" data-act="sumSwapAdm" data-id="${ap.id}">تبديل</button>` : ''}
        ${['بانتظار السداد', 'مؤكد', 'احتياطي'].includes(ap.status) && !ho.length ? `<button class="btn sm bad" data-act="sumApol" data-id="${ap.id}">اعتذار</button>` : ''}</div></div>`; }).join('') || '<div class="empty">لا طلبات بعد</div>'}</div>`;
}
function seasonForm(s) {
  s = s || {}; const locked = (S.sumApps || []).length > 0;
  const decs = (S.decOpts || []).map(d => `<option value="${d.id}" ${d.id === s.decision_id ? 'selected' : ''}>${esc(d.decision_no)} — ${esc(d.text.slice(0, 50))}</option>`).join('');
  const pol = s.cancel_policy || [{ days_before: 14, refund_pct: 100 }, { days_before: 7, refund_pct: 50 }, { days_before: 0, refund_pct: 0 }];
  const bl = (s.batches || []).map(b => `${b.name} | ${b.start_date} | ${b.end_date}`).join('\n');
  const ul = (s.resorts || []).flatMap(r => r.units.map(u => [r.name, r.owner_party || '', u.code, u.unit_type, u.beds, +u.full_price, +u.member_price, +u.deposit, +u.owner_cost].join(' | '))).join('\n');
  return `<h3>${s.id ? 'تعديل الموسم' : 'موسم جديد'}</h3><form id="ssf">
    <div class="grid2"><label class="f"><span>العنوان</span><input class="input" name="title" value="${esc(s.title || 'مصيف ' + (new Date().getFullYear() + 1))}" required></label>
      <label class="f"><span>السنة</span><input class="input" name="year" inputmode="numeric" value="${esc(s.year || new Date().getFullYear() + 1)}" required></label></div>
    <div class="grid2"><label class="f"><span>طريقة التوزيع (قرار الموسم)</span><select class="input" name="method">${options(['قرعة', 'أسبقية', 'أولوية لمن لم يستفد'], s.method || 'قرعة', false)}</select></label>
      <label class="f"><span>«لم يستفد» خلال (سنة)</span><input class="input" name="lookback_years" inputmode="numeric" value="${esc(s.lookback_years ?? 2)}"></label></div>
    <div class="grid2"><label class="f"><span>آخر موعد للتقديم</span><input class="input" type="date" name="apply_close" value="${esc(String(s.apply_close || '').slice(0, 10))}"></label>
      <label class="f"><span>عدد التفضيلات</span><input class="input" name="max_prefs" inputmode="numeric" value="${esc(s.max_prefs || 3)}"></label></div>
    <div class="grid2"><label class="f"><span>مهلة السداد بعد القبول (ساعة)</span><input class="input" name="hold_hours" inputmode="numeric" value="${esc(s.hold_hours || 72)}"></label>
      <label class="f"><span>قرار المجلس</span><select class="input" name="decision_id"><option value="">— اختر —</option>${decs}</select></label></div>
    <label class="f"><span>الأفواج — سطر لكل فوج: الاسم | من | إلى ${locked ? '<small class="muted">(فيه طلبات: لا تحذف أفواجاً)</small>' : ''}</span>
      <textarea class="input" name="batches" rows="3" placeholder="الفوج الأول | 2027-07-01 | 2027-07-07" ${locked ? 'readonly' : ''}>${esc(bl)}</textarea></label>
    <label class="f"><span>الوحدات — سطر لكل وحدة: المصيف | المالك/الشركة | رقم الوحدة | النوع | السراير | السعر الكامل | سعر المستحق | التأمين | تكلفة المالك</span>
      <textarea class="input" name="units" rows="5" placeholder="رأس البر | شركة كذا | A1 | شقة | 5 | 3000 | 1200 | 500 | 2500">${esc(ul)}</textarea></label>
    <b>الاسترداد عند الاعتذار</b>
    ${pol.map(x => `<div class="row" data-pol style="margin:4px 0"><span>قبل الفوج بـ</span><input class="input" style="width:70px" name="days" value="${x.days_before}"><span>يوم ⇐</span>
      <input class="input" style="width:70px" name="pct" value="${x.refund_pct}"><span>%</span></div>`).join('')}
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">حفظ</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}

// ───────── منح المناسبات ─────────
const GRT_ST = { 'مصروف': 'ok', 'معتمد': 'ok', 'مستوفى': '', 'مقدَّم': '', 'ناقص مستندات': 'warn', 'مرفوض': 'bad', 'ملغى': 'bad' };
const grtPill = st => `<span class="pill ${GRT_ST[st] || ''}">${esc(st)}</span>`;
const canGrtAdmin = () => can('grants.review') || can('grants.approve') || can('treasury.cheque.issue');
function grantCard(g, admin) {
  const docs = g.docs || [];
  return `<div class="card"><h2>🎁 ${esc(g.type_name)} <small class="muted">${esc(g.req_no)}</small><span class="sp"></span>${grtPill(g.status)}</h2>
    ${admin ? kvh('العضو', `${esc(g.person.full_name)} <small class="muted">${esc(g.person.job_id || '')}</small>`) : ''}
    ${kvh('المستفيد', `${esc(g.subject_name || '')} <small class="muted">(${esc(g.subject_relation || '')})</small>`)}
    ${kvh('تاريخ الواقعة', dt(g.event_date))}${kvh('المبلغ', g.amount ? money(g.amount) : '<span class="muted">يحدده المجلس</span>')}
    ${docs.length ? `<div style="margin-top:6px"><b>المستندات</b> ${admin && ['مقدَّم', 'ناقص مستندات', 'مستوفى'].includes(g.status) && can('grants.review')
      ? `<form data-docs="${g.id}">${docs.map((d, i) => `<label class="row"><input type="checkbox" name="d${i}" ${d.received ? 'checked' : ''}> ${esc(d.name)}</label>`).join('')}
         <button class="btn sm" style="margin-top:4px">حفظ المراجعة</button></form>`
      : docs.map(d => `<div>${d.received ? '✅' : '⏳'} ${esc(d.name)}</div>`).join('')}</div>` : ''}
    ${g.status === 'ناقص مستندات' && !admin ? '<div class="alert warn">سلّم أصل المستندات الناقصة لمكتب النقابة.</div>' : ''}
    ${g.reject_reason ? `<div class="alert bad">سبب الرفض: ${esc(g.reject_reason)}</div>` : ''}
    ${g.cheque ? kvh('الشيك', `${esc(g.cheque.cheque_no || 'بدون رقم')} — ${dt(g.cheque.issue_date)}`) : ''}
    ${g.decision ? kvh('القرار', esc(g.decision.decision_no)) : ''}${g.exception_note ? kvh('استثناء', esc(g.exception_note)) : ''}
    <div class="row" style="margin-top:8px">
      ${!admin && ['مقدَّم', 'ناقص مستندات', 'مستوفى'].includes(g.status) ? `<button class="btn sm bad" data-act="grtCancel" data-id="${g.id}">إلغاء الطلب</button>` : ''}
      ${admin && g.status === 'مستوفى' && can('grants.approve') ? `<button class="btn sm" data-act="grtApprove" data-id="${g.id}" data-amt="${g.amount || ''}">اعتماد</button>` : ''}
      ${admin && !['مصروف', 'مرفوض', 'ملغى'].includes(g.status) && can('grants.approve') ? `<button class="btn sm bad" data-act="grtReject" data-id="${g.id}">رفض</button>` : ''}
      ${admin && g.status === 'معتمد' && can('treasury.cheque.issue') ? `<button class="btn sm gold" data-act="grtPay" data-id="${g.id}">صرف شيك</button>` : ''}</div></div>`;
}
function grantsView() {
  const types = S.grtTypes || [], my = S.grtMy || [], fam = (S.me.profile && S.me.profile.family) || [];
  return `${S.grtElig === false ? '<div class="alert warn">المنح لأعضاء النقابة العامة النشطين.</div>' : ''}
  <div class="card"><h2>📝 طلب منحة</h2><form id="gaf">
    <label class="f"><span>نوع المنحة</span><select class="input" name="type">${types.map(t => `<option value="${t.code}">${esc(t.name)}${t.amount ? ' — ' + Number(t.amount) + ' ج' : ''}</option>`).join('')}</select></label>
    <label class="f"><span>تاريخ الواقعة</span><input class="input" type="date" name="event_date" required></label>
    <label class="f"><span>المستفيد</span><select class="input" name="who"><option value="self">أنا (العضو)</option>
      ${fam.map(f => `<option value="${f.id}">${esc(f.full_name)} (${esc(f.relation)})</option>`).join('')}<option value="other">شخص آخر من الأسرة (اكتب)</option></select></label>
    <div class="grid2" id="gother" hidden><input class="input" name="subject_name" placeholder="الاسم"><select class="input" name="subject_relation">${options(['أب', 'أم', 'زوج', 'زوجة', 'ابن', 'ابنة'], '', false)}</select></div>
    <div class="muted" id="gdocs"></div>
    <label class="f"><span>ملاحظات</span><input class="input" name="notes"></label>
    <div id="ferr"></div><button class="btn block" type="submit">تقديم</button></form></div>
  <h3 style="margin:14px 4px 6px">طلباتي</h3>${my.map(g => grantCard(g, false)).join('') || '<div class="card empty">لا طلبات</div>'}`;
}
function grantsAdminView() {
  const c = S.grtCounts || {}, f = S.grtF || {};
  return `<div class="tabs" style="margin-bottom:10px;overflow-x:auto">${[['', 'المفتوحة'], ['مقدَّم', 'جديد'], ['ناقص مستندات', 'ناقص'], ['مستوفى', 'للاعتماد'], ['معتمد', 'للصرف'], ['مصروف', 'مصروف'], ['مرفوض', 'مرفوض']]
      .map(([s, t]) => `<button data-gst="${s}" class="${(f.status || '') === s ? 'on' : ''}" style="white-space:nowrap">${t}${s && c[s] ? ' ' + c[s] : ''}</button>`).join('')}</div>
    ${can('grants.review') ? '<div class="card"><button class="btn sec" data-act="grtProxy">+ طلب نيابة عن عضو (مثلاً وفاة العضو)</button></div>' : ''}
    ${(S.grtList || []).map(g => grantCard(g, true)).join('') || '<div class="card empty">لا طلبات</div>'}
    ${can('grants.approve') ? `<div class="card"><h2>💰 المبالغ المقررة</h2>${(S.grtTypes || []).map(t => kvh(esc(t.name), t.amount ? money(t.amount) : '<span class="muted">غير محدد</span>')).join('')}
      <button class="btn sm sec" data-act="grtRate" style="margin-top:8px">تعديل مبلغ بقرار</button></div>` : ''}`;
}

// ───────── الأجهزة (خدمة إعلان وحجز فقط — التقسيط والسداد مع المورد) ─────────
const DEV_ST = { 'مسلّم': 'ok', 'مؤكد': 'ok', 'مطلوب': 'warn', 'مرفوض': 'bad', 'ملغى': 'bad' };
const devPill = st => `<span class="pill ${DEV_ST[st] || ''}">${esc(st)}</span>`;
function devOrderCard(o, admin) {
  return `<div class="kv" style="display:block"><div class="row"><b style="flex:1">${admin ? esc(o.person.full_name) + ' <small class="muted">' + esc(o.person.job_id || '') + (o.person.phone ? ' · ' + esc(o.person.phone) : '') + '</small>' : (['عمرة', 'حج'].includes(o.offer.category) ? '🕋 ' : '📱 ') + esc(o.item.name)}</b>${devPill(o.status)}</div>
    <div class="muted">${admin ? esc(o.item.name) + ' · ' : ''}${esc(o.order_no)} · ${esc(o.method)}${o.months ? ' ' + o.months + ' شهر' : ''}${+o.travelers > 1 ? ' · ' + o.travelers + ' أفراد' : ''} · ${money(o.offer_price)}${o.notes ? ' · ' + esc(o.notes) : ''}</div>
    ${o.reject_reason ? `<div class="alert bad">${esc(o.reject_reason)}</div>` : ''}
    <div class="row" style="margin-top:4px">
      ${!admin && ['مطلوب', 'مؤكد'].includes(o.status) ? `<button class="btn sm bad" data-act="devCancel" data-id="${o.id}">إلغاء الحجز</button>` : ''}
      ${admin && o.status === 'مطلوب' ? `<button class="btn sm" data-act="devDecide" data-s="مؤكد" data-id="${o.id}">تأكيد</button>` : ''}
      ${admin && o.status === 'مؤكد' ? `<button class="btn sm gold" data-act="devDecide" data-s="مسلّم" data-id="${o.id}">اتسلّم</button>` : ''}
      ${admin && ['مطلوب', 'مؤكد'].includes(o.status) ? `<button class="btn sm bad" data-act="devDecide" data-s="مرفوض" data-id="${o.id}">رفض</button>` : ''}</div></div>`;
}
function devicesView() {
  const trip = S.devPage === 'umrah', cats = trip ? ['عمرة', 'حج'] : ['أجهزة'];
  const offers = (S.devOffers || []).filter(f => cats.includes(f.category || 'أجهزة') && (f.status === 'الطلب مفتوح' || f.myOrders.length));
  return `<div class="alert">خدمة إعلان وحجز: النقابة بتعلن العروض وتجمع الحجوزات، والتقسيط والسداد بيتم مع ${trip ? 'شركة السياحة' : 'المورد'} مباشرة.</div>
  ${offers.map(f => `<div class="card"><h2>${f.category === 'عمرة' || f.category === 'حج' ? '🕋' : '🛒'} ${esc(f.title)}<span class="sp"></span><span class="pill">${esc(f.status)}</span></h2>
      <div class="muted">${esc(f.supplier)}${f.contact ? ' · ' + esc(f.contact) : ''}${f.order_close ? ' · آخر حجز ' + dt(f.order_close) : ''}</div>
      ${f.notes ? `<div style="margin-top:6px">${esc(f.notes)}</div>` : ''}
      ${f.items.map(i => `<div class="kv" style="display:block"><div class="row"><b style="flex:1">${esc(i.name)}</b><b>${money(i.offer_price)}</b></div>
        <div class="muted">${i.market_price ? 'سعر السوق ' + Number(i.market_price).toLocaleString('ar-EG') + ' · ' : ''}تقسيط حتى ${i.max_months} شهر${i.left !== null && i.left !== undefined ? ' · متبقي ' + i.left : ''}${i.notes ? ' · ' + esc(i.notes) : ''}</div>
        ${f.status === 'الطلب مفتوح' && !f.myOrders.some(o => o.item_id === i.id) && (i.left === null || i.left === undefined || i.left > 0) ? `<form class="row" data-devorder="${i.id}" style="margin-top:4px">
          ${trip ? '<input class="input" name="travelers" inputmode="numeric" value="1" style="width:56px" title="عدد المسافرين">' : ''}
          <select class="input" name="method" style="flex:1"><option>تقسيط</option><option>كاش</option></select>
          <select class="input" name="months" style="flex:1">${Array.from({ length: i.max_months }, (_, k) => i.max_months - k).map(m => `<option value="${m}">${m} شهر</option>`).join('')}</select>
          <button class="btn sm">احجز</button></form>` : ''}</div>`).join('')}
      ${f.myOrders.length ? '<b style="display:block;margin-top:8px">حجوزاتي</b>' + f.myOrders.map(o => devOrderCard(o, false)).join('') : ''}</div>`).join('') || '<div class="card empty">لا توجد عروض حالياً</div>'}`;
}
function devAdminView() {
  const f = S.devOffer;
  return `<div class="card"><button class="btn" data-act="devNew">+ عرض جديد</button></div>
    ${(S.devOffers || []).map(o => `<div class="card" ${f && f.id === o.id ? 'style="outline:2px solid var(--brand)"' : ''}><h2>🛒 ${esc(o.title)}<span class="sp"></span><span class="pill">${esc(o.status)}</span></h2>
      <div class="muted">${esc(o.category || 'أجهزة')} · ${esc(o.supplier)} · ${o.items.length} صنف · ${o.orderCount} حجز</div>
      <div class="row" style="margin-top:8px"><button class="btn sm sec" data-act="devOrders" data-id="${o.id}">الحجوزات</button>
        <button class="btn sm sec" data-act="devEdit" data-id="${o.id}">تعديل</button>
        ${o.status === 'مسودة' || o.status === 'الطلب مقفول' ? `<button class="btn sm" data-act="devStatus" data-s="الطلب مفتوح" data-id="${o.id}">فتح الحجز</button>` : ''}
        ${o.status === 'الطلب مفتوح' ? `<button class="btn sm" data-act="devStatus" data-s="الطلب مقفول" data-id="${o.id}">قفل الحجز</button>` : ''}
        ${o.status === 'الطلب مقفول' ? `<button class="btn sm sec" data-act="devStatus" data-s="منتهٍ" data-id="${o.id}">إنهاء</button>` : ''}</div></div>`).join('')}
    ${f ? `<div class="card"><h2>📋 حجوزات: ${esc(f.title)} (${(S.devOrders || []).length})</h2>${(S.devOrders || []).map(o => devOrderCard(o, true)).join('') || '<div class="empty">لا حجوزات</div>'}</div>` : ''}`;
}
function devOfferForm(o) {
  o = o || {};
  const il = (o.items || []).map(i => [i.name, i.offer_price, i.market_price ?? '', i.max_months, i.stock ?? '', i.notes ?? ''].join(' | ')).join('\n');
  return `<h3>${o.id ? 'تعديل العرض' : 'عرض جديد'}</h3><form id="dof">
    <div class="grid2"><label class="f"><span>النوع</span><select class="input" name="category">${options(['أجهزة', 'عمرة', 'حج'], o.category || 'أجهزة', false)}</select></label>
      <label class="f"><span>العنوان</span><input class="input" name="title" value="${esc(o.title)}" required></label></div>
    <div class="grid2"><label class="f"><span>المورد / شركة السياحة</span><input class="input" name="supplier" value="${esc(o.supplier)}" required></label>
      <label class="f"><span>التواصل</span><input class="input" name="contact" value="${esc(o.contact)}"></label></div>
    <label class="f"><span>آخر موعد للحجز</span><input class="input" type="date" name="order_close" value="${esc(o.order_close || '')}"></label>
    <label class="f"><span>تفاصيل/شروط العرض</span><textarea class="input" name="notes" rows="2">${esc(o.notes)}</textarea></label>
    <label class="f"><span>الأصناف/الباقات — سطر لكل واحد: الاسم | السعر | سعر السوق | أقصى شهور تقسيط | الكمية أو المقاعد | التفاصيل</span>
      <textarea class="input" name="items" rows="4" placeholder="غسالة 8 كيلو | 6500 | 7000 | 10 | |">${esc(il)}</textarea></label>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">حفظ</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}

// ───────── التقارير الشاملة ─────────
function reportsView() {
  const r = S.rep; if (!r) return '<div class="spin"></div>';
  const m = r.members, b = r.benefits, f = r.finance, num = v => Number(v || 0).toLocaleString('ar-EG');
  const kv2 = o => Object.entries(o || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => kvh(esc(k), num(v))).join('');
  return `<div class="card"><form id="repf" class="row"><select class="input" style="flex:1" name="year"><option value="">كل السنوات</option>
      ${(r.years || []).map(y => `<option ${String(y) === String(r.year) ? 'selected' : ''}>${y}</option>`).join('')}</select><button class="btn">عرض</button>
      <button class="btn sec" type="button" data-act="repPrint">طباعة</button></form></div>
    <div class="tiles" style="grid-template-columns:repeat(2,1fr);margin-bottom:14px">
      <div class="tile"><i>⬆️</i><b>${money(f.revenue)}</b><small>الإيرادات</small></div>
      <div class="tile"><i>⬇️</i><b>${money(f.expense)}</b><small>المصروفات</small></div>
      <div class="tile"><i>🎁</i><b>${money(b.total)}</b><small>المزايا (${num(b.people)} مستفيد)</small></div>
      <div class="tile"><i>🏦</i><b>${money(f.bank)}</b><small>البنك الدفتري (الآن)</small></div></div>
    <div class="card"><h2>👥 الأعضاء (${num(m.total)})</h2><b>التنظيم</b>${kv2(m.byOrg)}<b style="display:block;margin-top:8px">الحالة</b>${kv2(m.byState)}</div>
    <div class="card"><h2>🎁 المزايا حسب البند</h2>${(b.byCategory || []).map(c => kvh(`${esc(c.category)} <small class="muted">(${num(c.people)})</small>`, money(c.total))).join('') || '<div class="empty">لا شيء</div>'}</div>
    <div class="card"><h2>🎁 المنح</h2>${(r.grants.byType || []).map(g => kvh(`${esc(g.type)} <small class="muted">(${num(g.paid)} مصروفة${g.open ? ' · ' + num(g.open) + ' تحت الإجراء' : ''})</small>`, money(g.amount))).join('') || '<div class="empty">لا طلبات</div>'}</div>
    <div class="card"><h2>🚌 الأنشطة (${(r.activities || []).length})</h2>${(r.activities || []).map(a => `<div class="kv" style="display:block"><div class="row"><b style="flex:1">${esc(a.title)}</b><small class="muted">${esc(a.kind)} · ${dt(a.date)}</small></div>
      <div class="muted">${num(a.people)} مشارك · محصّل ${num(a.collected)} · دعم ${num(a.subsidy)} · مصروفات ${num(a.expenses)}</div></div>`).join('') || '<div class="empty">لا أنشطة</div>'}</div>
    ${(r.summer || []).length ? `<div class="card"><h2>🏖️ المصايف</h2>${r.summer.map(s => kvh(esc(s.title) + ' <small class="muted">' + esc(s.status) + '</small>', `${num(s.applied)} طلب · ${num(s.slots)} خانة · دعم ${num(s.subsidy)}`)).join('')}</div>` : ''}
    <div class="card"><h2>📱 الأجهزة (خدمة)</h2>${kvh('عروض', num(r.devices.offers))}${kvh('حجوزات', num(r.devices.bookings))}${kvh('اتسلّمت', num(r.devices.delivered))}</div>
    <div class="card"><h2>📒 الإيرادات والمصروفات حسب الحساب</h2>${(f.byAccount || []).map(a => kvh(`<small class="muted">${esc(a.code)}</small> ${esc(a.name)} <small class="muted">(${esc(a.type)})</small>`, money(a.amount))).join('')}
      ${kvh('<b>الفائض / (العجز)</b>', `<b>${money(+f.revenue - +f.expense)}</b>`)}${kvh('الخزينة الآن', money(f.cash))}${kvh('عُهد تحت التسوية الآن', money(f.custody))}</div>`;
}

// ───────── سجل المزايا ─────────
const KIND_ICON = { 'منحة': '🎁', 'بدل': '💼', 'جائزة': '🏆', 'دعم': '🤝', 'إعفاء': '🎟️', 'خصم': '📚', 'ميزة عينية': '📦' };
function benefitsBody(b, title) {
  if (!b) return '<div class="spin"></div>';
  const kinds = Object.entries(b.byKind || {});
  return `<div class="card"><h2>${title}</h2>
      <div style="font-size:28px;font-weight:800;color:var(--brand)">${money(b.total)} <small style="font-size:14px">ج</small></div>
      <div class="chips" style="margin-top:8px">${kinds.map(([k, v]) => `<span class="pill">${KIND_ICON[k] || '•'} ${esc(k)}: ${money(v)}</span>`).join('')}</div>
      ${(b.byYear || []).length > 1 ? `<div style="margin-top:10px">${b.byYear.map(y => kvh('سنة ' + y.year, money(y.total))).join('')}</div>` : ''}</div>
    <div class="card list">${(b.items || []).map(x => `<div class="li"><div class="av" style="width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#eaf2f8;flex:none">${KIND_ICON[x.kind] || '•'}</div>
      <div class="nm"><b>${esc(x.category)}</b><span class="muted">${dt(x.date)} · ${esc(x.source)}${x.basis ? ' · ' + esc(x.basis) : ''}${x.board_role ? ' · بصفته ' + esc(x.board_role) : ''}${x.notes ? ' · ' + esc(x.notes) : ''}</span></div>
      <b>${money(x.amount)}</b></div>`).join('') || '<div class="empty">لا توجد مزايا مسجّلة</div>'}</div>`;
}
function benefitsReportView() {
  const r = S.benRep; if (!r) return '<div class="spin"></div>';
  const years = (r.byYear || []).map(y => y.year);
  return `<div class="card"><form id="byf" class="row"><select class="input" style="flex:1" name="year"><option value="">كل السنوات</option>
      ${years.map(y => `<option ${String(y) === String(r.year) ? 'selected' : ''}>${y}</option>`).join('')}</select><button class="btn">عرض</button></form></div>
    <div class="tiles" style="grid-template-columns:repeat(2,1fr);margin-bottom:14px">
      <div class="tile"><i>🎁</i><b>${money(r.total)}</b><small>إجمالي المزايا</small></div>
      <div class="tile"><i>👥</i><b>${r.beneficiaries}</b><small>مستفيد</small></div></div>
    <div class="card"><h2>📊 حسب البند</h2>${(r.byCategory || []).map(c => kvh(`${KIND_ICON[c.kind] || ''} ${esc(c.category)} <small class="muted">(${c.people} مستفيد)</small>`, money(c.total))).join('')}</div>
    ${!r.year ? `<div class="card"><h2>📅 حسب السنة</h2>${(r.byYear || []).map(y => kvh(`${y.year} <small class="muted">(${y.people} مستفيد)</small>`, money(y.total))).join('')}</div>` : ''}
    <div class="card"><h2>🏛️ مزايا أعضاء المجلس <small class="muted">(ما استفادوا به وهم في المجلس)</small></h2>
      ${(r.board || []).map(b => `<div class="li" data-person="${b.person_id}" style="cursor:pointer"><div class="nm"><b>${esc(b.full_name)}</b>
        <span class="muted">${esc(b.role || 'غادر المجلس')} · ${Object.entries(b.byKind || {}).map(([k, v]) => esc(k) + ' ' + Number(v).toLocaleString('ar-EG')).join(' · ')}</span></div>
        <b>${money(b.total)}</b></div>`).join('') || '<div class="empty">لا شيء</div>'}</div>
    <div class="card"><h2>🔝 أعلى 20 مستفيداً</h2>${(r.top || []).map(t => `<div class="li" data-person="${t.person_id}" style="cursor:pointer">
      <div class="nm"><b>${esc(t.full_name)}</b><span class="muted">${esc(t.job_id || '')}</span></div><b>${money(t.total)}</b></div>`).join('')}</div>`;
}


// ───────── جدول البيانات (فرز · فلترة · تصدير Excel · طباعة) — جدول على الكمبيوتر وكروت على الموبايل ─────────
const G = {};
const plain = h => String(h ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
function grid(id, cols, rows, o = {}) {
  const st = (S.grid = S.grid || {})[id] = (S.grid || {})[id] || { q: '', sort: null, dir: 1 };
  G[id] = { cols, rows: rows || [], o };
  return `<div class="card grid" id="g-${id}">
    <div class="gbar">${o.title ? `<h2>${o.title}</h2>` : ''}<span class="sp"></span>
      <input class="input gq" data-gq="${id}" value="${esc(st.q)}" placeholder="🔎 فلترة النتائج…">
      <span class="pill gcount" data-gc="${id}"></span>
      <button class="btn sm sec" data-gx="${id}" title="تصدير Excel">⬇️ Excel</button>
      <button class="btn sm sec gprint" data-gp="${id}" title="طباعة">🖨️</button></div>
    <div class="gtw"><table class="gt"><thead><tr>${cols.map((c, i) => `<th data-gs="${id}:${i}" class="${c.num ? 'n' : ''}">${esc(c.t)}${st.sort === i ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody data-gb="${id}">${gridRows(id)}</tbody>${o.foot ? `<tfoot>${o.foot}</tfoot>` : ''}</table></div></div>`;
}
const cellRaw = (c, r) => c.raw ? c.raw(r) : plain(c.v(r));
function gridView(id) {
  const g = G[id], st = S.grid[id], q = st.q.trim().toLowerCase();
  let rows = g.rows.filter(r => !q || g.cols.some(c => String(cellRaw(c, r)).toLowerCase().includes(q)));
  if (st.sort != null) { const c = g.cols[st.sort];
    rows = rows.slice().sort((a, b) => { const x = cellRaw(c, a), y = cellRaw(c, b);
      return (c.num ? (+x || 0) - (+y || 0) : String(x).localeCompare(String(y), 'ar')) * st.dir; }); }
  return rows;
}
function gridRows(id) {
  const g = G[id], rows = gridView(id);
  setTimeout(() => { const el = document.querySelector(`[data-gc="${id}"]`); if (el) el.textContent = rows.length.toLocaleString('ar-EG') + (rows.length !== g.rows.length ? ' من ' + g.rows.length.toLocaleString('ar-EG') : '') + ' سجل'; });
  return rows.map(r => `<tr ${g.o.attr ? g.o.attr(r) : ''}>${g.cols.map(c => `<td data-l="${esc(c.t)}" class="${c.num ? 'n' : ''}">${c.v(r) ?? ''}</td>`).join('')}</tr>`).join('')
    || `<tr class="ge"><td colspan="${g.cols.length}"><div class="empty">${g.o.empty || 'لا بيانات'}</div></td></tr>`;
}
function bindGrids() {
  document.querySelectorAll('[data-gq]').forEach(i => i.oninput = () => { const id = i.dataset.gq; S.grid[id].q = i.value;
    document.querySelector(`[data-gb="${id}"]`).innerHTML = gridRows(id); bindPage(true); });
  document.querySelectorAll('[data-gs]').forEach(th => th.onclick = () => { const [id, i] = th.dataset.gs.split(':'), st = S.grid[id];
    if (st.sort === +i) st.dir = -st.dir; else { st.sort = +i; st.dir = 1; } render(); });
  document.querySelectorAll('[data-gx]').forEach(b => b.onclick = () => { const id = b.dataset.gx, g = G[id];
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = [g.cols.map(c => q(c.t)).join(','), ...gridView(id).map(r => g.cols.map(c => q(cellRaw(c, r))).join(','))].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = (g.o.file || id) + '-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
  document.querySelectorAll('[data-gp]').forEach(b => b.onclick = () => { document.body.dataset.printGrid = b.dataset.gp; window.print(); delete document.body.dataset.printGrid; });
}

// ───────── المالية والخزينة ─────────
const money = v => `<span class="dt">${Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
const PURPOSES = ['منحة', 'عهدة', 'دعم نشاط', 'مصروف', 'أخرى'];
const RCPT_KINDS = ['تحويل النقابة العامة', 'اشتراكات', 'رد عهدة', 'إيرادات أخرى', 'رسوم بنكية'];
const finTabs = act => `<div class="tabs" style="margin-bottom:12px;overflow-x:auto">${[['#/finance', 'الملخص'], ['#/cheques', 'الشيكات'],
  ['#/receipts', 'المقبوضات'], ['#/trial', 'الميزان'], ['#/entries', 'القيود']]
  .map(([h, t]) => `<button data-go="${h}" class="${act === h ? 'on' : ''}" style="white-space:nowrap">${t}</button>`).join('')}</div>`;
const periodForm = f => `<form id="pf" class="row" style="margin-bottom:10px"><input class="input" style="flex:1" type="date" name="from" value="${esc(f.from || '')}">
  <input class="input" style="flex:1" type="date" name="to" value="${esc(f.to || '')}"><button class="btn sm">عرض</button></form>`;
function finSummaryView() {
  const s = S.fin || {}, y = s.year || {};
  return finTabs('#/finance') + `<div class="card">${periodForm(S.finP || { from: s.from, to: s.to })}
    <div class="tiles" style="grid-template-columns:repeat(2,1fr)">
      <div class="tile" data-ledger="1102"><i>🏦</i><b>${money(s.bank)}</b><small>رصيد البنك الدفتري</small></div>
      <div class="tile" data-ledger="1103"><i>🧾</i><b>${money(s.custody)}</b><small>عُهد تحت التسوية (${s.unsettled || 0} شيك مفتوح)</small></div>
      <div class="tile"><i>⬆️</i><b>${money(y.revenue)}</b><small>إيرادات الفترة</small></div>
      <div class="tile"><i>⬇️</i><b>${money(y.expense)}</b><small>مصروفات الفترة</small></div></div></div>
  ${can('treasury.cheque.issue') || can('treasury.receipt') ? `<div class="card row">${can('treasury.cheque.issue') ? '<button class="btn" data-act="chqNew">+ صرف شيك</button>' : ''}
    ${can('treasury.receipt') ? '<button class="btn sec" data-act="rcptNew">+ إيداع / تحصيل</button>' : ''}</div>` : ''}
  <div class="card"><h2>📊 المصروفات حسب المجموعة</h2>${(s.byGroup || []).map(g => kvh(g.name, money(g.amount))).join('') || '<div class="empty">لا مصروفات</div>'}</div>
  <div class="card"><h2>🧾 العُهد المفتوحة</h2>${(s.openCustody || []).map(o => kvh(esc(o.party), money(o.balance))).join('') || '<div class="empty">لا عُهد مفتوحة 👌</div>'}</div>`;
}
const kvh = (k, vHtml) => `<div class="kv"><span>${k}</span><span>${vHtml}</span></div>`;
const stPill = st => `<span class="pill ${st === 'مسوّى' ? 'ok' : st === 'صادر' ? 'warn' : st === 'ملغى' ? 'bad' : ''}">${esc(st)}</span>`;
function chequesView() {
  const f = S.chqF || {};
  return finTabs('#/cheques') + `<div class="card"><form id="cf" class="row"><input class="input" style="flex:2;min-width:120px" name="q" value="${esc(f.q || '')}" placeholder="مستفيد / رقم / بيان">
      <select class="input" style="flex:1;min-width:100px" name="purpose"><option value="">كل الأغراض</option>${options(PURPOSES, f.purpose, false)}</select>
      <select class="input" style="flex:1;min-width:100px" name="status"><option value="">كل الحالات</option>${options(['صادر', 'مسوّى', 'مرحّل الرصيد'], f.status, false)}</select>
      <button class="btn">بحث</button></form>
    <div class="muted" style="margin-top:6px">الفترة: ${dt(f.from || '2000-01-01')} ← ${dt(f.to || 'اليوم')}</div></div>
  ${grid('chq', [
    { t: 'التاريخ', v: c => dt(c.issue_date), raw: c => c.issue_date },
    { t: 'رقم الشيك', v: c => esc(c.cheque_no || '—'), raw: c => c.cheque_no || '' },
    { t: 'المستفيد', v: c => `<b>${esc(c.payee_name)}</b>`, raw: c => c.payee_name },
    { t: 'الغرض', v: c => esc(c.purpose), raw: c => c.purpose },
    { t: 'القرار', v: c => esc(c.decision_no || '—'), raw: c => c.decision_no || '' },
    { t: 'المبلغ', v: c => money(c.amount), raw: c => +c.amount, num: true },
    { t: 'الحالة', v: c => stPill(c.status), raw: c => c.status },
  ], S.cheques, { title: '🧾 الشيكات', file: 'cheques', attr: c => `data-chq="${c.id}"`, empty: 'لا شيكات',
    foot: `<tr><td colspan="5"><b>الإجمالي</b></td><td class="n"><b>${money((S.cheques || []).reduce((x, c) => x + +c.amount, 0))}</b></td><td></td></tr>` })}`;
}
function chequeView() {
  const c = S.cheque; if (!c) return '';
  const st = c.settlement;
  return `<a href="#/cheques" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ الشيكات</a>
  <div class="card"><h2>شيك ${esc(c.cheque_no || 'بدون رقم')}<span class="sp"></span>${stPill(c.status)}</h2>
    ${kvh('المستفيد', esc(c.payee_name))}${kvh('التاريخ', dt(c.issue_date))}${kvh('المبلغ', money(c.amount))}${kvh('الغرض', esc(c.purpose))}
    ${kvh('القرار', c.decision ? esc(c.decision.decision_no + ' — ' + c.decision.text) : '<span class="muted">غير مربوط</span>')}
    ${c.notes ? kvh('البيان', esc(c.notes)) : ''}
    ${c.entry_id ? `<button class="btn sm sec" data-entry="${c.entry_id}" style="margin-top:8px">عرض القيد</button>` : ''}
    ${c.requires_settlement && c.status === 'صادر' && can('treasury.settlement') ? '<button class="btn sm gold" data-act="settleNew" style="margin-top:8px">تسوية العهدة</button>' : ''}</div>
  ${st ? `<div class="card"><h2>🧮 التسوية (${dt(st.settle_date)})</h2>
    ${kvh('العهدة', money(st.advance))}${+st.prev_balance ? kvh('رصيد مرحّل سابق', money(st.prev_balance)) : ''}
    ${+st.subscriptions ? kvh('اشتراكات المشاركين', money(st.subscriptions)) : ''}${kvh('المصروف', money(st.spent))}
    ${+st.returned ? kvh(esc(st.return_mode), money(st.returned)) : ''}
    ${(st.lines || []).map(l => `<div class="kv"><span>${esc(l.category)}${l.notes ? ' <small class="muted">' + esc(l.notes) + '</small>' : ''}</span><span>${money(l.amount)}</span></div>`).join('')}
    ${st.entry_id ? `<button class="btn sm sec" data-entry="${st.entry_id}" style="margin-top:8px">عرض قيد التسوية</button>` : ''}</div>` : ''}`;
}
function receiptsView() {
  return finTabs('#/receipts') + `${can('treasury.receipt') ? '<div class="card"><button class="btn" data-act="rcptNew">+ إيداع / تحصيل / رسوم</button></div>' : ''}
  ${grid('rcpt', [
    { t: 'التاريخ', v: r => dt(r.receipt_date), raw: r => r.receipt_date },
    { t: 'رقم الإيصال', v: r => esc(r.receipt_no), raw: r => r.receipt_no },
    { t: 'النوع', v: r => `<b>${esc(r.kind)}</b>`, raw: r => r.kind },
    { t: 'الجهة', v: r => esc(r.party || '—'), raw: r => r.party || '' },
    { t: 'المبلغ', v: r => money(r.amount), raw: r => +r.amount, num: true },
  ], S.receipts, { title: '📥 المقبوضات', file: 'receipts', attr: r => r.entry_id ? `data-entry="${r.entry_id}"` : '', empty: 'لا مقبوضات في الفترة',
    foot: `<tr><td colspan="4"><b>الإجمالي</b></td><td class="n"><b>${money((S.receipts || []).reduce((x, r) => x + +r.amount, 0))}</b></td></tr>` })}`;
}
function trialView() {
  const t = S.trial || {}, items = t.items || [];
  const sum = k => items.reduce((a, x) => a + Number(x[k] || 0), 0);
  return finTabs('#/trial') + `<div class="card">${periodForm(S.finP || { from: t.from, to: t.to })}</div>
  ${grid('trial', [
    { t: 'الكود', v: x => `<b>${esc(x.code)}</b>`, raw: x => x.code },
    { t: 'الحساب', v: x => esc(x.name), raw: x => x.name },
    { t: 'مدين الفترة', v: x => money(x.debit), raw: x => +x.debit || 0, num: true },
    { t: 'دائن الفترة', v: x => money(x.credit), raw: x => +x.credit || 0, num: true },
    { t: 'الرصيد', v: x => `<b>${money(x.closing)}</b>`, raw: x => +x.closing || 0, num: true },
  ], items, { title: '⚖️ ميزان المراجعة', file: 'trial-balance', attr: x => `data-ledger="${x.code}"`, empty: 'لا حركة',
    foot: `<tr><td colspan="2"><b>الإجمالي</b></td><td class="n"><b>${money(sum('debit'))}</b></td><td class="n"><b>${money(sum('credit'))}</b></td><td></td></tr>` })}<div class="card">
    <div class="kv"><span><b>مدين الفترة / دائن الفترة</b></span><span>${money(sum('debit'))} / ${money(sum('credit'))}</span></div>
    <div class="alert ${Math.abs(sum('debit') - sum('credit')) < 0.005 ? 'ok' : 'bad'}" style="margin-top:8px">${Math.abs(sum('debit') - sum('credit')) < 0.005 ? 'الميزان متوازن ✓' : 'الميزان غير متوازن!'}</div></div>`;
}
function ledgerView() {
  const l = S.ledger || {}; let bal = Number(l.opening || 0);
  return `<a href="#/trial" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ الميزان</a>
  <div class="card"><h2>📒 ${esc(l.account ? l.account.code + ' — ' + l.account.name : '')}</h2>${kvh('رصيد أول المدة', money(l.opening))}</div>
  ${grid('ledger', [
    { t: 'التاريخ', v: x => dt(x.date), raw: x => x.date },
    { t: 'رقم القيد', v: x => esc(x.entry_no), raw: x => x.entry_no },
    { t: 'البيان', v: x => `<b>${esc(x.description)}</b>${x.status === 'معكوس' ? ' <span class="pill bad">معكوس</span>' : ''}`, raw: x => x.description },
    { t: 'الطرف', v: x => esc(x.party || '—'), raw: x => x.party || '' },
    { t: 'مدين', v: x => +x.debit ? money(x.debit) : '', raw: x => +x.debit || 0, num: true },
    { t: 'دائن', v: x => +x.credit ? money(x.credit) : '', raw: x => +x.credit || 0, num: true },
    { t: 'الرصيد', v: x => money(x._bal), raw: x => x._bal, num: true },
  ], (l.items || []).map(x => ({ ...x, _bal: (bal += Number(x.debit) - Number(x.credit)) })), { file: 'ledger-' + (l.account ? l.account.code : ''), attr: x => `data-entry="${x.entry_id}"`, empty: 'لا حركة' })}`;
}
function entriesView() {
  return finTabs('#/entries') + `<div class="card"><form id="ef" class="row"><input class="input" style="flex:1" name="q" value="${esc((S.entF || {}).q || '')}" placeholder="بحث في البيان أو رقم القيد"><button class="btn">بحث</button></form></div>
  ${grid('ent', [
    { t: 'التاريخ', v: e => dt(e.entry_date), raw: e => e.entry_date },
    { t: 'رقم القيد', v: e => esc(e.entry_no), raw: e => e.entry_no },
    { t: 'البيان', v: e => `<b>${esc(e.description)}</b>`, raw: e => e.description },
    { t: 'المصدر', v: e => esc(e.source), raw: e => e.source },
    { t: 'الحالة', v: e => e.status === 'معكوس' ? '<span class="pill bad">معكوس</span>' : `<span class="pill ok">${esc(e.status || 'مرحّل')}</span>`, raw: e => e.status },
    { t: 'القيمة', v: e => money(e.total), raw: e => +e.total, num: true },
  ], S.entries, { title: '📒 دفتر اليومية', file: 'journal', attr: e => `data-entry="${e.id}"`, empty: 'لا قيود' })}`;
}
function entryModal(e) {
  return `<h3>${esc(e.entry_no)} <small class="muted">${dt(e.entry_date)}</small></h3><p>${esc(e.description)}</p>
    ${e.decision ? `<p class="muted">قرار ${esc(e.decision.decision_no)} — ${esc(e.decision.text)}</p>` : ''}
    ${(e.lines || []).map(l => `<div class="kv"><span><b>${esc(l.account)}</b> ${esc(l.name)}${l.party ? '<br><small class="muted">' + esc(l.party) + '</small>' : ''}</span>
      <span>${+l.debit ? 'مدين ' + money(l.debit) : 'دائن ' + money(l.credit)}</span></div>`).join('')}
    ${e.status === 'معكوس' ? '<div class="alert warn">هذا القيد معكوس</div>' : ''}
    <div class="acts">${e.status === 'مرحّل' && can('finance.journal') ? '<button class="btn bad" data-act="revEntry">قيد عكسي</button>' : ''}
      <button class="btn sec" type="button" data-close>إغلاق</button></div>`;
}
function chequeForm() {
  const decs = (S.decOpts || []).map(d => `<option value="${d.id}">${esc(d.decision_no)} — ${esc(d.text.slice(0, 60))}</option>`).join('');
  return `<h3>صرف شيك</h3><form id="chf">
    <div class="grid2"><label class="f"><span>الغرض</span><select class="input" name="purpose" id="chPurpose">${options(PURPOSES, 'عهدة', false)}</select></label>
      <label class="f"><span>المبلغ</span><input class="input" name="amount" inputmode="decimal" required></label></div>
    <label class="f"><span>المستفيد (الاسم كما في الشيك)</span><input class="input" name="payee_name" required></label>
    <div class="grid2"><label class="f"><span>الرقم الوظيفي (لو عضو)</span><input class="input" name="person_job" inputmode="numeric"></label>
      <label class="f"><span>رقم الشيك</span><input class="input" name="cheque_no" inputmode="numeric"></label></div>
    <div class="grid2"><label class="f"><span>التاريخ</span><input class="input" type="date" name="date" required></label>
      <label class="f" id="chAcc"><span>حساب المصروف</span><select class="input" name="expense_account">${(S.accounts || []).filter(a => a.postable && a.type === 'مصروفات')
        .map(a => `<option value="${a.code}">${a.code} — ${esc(a.name)}</option>`).join('')}</select></label></div>
    <label class="f"><span>قرار المجلس</span><select class="input" name="decision_id"><option value="">— اختر —</option>${decs}</select></label>
    <label class="f"><span>البيان</span><input class="input" name="notes"></label>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">صرف</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
function settleForm(c) {
  const cats = ['بدل جلسات', 'بدل ضيافة', 'بدل انتقال', 'هدايا', 'جوائز نقدية', 'مشروبات ومأكولات', 'مطبوعات ولافتات', 'إيجار سيارة', 'انتقالات بالباص', 'حجز تذاكر', 'رسوم', 'إقامة بالفندق', 'أدوات مكتبية', 'مشتريات أخرى'];
  const row = () => `<div class="row" data-sl style="margin-bottom:6px"><select class="input" style="flex:2" name="cat">${options(cats, null, false)}</select>
    <input class="input" style="flex:1" name="amt" inputmode="decimal" placeholder="المبلغ"><input class="input" style="flex:2" name="note" placeholder="بيان/مستند"></div>`;
  return `<h3>تسوية عهدة — ${esc(c.payee_name)} (${money(c.amount)})</h3><form id="stf">
    <label class="f"><span>تاريخ التسوية</span><input class="input" type="date" name="date" required></label>
    <b>المصروفات بالمستندات</b><div id="sls">${row()}${row()}</div><button class="btn sm sec" type="button" data-act="slAdd">+ بند</button>
    <div class="grid2" style="margin-top:10px"><label class="f"><span>اشتراكات حُصّلت من المشاركين</span><input class="input" name="subscriptions" inputmode="decimal" value="0"></label>
      <label class="f"><span>المتبقي المردود</span><input class="input" name="returned" inputmode="decimal" value="0"></label></div>
    <label class="f"><span>التصرف في المتبقي</span><select class="input" name="return_mode">${options(['لا يوجد', 'رد للخزينة', 'توريد للبنك', 'ترحيل'], 'لا يوجد', false)}</select></label>
    <div class="alert warn" id="stCalc"></div>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">تسجيل التسوية</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
function receiptForm() {
  return `<h3>إيداع / تحصيل / رسوم بنكية</h3><form id="rcf">
    <div class="grid2"><label class="f"><span>النوع</span><select class="input" name="kind">${options(RCPT_KINDS, 'تحويل النقابة العامة', false)}</select></label>
      <label class="f"><span>المبلغ</span><input class="input" name="amount" inputmode="decimal" required></label></div>
    <div class="grid2"><label class="f"><span>التاريخ</span><input class="input" type="date" name="date" required></label>
      <label class="f"><span>إلى/من</span><select class="input" name="cash_account"><option value="1102">البنك</option><option value="1101">الخزينة</option></select></label></div>
    <label class="f"><span>الطرف</span><input class="input" name="party"></label>
    <label class="f"><span>البيان</span><input class="input" name="notes"></label>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">تسجيل</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}

async function loadGov() { const r = await call('GOV_OVERVIEW'); if (r.success) S.gov = r; else toast(r.message, true); }

// ───────── الموجّه ─────────
async function loadLists() { const r = await call('GET_LISTS'); if (r.success) S.lists = r.lists || {}; }
// ───────── التثبيت كتطبيق (PWA) ─────────
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (location.hash.startsWith('#/home')) render(); });
window.addEventListener('appinstalled', () => { installEvt = null; toast('اتثبّت التطبيق ✓'); });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
function installCard() {
  if (isStandalone()) return '';
  if (installEvt) return `<div class="card row" style="align-items:center"><span style="font-size:28px">📲</span>
    <div style="flex:1"><b>ثبّت المنصة على موبايلك</b><div class="muted">تفتح من أيقونة على الشاشة زي أي تطبيق</div></div>
    <button class="btn sm" data-act="install">تثبيت</button></div>`;
  if (isIOS()) return `<div class="card row" style="align-items:center"><span style="font-size:28px">📲</span>
    <div style="flex:1"><b>ثبّت المنصة على الآيفون</b><div class="muted">من Safari: زر المشاركة ⬆️ ← «إضافة إلى الشاشة الرئيسية»</div></div></div>`;
  return '';
}

// ───────── الأخبار ─────────
const NEWS_ICON = { 'خبر': '📰', 'قرار': '📜', 'موعد': '📅', 'تهنئة': '🎉', 'تعزية': '🕊️' };
function newsItem(n, full) {
  return `<div class="kv" style="display:block${n.active === false ? ';opacity:.5' : ''}"><div class="row"><b style="flex:1">${NEWS_ICON[n.category] || '📰'} ${esc(n.title)}${n.pinned ? ' 📌' : ''}</b>
      <small class="muted">${dt(String(n.published_at).slice(0, 10))}</small></div>
    ${n.body ? `<div style="white-space:pre-line;margin-top:4px">${esc(full ? n.body : n.body.slice(0, 160) + (n.body.length > 160 ? '…' : ''))}</div>` : ''}
    ${full && S.newsManage ? `<div class="row" style="margin-top:6px"><button class="btn sm sec" data-act="newsEdit" data-id="${n.id}">تعديل</button>
      <button class="btn sm ${n.active === false ? '' : 'bad'}" data-act="newsHide" data-id="${n.id}" data-show="${n.active === false ? 1 : 0}">${n.active === false ? 'إظهار' : 'إخفاء'}</button>
      ${n.active === false ? '<span class="pill">مخفي</span>' : ''}${n.expires_at ? `<span class="pill">حتى ${dt(n.expires_at)}</span>` : ''}</div>` : ''}</div>`;
}
function newsView() {
  return `${S.newsManage ? '<div class="card"><button class="btn" data-act="newsNew">+ خبر / إعلان جديد</button></div>' : ''}
    <div class="card">${(S.news || []).filter(n => S.newsManage || n.active).map(n => newsItem(n, true)).join('') || '<div class="empty">لا أخبار</div>'}</div>`;
}
const newsForm = n => { n = n || {}; return `<h3>${n.id ? 'تعديل' : 'خبر جديد'}</h3><form id="nwf">
  <div class="grid2"><label class="f"><span>النوع</span><select class="input" name="category">${options(['خبر', 'قرار', 'موعد', 'تهنئة', 'تعزية'], n.category || 'خبر', false)}</select></label>
    <label class="f"><span>يختفي بعد (اختياري)</span><input class="input" type="date" name="expires_at" value="${esc(n.expires_at || '')}"></label></div>
  <label class="f"><span>العنوان</span><input class="input" name="title" value="${esc(n.title)}" required></label>
  <label class="f"><span>التفاصيل</span><textarea class="input" name="body" rows="5">${esc(n.body)}</textarea></label>
  <label class="row"><input type="checkbox" name="pinned" ${n.pinned ? 'checked' : ''}> تثبيت في الأعلى</label>
  ${n.id ? '' : '<div class="muted">النشر بيبعت إشعار لكل الأعضاء.</div>'}
  <div id="ferr"></div><div class="acts"><button class="btn" type="submit">${n.id ? 'حفظ' : 'نشر'}</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`; };

// ───────── الإشعارات ─────────
const NTF_ICON = { 'رحلة': '🚌', 'مصيف': '🏖️', 'منحة': '🎁', 'جهاز': '📱', 'عمرة': '🕋', 'بيانات': '🪪', 'إعلان': '📣' };
async function refreshNtf() {
  const r = await call('NTF_LIST'); if (!r.success) return;
  const n = (+r.unread || 0) + (r.tasks || []).reduce((a, t) => a + +t.count, 0);
  S.ntf = r; if (n !== S.ntfCount) { S.ntfCount = n; const b = document.querySelector('.top .bell'); if (b) b.outerHTML = `<a href="#/notifications" class="bell" title="الإشعارات">🔔${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : ''}</a>`; }
}
function notificationsView() {
  const r = S.ntf || {}, ago = d => { const m = Math.round((Date.now() - new Date(d)) / 60000);
    return m < 60 ? `من ${Math.max(m, 1)} دقيقة` : m < 1440 ? `من ${Math.round(m / 60)} ساعة` : dt(String(d).slice(0, 10)); };
  return `${(r.tasks || []).length ? `<div class="card"><h2>📌 مهام مستنياك</h2>${r.tasks.map(t => `<a class="kv" href="${esc(t.link)}" style="text-decoration:none;color:inherit"><span>${esc(t.title)}</span><span class="pill warn">${t.count}</span></a>`).join('')}</div>` : ''}
    <div class="card list">${(r.items || []).map(n => `<a class="li" href="${esc(n.link || '#/home')}" style="text-decoration:none;color:inherit${n.unread ? ';background:#f3f8fc' : ''}">
      <div class="av" style="width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#eaf2f8;flex:none">${NTF_ICON[n.kind] || '🔔'}</div>
      <div class="nm"><b>${esc(n.title)}${n.unread ? ' <span class="pill ok" style="font-size:10px">جديد</span>' : ''}</b><span class="muted">${esc(n.body || '')} · ${ago(n.at)}</span></div></a>`).join('')
      || '<div class="empty">لا إشعارات</div>'}</div>`;
}

async function boot() {
  if (!S.token) { location.hash = '#/login'; return render(); }
  const r = await call('GET_ME');
  if (!r.success) return;
  S.me = r; await loadLists();
  refreshNtf(); if (!S.ntfTimer) S.ntfTimer = setInterval(() => { if (S.token && !document.hidden) refreshNtf(); }, 120000);
  if (isStaff() && r.mustChange) location.hash = '#/account';
  else if (!location.hash || location.hash === '#/login') location.hash = isStaff() ? '#/dash' : '#/home';
  render();
}
async function render() {
  const app = $('#app'), h = location.hash || '#/login';
  if (!S.token || !S.me || h === '#/login') { app.innerHTML = loginView(); return bindLogin(); }
  let title = 'منصة النقابة', body = '';
  if (h.startsWith('#/dash')) {
    title = 'لوحة القيادة'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const want = can('reports.view') || can('finance.view');
    const [rep, fin] = await Promise.all([want ? call('REP_OVERVIEW', { year: String(new Date().getFullYear()) }) : null,
      can('finance.view') ? call('FIN_SUMMARY', {}) : null, refreshNtf()]);
    S.dash = { rep: rep && rep.success ? rep.report : null, fin: fin && fin.success ? fin : null }; body = dashView();
  }
  else if (h.startsWith('#/home')) {
    title = 'أنشطتي';
    if (S.me.profile && (!S.mySumAt || Date.now() - S.mySumAt > 60000)) {
      const [bn, bk, gr] = await Promise.all([call('BEN_MY'), call('ACT_MY_BOOKINGS'), call('GRT_MY')]);
      const open = st => !/ملغ|مرفوض|منته|مصروف|مقفل|معتذر/.test(st || '');
      S.mySum = { ben: bn.success ? bn.benefits.total : 0, bk: bk.success ? bk.items.filter(x => open(x.status)).length : 0,
        grt: gr.success ? gr.items.filter(x => open(x.status)).length : 0, fam: (S.me.profile.family || []).length }; S.mySumAt = Date.now();
    }
    if (!S.newsAt || Date.now() - S.newsAt > 60000) { const r = await call('NEWS_LIST', { limit: 3 }); S.homeNews = r.success ? r.items : []; S.newsAt = Date.now(); }
    body = S.me.profile ? homeView() : '<div class="empty">الحساب مش مربوط بملف عضو</div>';
  }
  else if (h.startsWith('#/news')) {
    title = 'أخبار النقابة'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('NEWS_LIST', { all: true, limit: 50 }); S.news = r.success ? r.items : []; S.newsManage = r.canManage; body = newsView();
  }
  else if (h.startsWith('#/profile')) { title = 'ملفي'; body = profileBody(S.me.profile, false); }
  else if (h.startsWith('#/family')) { title = 'أسرتي'; body = familyView(S.me.profile, false); }
  else if (h.startsWith('#/account')) { title = 'حسابي'; body = accountView(); }
  else if (h.startsWith('#/admin')) { title = 'الأعضاء'; body = adminView(); }
  else if (h.startsWith('#/person/')) {
    title = 'ملف عضو'; const id = h.split('/')[2];
    if (!S.person || S.person.person.id !== id) {
      app.innerHTML = shell(title, '<div class="spin"></div>');
      const r = await call('GET_PERSON', { id }); if (!r.success) return toast(r.message, true);
      S.person = r.profile; S.personBen = null;
      if (can('benefits.view')) { const b = await call('BEN_PERSON', { personId: id }); S.personBen = b.success ? b.benefits : null; }
    }
    body = personView() + (S.personBen ? benefitsBody(S.personBen, '🎁 ما استفاد به من النقابة') : '');
  }
  else if (h.startsWith('#/requests')) {
    title = 'طلبات التعديل'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('LIST_CHANGE_REQUESTS'); S.requests = r.success ? r.items : []; body = requestsView();
  }
  else if (h.startsWith('#/lists')) { title = 'القوائم'; body = listsView(); }
  else if (h.startsWith('#/trips')) {
    title = 'الرحلات والفعاليات'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('ACT_LIST'); S.acts = r.success ? r.items : []; body = tripsView();
  }
  else if (h.startsWith('#/trip/')) {
    title = 'الرحلة'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('ACT_GET', { activityId: h.split('/')[2] }); if (!r.success) return toast(r.message, true);
    S.trip = r.activity; body = tripView();
  }
  else if (h.startsWith('#/mytrips')) {
    title = 'حجوزاتي'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('ACT_MY_BOOKINGS'); S.myBk = r.success ? r.items : []; body = myTripsView();
  }
  else if (h.startsWith('#/actadmin/')) {
    title = 'إدارة النشاط'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const id = h.split('/')[2];
    const [g, b] = await Promise.all([call('ACT_GET', { activityId: id }), call('ACT_BOOKINGS', { activityId: id })]);
    if (!g.success) return toast(g.message, true); if (!b.success) return toast(b.message, true);
    S.trip = g.activity; S.actBk = b.items; S.actSum = b.summary; body = actAdminView();
  }
  else if (h.startsWith('#/notifications')) {
    title = 'الإشعارات'; app.innerHTML = shell(title, '<div class="spin"></div>');
    await refreshNtf(); body = notificationsView();
    if (+(S.ntf || {}).unread) { await call('NTF_READ'); S.ntf.unread = 0; S.ntfCount = (S.ntf.tasks || []).reduce((a, t) => a + +t.count, 0); }
  }
  else if (h.startsWith('#/reports')) {
    title = 'التقارير الشاملة'; app.innerHTML = shell(title, '<div class="spin"></div>');
    if (S.repYear === undefined) S.repYear = String(new Date().getFullYear());
    const r = await call('REP_OVERVIEW', { year: S.repYear }); if (!r.success) return toast(r.message, true);
    S.rep = r.report; body = reportsView();
  }
  else if (h.startsWith('#/devadmin')) {
    title = 'عروض الأجهزة والعمرة'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const o = await call('DEV_OFFERS'); S.devOffers = o.success ? o.items : [];
    if (S.devOffer) { const r = await call('DEV_ORDERS', { offerId: S.devOffer.id }); S.devOrders = r.success ? r.items : []; }
    body = devAdminView();
  }
  else if (h.startsWith('#/devices') || h.startsWith('#/umrah')) {
    S.devPage = h.startsWith('#/umrah') ? 'umrah' : 'devices';
    title = S.devPage === 'umrah' ? 'العمرة والحج' : 'أجهزة بالتقسيط'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const o = await call('DEV_OFFERS');
    S.devOffers = o.success ? o.items : []; body = devicesView();
  }
  else if (h.startsWith('#/grantsadmin')) {
    title = 'طلبات المنح'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const [t, l] = await Promise.all([call('GRT_TYPES'), call('GRT_LIST', S.grtF || {})]);
    if (!l.success) return toast(l.message, true);
    S.grtTypes = t.success ? t.items : []; S.grtList = l.items; S.grtCounts = l.counts || {}; body = grantsAdminView();
  }
  else if (h.startsWith('#/grants')) {
    title = 'المنح والمناسبات'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const [t, m] = await Promise.all([call('GRT_TYPES'), call('GRT_MY')]);
    S.grtTypes = t.success ? t.items : []; S.grtElig = t.eligibleToday; S.grtMy = m.success ? m.items : []; body = grantsView();
  }
  else if (h.startsWith('#/summer')) {
    title = 'المصايف'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('SUM_LIST'); S.seasons = r.success ? r.items : []; body = summerListView();
  }
  else if (h.startsWith('#/season/')) {
    title = 'المصيف'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('SUM_GET', { seasonId: h.split('/')[2] }); if (!r.success) return toast(r.message, true);
    S.season = r.season; body = seasonView();
  }
  else if (h.startsWith('#/sumadmin/')) {
    title = 'إدارة المصيف'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const id = h.split('/')[2];
    const [g, b] = await Promise.all([call('SUM_GET', { seasonId: id }), call('SUM_APPS', { seasonId: id })]);
    if (!g.success) return toast(g.message, true); if (!b.success) return toast(b.message, true);
    S.season = g.season; S.sumApps = b.items; S.sumSum = b.summary; S.sumSwaps = b.swaps; body = sumAdminView();
  }
  else if (h.startsWith('#/mybenefits')) {
    title = 'استفاداتي'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('BEN_MY'); if (!r.success) return toast(r.message, true);
    body = benefitsBody(r.benefits, '🎁 كل ما استفدت به من النقابة');
  }
  else if (h.startsWith('#/benefits')) {
    title = 'سجل المزايا'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('BEN_REPORT', { year: S.benYear || '' }); if (!r.success) return toast(r.message, true);
    S.benRep = r; body = benefitsReportView();
  }
  else if (['#/finance', '#/cheques', '#/cheque/', '#/receipts', '#/trial', '#/ledger/', '#/entries'].some(x => h.startsWith(x))) {
    title = 'المالية'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const P = S.finP || {};
    if (h.startsWith('#/finance')) { const r = await call('FIN_SUMMARY', P); if (!r.success) return toast(r.message, true); S.fin = r; body = finSummaryView(); }
    else if (h.startsWith('#/cheques')) { const r = await call('FIN_CHEQUES', { from: '2000-01-01', ...(S.chqF || {}) }); S.cheques = r.success ? r.items : []; body = chequesView(); }
    else if (h.startsWith('#/cheque/')) { const r = await call('FIN_CHEQUE', { id: h.split('/')[2] }); if (!r.success) return toast(r.message, true); S.cheque = r.cheque; body = chequeView(); }
    else if (h.startsWith('#/receipts')) { const r = await call('FIN_RECEIPTS', { from: '2000-01-01', ...P }); S.receipts = r.success ? r.items : []; body = receiptsView(); }
    else if (h.startsWith('#/trial')) { const r = await call('FIN_TRIAL_BALANCE', { from: '2000-01-01', ...P }); S.trial = r.success ? r : {}; body = trialView(); }
    else if (h.startsWith('#/ledger/')) { const r = await call('FIN_LEDGER', { account: h.split('/')[2], from: '2000-01-01', ...P }); S.ledger = r.success ? r : {}; body = ledgerView(); }
    else { const r = await call('FIN_ENTRIES', { from: '2000-01-01', ...(S.entF || {}) }); S.entries = r.success ? r.items : []; body = entriesView(); }
  }
  else if (h.startsWith('#/board') || h.startsWith('#/meetings') || h.startsWith('#/meeting/') || h.startsWith('#/decisions')) {
    title = 'المجلس';
    if (!S.gov) { app.innerHTML = shell(title, '<div class="spin"></div>'); await loadGov(); }
    if (h.startsWith('#/board')) body = boardView();
    else if (h.startsWith('#/meetings')) {
      if (!S.meetings) { const r = await call('GOV_LIST_MEETINGS'); S.meetings = r.success ? r.items : []; }
      body = meetingsView();
    } else if (h.startsWith('#/meeting/')) {
      const id = h.split('/')[2];
      if (!S.meeting || S.meeting.id !== id) {
        app.innerHTML = shell(title, '<div class="spin"></div>');
        const r = await call('GOV_GET_MEETING', { id }); if (!r.success) return toast(r.message, true); S.meeting = r.meeting;
      }
      body = meetingView();
    } else {
      if (!S.decisions) { const r = await call('GOV_LIST_DECISIONS', S.decF || {}); S.decisions = r.success ? r.items : []; }
      body = decisionsView();
    }
  }
  else { location.hash = isStaff() ? '#/dash' : '#/home'; return; }
  app.innerHTML = shell(title, body);
  bindPage();
}

// ───────── الأحداث ─────────
function bindPage(gridOnly) {
  const app = $('#app');
  if (!gridOnly) bindGrids();
  app.querySelectorAll('[data-act=logout]').forEach(b => b.onclick = () => { if (confirm('تسجيل الخروج؟')) logout(); });
  const admin = location.hash.startsWith('#/person/');
  const pr = admin ? S.person : S.me.profile;
  const pid = admin ? S.person.person.id : null;
  const on = (act, fn) => app.querySelectorAll(`[data-act=${act}]`).forEach(b => b.onclick = () => fn(b));

  on('editSelf', () => openModal(selfForm(pr.person), () => bindSelfForm(pid)));
  on('addFam', () => openModal(famForm(), () => bindFamForm({}, pid)));
  on('editFam', b => { const m = pr.family.find(x => x.id === b.dataset.id); openModal(famForm(m, !pid), () => bindFamForm(m, pid)); });
  on('request', () => openModal(requestForm(pr.person), () => {
    $('#modal [data-close]').onclick = closeModal;
    $('#rf').onsubmit = async e => { e.preventDefault();
      const r = await busy(e.target.querySelector('[type=submit]'), () => call('REQUEST_CHANGE', formData(e.target)));
      if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
      closeModal(); toast('اتبعت الطلب للمسؤول ✓'); const me = await call('GET_ME'); if (me.success) S.me = me; render(); };
  }));
  on('movement', () => openModal(movementForm(pr), () => {
    $('#modal [data-close]').onclick = closeModal;
    const sync = () => ($('#mfTo').innerHTML = toValueInput($('#mfField').value)); sync(); $('#mfField').onchange = sync;
    $('#mf').onsubmit = async e => { e.preventDefault();
      const r = await busy(e.target.querySelector('[type=submit]'), () => call('ADD_MOVEMENT', { personId: pid, ...formData(e.target) }));
      if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
      closeModal(); toast('اتسجلت الحركة ✓'); S.person = r.profile; render(); };
  }));
  on('editAdmin', () => openModal(adminFieldsForm(pr.person), () => {
    $('#modal [data-close]').onclick = closeModal;
    $('#af').onsubmit = async e => { e.preventDefault();
      const d = formData(e.target), reason = d.reason; delete d.reason;
      const r = await busy(e.target.querySelector('[type=submit]'), () => call('SAVE_PERSON', { id: pid, fields: d, reason }));
      if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
      closeModal(); toast('اتحفظ ✓'); S.person = r.profile; render(); };
  }));

  const gs = $('#gs');
  if (gs) gs.onsubmit = async e => { e.preventDefault(); S.q = formData(gs).q; if (!S.q) return;
    const r = await call('SEARCH_PERSONS', { q: S.q }); S.results = r.success ? r.items : []; if (!r.success) toast(r.message, true);
    if (location.hash.startsWith('#/admin')) render(); else location.hash = '#/admin'; };
  const qs = $('#qs');
  if (qs) qs.onsubmit = async e => { e.preventDefault(); S.q = formData(qs).q;
    const r = await busy(qs.querySelector('button'), () => call('SEARCH_PERSONS', { q: S.q }));
    S.results = r.success ? r.items : []; if (!r.success) toast(r.message, true); render(); };
  app.querySelectorAll('[data-person]').forEach(li => li.onclick = () => { location.hash = '#/person/' + li.dataset.person; });

  on('approve', async b => { const r = await busy(b, () => call('DECIDE_CHANGE_REQUEST', { id: b.dataset.id, approve: true }));
    toast(r.success ? 'اتعتمد ✓' : r.message, !r.success); render(); });
  on('reject', async b => { const note = prompt('سبب الرفض (إجباري):'); if (!note) return;
    const r = await busy(b, () => call('DECIDE_CHANGE_REQUEST', { id: b.dataset.id, approve: false, note }));
    toast(r.success ? 'اترفض' : r.message, !r.success); render(); });

  const lk = $('#lk'); if (lk) lk.onchange = () => { S.listKey = lk.value; render(); };
  const la = $('#la');
  if (la) la.onsubmit = async e => { e.preventDefault();
    const r = await call('SAVE_LIST_ITEM', { listKey: S.listKey || 'workplace', value: formData(la).value });
    if (!r.success) return toast(r.message, true); await loadLists(); render(); };
  on('hideItem', async b => { if (!confirm('إخفاء «' + b.dataset.v + '» من القائمة؟')) return;
    const r = await call('SAVE_LIST_ITEM', { listKey: S.listKey || 'workplace', value: b.dataset.v, active: false });
    if (!r.success) return toast(r.message, true); await loadLists(); render(); });

  // ── المجلس ──
  app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { location.hash = b.dataset.go; });
  app.querySelectorAll('[data-meet]').forEach(li => li.onclick = () => { location.hash = '#/meeting/' + li.dataset.meet; });
  const govDone = r => { S.gov = { ...S.gov, term: r.term || S.gov.term }; closeModal(); toast('اتحفظ ✓'); render(); };
  const govForm = (html, formId, build, action, after) => openModal(html, () => {
    $('#modal [data-close]').onclick = closeModal;
    $(formId).onsubmit = async e => { e.preventDefault();
      const r = await busy(e.target.querySelector('[type=submit]'), () => call(action, build(e.target)));
      if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
      after(r); };
  });
  on('termEdit', () => govForm(termForm(S.gov && S.gov.term || {}), '#tf',
    f => ({ term: { ...formData(f), id: S.gov && S.gov.term ? S.gov.term.id : undefined } }), 'GOV_SAVE_TERM', r => { S.gov = null; closeModal(); toast('اتحفظ ✓'); render(); }));
  on('seatAdd', () => govForm(seatAddForm(), '#saf', f => ({ termId: S.gov.term.id, ...formData(f) }), 'GOV_ADD_SEAT', govDone));
  on('seatEnd', b => { const s = S.gov.term.seats.find(x => x.id === b.dataset.id);
    govForm(seatEndForm(s), '#sef', f => ({ seatId: s.id, ...formData(f) }), 'GOV_END_SEAT', govDone); });
  const meetBuild = (f, id) => ({ termId: S.gov.term.id, meeting: { ...formData(f), id,
    agenda: f.agenda.value.split('\n').map(x => x.trim()).filter(Boolean),
    attendance: [...f.querySelectorAll('[data-att]')].map(s => ({ person_id: s.dataset.att, status: s.value })),
    decisions: [...f.querySelectorAll('[data-dec]')].map(d => ({ text: d.querySelector('[name=d_text]').value.trim(),
      category: d.querySelector('[name=d_category]').value, amount: d.querySelector('[name=d_amount]').value.trim(),
      votes_for: d.querySelector('[name=d_for]').value.trim(), votes_against: d.querySelector('[name=d_against]').value.trim(),
      votes_abstain: d.querySelector('[name=d_abstain]').value.trim(), status: d.querySelector('[name=d_status]').value })).filter(d => d.text) } });
  const meetAfter = r => { S.meeting = r.meeting; S.meetings = null; S.decisions = null; S.gov = null; closeModal(); toast('اتحفظ ✓');
    location.hash = '#/meeting/' + r.meeting.id; render(); };
  const bindDecAdd = () => { const b = $('#modal [data-act=decAdd]'); if (b) b.onclick = () => {
    const box = $('#decs'), n = box.querySelectorAll('[data-dec]').length, tmp = document.createElement('div');
    tmp.innerHTML = decRow({}, n);
    box.appendChild(tmp.firstElementChild); }; };
  on('meetNew', () => { govForm(meetingForm(null), '#mtf', f => meetBuild(f), 'GOV_SAVE_MEETING', meetAfter); bindDecAdd(); });
  on('meetEdit', () => { govForm(meetingForm(S.meeting), '#mtf', f => meetBuild(f, S.meeting.id), 'GOV_SAVE_MEETING', meetAfter); bindDecAdd(); });
  const df = $('#df');
  if (df) df.onsubmit = async e => { e.preventDefault(); S.decF = formData(df);
    const r = await busy(df.querySelector('button'), () => call('GOV_LIST_DECISIONS', S.decF));
    S.decisions = r.success ? r.items : []; render(); };

  // ── الأنشطة ──
  app.querySelectorAll('[data-trip]').forEach(c => c.onclick = () => { location.hash = '#/trip/' + c.dataset.trip; });
  const compRow = () => `<div class="row" data-comp style="margin:4px 0"><input class="input" style="flex:2" name="c_name" placeholder="اسم المرافق">
    <input class="input" style="flex:1" name="c_rel" placeholder="صلته"><input class="input" style="flex:1" name="c_age" inputmode="numeric" placeholder="السن"></div>`;
  on('compAdd', () => { const box = $('#comps'); if (box.querySelectorAll('[data-comp]').length >= S.trip.max_companions) return toast('وصلت للحد الأقصى للمرافقين', true);
    box.insertAdjacentHTML('beforeend', compRow()); });
  const bkf = $('#bkf');
  if (bkf) bkf.onsubmit = async e => { e.preventDefault();
    const people = [...bkf.querySelectorAll('[name=fam]:checked')].map(c => ({ family_member_id: c.value }))
      .concat([...bkf.querySelectorAll('[data-comp]')].map(r => ({ full_name: r.querySelector('[name=c_name]').value.trim(),
        relation: r.querySelector('[name=c_rel]').value.trim() || 'مرافق', age: r.querySelector('[name=c_age]').value.trim() })).filter(x => x.full_name));
    const r = await busy(bkf.querySelector('[type=submit]'), () => call('ACT_BOOK', { activityId: S.trip.id, people }));
    if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    toast(r.booking.status === 'قائمة انتظار' ? 'المقاعد اكتملت — اتسجلت في قائمة الانتظار' : 'اتحجز ✓ ادفع خلال المهلة علشان يتأكد'); render(); };
  on('myCancel', async b => { if (!confirm('متأكد من إلغاء الحجز؟')) return;
    const r = await busy(b, () => call('ACT_CANCEL_MY', { bookingId: b.dataset.id }));
    if (!r.success) return toast(r.message, true); toast(+r.refund ? `اتلغى — هيترد لك ${r.refund} ج` : 'اتلغى الحجز'); render(); });
  const loadDecs = async () => { if (!S.decOpts) { const r = await call('GOV_LIST_DECISIONS'); S.decOpts = r.success ? r.items.filter(d => ['صرف', 'دعم نشاط', 'منحة', 'إعفاء'].includes(d.category)) : []; } };
  const actFormOpen = async a => { await loadDecs();
    openModal(activityForm(a), () => {
      $('#modal [data-close]').onclick = closeModal;
      $('#acf').onsubmit = async e => { e.preventDefault(); const f = e.target, d = formData(f);
        const act = { ...d, id: a && a.id, program: f.program.value.split('\n').map(x => x.trim()).filter(Boolean).map(x => { const m = x.split(' - '); return m.length > 1 ? { time: m[0], text: m.slice(1).join(' - ') } : { text: x }; }),
          cancel_policy: [...f.querySelectorAll('[data-pol]')].map(r => ({ days_before: +r.querySelector('[name=days]').value || 0, refund_pct: +r.querySelector('[name=pct]').value || 0 })) };
        delete act.label; delete act.applies_to; delete act.max_age; delete act.full_price; delete act.member_price; delete act.takes_seat; delete act.days; delete act.pct;
        if (!a || !(S.actBk || []).some(b => b.status !== 'ملغى')) act.prices = [...f.querySelectorAll('[data-pr]')].map(r => ({ label: r.querySelector('[name=label]').value,
          applies_to: r.querySelector('[name=applies_to]').value, max_age: r.querySelector('[name=max_age]').value, full_price: r.querySelector('[name=full_price]').value,
          member_price: r.querySelector('[name=member_price]').value, takes_seat: r.querySelector('[name=takes_seat]').checked })).filter(p => p.label && p.full_price !== '');
        const r = await busy(f.querySelector('[type=submit]'), () => call('ACT_SAVE', { activity: act }));
        if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اتحفظ ✓'); location.hash = '#/actadmin/' + r.activity.id; render(); };
    }); };
  on('actNew', () => actFormOpen(null));
  on('actEdit', () => actFormOpen(S.trip));
  const actDo = async (b, action, extra, msg) => { const r = await busy(b, () => call(action, { activityId: S.trip.id, ...extra }));
    if (!r.success) return toast(r.message, true); toast(msg(r)); render(); };
  on('actStatus', b => actDo(b, 'ACT_SET_STATUS', { status: b.dataset.s }, () => 'اتغيرت الحالة ✓'));
  on('actSeats', b => actDo(b, 'ACT_ASSIGN_SEATS', {}, r => `اتوزعت ${r.seats} كرسي بالأسبقية ✓`));
  on('actClose', b => { if (confirm('إقفال النشاط؟ هيتسجل الدعم للحاضرين وإعفاءات المشرفين في سجل المزايا.'))
    actDo(b, 'ACT_CLOSE', {}, r => `اتقفل ✓ — ${r.result.benefits} ميزة دعم و${r.result.supervisors} إعفاء مشرف`); });
  on('actCancelAll', b => { if (confirm('إلغاء النشاط كله؟ كل المدفوع هيترد بالكامل.')) actDo(b, 'ACT_SET_STATUS', { status: 'ملغى' }, () => 'اتلغى النشاط واترد المدفوع'); });
  on('actSup', b => { const job = prompt('الرقم الوظيفي للمشرف:'); if (!job) return; const pct = prompt('نسبة إعفائه من الاشتراك %', '100');
    actDo(b, 'ACT_SUPERVISOR', { jobId: job, task: 'مشرف', self_exempt_pct: +pct || 0 }, () => 'اتضاف المشرف ✓'); });
  on('bkPay', b => { const amt = prompt('المبلغ المحصّل:', b.dataset.rest); if (!amt) return;
    busy(b, () => call('ACT_PAY', { bookingId: b.dataset.id, amount: amt })).then(r => { if (!r.success) return toast(r.message, true); toast('اتحصّل — إيصال ' + r.receipt_no); render(); }); });
  on('bkCancel', b => { const reason = prompt('سبب الإلغاء (إجباري):'); if (!reason) return;
    busy(b, () => call('ACT_CANCEL', { bookingId: b.dataset.id, reason })).then(r => { if (!r.success) return toast(r.message, true); toast(+r.refund ? 'اتلغى — مردود ' + r.refund : 'اتلغى'); render(); }); });

  // ── المصايف ──
  app.querySelectorAll('[data-season]').forEach(c => c.onclick = () => { location.hash = '#/season/' + c.dataset.season; });
  const sumCall = async (b, action, extra, msg) => { const r = await busy(b, () => call(action, extra));
    if (!r.success) { toast(r.message, true); return null; } if (msg) toast(msg(r)); render(); return r; };
  const saf = $('#saf');
  if (saf) saf.onsubmit = async e => { e.preventDefault();
    const prefs = [...saf.querySelectorAll('[data-pref]')].map(r => ({ batch_id: r.querySelector('[name=batch_id]').value,
      resort_id: r.querySelector('[name=resort_id]').value, unit_type: r.querySelector('[name=unit_type]').value })).filter(p => p.batch_id);
    const fam = [...saf.querySelectorAll('[name=fam]:checked')].map(c => c.value);
    const r = await busy(saf.querySelector('[type=submit]'), () => call('SUM_APPLY', { seasonId: S.season.id, prefs, family_member_ids: fam }));
    if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    toast('اتقدّم الطلب ✓ رقم ' + r.application.app_no); render(); };
  on('sumWithdraw', b => { if (confirm('سحب الطلب؟')) sumCall(b, 'SUM_WITHDRAW', { applicationId: b.dataset.id }, () => 'اتسحب الطلب'); });
  on('sumApolMy', b => { const reason = prompt('سبب الاعتذار:'); if (reason === null) return;
    sumCall(b, 'SUM_APOLOGIZE_MY', { applicationId: b.dataset.id, reason }, r => +r.refund ? `اتسجل الاعتذار — هيترد لك ${r.refund} ج` : 'اتسجل الاعتذار'); });
  const swapForm = (id, admin) => {
    const s = S.season, units = s.resorts.flatMap(r => r.units.filter(u => u.active).map(u => ({ ...u, resort: r.name })));
    openModal(`<h3>طلب تبديل</h3><form id="swf">
      <label class="f"><span>النوع</span><select class="input" name="kind">${options(['تبديل فوج', 'تبديل وحدة', 'تبادل'], 'تبديل فوج', false)}</select></label>
      <label class="f"><span>الفوج المطلوب</span><select class="input" name="batch_id"><option value="">نفس الفوج</option>${s.batches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
      <label class="f"><span>الوحدة المطلوبة (اختياري)</span><select class="input" name="unit_id"><option value="">أي وحدة مناسبة</option>${units.map(u => `<option value="${u.id}">${esc(u.resort)} ${esc(u.code)} (${u.beds})</option>`).join('')}</select></label>
      <label class="f"><span>للتبادل: رقم طلب العضو الآخر (لازم يوافق)</span><input class="input" name="withAppNo" placeholder="مصيف-2027-00012"></label>
      <label class="f"><span>السبب</span><input class="input" name="reason"></label>
      <div id="ferr"></div><div class="acts"><button class="btn" type="submit">إرسال</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`, () => {
      $('#modal [data-close]').onclick = closeModal;
      $('#swf').onsubmit = async e => { e.preventDefault(); const d = formData(e.target);
        const r = await busy(e.target.querySelector('[type=submit]'), () => call(admin ? 'SUM_SWAP_REQUEST' : 'SUM_SWAP_REQUEST_MY', { applicationId: id, ...d }));
        if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast(d.kind === 'تبادل' ? 'اتبعت للعضو الآخر للموافقة ثم الإدارة' : 'اتبعت للإدارة للاعتماد'); render(); };
    }); };
  on('sumSwapMy', b => swapForm(b.dataset.id, false));
  on('sumSwapAdm', b => swapForm(b.dataset.id, true));
  on('swAccept', b => sumCall(b, 'SUM_SWAP_ACCEPT', { swapId: b.dataset.id, accept: b.dataset.v === '1' }, () => b.dataset.v === '1' ? 'وافقت — بانتظار اعتماد الإدارة' : 'اترفض'));
  on('swDecide', b => sumCall(b, 'SUM_SWAP_DECIDE', { swapId: b.dataset.id, approve: b.dataset.v === '1' }, () => b.dataset.v === '1' ? 'اتنفذ التبديل ✓' : 'اترفض'));
  const sumFormOpen = async s => { await loadDecs();
    openModal(seasonForm(s), () => {
      $('#modal [data-close]').onclick = closeModal;
      $('#ssf').onsubmit = async e => { e.preventDefault(); const f = e.target, d = formData(f);
        const season = { id: s && s.id, title: d.title, year: d.year, method: d.method, lookback_years: d.lookback_years, max_prefs: d.max_prefs,
          hold_hours: d.hold_hours, decision_id: d.decision_id, apply_close: d.apply_close ? d.apply_close + 'T23:59:59' : '',
          cancel_policy: [...f.querySelectorAll('[data-pol]')].map(r => ({ days_before: +r.querySelector('[name=days]').value || 0, refund_pct: +r.querySelector('[name=pct]').value || 0 })) };
        const rows = t => t.split('\n').map(x => x.split('|').map(y => y.trim())).filter(x => x[0]);
        if (!f.batches.readOnly) season.batches = rows(f.batches.value).map(x => ({ name: x[0], start_date: x[1], end_date: x[2] }));
        else season.batches = s.batches.map(b => ({ id: b.id, name: b.name, start_date: b.start_date, end_date: b.end_date }));
        const res = {};
        rows(f.units.value).forEach(x => { const k = x[0]; const old = s && s.resorts.find(r => r.name === k);
          res[k] = res[k] || { id: old && old.id, name: k, owner_party: x[1], location: old && old.location, units: [] };
          res[k].units.push({ code: x[2], unit_type: x[3] || 'شقة', beds: x[4], full_price: x[5], member_price: x[6], deposit: x[7] || 0, owner_cost: x[8] || 0 }); });
        season.resorts = Object.values(res);
        const r = await busy(f.querySelector('[type=submit]'), () => call('SUM_SAVE', { season }));
        if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اتحفظ ✓'); location.hash = '#/sumadmin/' + r.season.id; render(); };
    }); };
  on('sumNew', () => sumFormOpen(null));
  on('sumEdit', () => sumFormOpen(S.season));
  const sid = () => ({ seasonId: S.season.id });
  on('sumStatus', b => sumCall(b, 'SUM_SET_STATUS', { ...sid(), status: b.dataset.s }, () => 'اتغيرت الحالة ✓'));
  on('sumAlloc', b => { let seed = '';
    if (S.season.method !== 'أسبقية') { seed = prompt('البذرة المعلنة للقرعة (مثلاً رقم يُسحب علناً أمام الحضور) — تُنشر مع النتيجة ليتحقق منها أي عضو:', S.season.lottery_seed || ''); if (!seed) return; }
    if (!confirm('التوزيع مرة واحدة ولا يُعاد. متأكد؟')) return;
    sumCall(b, 'SUM_ALLOCATE', { ...sid(), seed }, r => `اتوزّع ✓ ${r.result.accepted} مقبول و${r.result.reserve} احتياطي`); });
  on('sumClose', b => { if (confirm('إقفال الموسم؟ الدعم هيتسجل في سجل المزايا ومستحقات الملاك هتتقيد.'))
    sumCall(b, 'SUM_CLOSE', sid(), r => `اتقفل ✓ — ${r.result.benefits} ميزة دعم و${r.result.owner_entries} قيد استحقاق`); });
  on('sumCancelAll', b => { if (confirm('إلغاء الموسم كله؟ كل المدفوع هيترد بالكامل.')) sumCall(b, 'SUM_SET_STATUS', { ...sid(), status: 'ملغى' }, () => 'اتلغى الموسم'); });
  on('sumPay', b => { const amt = prompt('المبلغ المحصّل:', b.dataset.rest); if (!amt) return;
    sumCall(b, 'SUM_PAY', { applicationId: b.dataset.id, amount: amt }, r => 'اتحصّل — إيصال ' + r.receipt_no); });
  on('sumApol', b => { const reason = prompt('سبب الاعتذار (إجباري):'); if (!reason) return;
    sumCall(b, 'SUM_APOLOGIZE', { applicationId: b.dataset.id, reason }, r => +r.refund ? 'اتسجل — مردود ' + r.refund : 'اتسجل الاعتذار'); });
  on('sumHand', b => { const k = b.dataset.k;
    openModal(`<h3>محضر ${k} الوحدة</h3><form id="hof"><label class="f"><span>حالة الوحدة</span><textarea class="input" name="condition" rows="2" placeholder="سليمة / ملاحظات العفش والأجهزة"></textarea></label>
      ${k === 'استلام' ? '<label class="f"><span>قيمة التلفيات (تُخصم من التأمين)</span><input class="input" name="damages" inputmode="decimal" value="0"></label>' : '<div class="muted">هيتحصّل التأمين بإيصال ويُرد عند الاستلام.</div>'}
      <label class="f"><span>ملاحظات</span><input class="input" name="notes"></label>
      <div id="ferr"></div><div class="acts"><button class="btn" type="submit">تسجيل</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`, () => {
      $('#modal [data-close]').onclick = closeModal;
      $('#hof').onsubmit = async e => { e.preventDefault();
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('SUM_HANDOVER', { applicationId: b.dataset.id, kind: k, ...formData(e.target) }));
        if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); const x = r.result;
        toast(k === 'تسليم' ? (+x.deposit ? `اتسلّمت — تأمين ${x.deposit} إيصال ${x.receipt_no}` : 'اتسلّمت ✓') : `اتسلّمت — خصم ${x.deducted} ورد ${x.returned}${+x.uncovered ? ' · غير مغطى ' + x.uncovered : ''}`); render(); };
    }); });

  // ── المنح ──
  const gaf = $('#gaf');
  if (gaf) {
    const sync = () => { const t = (S.grtTypes || []).find(x => x.code === gaf.type.value);
      $('#gother').hidden = gaf.who.value !== 'other';
      $('#gdocs').textContent = t && t.docs.length ? 'المستندات المطلوبة: ' + t.docs.join('، ') + (t.deadline_days ? ` — خلال ${t.deadline_days} يوم من الواقعة` : '') : ''; };
    gaf.onchange = sync; sync();
    gaf.onsubmit = async e => { e.preventDefault(); const d = formData(gaf);
      const p = { type: d.type, event_date: d.event_date, notes: d.notes };
      if (d.who === 'other') Object.assign(p, { subject_name: d.subject_name, subject_relation: d.subject_relation });
      else if (d.who !== 'self') p.family_member_id = d.who;
      const r = await busy(gaf.querySelector('[type=submit]'), () => call('GRT_APPLY', p));
      if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
      toast('اتقدّم الطلب ✓ رقم ' + r.request.req_no); render(); };
  }
  app.querySelectorAll('[data-gst]').forEach(b => b.onclick = () => { S.grtF = { status: b.dataset.gst || undefined }; render(); });
  const grtDo = async (b, action, extra, msg) => { const r = await busy(b, () => call(action, extra)); if (!r.success) return toast(r.message, true); toast(msg); render(); };
  on('grtCancel', b => { if (confirm('إلغاء الطلب؟')) grtDo(b, 'GRT_CANCEL_MY', { requestId: b.dataset.id }, 'اتلغى الطلب'); });
  app.querySelectorAll('form[data-docs]').forEach(f => f.onsubmit = e => { e.preventDefault();
    const g = S.grtList.find(x => x.id === f.dataset.docs);
    const docs = g.docs.map((d, i) => ({ ...d, received: f.querySelector(`[name=d${i}]`).checked }));
    grtDo(f.querySelector('button'), 'GRT_REVIEW', { requestId: g.id, docs }, 'اتحفظت المراجعة ✓'); });
  on('grtApprove', async b => { await loadDecs();
    openModal(`<h3>اعتماد المنحة</h3><form id="gdf"><label class="f"><span>المبلغ</span><input class="input" name="amount" inputmode="decimal" value="${esc(b.dataset.amt)}"></label>
      <label class="f"><span>استثناء: موافقة رئيس المجلس (لو المبلغ غير المقرر)</span><input class="input" name="exception_note" placeholder="مثلاً: موافقة رئيس المجلس بتاريخ …"></label>
      <label class="f"><span>أو قرار المجلس</span><select class="input" name="decision_id"><option value="">—</option>${(S.decOpts || []).map(d => `<option value="${d.id}">${esc(d.decision_no)} — ${esc(d.text.slice(0, 50))}</option>`).join('')}</select></label>
      <div id="ferr"></div><div class="acts"><button class="btn" type="submit">اعتماد</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`, () => {
      $('#modal [data-close]').onclick = closeModal;
      $('#gdf').onsubmit = async e => { e.preventDefault();
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('GRT_DECIDE', { requestId: b.dataset.id, approve: true, ...formData(e.target) }));
        if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اتعتمد ✓ — جاهز للصرف من أمين الصندوق'); render(); }; }); });
  on('grtReject', b => { const reason = prompt('سبب الرفض (إجباري):'); if (!reason) return; grtDo(b, 'GRT_DECIDE', { requestId: b.dataset.id, approve: false, reason }, 'اترفض'); });
  on('grtPay', b => { const no = prompt('رقم الشيك:'); if (no === null) return;
    grtDo(b, 'GRT_PAY', { requestId: b.dataset.id, cheque_no: no }, 'اتصرف الشيك ✓ واتسجل في المزايا'); });
  on('grtProxy', () => { openModal(`<h3>طلب نيابة عن عضو</h3><form id="gpf"><label class="f"><span>الرقم الوظيفي</span><input class="input" name="jobId" required></label>
      <label class="f"><span>النوع</span><select class="input" name="type">${(S.grtTypes || []).map(t => `<option value="${t.code}">${esc(t.name)}</option>`).join('')}</select></label>
      <label class="f"><span>تاريخ الواقعة</span><input class="input" type="date" name="event_date" required></label>
      <div class="grid2"><input class="input" name="subject_name" placeholder="اسم المستفيد/المتوفى (فارغ = العضو)"><select class="input" name="subject_relation">${options(['العضو', 'أب', 'أم', 'زوج', 'زوجة', 'ابن', 'ابنة'], 'العضو', false)}</select></div>
      <div id="ferr"></div><div class="acts"><button class="btn" type="submit">تقديم</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`, () => {
      $('#modal [data-close]').onclick = closeModal;
      $('#gpf').onsubmit = async e => { e.preventDefault();
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('GRT_APPLY', formData(e.target)));
        if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اتسجل الطلب ' + r.request.req_no); render(); }; }); });
  on('grtRate', async b => { await loadDecs();
    openModal(`<h3>تعديل مبلغ منحة</h3><form id="grf"><label class="f"><span>النوع</span><select class="input" name="type">${(S.grtTypes || []).map(t => `<option value="${t.code}">${esc(t.name)}</option>`).join('')}</select></label>
      <div class="grid2"><label class="f"><span>المبلغ</span><input class="input" name="amount" inputmode="decimal" required></label>
        <label class="f"><span>لصلة معينة (اختياري)</span><select class="input" name="relation"><option value="">الكل</option>${options(['العضو', 'أب', 'أم', 'زوج', 'زوجة', 'ابن', 'ابنة'], '', false)}</select></label></div>
      <div class="grid2"><label class="f"><span>يسري من</span><input class="input" type="date" name="valid_from"></label>
        <label class="f"><span>القرار</span><select class="input" name="decision_id"><option value="">—</option>${(S.decOpts || []).map(d => `<option value="${d.id}">${esc(d.decision_no)}</option>`).join('')}</select></label></div>
      <div id="ferr"></div><div class="acts"><button class="btn" type="submit">حفظ</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`, () => {
      $('#modal [data-close]').onclick = closeModal;
      $('#grf').onsubmit = async e => { e.preventDefault();
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('GRT_SET_RATE', formData(e.target)));
        if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اتحفظ المبلغ ✓'); render(); }; }); });

  // ── الأجهزة ──
  const devDo = async (b, action, extra, msg) => { const r = await busy(b, () => call(action, extra)); if (!r.success) return toast(r.message, true); toast(msg); render(); };
  app.querySelectorAll('form[data-devorder]').forEach(f => f.onsubmit = e => { e.preventDefault();
    devDo(f.querySelector('button'), 'DEV_ORDER', { itemId: f.dataset.devorder, ...formData(f) }, 'اتسجل الحجز ✓ — المسئول هيأكد معاك'); });
  on('devCancel', b => { if (confirm('إلغاء الحجز؟')) devDo(b, 'DEV_CANCEL_MY', { orderId: b.dataset.id }, 'اتلغى'); });
  const reloadOrders = async () => { if (S.devOffer) { const r = await call('DEV_ORDERS', { offerId: S.devOffer.id }); S.devOrders = r.success ? r.items : []; } };
  on('devOrders', async b => { S.devOffer = S.devOffers.find(o => o.id === b.dataset.id); await reloadOrders(); render(); });
  const devFormOpen = o => openModal(devOfferForm(o), () => {
    $('#modal [data-close]').onclick = closeModal;
    $('#dof').onsubmit = async e => { e.preventDefault(); const d = formData(e.target);
      const items = d.items.split('\n').map(x => x.split('|').map(y => y.trim())).filter(x => x[0]).map(x => ({ name: x[0], offer_price: x[1], market_price: x[2],
        max_months: x[3], stock: x[4], notes: x[5] }));
      const r = await busy(e.target.querySelector('[type=submit]'), () => call('DEV_SAVE', { offer: { ...d, id: o && o.id, items } }));
      if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
      closeModal(); toast('اتحفظ ✓'); render(); }; });
  on('devNew', () => devFormOpen(null));
  on('devEdit', b => devFormOpen(S.devOffers.find(o => o.id === b.dataset.id)));
  on('devStatus', b => devDo(b, 'DEV_SET_STATUS', { offerId: b.dataset.id, status: b.dataset.s }, 'اتغيرت الحالة ✓'));
  on('devDecide', async b => { let reason = '';
    if (b.dataset.s === 'مرفوض') { reason = prompt('السبب (إجباري):'); if (!reason) return; }
    const r = await busy(b, () => call('DEV_DECIDE', { orderId: b.dataset.id, status: b.dataset.s, reason }));
    if (!r.success) return toast(r.message, true); toast('اتحدّث ✓'); await reloadOrders(); render(); });

  // ── التقارير ──
  const repf = $('#repf');
  if (repf) repf.onsubmit = e => { e.preventDefault(); S.repYear = repf.year.value; render(); };
  on('repPrint', () => window.print());

  on('install', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); });
  // ── الأخبار ──
  const newsOpen = n => openModal(newsForm(n), () => {
    $('#modal [data-close]').onclick = closeModal;
    $('#nwf').onsubmit = async e => { e.preventDefault();
      const r = await busy(e.target.querySelector('[type=submit]'), () => call('NEWS_SAVE', { news: { ...formData(e.target), id: n && n.id } }));
      if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
      closeModal(); S.newsAt = 0; toast(n ? 'اتحفظ ✓' : 'اتنشر ✓ ووصل إشعار للأعضاء'); render(); }; });
  on('newsNew', () => newsOpen(null));
  on('newsEdit', b => newsOpen(S.news.find(x => x.id === b.dataset.id)));
  on('newsHide', b => busy(b, () => call('NEWS_HIDE', { id: b.dataset.id, show: b.dataset.show === '1' })).then(r => { if (!r.success) return toast(r.message, true); S.newsAt = 0; render(); }));

  // ── المزايا ──
  const byf = $('#byf');
  if (byf) byf.onsubmit = e => { e.preventDefault(); S.benYear = formData(byf).year; render(); };

  // ── المالية ──
  app.querySelectorAll('[data-chq]').forEach(li => li.onclick = () => { location.hash = '#/cheque/' + li.dataset.chq; });
  app.querySelectorAll('[data-ledger]').forEach(li => li.onclick = () => { location.hash = '#/ledger/' + li.dataset.ledger; });
  app.querySelectorAll('[data-entry]').forEach(li => li.onclick = async ev => { ev.stopPropagation();
    const r = await call('FIN_ENTRY', { id: li.dataset.entry }); if (!r.success || !r.entry) return toast(r.message || 'غير موجود', true);
    openModal(entryModal(r.entry), () => {
      $('#modal [data-close]').onclick = closeModal;
      const rv = $('#modal [data-act=revEntry]');
      if (rv) rv.onclick = async () => { const reason = prompt('سبب القيد العكسي (إجباري):'); if (!reason) return;
        const x = await busy(rv, () => call('FIN_REVERSE', { id: r.entry.id, reason }));
        if (!x.success) return toast(x.message, true); closeModal(); toast('اتعمل قيد عكسي ✓'); render(); };
    }); });
  const pf = $('#pf');
  if (pf) pf.onsubmit = e => { e.preventDefault(); S.finP = formData(pf); render(); };
  const cf = $('#cf');
  if (cf) cf.onsubmit = e => { e.preventDefault(); S.chqF = formData(cf); render(); };
  const ef = $('#ef');
  if (ef) ef.onsubmit = e => { e.preventDefault(); S.entF = formData(ef); render(); };
  const finForm = (html, id, build, action, msg, after) => openModal(html, () => {
    $('#modal [data-close]').onclick = closeModal;
    $(id).onsubmit = async e => { e.preventDefault();
      const r = await busy(e.target.querySelector('[type=submit]'), () => call(action, build(e.target)));
      if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
      closeModal(); toast(msg); after ? after(r) : render(); };
  });
  on('chqNew', async () => {
    if (!S.accounts) { const r = await call('FIN_ACCOUNTS'); S.accounts = r.success ? r.items : []; }
    if (!S.decOpts) { const r = await call('GOV_LIST_DECISIONS'); S.decOpts = r.success ? r.items.filter(d => ['صرف', 'دعم نشاط', 'منحة', 'إعفاء'].includes(d.category)) : []; }
    finForm(chequeForm(), '#chf', f => formData(f), 'FIN_ISSUE_CHEQUE', 'اتصرف الشيك واترحّل القيد ✓', r => { location.hash = '#/cheque/' + r.id; });
    const sync = () => { $('#chAcc').style.display = $('#chPurpose').value === 'عهدة' ? 'none' : ''; }; sync(); $('#chPurpose').onchange = sync;
  });
  on('rcptNew', () => finForm(receiptForm(), '#rcf', f => formData(f), 'FIN_RECEIPT', 'اتسجّل واترحّل القيد ✓',
    r => { toast('رقم الإيصال: ' + r.receipt_no); location.hash = '#/receipts'; render(); }));
  on('settleNew', () => {
    const c = S.cheque;
    finForm(settleForm(c), '#stf', f => ({ cheque_id: c.id, date: f.date.value, subscriptions: f.subscriptions.value, returned: f.returned.value,
      return_mode: f.return_mode.value, lines: [...f.querySelectorAll('[data-sl]')].map(r => ({ category: r.querySelector('[name=cat]').value,
        amount: r.querySelector('[name=amt]').value.trim(), notes: r.querySelector('[name=note]').value.trim() })).filter(l => +l.amount > 0) }),
      'FIN_SETTLE', 'اتسوّت العهدة ✓', () => render());
    const calc = () => { const f = $('#stf'); const spent = [...f.querySelectorAll('[name=amt]')].reduce((a, i) => a + (+i.value || 0), 0);
      const left = +c.amount + (+f.subscriptions.value || 0) - spent - (+f.returned.value || 0);
      $('#stCalc').innerHTML = `المصروف ${money(spent)} · المتبقي ${money(left)}${Math.abs(left) > 0.005 ? (left > 0 ? ' — رد أو ورّد أو رحّل' : ' — عجز يلزمه قرار') : ' ✓'}`; };
    $('#stf').addEventListener('input', calc); calc();
    $('#modal [data-act=slAdd]').onclick = () => { const box = $('#sls'), t = document.createElement('div'); t.innerHTML = box.firstElementChild.outerHTML;
      t.firstElementChild.querySelectorAll('input').forEach(i => (i.value = '')); box.appendChild(t.firstElementChild); };
  });

  const pw = $('#pw');
  if (pw) pw.onsubmit = async e => { e.preventDefault();
    const r = await busy(pw.querySelector('button'), () => call('CHANGE_PASSWORD', formData(pw)));
    if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    toast('اتغيرت كلمة المرور ✓'); S.me.mustChange = false; location.hash = '#/admin'; };
}

window.addEventListener('hashchange', render);
boot();
window.__erp = { S, call };   // للاختبار الآلي
})();
