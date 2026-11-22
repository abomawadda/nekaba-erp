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
    location.hash = member ? '#/home' : '#/admin'; await boot();
  };
}

// ───────── الهيكل ─────────
function shell(title, body) {
  const me = S.me, p = me && me.profile && me.profile.person;
  const name = p ? p.full_name : (me && me.username) || '';
  const h = location.hash;
  const gov = can('governance.view') || can('governance.manage');
  const nav = isStaff()
    ? [['#/admin', '👥', 'الأعضاء', can('profile.view')], ['#/board', '🏛️', 'المجلس', gov], ['#/finance', '💰', 'المالية', can('finance.view')],
       ['#/requests', '📝', 'الطلبات', can('profile.change.approve')],
       ['#/lists', '🗂️', 'القوائم', can('lists.manage')], ['#/account', '⚙️', 'حسابي', true]]
    : [['#/home', '🏠', 'أنشطتي', true], ['#/profile', '🪪', 'ملفي', true], ['#/family', '👨‍👩‍👧', 'أسرتي', true],
       ['#/board', '🏛️', 'المجلس', gov], ['#/finance', '💰', 'المالية', can('finance.view')], ['#/account', '⚙️', 'حسابي', true]];
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
  <div class="card list">${(S.cheques || []).map(c => `<div class="li" data-chq="${c.id}"><div class="nm"><b>${esc(c.payee_name)}</b>
      <span class="muted">${dt(c.issue_date)} · ${esc(c.purpose)}${c.cheque_no ? ' · شيك ' + esc(c.cheque_no) : ''}${c.decision_no ? ' · قرار ' + esc(c.decision_no) : ''}</span></div>
      <div style="text-align:left"><b>${money(c.amount)}</b><br>${stPill(c.status)}</div></div>`).join('') || '<div class="empty">لا شيكات</div>'}</div>`;
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
  <div class="card list">${(S.receipts || []).map(r => `<div class="li" ${r.entry_id ? `data-entry="${r.entry_id}"` : ''}><div class="nm"><b>${esc(r.kind)}${r.party ? ' — ' + esc(r.party) : ''}</b>
      <span class="muted">${dt(r.receipt_date)} · ${esc(r.receipt_no)}</span></div><b>${money(r.amount)}</b></div>`).join('') || '<div class="empty">لا مقبوضات في الفترة</div>'}</div>`;
}
function trialView() {
  const t = S.trial || {}, items = t.items || [];
  const sum = k => items.reduce((a, x) => a + Number(x[k] || 0), 0);
  return finTabs('#/trial') + `<div class="card">${periodForm(S.finP || { from: t.from, to: t.to })}</div>
  <div class="card"><h2>⚖️ ميزان المراجعة</h2>
    ${items.map(x => `<div class="kv" style="cursor:pointer" data-ledger="${x.code}"><span><b>${esc(x.code)}</b> ${esc(x.name)}</span>
      <span>${money(x.closing)}</span></div>`).join('') || '<div class="empty">لا حركة</div>'}
    <div class="kv"><span><b>مدين الفترة / دائن الفترة</b></span><span>${money(sum('debit'))} / ${money(sum('credit'))}</span></div>
    <div class="alert ${Math.abs(sum('debit') - sum('credit')) < 0.005 ? 'ok' : 'bad'}" style="margin-top:8px">${Math.abs(sum('debit') - sum('credit')) < 0.005 ? 'الميزان متوازن ✓' : 'الميزان غير متوازن!'}</div></div>`;
}
function ledgerView() {
  const l = S.ledger || {}; let bal = Number(l.opening || 0);
  return `<a href="#/trial" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ الميزان</a>
  <div class="card"><h2>📒 ${esc(l.account ? l.account.code + ' — ' + l.account.name : '')}</h2>${kvh('رصيد أول المدة', money(l.opening))}</div>
  <div class="card list">${(l.items || []).map(x => { bal += Number(x.debit) - Number(x.credit);
    return `<div class="li" data-entry="${x.entry_id}"><div class="nm"><b>${esc(x.description)}</b>
      <span class="muted">${dt(x.date)} · ${esc(x.entry_no)}${x.party ? ' · ' + esc(x.party) : ''}${x.status === 'معكوس' ? ' · معكوس' : ''}</span></div>
      <div style="text-align:left">${+x.debit ? '<span class="pill ok">مدين</span> ' + money(x.debit) : '<span class="pill warn">دائن</span> ' + money(x.credit)}<br><small class="muted">رصيد ${money(bal)}</small></div></div>`; }).join('')
    || '<div class="empty">لا حركة</div>'}</div>`;
}
function entriesView() {
  return finTabs('#/entries') + `<div class="card"><form id="ef" class="row"><input class="input" style="flex:1" name="q" value="${esc((S.entF || {}).q || '')}" placeholder="بحث في البيان أو رقم القيد"><button class="btn">بحث</button></form></div>
  <div class="card list">${(S.entries || []).map(e => `<div class="li" data-entry="${e.id}"><div class="nm"><b>${esc(e.description)}</b>
    <span class="muted">${dt(e.entry_date)} · ${esc(e.entry_no)} · ${esc(e.source)}${e.status === 'معكوس' ? ' · <span class="pill bad">معكوس</span>' : ''}</span></div><b>${money(e.total)}</b></div>`).join('')
    || '<div class="empty">لا قيود</div>'}</div>`;
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
