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
    location.hash = member ? '#/home' : '#/admin'; await boot();
  };
}

// ───────── الهيكل ─────────
function shell(title, body) {
  const me = S.me, p = me && me.profile && me.profile.person;
  const name = p ? p.full_name : (me && me.username) || '';
  const h = location.hash;
  const nav = isStaff()
    ? [['#/admin', '👥', 'الأعضاء', can('profile.view')], ['#/requests', '📝', 'الطلبات', can('profile.change.approve')],
       ['#/lists', '🗂️', 'القوائم', can('lists.manage')], ['#/account', '⚙️', 'حسابي', true]]
    : [['#/home', '🏠', 'أنشطتي', true], ['#/profile', '🪪', 'ملفي', true], ['#/family', '👨‍👩‍👧', 'أسرتي', true], ['#/account', '⚙️', 'حسابي', true]];
  return `<div class="top"><img src="img/logo-union.png" alt=""><div class="t"><b>${esc(title)}</b><small>${esc(name)}</small></div>
      <button data-act="logout">خروج</button></div>
    <div class="wrap">${body}</div>
    <nav class="nav">${nav.filter(n => n[3]).map(n => `<a href="${n[0]}" class="${h.startsWith(n[0]) ? 'on' : ''}"><i>${n[1]}</i>${n[2]}</a>`).join('')}</nav>`;
}

// ───────── أنشطتي ─────────
function homeView() {
  const pr = S.me.profile, p = pr.person, c = pr.completeness;
  const elig = pr.eligibleToday;
  const tiles = [
    { i: '📚', b: 'الكتب الخارجية', s: 'احجز كتب ولادك بالتقسيط', href: C.BOOKS_URL },
    { i: '🚌', b: 'الرحلات', s: 'قريباً', soon: true },
    { i: '🏖️', b: 'المصايف', s: 'قريباً', soon: true },
    { i: '🎁', b: 'المنح والمناسبات', s: elig ? 'قريباً' : 'لأعضاء النقابة العامة', soon: true },
    { i: '📱', b: 'أجهزة بالتقسيط', s: 'قريباً', soon: true },
    { i: '🌙', b: 'الإفطار والفعاليات', s: 'قريباً', soon: true },
  ];
  return `<div class="card"><h2>أهلاً ${esc((p.full_name || '').split(' ')[0])} 👋</h2>
      <div class="row"><span class="pill ${elig ? 'ok' : 'warn'}">${elig ? 'عضو النقابة العامة — مستحق الدعم' : esc(p.union_org || 'التنظيم غير محدد')}</span>
      ${p.member_state ? `<span class="pill">${esc(p.member_state)}</span>` : ''}</div></div>
    ${c.percent < 100 ? `<a class="card" style="display:block;text-decoration:none;color:inherit" href="#/profile">
      <h2>ملفك مكتمل ${c.percent}%<span class="sp"></span><span class="pill warn">كمّله</span></h2>
      <div class="prog"><div style="width:${c.percent}%"></div></div>
      <div class="muted">ناقص: ${c.missing.map(esc).join('، ')}</div></a>` : ''}
    <div class="tiles">${tiles.map(t => t.soon
      ? `<div class="tile soon"><i>${t.i}</i><b>${t.b}</b><small>${esc(t.s)}</small></div>`
      : `<a class="tile" href="${esc(t.href)}" target="_blank" rel="noopener"><i>${t.i}</i><b>${t.b}</b><small>${esc(t.s)}</small></a>`).join('')}</div>`;
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
      <div class="muted">من ${esc(x.effective_date)}${d != null ? ' · ' + durTxt(d) : ''}${x.decision_ref ? ' · قرار ' + esc(x.decision_ref) : ''}</div></div>`;
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
    <div class="card list" id="res">${(S.results || []).map(x => `<div class="li" data-person="${x.id}">
      <div class="nm"><b>${esc(x.full_name)}</b><span class="muted">${esc(x.job_id || '')} · ${esc(x.workplace || '—')} · ${esc(x.job_title || '—')}</span></div>
      <span class="pill ${x.union_org === 'النقابة العامة' ? 'ok' : 'warn'}">${esc(x.union_org || '؟')}</span></div>`).join('')
      || '<div class="empty">ابحث عن عضو</div>'}</div>`;
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

// ───────── الموجّه ─────────
async function loadLists() { const r = await call('GET_LISTS'); if (r.success) S.lists = r.lists || {}; }
async function boot() {
  if (!S.token) { location.hash = '#/login'; return render(); }
  const r = await call('GET_ME');
  if (!r.success) return;
  S.me = r; await loadLists();
  if (isStaff() && r.mustChange) location.hash = '#/account';
  else if (!location.hash || location.hash === '#/login') location.hash = isStaff() ? '#/admin' : '#/home';
  render();
}
async function render() {
  const app = $('#app'), h = location.hash || '#/login';
  if (!S.token || !S.me || h === '#/login') { app.innerHTML = loginView(); return bindLogin(); }
  let title = 'منصة النقابة', body = '';
  if (h.startsWith('#/home')) { title = 'أنشطتي'; body = S.me.profile ? homeView() : '<div class="empty">الحساب مش مربوط بملف عضو</div>'; }
  else if (h.startsWith('#/profile')) { title = 'ملفي'; body = profileBody(S.me.profile, false); }
  else if (h.startsWith('#/family')) { title = 'أسرتي'; body = familyView(S.me.profile, false); }
  else if (h.startsWith('#/account')) { title = 'حسابي'; body = accountView(); }
  else if (h.startsWith('#/admin')) { title = 'الأعضاء'; body = adminView(); }
  else if (h.startsWith('#/person/')) {
    title = 'ملف عضو'; const id = h.split('/')[2];
    if (!S.person || S.person.person.id !== id) {
      app.innerHTML = shell(title, '<div class="spin"></div>');
      const r = await call('GET_PERSON', { id }); if (!r.success) return toast(r.message, true);
      S.person = r.profile;
    }
    body = personView();
  }
  else if (h.startsWith('#/requests')) {
    title = 'طلبات التعديل'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('LIST_CHANGE_REQUESTS'); S.requests = r.success ? r.items : []; body = requestsView();
  }
  else if (h.startsWith('#/lists')) { title = 'القوائم'; body = listsView(); }
  else { location.hash = isStaff() ? '#/admin' : '#/home'; return; }
  app.innerHTML = shell(title, body);
  bindPage();
}

// ───────── الأحداث ─────────
function bindPage() {
  const app = $('#app');
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
