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

// ───────── النوافذ المؤسسية والتقويم العربي المخصص (ERP Modal & Custom Calendar) ─────────
let dpState = null;
function closeDP() {
  const p = $('#dpPop'), b = $('#dpBack');
  if (p) p.remove();
  if (b) b.classList.remove('on');
  dpState = null;
}
function ensureDPBackdrop() {
  let b = $('#dpBack');
  if (!b) { b = document.createElement('div'); b.id = 'dpBack'; b.className = 'dp-backdrop'; b.onclick = closeDP; document.body.appendChild(b); }
  return b;
}
function openDP(el) {
  closeDP();
  const mode = el.dataset.dp || 'date', now = new Date();
  const raw = (el.value || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  let yr = m ? +m[1] : now.getFullYear(), mo = m ? +m[2] - 1 : now.getMonth();
  if (mo < 0 || mo > 11) mo = now.getMonth();
  const minV = el.dataset.dpMin || '', maxV = el.dataset.dpMax || '';
  const pop = document.createElement('div');
  pop.id = 'dpPop'; pop.className = 'dp-pop';
  document.body.appendChild(pop);
  ensureDPBackdrop().classList.add('on');
  dpState = { el, pop };

  const setVal = v => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    closeDP();
  };
  const pad = n => String(n).padStart(2, '0');
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const AR_MO = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  const draw = () => {
    const yStart = Math.min(1950, yr - 5), yEnd = Math.max(now.getFullYear() + 10, yr + 5);
    const yOpts = []; for (let y = yEnd; y >= yStart; y--) yOpts.push(`<option value="${y}" ${y === yr ? 'selected' : ''}>${y}</option>`);
    if (mode === 'month') {
      const curYm = `${yr}-${pad(mo + 1)}`;
      pop.innerHTML = `<div class="dp-hd">
          <button type="button" class="dp-nav" data-dpn="-1" title="السنة السابقة">‹</button>
          <select class="dp-sel" data-dpy>${yOpts.join('')}</select>
          <button type="button" class="dp-nav" data-dpn="1" title="السنة التالية">›</button>
        </div>
        <div class="dp-bd"><div class="dp-months">${AR_MO.map((nm, i) => {
          const ym = `${yr}-${pad(i + 1)}`;
          return `<button type="button" class="dp-m ${raw === ym ? 'on' : ''}" data-dpval="${ym}">${pad(i + 1)} · ${nm}</button>`;
        }).join('')}</div></div>
        <div class="dp-ft">
          <button type="button" data-dpval="${now.getFullYear()}-${pad(now.getMonth() + 1)}">الشهر الحالي</button>
          <button type="button" data-dpval="${yr}-01">يناير ${yr}</button>
          ${!el.required ? '<button type="button" class="dp-clr" data-dpval="">مسح</button>' : ''}
        </div>`;
      pop.querySelectorAll('[data-dpn]').forEach(b => (b.onclick = () => { yr += +b.dataset.dpn; draw(); }));
      pop.querySelector('[data-dpy]').onchange = e => { yr = +e.target.value; draw(); };
      pop.querySelectorAll('[data-dpval]').forEach(b => (b.onclick = () => setVal(b.dataset.dpval)));
      return;
    }
    const first = new Date(yr, mo, 1), start = new Date(first);
    start.setDate(1 - ((first.getDay() + 1) % 7)); // يبدأ الأسبوع يوم السبت
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const isoD = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const out = d.getMonth() !== mo;
      const dis = (minV && isoD < minV) || (maxV && isoD > maxV);
      cells.push(`<button type="button" class="dp-d ${out ? 'out' : ''} ${isoD === todayIso ? 'today' : ''} ${isoD === raw ? 'on' : ''}" ${dis ? 'disabled' : ''} data-dpval="${isoD}">${d.getDate()}</button>`);
    }
    pop.innerHTML = `<div class="dp-hd">
        <button type="button" class="dp-nav" data-dpm="-1" title="الشهر السابق">‹</button>
        <select class="dp-sel" data-dpmsel>${AR_MO.map((nm, i) => `<option value="${i}" ${i === mo ? 'selected' : ''}>${pad(i + 1)} — ${nm}</option>`).join('')}</select>
        <select class="dp-sel" data-dpy style="max-width:86px">${yOpts.join('')}</select>
        <button type="button" class="dp-nav" data-dpm="1" title="الشهر التالي">›</button>
      </div>
      <div class="dp-bd">
        <div class="dp-dow">${['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة'].map(w => `<span>${w}</span>`).join('')}</div>
        <div class="dp-days">${cells.join('')}</div>
      </div>
      <div class="dp-ft">
        <button type="button" data-dpval="${todayIso}">اليوم</button>
        <button type="button" data-dpval="${yr}-${pad(mo + 1)}-01">أول الشهر</button>
        <button type="button" data-dpval="${yr}-01-01">أول السنة</button>
        ${!el.required ? '<button type="button" class="dp-clr" data-dpval="">مسح</button>' : ''}
      </div>`;
    pop.querySelectorAll('[data-dpm]').forEach(b => (b.onclick = () => {
      mo += +b.dataset.dpm;
      if (mo < 0) { mo = 11; yr--; } else if (mo > 11) { mo = 0; yr++; }
      draw();
    }));
    pop.querySelector('[data-dpmsel]').onchange = e => { mo = +e.target.value; draw(); };
    pop.querySelector('[data-dpy]').onchange = e => { yr = +e.target.value; draw(); };
    pop.querySelectorAll('[data-dpval]').forEach(b => (b.onclick = () => setVal(b.dataset.dpval)));
  };
  draw();

  if (window.innerWidth > 520) {
    const r = el.getBoundingClientRect(), pw = 308, ph = pop.offsetHeight || 340;
    let left = Math.min(window.innerWidth - pw - 10, Math.max(10, r.right - pw));
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 10 && r.top > ph + 10) top = r.top - ph - 6;
    else if (top + ph > window.innerHeight - 10) top = Math.max(10, window.innerHeight - ph - 10);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
}

document.addEventListener('mousedown', e => {
  if (!dpState) return;
  if (dpState.pop.contains(e.target) || dpState.el === e.target || e.target.closest('.dp-field')?.contains(dpState.el)) return;
  closeDP();
});
let dlgState = null;
function closeDlg(val) {
  closeDP();
  const d = $('#dlg');
  if (d) { d.hidden = true; d.innerHTML = ''; }
  if (dlgState) { const fn = dlgState; dlgState = null; fn(val); }
}
function uiDialog(o = {}) {
  closeDP();
  return new Promise(resolve => {
    if (dlgState) closeDlg(null);
    dlgState = resolve;
    const d = $('#dlg'), tone = o.tone || 'info';
    const ic = o.icon || ({ bad: '⚠️', warn: '⚡', ok: '✓', info: '🛡️' }[tone] || '🛡️');
    const btnCls = tone === 'bad' ? 'bad' : tone === 'warn' ? 'gold' : '';
    const isPrompt = o.mode === 'prompt', isAlert = o.mode === 'alert';
    const kind = o.kind || 'text';
    const inputHtml = !isPrompt ? '' : kind === 'textarea'
      ? `<label class="f" style="margin-top:8px">${o.label ? `<span>${esc(o.label)}</span>` : ''}<textarea class="input" id="dlgIn" rows="3" placeholder="${esc(o.placeholder || '')}">${esc(o.value || '')}</textarea></label>`
      : `<label class="f" style="margin-top:8px">${o.label ? `<span>${esc(o.label)}</span>` : ''}<input class="input" id="dlgIn" ${kind === 'date' ? 'type="date"' : kind === 'amount' ? 'inputmode="decimal" data-tafqeet="1"' : kind === 'numeric' ? 'inputmode="numeric" dir="ltr"' : 'type="text"'} value="${esc(o.value ?? '')}" placeholder="${esc(o.placeholder || '')}" autocomplete="off"></label>`;
    d.hidden = false;
    d.innerHTML = `<div class="dlg-box ${esc(tone)}" role="dialog" aria-modal="true">
      <div class="dlg-hd"><div class="dlg-ic">${ic}</div><h4>${esc(o.title || (isPrompt ? 'إدخال بيانات إجرائية' : isAlert ? 'تنبيه من المنظومة' : 'تأكيد الإجراء'))}</h4></div>
      <div class="dlg-bd">
        ${o.msg ? `<p>${esc(o.msg)}</p>` : ''}${o.html || ''}
        ${inputHtml}
        <div class="dlg-err" id="dlgErr" hidden></div>
      </div>
      <div class="dlg-ft">
        <button type="button" class="btn ${btnCls}" id="dlgOk">${esc(o.okText || (isAlert ? 'حسناً' : 'تأكيد المتابعة'))}</button>
        ${isAlert ? '' : `<button type="button" class="btn sec" id="dlgCancel">${esc(o.cancelText || 'إلغاء')}</button>`}
      </div></div>`;
    enhanceUI(d);
    const inp = d.querySelector('#dlgIn'), err = d.querySelector('#dlgErr');
    const submit = () => {
      if (!isPrompt) return closeDlg(true);
      const val = (inp ? inp.value : '').trim();
      if (o.required !== false && !val) {
        err.textContent = o.errMsg || 'يرجى استيفاء هذا الحقل للمتابعة.';
        err.hidden = false;
        inp && inp.focus();
        return;
      }
      closeDlg(val);
    };
    d.querySelector('#dlgOk').onclick = submit;
    const cancelBtn = d.querySelector('#dlgCancel');
    if (cancelBtn) cancelBtn.onclick = () => closeDlg(isPrompt ? null : false);
    d.onclick = ev => { if (ev.target === d) closeDlg(isAlert ? true : isPrompt ? null : false); };
    if (inp) {
      setTimeout(() => { inp.focus(); if (inp.select && kind !== 'date') inp.select(); }, 20);
      if (kind !== 'textarea') inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
    } else {
      setTimeout(() => d.querySelector('#dlgOk')?.focus(), 20);
    }
  });
}
const uiAlert = (msg, o = {}) => uiDialog({ mode: 'alert', ...(typeof msg === 'object' ? msg : { msg, ...o }) });
const uiConfirm = (msg, o = {}) => uiDialog({ mode: 'confirm', ...(typeof msg === 'object' ? msg : { msg, ...o }) });
const uiPrompt = (msg, o = {}) => uiDialog({ mode: 'prompt', ...(typeof msg === 'object' ? msg : { msg, ...o }) });

try {
  if (localStorage.getItem('nekaba_side_mini') === '1') document.body.classList.add('side-mini');
  S.navClosed = JSON.parse(localStorage.getItem('nekaba_nav_closed') || '{}') || {};
} catch (_) { S.navClosed = {}; }
function saveNavPrefs() {
  try {
    localStorage.setItem('nekaba_side_mini', document.body.classList.contains('side-mini') ? '1' : '0');
    localStorage.setItem('nekaba_nav_closed', JSON.stringify(S.navClosed || {}));
  } catch (_) {}
}

document.addEventListener('click', e => {
  const sgt = e.target.closest('[data-sgt]');
  if (sgt) {
    const g = sgt.dataset.sgt, box = sgt.closest('[data-sgbox]');
    if (box) {
      const shut = box.classList.toggle('shut');
      S.navClosed = S.navClosed || {};
      if (shut) S.navClosed[g] = true; else delete S.navClosed[g];
      saveNavPrefs();
    }
    return;
  }
  const actEl = e.target.closest('[data-act]');
  if (!actEl) return;
  const act = actEl.dataset.act;
  if (act === 'drawerToggle') document.body.classList.toggle('drawer-open');
  else if (act === 'drawerClose') document.body.classList.remove('drawer-open');
  else if (act === 'sideMini') {
    const mini = document.body.classList.toggle('side-mini');
    document.querySelectorAll('.side-pin').forEach(p => { p.textContent = mini ? '⇤' : '⇥'; p.title = mini ? 'توسيع الشريط الجانبي' : 'طي الشريط الجانبي'; });
    saveNavPrefs();
  } else if (act === 'navFoldAll') {
    S.navClosed = S.navClosed || {};
    document.querySelectorAll('[data-sgbox]').forEach(box => { box.classList.add('shut'); S.navClosed[box.dataset.sgbox] = true; });
    saveNavPrefs();
  } else if (act === 'navOpenAll') {
    S.navClosed = {};
    document.querySelectorAll('[data-sgbox]').forEach(box => box.classList.remove('shut'));
    saveNavPrefs();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (dpState) closeDP();
    else if (dlgState) closeDlg(null);
    else if (!$('#modal').hidden) closeModal();
    else document.body.classList.remove('drawer-open');
  }
});

function enhanceUI(root = document) {
  root.querySelectorAll('input[type="date"], input[type="month"]').forEach(el => {
    const mode = el.type;
    el.dataset.dp = mode;
    if (el.min) el.dataset.dpMin = el.min;
    if (el.max) el.dataset.dpMax = el.max;
    el.type = 'text';
    el.dir = 'ltr';
    el.autocomplete = 'off';
    if (!el.placeholder) el.placeholder = mode === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
    const wrap = document.createElement('div');
    wrap.className = 'dp-field';
    if (el.style.flex) { wrap.style.flex = el.style.flex; el.style.flex = ''; }
    if (el.style.maxWidth) { wrap.style.maxWidth = el.style.maxWidth; el.style.maxWidth = ''; }
    if (el.style.minWidth) { wrap.style.minWidth = el.style.minWidth; el.style.minWidth = ''; }
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'dp-btn'; btn.tabIndex = -1; btn.textContent = '📅'; btn.title = 'فتح التقويم';
    wrap.appendChild(btn);
    btn.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); openDP(el); };
    el.addEventListener('click', () => openDP(el));
    el.addEventListener('blur', () => {
      const v = el.value.trim(); if (!v) return;
      if (mode === 'date' && typeof parseAnyDate === 'function') { const isoD = parseAnyDate(v); if (isoD) el.value = isoD; }
    });
  });
  root.querySelectorAll('input[name="amount"]:not([data-tfq]), input[data-tafqeet]:not([data-tfq])').forEach(el => {
    if (['hidden', 'checkbox', 'radio'].includes(el.type)) return;
    el.dataset.tfq = '1';
    const box = document.createElement('div');
    box.className = 'amt-words';
    el.insertAdjacentElement('afterend', box);
    const sync = () => {
      const n = +String(el.value || '').replace(/,/g, '');
      box.textContent = n > 0 && typeof tafqeet === 'function' ? '💰 ' + tafqeet(n) : '';
    };
    el.addEventListener('input', sync);
    sync();
  });
}

function openModal(html, onMount, cls = '') {
  closeDP();
  const m = $('#modal');
  m.className = ('modal ' + cls).trim();
  let title = 'نافذة إجرائية', rest = html;
  const hm = String(html).match(/^\s*<h3>([\s\S]*?)<\/h3>([\s\S]*)$/i);
  if (hm) { title = hm[1]; rest = hm[2]; }
  m.innerHTML = `<div class="sheet">
    <div class="m-head"><h3>${title}</h3><button type="button" class="m-x" data-mclose title="إغلاق">✕</button></div>
    <div class="m-body">${rest}</div></div>`;
  m.hidden = false;
  m.onclick = e => { if (e.target === m) closeModal(); };
  m.querySelector('[data-mclose]').onclick = closeModal;
  onMount && onMount(m);
  enhanceUI(m);
}
function closeModal() { closeDP(); const m = $('#modal'); m.hidden = true; m.className = 'modal'; m.innerHTML = ''; }
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
    </form>
    ${tab === 'member' ? `<div style="text-align:center;margin-top:12px;padding-top:10px;border-top:1px dashed #e2e8f0">
      <button type="button" class="btn sm sec" id="actvBtn">🔑 لا تستطيع الدخول أو ينقصك الرقم القومي؟ اطلب تفعيل حسابك</button>
    </div>` : ''}
  </div></div>`;
}
function bindLogin() {
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S._loginTab = b.dataset.tab; render(); });
  const ab = $('#actvBtn');
  if (ab) ab.onclick = () => openModal(`<h3>🔑 طلب تفعيل حساب عضو (تحديث الرقم القومي والموبايل)</h3>
    <p class="muted" style="font-size:13px">إذا لم يكن رقمك القومي مسجّلاً بقاعدة بيانات اللجنة بعد، أرسل بياناتك ليتم التحقق وتفعيل دخولك للبوابة:</p>
    <form id="actvf">
      <label class="f"><span>الرقم الوظيفي</span><input class="input" name="job_id" inputmode="numeric" required placeholder="مثال: 97117"></label>
      <label class="f"><span>الرقم القومي كاملاً (14 رقماً)</span><input class="input" name="national_id" inputmode="numeric" minlength="14" maxlength="14" required placeholder="14 رقماً"></label>
      <label class="f"><span>رقم الموبايل للتواصل</span><input class="input" name="phone" inputmode="tel" required placeholder="01xxxxxxxxx"></label>
      <div id="ferr"></div>
      <div class="acts"><button class="btn gold" type="submit">إرسال طلب التفعيل</button><button class="btn sec" type="button" data-close>إلغاء</button></div>
    </form>`, () => {
    $('#modal [data-close]').onclick = closeModal;
    $('#actvf').onsubmit = async e => {
      e.preventDefault();
      const r = await busy(e.target.querySelector('[type=submit]'), () => call('ACTV_REQUEST', formData(e.target)));
      if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
      closeModal();
      toast(`تم استلام طلب التفعيل للأستاذ/ ${r.full_name} — سيتم التفعيل عقب المراجعة ✓`);
    };
  });
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    const d = formData(e.target), member = (S._loginTab || 'member') === 'member';
    const r = await busy(e.target.querySelector('button[type=submit]'), () => call(member ? 'LOGIN_MEMBER' : 'LOGIN_ADMIN', d));
    if (!r.success) { $('#lerr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    saveSession(r.token, member ? 'member' : 'staff');
    location.hash = member ? '#/home' : '#/dash'; await boot();
  };
}

// ───────── الهيكل (ERP: قائمة جانبية قابلة للطي ومجموعات قابلة للطي + درج ذكي على التابلت والموبايل) ─────────
function navModel() {
  const gov = can('governance.view') || can('governance.manage');
  const fin = can('finance.view');
  const pay = fin || can('treasury.payment.request') || can('treasury.payment.approve') || can('treasury.cheque.issue');
  if (isStaff()) return [
    ['الرئيسية', [['#/dash', '📊', 'لوحة القيادة', true], ['#/inbox', '📥', 'صندوق الاعتمادات', true], ['#/calendar', '📅', 'التقويم', true], ['#/notifications', '🔔', 'الإشعارات', true]]],
    ['العضوية', [['#/admin', '👥', 'الأعضاء', can('profile.view')], ['#/memberlists', '📋', 'كشوف الأعضاء', can('profile.view')], ['#/requests', '📝', 'طلبات التعديل', can('profile.change.approve')], ['#/activations', '🔑', 'طلبات تفعيل الأعضاء', can('profile.edit') || can('profile.change.approve')], ['#/lists', '🗂️', 'القوائم', can('lists.manage')]]],
    ['الحوكمة', [['#/board', '🏛️', 'المجلس', gov], ['#/meetings', '🗓️', 'الاجتماعات', gov], ['#/decisions', '⚖️', 'القرارات', gov]]],
    ['المالية والخزينة', [['#/finance', '💰', 'المالية', fin], ['#/payreqs', '📝', 'طلبات الصرف والشيكات', pay], ['#/cheques', '🧾', 'الشيكات والعُهد', fin], ['#/settlements', '🧮', 'التسويات والعُهد المفتوحة', fin], ['#/bank', '🏦', 'مطابقة البنك', fin], ['#/chqbooks', '📗', 'دفاتر الشيكات', fin], ['#/receipts', '📥', 'المقبوضات', fin], ['#/entries', '📒', 'القيود', fin], ['#/trial', '⚖️', 'ميزان المراجعة', fin], ['#/statements', '📑', 'القوائم المالية', fin], ['#/budget', '🎯', 'الموازنة التقديرية', fin], ['#/dues', '🧮', 'حصة الاشتراكات', fin], ['#/policy', '📜', 'اللائحة المالية', fin], ['#/periods', '🔒', 'إقفال الفترات والسنوات', fin], ['#/journal', '✍️', 'عملية مالية / قيد', can('finance.journal')], ['#/parties', '🏢', 'الأطراف الخارجية', fin]]],
    ['الخدمات والمزايا', [['#/trips', '🚌', 'الأنشطة', can('activities.manage')], ['#/summer', '🏖️', 'المصايف', can('summer.manage')], ['#/grantsadmin', '🎁', 'المنح', canGrtAdmin()], ['#/devadmin', '📱', 'الأجهزة والعمرة', can('devices.manage')], ['#/benefits', '🏅', 'المزايا', can('benefits.view')]]],
    ['التقارير والاتصال', [['#/reports', '📈', 'التقارير', can('reports.view') || fin], ['#/annual', '📘', 'التقرير السنوي', (can('reports.view') || fin) && fin], ['#/tickets', '💬', 'شكاوى ومقترحات الأعضاء', can('profile.view') || can('profile.change.approve')], ['#/news', '📰', 'الأخبار', can('news.manage')]]],
    ['النظام', [['#/users', '🔐', 'المستخدمون والصلاحيات', can('users.manage')], ['#/archive', '🗂️', 'الأرشيف الإلكتروني', can('finance.view') || can('audit.view') || can('governance.view')], ['#/audit', '🛡️', 'سجل التدقيق', can('audit.view')], ['#/help', '❓', 'المساعدة', true], ['#/account', '⚙️', 'حسابي', true]]],
  ];
  return [
    ['الرئيسية', [['#/home', '🏠', 'بوابتي الرئيسية', true], ['#/myrequests', '📋', 'طلباتي ومتابعتها', true], ['#/tickets', '💬', 'الشكاوى والمقترحات', true], ['#/calendar', '📅', 'التقويم', true], ['#/notifications', '🔔', 'الإشعارات', true]]],
    ['خدماتي', [['#/trips', '🚌', 'الرحلات والفعاليات', true], ['#/mytrips', '🎫', 'حجوزاتي', true], ['#/summer', '🏖️', 'المصايف', true], ['#/grants', '🎁', 'المنح', true], ['#/devices', '📱', 'الأجهزة', true], ['#/umrah', '🕋', 'العمرة والحج', true]]],
    ['ملفي', [['#/card', '💳', 'بطاقة العضوية', true], ['#/profile', '🪪', 'ملفي', true], ['#/family', '👨‍👩‍👧', 'أسرتي', true], ['#/mybenefits', '🏅', 'استفاداتي', true]]],
    ['الإدارة', [['#/board', '🏛️', 'المجلس', gov], ['#/finance', '💰', 'المالية', fin], ['#/reports', '📈', 'التقارير', can('reports.view')], ['#/news', '📰', 'الأخبار', can('news.manage')]]],
    ['النظام', [['#/help', '❓', 'المساعدة', true], ['#/account', '⚙️', 'حسابي', true]]],
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
  const closed = S.navClosed || {};
  const isMini = document.body.classList.contains('side-mini');
  const mob = all.filter(n => !['#/notifications', '#/payreqs', '#/journal', '#/parties', '#/dues', '#/policy', '#/annual', '#/help', '#/archive', '#/calendar', '#/memberlists', '#/card', '#/bank', '#/chqbooks', '#/settlements', '#/myrequests', '#/statements', '#/budget', '#/users', '#/audit', '#/meetings', '#/decisions', '#/cheques', '#/receipts', '#/entries', '#/trial', '#/mytrips', '#/umrah', '#/mybenefits'].includes(n[0])
    && !(!isStaff() && ['#/devices', '#/summer', '#/grants', '#/trips'].includes(n[0])));
  return `<div class="erp">
    <div class="side-backdrop" data-act="drawerClose"></div>
    <aside class="side">
      <div class="brand">
        <img src="img/logo-union.png" alt="">
        <div><b>منصة النقابة</b><small>${esc(C.ORG_NAME)}</small></div>
        <button type="button" class="side-pin" data-act="sideMini" title="${isMini ? 'توسيع الشريط الجانبي' : 'طي الشريط الجانبي'}">${isMini ? '⇤' : '⇥'}</button>
      </div>
      <div class="side-tools">
        <span style="opacity:.75">القوائم الرئيسية</span>
        <div class="row" style="gap:4px">
          <button type="button" data-act="navFoldAll" title="طي جميع القوائم الرئيسية">⊟ طي الكل</button>
          <button type="button" data-act="navOpenAll" title="فتح جميع القوائم الرئيسية">⊞ فتح الكل</button>
        </div>
      </div>
      ${groups.map(([g, items]) => {
        const shut = !!closed[g];
        return `<div class="sg ${shut ? 'shut' : ''}" data-sgbox="${esc(g)}">
          <button type="button" class="sgt" data-sgt="${esc(g)}"><span>${esc(g)}</span><small class="sg-cnt">${numAr(items.length)}</small><i class="sg-arr">▾</i></button>
          <div class="sg-items">${items.map(n => `<a href="${n[0]}" class="${n === cur ? 'on' : ''}" title="${esc(n[2])}"><i>${n[1]}</i><span class="slbl">${n[2]}</span></a>`).join('')}</div>
        </div>`;
      }).join('')}
      <div class="sfoot"><div class="who" title="${esc(name)}"><span class="av">${esc((name || '؟').trim()[0] || '؟')}</span><div><b>${esc(name)}</b><small>${isStaff() ? 'الإدارة' : 'عضو'}</small></div></div></div>
    </aside>
    <div class="main"><div class="top">
      <button type="button" class="menu-btn" data-act="drawerToggle" title="القائمة الكاملة">☰</button>
      <button type="button" class="rail-btn" data-act="sideMini" title="طي / توسيع الشريط الجانبي">☰</button>
      <img src="img/logo-union.png" alt=""><div class="t"><small class="crumb">${grp ? esc(grp[0]) + ' ‹ ' : ''}</small><b>${esc(title)}</b><small class="nm">${esc(name)}</small></div>
      ${isStaff() && can('profile.view') ? `<form class="gs" id="gs"><input name="q" placeholder="🔎 بحث عن عضو: اسم، رقم وظيفي، موبايل…" value="${esc(S.q || '')}"></form>` : ''}
      <a href="#/notifications" class="bell" title="الإشعارات">🔔${S.ntfCount ? `<span class="badge">${S.ntfCount > 9 ? '9+' : S.ntfCount}</span>` : ''}</a>
      <button data-act="logout">خروج</button></div>
    <div class="wrap">${body}</div></div></div>
    <nav class="nav">${(mob.length > 5 ? mob.slice(0, 4) : mob).map(n => `<a href="${n[0]}" class="${h.startsWith(n[0]) ? 'on' : ''}"><i>${n[1]}</i>${n[2]}</a>`).join('')}${mob.length > 5 ? '<button type="button" data-act="drawerToggle"><i>☰</i>الأقسام</button>' : ''}</nav>`;
}

// ───────── لوحة القيادة (الإدارة) ─────────
const numAr = v => Number(v || 0).toLocaleString('ar-EG');
const bars = (o, money_ = false) => { const e = Object.entries(o || {}).sort((x, y) => y[1] - x[1]); const mx = Math.max(1, ...e.map(x => +x[1]));
  return e.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><div><i style="width:${Math.max(2, 100 * v / mx)}%"></i></div><b>${money_ ? money(v) : numAr(v)}</b></div>`).join('') || '<div class="empty">لا بيانات</div>'; };
function dashView() {
  const d = S.dash || {}, r = d.rep || {}, f = d.fin || {}, n = S.ntf || {}, m = r.members || {}, b = r.benefits || {}, rf = r.finance || {};
  const tasks = n.tasks || [], y = new Date().getFullYear();
  const kpi = (i, v, l, href, cls = '') => `<a class="kpi ${cls}" ${href ? `href="${href}"` : ''}><i>${i}</i><div><b>${v}</b><small>${l}</small></div></a>`;
  const qa = [
    ['#/admin', '👤', 'بحث عن عضو', can('profile.view')],
    ['payReqNew', '📝', 'طلب استخراج شيك', can('treasury.payment.request') || can('treasury.cheque.issue')],
    ['grtStaffNew', '🎁', 'طلب استخراج منحة', can('grants.review')],
    ['#/payreqs', '🧾', 'طابور الصرف والشيكات', can('finance.view') || can('treasury.cheque.issue') || can('treasury.payment.approve')],
    ['rcptNew', '📥', 'إيداع / تحصيل', can('treasury.receipt')],
    ['#/meetings', '🗓️', 'الاجتماعات والقرارات', can('governance.view') || can('governance.manage')],
    ['#/trips', '🚌', 'الأنشطة والرحلات', can('activities.manage')],
    ['#/reports', '📈', 'التقارير الشاملة', can('reports.view') || can('finance.view')],
  ].filter(x => x[3]);
  const surplus = +rf.revenue - +rf.expense;
  return `<div class="hello"><div><h1>أهلاً${S.me.username ? '، ' + esc(S.me.username) : ''} 👋</h1><div class="muted">ملخص المنظومة لسنة ${y} — ${dt(new Date().toISOString().slice(0, 10))}</div></div></div>
    <div class="kpis">
      ${r.members ? kpi('👥', numAr(m.total), 'عضو مسجّل', '#/admin') : ''}
      ${f.bank !== undefined ? kpi('🏦', money(f.bank), 'رصيد البنك الدفتري', '#/ledger/1102') : ''}
      ${f.custody !== undefined ? kpi('🧾', money(f.custody), `عُهد تحت التسوية (${numAr(f.unsettled)} شيك)`, '#/settlements', +f.custody ? 'warn' : '') : ''}
      ${r.finance ? kpi(surplus >= 0 ? '📈' : '📉', money(surplus), `فائض / (عجز) ${r.year || y}`, '#/reports', surplus >= 0 ? 'ok' : 'bad') : ''}
      ${r.benefits ? kpi('🏅', money(b.total), `مزايا ${r.year || y} لـ ${numAr(b.people)} مستفيد`, '#/benefits') : ''}
      ${kpi('📌', numAr(tasks.reduce((a, t) => a + +t.count, 0)), 'مهام تنتظر إجراءك', '#/inbox', tasks.length ? 'warn' : 'ok')}
    </div>
    <div class="dgrid">
      <div class="card"><h2>📌 صندوق المهام<span class="sp"></span><a class="pill" href="#/inbox" style="text-decoration:none">الكل</a></h2>
        ${tasks.map(t => `<a class="task ${t.level || ''}" href="${esc(t.link)}"><span>${esc(t.title)}</span><span class="pill ${t.level === 'bad' ? 'bad' : 'warn'}">${t.level && +t.count === 1 && /لم تُعمل/.test(t.title) ? '!' : numAr(t.count)}</span><em>←</em></a>`).join('') || '<div class="empty">✅ لا مهام معلّقة — كل شيء تمام</div>'}</div>
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


// ───────── مسارات الاعتماد ─────────
function stepper(it) {
  const st = it.stages || [], i = +it.idx, closed = i < 0;
  return `<div class="steps ${closed ? 'x' : ''}">${st.map((t, k) => `<div class="stp ${!closed && k < i ? 'done' : ''} ${!closed && k === i ? 'cur' : ''}"><span>${!closed && k < i ? '✓' : k + 1}</span><small>${esc(t)}</small></div>`).join('')}</div>`;
}
function wfCard(it, staff) {
  const closed = +it.idx < 0, done = !closed && +it.idx >= (it.stages || []).length - 1;
  return `<div class="card wf"><div class="row"><span class="wfi">${it.icon || '•'}</span>
      <div style="flex:1;min-width:0"><b>${esc(String(it.title).replace(/^([a-z_0-9]+):/, (m, f) => (FIELD_LBL[f] || f) + ':'))}</b><div class="muted">${esc(it.module)}${it.ref ? ' · ' + esc(it.ref) : ''}${staff ? ' · ' + esc(it.person) : ''} · ${dt(String(it.at).slice(0, 10))}</div></div>
      ${it.amount != null && +it.amount ? `<b>${money(it.amount)}</b>` : ''}
      <span class="pill ${closed ? 'bad' : done ? 'ok' : 'warn'}">${esc(it.status)}</span></div>
    ${stepper(it)}
    <div class="row wfa">${!closed && !done && it.actor ? `<span class="muted">⏳ عند: <b style="display:inline">${esc(it.actor)}</b></span>` : ''}
      ${it.note ? `<span class="muted">· ${esc(it.note)}</span>` : ''}<span class="sp" style="flex:1"></span>
      ${staff ? `<a class="btn sm sec" href="#/person/${it.person_id}" style="text-decoration:none">ملف العضو</a><a class="btn sm" href="${esc(it.link)}" style="text-decoration:none">اتخاذ إجراء ←</a>`
              : `<a class="btn sm sec" href="${esc(it.mylink)}" style="text-decoration:none">فتح</a>`}</div></div>`;
}
function inboxView() {
  const items = S.inbox || [], f = S.inboxF || '', mods = [...new Set(items.map(x => x.module))];
  const list = items.filter(x => !f || x.module === f);
  return `<div class="kpis">${[['📥', items.length, 'طلب ينتظر إجراءك'], ...mods.map(m => [items.find(x => x.module === m).icon, items.filter(x => x.module === m).length, m])]
      .map(([i, v, l]) => `<div class="kpi"><i>${i}</i><div><b>${numAr(v)}</b><small>${esc(l)}</small></div></div>`).join('')}</div>
    ${mods.length > 1 ? `<div class="subtabs"><button data-wff="" class="${!f ? 'on' : ''}">📂 الكل<span class="st-cnt">${numAr(items.length)}</span></button>${mods.map(m => `<button data-wff="${esc(m)}" class="${f === m ? 'on' : ''}">${esc(m)}<span class="st-cnt">${numAr(items.filter(x => x.module === m).length)}</span></button>`).join('')}</div>` : ''}
    ${list.map(x => wfCard(x, true)).join('') || '<div class="card empty">✅ لا طلبات تنتظر إجراءك — كل شيء تمام</div>'}`;
}
function myReqView() {
  const items = S.myReq || [], open = items.filter(x => +x.idx >= 0 && +x.idx < x.stages.length - 1);
  return `<div class="card"><h2>📋 طلباتي ومتابعتها</h2><div class="muted">كل طلب قدّمته: وصل لفين ومستني مين.</div></div>
    ${open.length ? `<h3 class="sec-h">قيد التنفيذ (${numAr(open.length)})</h3>${open.map(x => wfCard(x, false)).join('')}` : ''}
    ${items.length > open.length ? `<h3 class="sec-h">المنتهية</h3>${items.filter(x => !open.includes(x)).map(x => wfCard(x, false)).join('')}` : ''}
    ${items.length ? '' : '<div class="card empty">لسه ما قدّمتش أي طلب</div>'}`;
}


// ───────── إدارة النظام: المستخدمون والصلاحيات، سجل التدقيق ─────────
const roleName = c => ((S.sys && S.sys.roles) || []).find(r => r.code === c)?.name || c;
function usersView() {
  const d = S.sys || {}, users = d.users || [], roles = d.roles || [], perms = d.perms || [];
  return `<div class="card row"><button class="btn" data-act="userNew">+ مستخدم جديد</button><span class="muted" style="flex:1">${numAr(users.filter(u => u.active).length)} مستخدم نشط من ${numAr(users.length)}</span></div>
    ${grid('users', [
      { t: 'اسم المستخدم', v: u => `<b>${esc(u.username)}</b>${u.must_change ? ' <span class="pill warn">كلمة مؤقتة</span>' : ''}`, raw: u => u.username },
      { t: 'العضو المرتبط', v: u => esc(u.person || '—'), raw: u => u.person || '' },
      { t: 'الأدوار', v: u => (u.roles || []).map(r => `<span class="pill ${r === 'SYS_ADMIN' ? 'bad' : 'ok'}">${esc(roleName(r))}</span>`).join(' ') || '<span class="muted">بلا دور</span>', raw: u => (u.roles || []).map(roleName).join('، ') },
      { t: 'الحالة', v: u => u.active ? '<span class="pill ok">نشط</span>' : '<span class="pill bad">موقوف</span>', raw: u => u.active ? 'نشط' : 'موقوف' },
      { t: 'آخر دخول', v: u => u.last_login ? dt(String(u.last_login).slice(0, 16).replace('T', ' ')) : '<span class="muted">لم يدخل</span>', raw: u => u.last_login || '' },
    ], users, { title: '🔐 المستخدمون', file: 'users', attr: u => `data-user="${esc(u.username)}"`, empty: 'لا مستخدمين' })}
    <div class="card"><h2>🧩 مصفوفة الصلاحيات</h2><div class="muted" style="margin-bottom:8px">ما يملكه كل دور (المدير له كل الصلاحيات ضمناً). ⬤ = مسموح، والرقم = حد مالي.</div>
      <div class="gtw"><table class="pm"><thead><tr><th>الصلاحية</th>${roles.map(r => `<th>${esc(r.name)}</th>`).join('')}</tr></thead><tbody>
      ${perms.map(pm => `<tr><td><span class="muted">${esc(pm.module)}</span> ${esc(pm.name)}</td>${roles.map(r => { const x = r.kind === 'admin' ? { max: null } : (r.perms || []).find(y => y.code === pm.code);
        return `<td class="c">${x ? (x.max != null ? `<span class="pill warn">${numAr(x.max)}</span>` : '<b class="dot">⬤</b>') : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
function userForm(u) {
  const roles = (S.sys || {}).roles || [], isNew = !u;
  u = u || { roles: [], active: true };
  return `<h3>${isNew ? 'مستخدم جديد' : 'تعديل ' + esc(u.username)}</h3><form id="uf">
    <label class="f"><span>اسم المستخدم (إنجليزي صغير)</span><input class="input" name="username" value="${esc(u.username || '')}" ${isNew ? '' : 'readonly'} required pattern="[a-z0-9_.]{3,30}" dir="ltr"></label>
    <label class="f"><span>${isNew ? 'كلمة مرور مؤقتة (8+ أحرف) — يُلزم بتغييرها' : 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)'}</span><input class="input" name="password" type="text" ${isNew ? 'required' : ''} minlength="8" dir="ltr" autocomplete="off"></label>
    <label class="f"><span>ربط بعضو (اختياري) — ابحث بالاسم أو الرقم الوظيفي</span><div class="row"><input class="input" id="upq" style="flex:1" placeholder="${esc(u.person || 'بحث…')}"><button class="btn sm sec" type="button" id="ups">بحث</button></div>
      <select class="input" name="personId" id="upsel" style="margin-top:6px"><option value="${esc(u.person_id || '')}">${esc(u.person || '— بدون ربط —')}</option>${u.person_id ? '<option value="">— إلغاء الربط —</option>' : ''}</select></label>
    <div class="f"><span class="muted" style="font-size:13px">الأدوار</span><div class="rolebox">${roles.map(r => `<label><input type="checkbox" name="role" value="${esc(r.code)}" ${(u.roles || []).includes(r.code) ? 'checked' : ''}> ${esc(r.name)} <small class="muted">(${(r.kind === 'admin' ? 'كل الصلاحيات' : numAr((r.perms || []).length) + ' صلاحية')})</small></label>`).join('')}</div></div>
    <label class="f"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> الحساب نشط</label>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">حفظ</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
function bindUserForm(u) {
  $('#modal [data-close]').onclick = closeModal;
  $('#ups').onclick = async () => { const q = $('#upq').value.trim(); if (!q) return;
    const r = await call('SEARCH_PERSONS', { q }); if (!r.success) return toast(r.message, true);
    $('#upsel').innerHTML = '<option value="">— بدون ربط —</option>' + r.items.slice(0, 30).map(x => `<option value="${x.id}">${esc(x.full_name)} — ${esc(x.job_id || '')}</option>`).join(''); };
  $('#uf').onsubmit = async e => { e.preventDefault(); const f = e.target;
    const d = { username: f.username.value.trim().toLowerCase(), active: f.active.checked, roles: [...f.querySelectorAll('[name=role]:checked')].map(i => i.value) };
    if (f.password.value) d.password = f.password.value;
    if (f.personId.value !== (u && u.person_id || '')) d.personId = f.personId.value || null;
    const r = await busy(f.querySelector('[type=submit]'), () => call('SYS_USER_SAVE', d));
    if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    closeModal(); toast('اتحفظ ✓' + (d.password ? ' — بلّغ المستخدم بكلمة المرور المؤقتة' : '')); render(); };
}
const ENT_LBL = { 'core.persons': 'الأشخاص', 'core.person_movements': 'الحركات', 'core.family_members': 'الأسرة', 'core.change_requests': 'طلبات التعديل', 'core.users': 'المستخدمون',
  'core.user_roles': 'أدوار المستخدمين', 'finance.entries': 'القيود', 'finance.budgets': 'الموازنة', 'treasury.cheques': 'الشيكات', 'treasury.receipts': 'المقبوضات', 'benefits.ledger': 'سجل المزايا',
  'governance.decisions': 'القرارات', 'governance.meetings': 'الاجتماعات', 'governance.attendance': 'الحضور', 'governance.candidates': 'المرشحون' };
const ACT_LBL = { INSERT: ['إضافة', 'ok'], UPDATE: ['تعديل', 'warn'], DELETE: ['حذف', 'bad'] };
function auditView() {
  const d = S.audit || {}, f = S.audF || {};
  return `<div class="card"><form id="auf" class="row">
      <select class="input" style="flex:1;min-width:140px" name="entity"><option value="">كل الجداول</option>${(d.entities || []).map(e => `<option value="${esc(e)}" ${f.entity === e ? 'selected' : ''}>${esc(ENT_LBL[e] || e)}</option>`).join('')}</select>
      <select class="input" style="flex:1;min-width:100px" name="action"><option value="">كل العمليات</option>${Object.entries(ACT_LBL).map(([k, [t]]) => `<option value="${k}" ${f.action === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input class="input" style="flex:1;min-width:100px" name="actor" value="${esc(f.actor || '')}" placeholder="المستخدم">
      <input class="input" style="flex:1" type="date" name="from" value="${esc(f.from || '')}"><input class="input" style="flex:1" type="date" name="to" value="${esc(f.to || '')}">
      <button class="btn">عرض</button></form><div class="muted" style="margin-top:6px">سجل غير قابل للتعديل أو الحذف. الافتراضي آخر 30 يوماً، حتى 200 سجل.</div></div>
    ${grid('audit', [
      { t: 'الوقت', v: x => dt(String(x.at).slice(0, 19).replace('T', ' ')), raw: x => x.at },
      { t: 'المستخدم', v: x => `<b>${esc(x.actor || 'SYSTEM')}</b>`, raw: x => x.actor || '' },
      { t: 'العملية', v: x => { const a = ACT_LBL[x.action] || [x.action, '']; return `<span class="pill ${a[1]}">${esc(a[0])}</span>`; }, raw: x => (ACT_LBL[x.action] || [x.action])[0] },
      { t: 'الجدول', v: x => esc(ENT_LBL[x.entity] || x.entity), raw: x => ENT_LBL[x.entity] || x.entity },
      { t: 'الحقول المتغيّرة', v: x => x.action === 'UPDATE' ? esc((x.changed || []).map(k => FIELD_LBL[k] || k).join('، ')) : '<span class="muted">السجل كاملاً</span>', raw: x => (x.changed || []).join(' ') },
      { t: 'السبب', v: x => esc(x.reason || ''), raw: x => x.reason || '' },
    ], d.items, { title: '🛡️ سجل التدقيق', file: 'audit-log', attr: x => `data-aud="${x.id}"`, empty: 'لا سجلات في الفترة' })}`;
}
function auditModal(x) {
  const b = x.before || {}, a = x.after || {}, keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(k => x.action !== 'UPDATE' || JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  const fv = v => v == null ? '<span class="muted">—</span>' : esc(typeof v === 'object' ? JSON.stringify(v) : v);
  return `<h3>${esc((ACT_LBL[x.action] || [x.action])[0])} — ${esc(ENT_LBL[x.entity] || x.entity)}</h3>
    <div class="muted">${dt(String(x.at).slice(0, 19).replace('T', ' '))} · بواسطة <b>${esc(x.actor || 'SYSTEM')}</b> · سجل #${x.id}${x.reason ? ' · السبب: ' + esc(x.reason) : ''}</div>
    <div class="gtw" style="margin-top:10px"><table class="pm"><thead><tr><th>الحقل</th>${x.action !== 'INSERT' ? '<th>قبل</th>' : ''}${x.action !== 'DELETE' ? '<th>بعد</th>' : ''}</tr></thead><tbody>
    ${keys.filter(k => !/password|hash|salt/.test(k)).map(k => `<tr><td><b>${esc(FIELD_LBL[k] || k)}</b></td>${x.action !== 'INSERT' ? `<td class="old">${fv(b[k])}</td>` : ''}${x.action !== 'DELETE' ? `<td class="new">${fv(a[k])}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    <div class="acts"><button class="btn sec" type="button" data-close>إغلاق</button></div>`;
}


// ───────── التقويم الموحّد ─────────
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function calEvents() {
  const ev = [], add = (date, icon, title, kind, link) => { if (date) ev.push({ date: String(date).slice(0, 10), icon, title, kind, link }); };
  (S.acts || []).forEach(a => {
    const link = (isStaff() && can('activities.manage') ? '#/actadmin/' : '#/trip/') + a.id;
    const st = new Date(a.start_date), en = new Date(a.end_date || a.start_date);
    for (let d = new Date(st), i = 0; d <= en && i < 31; d.setDate(d.getDate() + 1), i++) add(iso(d), '🚌', a.title, 'act', link);
    if (a.booking_close) add(a.booking_close, '⏰', 'آخر حجز: ' + a.title, 'dead', link);
  });
  (S.seasons || []).forEach(x => { const link = (isStaff() && can('summer.manage') ? '#/sumadmin/' : '#/season/') + x.id;
    add(x.start, '🏖️', x.title, 'sum', link); if (x.apply_close) add(x.apply_close, '⏰', 'آخر تقديم: ' + x.title, 'dead', link); });
  (S.meetings || []).forEach(m => add(m.meeting_date, '🏛️', m.title, 'gov', '#/meeting/' + m.id));
  return ev;
}
function calendarView() {
  const now = new Date(), m = S.calM || new Date(now.getFullYear(), now.getMonth(), 1), ev = calEvents();
  const first = new Date(m.getFullYear(), m.getMonth(), 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 1) % 7)); // الأسبوع يبدأ السبت
  const today = iso(now), days = [];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  const by = {}; ev.forEach(e => (by[e.date] = by[e.date] || []).push(e));
  const monthKey = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
  const upcoming = ev.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).filter((e, i, a) => a.findIndex(x => x.title === e.title && x.kind === e.kind) === i).slice(0, 8);
  return `<div class="card"><div class="row"><button class="btn sm sec" data-cal="-1">→ السابق</button><h2 style="flex:1;justify-content:center;margin:0">${MONTHS[m.getMonth()]} ${m.getFullYear()}</h2>
      <button class="btn sm sec" data-cal="0">اليوم</button><button class="btn sm sec" data-cal="1">التالي ←</button></div>
    <div class="legend"><span class="ev act">🚌 نشاط</span><span class="ev sum">🏖️ مصيف</span>${isStaff() ? '<span class="ev gov">🏛️ اجتماع</span>' : ''}<span class="ev dead">⏰ موعد نهائي</span></div>
    <div class="cal">${['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'].map(d => `<div class="cdh">${d}</div>`).join('')}
      ${days.map(d => { const k = iso(d), es = by[k] || [];
        return `<div class="cd ${k.slice(0, 7) !== monthKey ? 'out' : ''} ${k === today ? 'today' : ''}"><span class="dn">${d.getDate()}</span>
          ${es.slice(0, 3).map(e => `<a class="ev ${e.kind}" href="${e.link}" title="${esc(e.title)}">${e.icon} ${esc(e.title)}</a>`).join('')}${es.length > 3 ? `<small class="muted">+${es.length - 3}</small>` : ''}</div>`; }).join('')}</div></div>
    <div class="card"><h2>🗓️ القادم</h2>${upcoming.map(e => `<a class="kv" href="${e.link}" style="text-decoration:none;color:inherit"><span>${e.icon} ${esc(e.title)}</span><span>${dt(e.date)}</span></a>`).join('') || '<div class="empty">لا مواعيد قادمة</div>'}</div>`;
}


// ───────── كشوف الأعضاء ─────────
function memberListsView() {
  const r = S.mlist || {}, f = S.mlF || {}, fc = r.facets || {};
  const sel = (k, lbl) => `<select class="input" name="${k}" style="flex:1;min-width:130px"><option value="">${lbl}: الكل</option>${Object.entries(fc[k] || {}).sort((a, b) => b[1] - a[1])
    .filter(([v]) => v !== '—').map(([v, n]) => `<option value="${esc(v)}" ${f[k] === v ? 'selected' : ''}>${esc(v)} (${numAr(n)})</option>`).join('')}</select>`;
  const presets = [['', 'كل الأعضاء'], ['pens', '⚠️ معاش بلا تاريخ معاش'], ['phone', '📵 بلا موبايل'], ['nid', '🪪 بلا رقم قومي'], ['gen', '✅ النقابة العامة النشطين']];
  return `<div class="card"><form id="mlf" class="row">${sel('union_org', 'التنظيم')}${sel('member_state', 'الحالة')}${sel('workplace', 'جهة العمل')}${sel('job_title', 'الوظيفة')}${sel('grade', 'الدرجة')}
      <select class="input" name="missing" style="flex:1;min-width:130px"><option value="">كل البيانات</option>${[['phone', 'بلا موبايل'], ['national_id', 'بلا رقم قومي'], ['hire_date', 'بلا تاريخ تعيين'], ['retirement_date', 'معاش بلا تاريخ معاش']].map(([v, t]) => `<option value="${v}" ${f.missing === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="btn">تطبيق</button></form>
    <div class="chips" style="margin-top:10px">${presets.map(([k, t]) => `<button class="btn sm sec" data-mlp="${k}">${t}</button>`).join('')}
      <button class="btn sm gold" type="button" data-act="gaRepPrint">🏛️ تقرير وكشف الجمعية العمومية (نقابة عامة)</button></div></div>
    <div class="kpis"><div class="kpi"><i>👥</i><div><b>${numAr(r.total)}</b><small>عضو في الكشف</small></div></div>
      ${Object.entries(r.byState || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `<div class="kpi"><i>🪪</i><div><b>${numAr(v)}</b><small>${esc(k)}</small></div></div>`).join('')}</div>
    ${fixBox(r, f)}
    ${grid('mlist', [
      { t: 'الرقم الوظيفي', v: x => esc(x.job_id || ''), raw: x => x.job_id || '' },
      { t: 'الاسم', v: x => `<b>${esc(x.full_name)}</b>`, raw: x => x.full_name },
      { t: 'الموبايل', v: x => x.phone ? `<span class="dt">${esc(x.phone)}</span>` : '<span class="pill warn">—</span>', raw: x => x.phone || '' },
      { t: 'جهة العمل', v: x => esc(x.workplace || '—'), raw: x => x.workplace || '' },
      { t: 'الوظيفة', v: x => esc(x.job_title || '—'), raw: x => x.job_title || '' },
      { t: 'الدرجة', v: x => esc(x.grade || '—'), raw: x => x.grade || '' },
      { t: 'التنظيم', v: x => `<span class="pill ${x.union_org === 'النقابة العامة' ? 'ok' : 'warn'}">${esc(x.union_org || '؟')}</span>`, raw: x => x.union_org || '' },
      { t: 'الحالة', v: x => esc(x.member_state || '—'), raw: x => x.member_state || '' },
      { t: 'التعيين', v: x => dt(x.hire_date), raw: x => x.hire_date || '' },
      { t: 'المعاش', v: x => dt(x.retirement_date), raw: x => x.retirement_date || '' },
      { t: 'الأسرة', v: x => numAr(x.family), raw: x => +x.family, num: true },
    ], r.items, { title: '📋 الكشف', file: 'members-list', attr: x => `data-person="${x.id}"`, empty: 'لا أعضاء مطابقين' })}
    <div class="card"><h2>🏢 التوزيع حسب جهة العمل</h2>${bars(r.byWorkplace)}</div>`;
}


// ───────── بطاقة العضوية الرقمية ─────────
function memberCard(pr) {
  const p = pr.person, b = (pr.board || []).find(x => !x.to_date), elig = pr.eligibleToday, today = new Date().toISOString().slice(0, 10);
  return `<div class="mcard ${elig ? '' : 'ne'}"><div class="mch"><img src="img/logo-union.png" alt=""><div><b>${esc(C.ORG_NAME)}</b><small>بطاقة عضوية</small></div></div>
    <div class="mcb"><div class="mav">${esc((p.full_name || '؟').trim()[0])}</div><div style="min-width:0">
      <div class="mnm">${esc(p.full_name)}</div><div class="mjob">${esc(p.job_title || '')}${p.workplace ? ' — ' + esc(p.workplace) : ''}</div></div></div>
    <div class="mcg"><div><small>الرقم الوظيفي</small><b class="dt">${esc(p.job_id || '—')}</b></div><div><small>التنظيم</small><b>${esc(p.union_org || '—')}</b></div>
      <div><small>الحالة</small><b>${esc(p.member_state || '—')}</b></div><div><small>${b ? 'الصفة' : 'الدرجة'}</small><b>${esc(b ? b.role : (p.grade || '—'))}</b></div></div>
    <div class="mqr" id="mqr"></div>
    <div class="mcf"><span class="mst">${elig ? '✓ مستحق دعم النقابة' : 'غير مستحق الدعم حالياً'}</span><small>سارية في <span class="dt">${today}</span></small></div></div>`;
}
function cardView(pr, admin) {
  return `<div class="cardwrap">${memberCard(pr)}</div>
    <div class="card row noprint" style="justify-content:center"><button class="btn" data-act="cardPrint">🖨️ طباعة / حفظ PDF</button>${admin && can('profile.edit') ? '<button class="btn bad" data-act="cardReissue">↻ إعادة إصدار (يلغي القديمة)</button>' : ''}${admin ? '' : '<a class="btn sec" href="#/profile" style="text-decoration:none">ملفي</a>'}</div>
    <div class="muted noprint" style="text-align:center">رمز QR يفتح صفحة تحقق تؤكد صحة البطاقة وحالة العضو لحظة المسح. البطاقة تُظهر بياناتك وحالة استحقاقك كما في سجل النقابة اليوم. لو فيه خطأ قدّم «طلب تعديل» من ملفي.</div>`;
}


let qrLib;
function loadQR() { return qrLib || (qrLib = new Promise((ok, no) => { const sc = document.createElement('script');
  sc.src = 'js/qrcode.js'; sc.onload = () => ok(window.qrcode); sc.onerror = no; document.head.appendChild(sc); })); }
async function drawCardQR(personId, reissue) {
  const box = $('#mqr'); if (!box) return;
  const r = await call('SYS_CARD', { ...(personId ? { personId } : {}), ...(reissue ? { reissue: true } : {}) });
  if (!r.success) { box.innerHTML = ''; return toast(r.message, true); }
  try { const Q = await loadQR(); box.innerHTML = '';
    const q = Q(0, 'M'); q.addData(location.origin + '/#/verify/' + r.token); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  } catch (_) { box.innerHTML = ''; }
}
function verifyView(r) {
  const c = r && r.card;
  return `<div class="login"><div class="box" style="max-width:440px">
    <div class="hd"><img src="img/logo-union.png" alt=""><h1>التحقق من بطاقة العضوية</h1><div class="muted">${esc(C.ORG_NAME)}</div></div>
    ${!r ? '<div class="spin"></div>' : !c ? `<div class="alert bad" style="text-align:center;font-size:16px">✗ ${esc(r.message || 'البطاقة غير صحيحة')}</div>`
    : `<div class="alert ${c.eligible ? 'ok' : 'warn'}" style="text-align:center;font-size:16px"><b>✓ بطاقة صحيحة</b><br>${c.eligible ? 'العضو مستحق دعم النقابة اليوم' : 'العضو غير مستحق للدعم حالياً'}</div>
      ${kv('الاسم', c.full_name)}${kv('الرقم الوظيفي', c.job_id)}${kv('التنظيم', c.union_org)}${kv('الحالة', c.member_state)}${kv('جهة العمل', c.workplace)}
      ${c.board_role ? kv('الصفة', c.board_role) : ''}${kv('تاريخ الإصدار', String(c.issued_at).slice(0, 10))}${kv('وقت التحقق', String(c.checked_at).slice(0, 16).replace('T', ' '))}`}
    <a class="btn sec block" href="#/login" style="display:block;text-align:center;text-decoration:none;margin-top:14px">دخول المنصة</a></div></div>`;
}

// ───────── الأرشيف الإلكتروني (مرفقات أي سجل) ─────────
const DOC_TYPES = ['قرار', 'فاتورة', 'إيصال', 'محضر', 'مستند منحة', 'بطاقة/هوية', 'عقد', 'خطاب', 'أخرى'];
const docsBox = (type, id, title = '📎 المستندات المرفقة') => `<div class="card docbox" data-docbox="${type}:${esc(id)}"><h2>${title}</h2><div class="dbody"><div class="spin"></div></div></div>`;
const fileToB64 = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });
async function shrinkImage(file) {
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
  return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
}
async function openDoc(id) {
  const r = await call('DOC_GET', { id }); if (!r.success) return toast(r.message, true);
  const bin = Uint8Array.from(atob(r.data), ch => ch.charCodeAt(0)), url = URL.createObjectURL(new Blob([bin], { type: r.mime }));
  openModal(`<h3>${esc(r.title)}</h3>${r.mime === 'application/pdf' ? `<iframe src="${url}" class="docview"></iframe>` : `<img src="${url}" class="docimg" alt="">`}
    <div class="acts"><a class="btn" href="${url}" download="${esc(r.title)}${r.mime === 'application/pdf' ? '.pdf' : '.jpg'}" style="text-decoration:none;text-align:center">⬇️ تنزيل</a><button class="btn sec" data-close>إغلاق</button></div>`,
    m => m.querySelector('[data-close]').onclick = () => { URL.revokeObjectURL(url); closeModal(); });
}
async function loadDocBoxes() {
  for (const box of document.querySelectorAll('[data-docbox]')) {
    const [type, id] = box.dataset.docbox.split(/:(.*)/s), body = box.querySelector('.dbody');
    const r = await call('DOC_LIST', { entityType: type, entityId: id });
    if (!r.success) { box.remove(); continue; }
    body.innerHTML = `${r.items.map(d => `<div class="docrow"><span class="dicon">${d.mime === 'application/pdf' ? '📄' : '🖼️'}</span>
        <div style="flex:1;min-width:0"><b>${esc(d.title)}</b><div class="muted" style="font-size:12px">${esc(d.doc_type)} · ${Math.ceil(d.size / 1024)} ك.ب · ${esc(d.by || '')} · ${dt(String(d.at).slice(0, 10))}</div></div>
        <button class="btn sm sec" data-docopen="${d.id}">عرض</button>${r.canWrite ? `<button class="btn sm bad" data-docdel="${d.id}">حذف</button>` : ''}</div>`).join('') || '<div class="muted">لا مستندات مرفقة بعد.</div>'}
      ${r.canWrite ? `<div class="row docup"><select class="input" data-doctype style="flex:1;min-width:110px">${DOC_TYPES.map(t => `<option>${t}</option>`).join('')}</select>
        <input class="input" data-doctitle placeholder="وصف المستند (اختياري)" style="flex:2;min-width:140px">
        <label class="btn sm">📷 رفع صورة/PDF<input type="file" accept="image/*,application/pdf" data-docfile hidden></label></div>` : ''}`;
    body.querySelectorAll('[data-docopen]').forEach(b => b.onclick = () => openDoc(b.dataset.docopen));
    body.querySelectorAll('[data-docdel]').forEach(b => b.onclick = async () => {
      const reason = await uiPrompt('أدخل سبب حذف المستند المرفق (يُسجَّل في سجل التدقيق):', { title: '🗑️ حذف مستند من الأرشيف', tone: 'bad', okText: 'تأكيد الحذف', placeholder: 'مثال: رُفع بالخطأ / مستند مكرر' });
      if (!reason) return;
      const x = await call('DOC_DELETE', { id: b.dataset.docdel, reason }); if (!x.success) return toast(x.message, true); toast('اتحذف ✓'); loadDocBoxes(); });
    const fi = body.querySelector('[data-docfile]');
    if (fi) fi.onchange = async () => { const f = fi.files[0]; if (!f) return;
      try {
        let blob = f, mime = f.type;
        if (mime.startsWith('image/')) { blob = await shrinkImage(f); mime = 'image/jpeg'; }
        else if (mime !== 'application/pdf') return toast('صورة أو PDF فقط', true);
        if (blob.size > 3145728) return toast('الملف أكبر من 3 ميجا', true);
        toast('جاري الرفع…');
        const x = await call('DOC_UPLOAD', { entityType: type, entityId: id, mime, data: await fileToB64(blob),
          docType: body.querySelector('[data-doctype]').value, title: body.querySelector('[data-doctitle]').value.trim() || f.name.replace(/\.[^.]+$/, '') });
        if (!x.success) return toast(x.message, true); toast('اترفع ✓'); loadDocBoxes();
      } catch (_) { toast('تعذّر قراءة الملف', true); } };
  }
}
const ENT_DOC = { cheque: ['🧾 شيك', id => '#/cheque/' + id], payreq: ['📝 طلب صرف', () => '#/payreqs'], receipt: ['📥 مقبوضات', () => '#/receipts'], entry: ['📒 قيد', () => '#/entries'], grant: ['🎁 منحة', () => '#/grantsadmin'],
  meeting: ['🗓️ اجتماع', id => '#/meeting/' + id], decision: ['⚖️ قرار', () => '#/decisions'], person: ['👤 عضو', id => '#/person/' + id], activity: ['🚌 نشاط', id => '#/actadmin/' + id], general: ['🗂️ عام', () => '#/archive'] };
function archiveView() {
  const f = S.arcF || {};
  return `<div class="card"><form id="arcf" class="row"><input class="input" name="q" value="${esc(f.q || '')}" placeholder="بحث في وصف المستند" style="flex:2;min-width:150px">
      <select class="input" name="entityType" style="flex:1;min-width:120px"><option value="">كل السجلات</option>${Object.entries(ENT_DOC).map(([k, [t]]) => `<option value="${k}" ${f.entityType === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select class="input" name="docType" style="flex:1;min-width:120px"><option value="">كل الأنواع</option>${DOC_TYPES.map(t => `<option ${f.docType === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="btn">بحث</button></form></div>
    ${docsBox('general', 'archive', '🗂️ مستندات عامة (لوائح، خطابات، عقود…)')}
    ${grid('arc', [
      { t: 'التاريخ', v: d => dt(String(d.at).slice(0, 10)), raw: d => d.at },
      { t: 'المستند', v: d => `${d.mime === 'application/pdf' ? '📄' : '🖼️'} <b>${esc(d.title)}</b>`, raw: d => d.title },
      { t: 'النوع', v: d => esc(d.doc_type), raw: d => d.doc_type },
      { t: 'مرفق بـ', v: d => `<a href="${(ENT_DOC[d.entity_type] || ['', () => '#'])[1](d.entity_id)}">${(ENT_DOC[d.entity_type] || [d.entity_type])[0]}</a>`, raw: d => (ENT_DOC[d.entity_type] || [d.entity_type])[0] },
      { t: 'رفعه', v: d => esc(d.by || ''), raw: d => d.by || '' },
      { t: 'الحجم', v: d => Math.ceil(d.size / 1024) + ' ك.ب', raw: d => d.size, num: true },
    ], S.arc, { title: '📚 كل المستندات', file: 'archive', attr: d => `data-docopen="${d.id}"`, empty: 'لا مستندات' })}`;
}


// ───────── مركز المساعدة ─────────
const HELP = [
  // للعضو
  { who: 'm', i: '🏠', t: 'أول ما تدخل', l: '#/home', s: ['ادخل برقمك الوظيفي وآخر 4 أرقام من قوميك أو موبايلك المسجّل.', 'صفحة «أنشطتي» فيها ملخصك: استفاداتك، حجوزاتك، طلبات المنح، وأسرتك.', 'لو ملفك ناقص هتظهر لك نسبة الاكتمال — كمّله من «ملفي».'] },
  { who: 'm', i: '🪪', t: 'ملفي وتعديل بياناتي', l: '#/profile', s: ['البيانات الشخصية (موبايل، عنوان…) تعدّلها بنفسك من «تعديل».', 'البيانات الوظيفية والنقابية تتعدّل بـ«طلب تعديل» يراجعه مسئول البيانات.', 'تقدر تطبع طلب التعديل من نفس الصفحة وتتابعه من «طلباتي».'] },
  { who: 'm', i: '👨‍👩‍👧', t: 'أسرتي', l: '#/family', s: ['سجّل زوجتك وأولادك مرة واحدة — هيظهروا لك في الرحلات والمصايف والكتب.', 'تاريخ الميلاد والمرحلة الدراسية مهمين لأسعار الأطفال وكتب المدارس.'] },
  { who: 'm', i: '🎁', t: 'التقديم على منحة', l: '#/grants', s: ['اختار نوع المنحة (زواج، وفاة، مولود…) واكتب تاريخ الواقعة واسم المستفيد.', 'من «📎 المستندات» في الطلب ارفع صور المستندات من موبايلك (قسيمة، شهادة…).', 'تابع الطلب من «طلباتي»: هتشوف وصل لأنهي مرحلة ومستني مين.', 'تقدر تطبع الطلب من «🖨️ طباعة الطلب».'] },
  { who: 'm', i: '🚌', t: 'حجز رحلة أو فعالية', l: '#/trips', s: ['افتح النشاط، اختار مين جاي معاك من أسرتك، واحجز.', 'ادفع قبل انتهاء المهلة وإلا الحجز يسقط ويروح للمنتظرين.', 'بعد التأكيد اطبع «إيصال الحجز» من صفحة النشاط.', 'الإلغاء متاح من نفس الصفحة بنسبة الاسترداد الظاهرة.'] },
  { who: 'm', i: '💳', t: 'بطاقة العضوية', l: '#/card', s: ['بطاقتك الرقمية فيها رمز QR — أي حد يصوّره يتأكد إنها سليمة وإنك مستحق الدعم النهارده.', 'تقدر تطبعها أو تحفظها PDF بمقاس الكارت.'] },
  { who: 'm', i: '📋', t: 'طلباتي ومتابعتها', l: '#/myrequests', s: ['كل طلب قدّمته بخط مراحل: اللي خلص ✓ والمرحلة الحالية ومستني مين.'] },
  // للإدارة
  { who: 's', i: '📊', t: 'لوحة القيادة وصندوق الاعتمادات', l: '#/dash', s: ['لوحة القيادة: مؤشرات الأعضاء والبنك والعُهد والفائض والمزايا، ومهامك.', '«صندوق الاعتمادات» فيه كل طلب مستني إجراء من صلاحيتك أنت — افتحه واضغط «اتخاذ إجراء».', 'البحث عن أي عضو من الشريط العلوي على الكمبيوتر.'] },
  { who: 's', p: 'profile.view', i: '👥', t: 'الأعضاء والكشوف', l: '#/memberlists', s: ['«الأعضاء»: بحث بالاسم أو الرقم الوظيفي أو الموبايل ← ملف العضو 360 بتبويباته.', '«كشوف الأعضاء»: فلتر بالتنظيم والحالة والجهة والبيانات الناقصة ثم «⬇️ Excel».', 'زر «⚠️ معاش بلا تاريخ معاش» يطلّع الكشف اللي محتاج استكمال.'] },
  { who: 's', p: 'treasury.cheque.issue', i: '🧾', t: 'صرف شيك وسند الصرف', l: '#/finance', s: ['من «المالية» ← «+ صرف شيك»: المستفيد والمبلغ والغرض والقرار.', 'لو الغرض «عهدة» أو «دعم نشاط» هيظهر في «التسويات» لحد ما يتسوّى.', 'من شاشة الشيك: «🖨️ سند الصرف» للتوقيعات، و«📎 المستندات» لرفع القرار والفواتير.'] },
  { who: 's', p: 'treasury.cheque.issue', i: '📗', t: 'دفاتر الشيكات', l: '#/chqbooks', s: ['سجّل كل دفتر جديد بأول وآخر رقم — بعدها أي شيك برقم خارج الدفتر يترفض.', 'الورقة اللي اتقطعت أو اتلخبطت سجّلها «تالفة» بالسبب.', 'المنظومة بتنبهك للأرقام المتخطّاة وبتقولك الرقم التالي.'] },
  { who: 's', p: 'finance.view', i: '🏦', t: 'مطابقة كشف البنك', l: '#/bank', s: ['اكتب تاريخ الكشف ورصيده واضغط «احسب المطابقة».', 'علّم الشيكات اللي ظهرت في الكشف كـ«منصرفة» والإيداعات اللي ظهرت كـ«مودعة».', 'الباقي في جدول الشيكات = شيكات مع المستفيدين لسه ما صرفوهاش (المتقادم +6 شهور بالأحمر).', 'لو فيه فرق باقي غالباً مصاريف/فوائد بنكية — سجّلها من «المقبوضات».', 'لما الفرق يبقى صفر: «حفظ» ثم «اعتماد المطابقة».'] },
  { who: 's', p: 'treasury.cheque.issue', i: '✗', t: 'إلغاء شيك لم يُصرف', l: '#/cheques', s: ['افتح الشيك ← «✗ إلغاء الشيك» واكتب السبب.', 'بيتعمل قيد عكسي تلقائياً، ولو كان منحة بترجع «معتمد» لصرف شيك جديد.', 'الشيك المنصرف من البنك أو المسوّى مايتلغيش.'] },
  { who: 's', p: 'finance.view', i: '🧮', t: 'التسويات والعُهد المفتوحة', l: '#/settlements', s: ['كل عهدة/سلفة/رحلة/إفطار لسه ما اتسوّتش، بعمرها (المتأخر +30 و+90 يوم ملوّن).', 'افتح الشيك ← «تسوية العهدة»: تقدر تعلّم شيكات تانية لنفس صاحب العهدة (تسوية مجمّعة)، وتختار رصيد مرحّل سابق يُجلب آلياً، وتحفظ «مسودة» قبل الاعتماد.', 'عند خطأ في تسوية معتمدة: «↩️ استرجاع التسوية» بقيد عكسي وسبب، فترجع الشيكات «صادر» وتُلغى مزاياها.', 'اطبع «تقرير تسوية سلفة عهدة» (مفردة أو مجمّعة) أو «كشف العُهد المفتوحة» للمجلس.'] },
  { who: 's', p: 'treasury.receipt', i: '📥', t: 'المقبوضات وسند القبض', l: '#/receipts', s: ['«+ إيداع / تحصيل»: تحويل النقابة العامة، اشتراكات، رد عهدة، رسوم بنكية…', 'من الجدول «🖨️ سند قبض» لكل إيصال.'] },
  { who: 's', p: 'finance.view', i: '📑', t: 'القوائم المالية والموازنة', l: '#/statements', s: ['«القوائم المالية»: الإيرادات والمصروفات والمركز المالي لأي فترة، مع الطباعة الرسمية A4.', '«الموازنة»: اكتب المقدّر لكل بند واحفظ، وتابع الانحراف ونسبة التنفيذ.'] },
  { who: 's', p: 'grants.review', i: '🎁', t: 'مراجعة المنح', l: '#/grantsadmin', s: ['راجع المستندات (ومرفقاتها في «📎 المستندات») وعلّم المستلم.', 'المستوفى يعتمده المعتمِد، والمعتمد تصرفه الخزينة بشيك.'] },
  { who: 's', p: 'governance.view', i: '🏛️', t: 'المجلس والاجتماعات والقرارات', l: '#/meetings', s: ['سجّل الجلسة وجدول أعمالها، وحدد حضور الأعضاء بنقرة واحدة (أو «✓ الكل حاضر»).', 'المنظومة تحسب «💼 بدل الجلسة» للحاضرين تلقائياً، وتقدر تستورده داخل نافذة تسوية العهدة بضغطة زر فيمنع تكرار الصرف ويغذّي المزايا.', 'تُطبع المحاضر وكشوف الحضور وصرف البدلات بتوقيعات (أمين الصندوق · الأمين العام · رئيس اللجنة النقابية)، بينما سائر التقارير والسندات بتوقيعي (أمين الصندوق · رئيس اللجنة النقابية).', 'من «⚖️ القرارات»: تابع حالة التنفيذ والمسئول والموعد والمنصرف الفعلي مقابل السقف ومرفقات كل قرار.'] },
  { who: 's', p: 'users.manage', i: '🔐', t: 'المستخدمون والصلاحيات', l: '#/users', s: ['«+ مستخدم جديد»: اسم إنجليزي وكلمة مؤقتة (يغيّرها أول دخول) والأدوار.', 'شوف «مصفوفة الصلاحيات» لتعرف كل دور يقدر يعمل إيه وحدوده المالية.', 'لإيقاف موظف: افتح حسابه وشيل علامة «الحساب نشط».'] },
  { who: 's', p: 'audit.view', i: '🛡️', t: 'سجل التدقيق والأرشيف', l: '#/audit', s: ['كل تعديل في المنظومة متسجّل: مين وإمتى وإيه اللي اتغيّر (قبل/بعد).', '«الأرشيف الإلكتروني»: كل المستندات المرفوعة بالبحث والفلترة.'] },
];
function helpView() {
  const q = (S.helpQ || '').trim(), who = isStaff() ? 's' : 'm';
  const items = HELP.filter(h => (h.who === who || (who === 's' && h.who === 'm' && S.helpAll)) && (!h.p || can(h.p)))
    .filter(h => !q || (h.t + h.s.join(' ')).includes(q));
  return `<div class="card"><h2>❓ مركز المساعدة</h2><div class="muted">شرح مختصر لكل شاشة حسب صلاحياتك. اضغط على العنوان عشان تروح للشاشة.</div>
      <div class="row" style="margin-top:10px"><input class="input" id="helpq" value="${esc(q)}" placeholder="🔎 ابحث: شيك، منحة، مطابقة، حجز…" style="flex:1">
      ${isStaff() ? `<label class="row" style="gap:6px"><input type="checkbox" id="helpall" ${S.helpAll ? 'checked' : ''}> عرض شرح العضو كمان</label>` : ''}</div></div>
    <div class="dgrid">${items.map(h => `<div class="card help"><h2><a href="${h.l}">${h.i} ${esc(h.t)}</a></h2><ol>${h.s.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>`).join('') || '<div class="card empty">مفيش نتائج</div>'}</div>
    <div class="card muted">محتاج مساعدة أكتر؟ كلّم مسئول المنظومة في النقابة.</div>`;
}


// ───────── استكمال البيانات بالجملة ─────────
const parseAnyDate = v => { v = String(v || '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{5}$/.test(v)) { const d = new Date(Date.UTC(1899, 11, 30) + +v * 864e5); return d.toISOString().slice(0, 10); } // رقم تسلسلي من Excel
  return null; };
function applyPaste(mode) {
  const lines = $('#pasteBox').value.split(/\r?\n/).map(l => l.split(/\t|,|;/).map(x => x.trim())).filter(x => x[0]);
  const byJob = {}; (S.mlist.items || []).forEach(x => { if (x.job_id) byJob[String(x.job_id).trim()] = x; });
  let ok = 0; const miss = [], bad = [];
  lines.forEach(([job, val]) => { job = String(job).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)); const x = byJob[job];
    if (!x) { if (/\d/.test(job)) miss.push(job); return; }
    const v = mode === 'ret' ? parseAnyDate(val) : String(val || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '').replace(/^1(\d{9})$/, '01$1');
    if (!v || (mode === 'phone' && !/^01\d{9}$/.test(v))) { bad.push(job); return; }
    const inp = document.querySelector(`[data-fix="${x.id}"]`); if (inp) { inp.value = v; inp.classList.add('filled'); ok++; } });
  $('#pasteRes').innerHTML = `<div class="alert ${miss.length || bad.length ? 'warn' : 'ok'}" style="margin-top:6px">اتملى ${ok} صف — راجعهم (باللون الأخضر) واضغط «حفظ المكتوب».
    ${miss.length ? `<br>أرقام وظيفية مش في الكشف (${miss.length}): ${miss.slice(0, 20).map(esc).join('، ')}` : ''}${bad.length ? `<br>قيمة غير مفهومة (${bad.length}): ${bad.slice(0, 20).map(esc).join('، ')}` : ''}</div>`;
}

function fixBox(r, f) {
  const mode = f.missing === 'retirement_date' && can('profile.movement') && can('profile.edit') ? 'ret' : f.missing === 'phone' && can('profile.edit') ? 'phone' : null;
  if (!mode || !(r.items || []).length) return '';
  const rows = r.items.slice(0, 200);
  return `<div class="card fixbox"><h2>✍️ استكمال ${mode === 'ret' ? 'تواريخ المعاش' : 'أرقام الموبايل'} (${numAr(rows.length)})</h2>
    <div class="muted">${mode === 'ret' ? 'اكتب تاريخ المعاش لكل عضو (من كشف شئون العاملين) — المنظومة هتسجّله «نشط» من تعيينه لحد تاريخ المعاش، و«معاش» بعده، فمعاملاته القديمة تتقبل صح. اللي مش عارف تاريخه سيبه فاضي.' : 'اكتب الموبايل للي عندك رقمه وسيب الباقي فاضي.'}</div>
    <div class="gtw" style="margin-top:8px"><table class="bt"><thead><tr><th>الاسم</th><th>الرقم الوظيفي</th><th>${mode === 'ret' ? 'تاريخ التعيين' : 'جهة العمل'}</th><th>${mode === 'ret' ? 'تاريخ المعاش' : 'الموبايل'}</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td data-l="الاسم"><b>${esc(x.full_name)}</b></td><td data-l="الرقم">${esc(x.job_id || '')}</td><td data-l="${mode === 'ret' ? 'التعيين' : 'الجهة'}">${mode === 'ret' ? dt(x.hire_date) || '<span class="muted">—</span>' : esc(x.workplace || '—')}</td>
      <td data-l="${mode === 'ret' ? 'المعاش' : 'الموبايل'}"><input class="input fixin" data-fix="${x.id}" ${mode === 'ret' ? `type="date" min="${esc(x.hire_date || '')}" max="${new Date().toISOString().slice(0, 10)}"` : 'inputmode="tel" dir="ltr" placeholder="01xxxxxxxxx"'}></td></tr>`).join('')}</tbody></table></div>
    <details class="paste" style="margin-top:10px"><summary><b>📋 لصق من Excel</b> <span class="muted">— انسخ عمودين: الرقم الوظيفي ثم ${mode === 'ret' ? 'تاريخ المعاش' : 'الموبايل'}</span></summary>
      <textarea class="input" id="pasteBox" rows="5" dir="ltr" placeholder="${mode === 'ret' ? '97117   30/06/2020' : '97117   01012345678'}"></textarea>
      <button class="btn sm" data-act="pasteApply" data-mode="${mode}" style="margin-top:6px">مطابقة وتعبئة الجدول</button><div id="pasteRes"></div></details>
    <div class="row" style="margin-top:10px"><input class="input" id="fixReason" placeholder="مصدر البيانات (مثلاً: كشف شئون العاملين نوفمبر 2026)" style="flex:1;min-width:200px">
      <button class="btn gold" data-act="fixSave" data-mode="${mode}">💾 حفظ المكتوب</button></div><div id="fixres"></div></div>`;
}

// ───────── التقرير السنوي للجمعية العمومية ─────────
function annualView() {
  const A = S.annual || {}, y = A.year, r = A.rep || {}, m = r.members || {}, b = A.ben || {}, f = r.finance || {};
  const meets = (A.meetings || []).filter(x => String(x.meeting_date).startsWith(y)), decs = (A.decisions || []).filter(x => String(x.meeting_date).startsWith(y));
  const byCat = {}; decs.forEach(d => { byCat[d.category || 'أخرى'] = (byCat[d.category || 'أخرى'] || 0) + 1; });
  const years = r.years || [];
  const tbl = (head, rows) => `<table class="ed-tbl"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="muted">لا بيانات</td></tr>`}</tbody></table>`;
  return `<div class="card noprint row"><select class="input" id="annY" style="max-width:160px">${years.map(x => `<option ${String(x) === String(y) ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <button class="btn" data-act="annGo">عرض</button><button class="btn gold" data-act="annPrint">🖨️ طباعة / PDF</button>
      <span class="muted">تقرير مجمّع تلقائياً من المنظومة — راجعه قبل العرض على الجمعية العمومية.</span></div>
    <div class="annual">
    <div class="ann-cover"><img src="img/logo-union.png" alt=""><div style="font-size:12px;font-weight:700;color:#64748b;margin-top:6px">النقابة العامة للعاملين بالاتصالات</div><h1>${esc(C.ORG_NAME)}</h1><h2>التقرير السنوي لمجلس الإدارة عن عام ${esc(y)}</h2>
      <div class="muted">مقدَّم إلى الجمعية العمومية الموقرة — أُعد آلياً من منظومة النقابة في ${new Date().toISOString().slice(0, 10)}</div></div>
    <section><h3>أولاً: العضوية</h3>
      <p>بلغ إجمالي المسجّلين في المنظومة <b>${numAr(m.total)}</b> عضواً، موزّعين كالتالي:</p>
      <div class="ann2">${tbl(['التنظيم', 'العدد'], Object.entries(m.byOrg || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${numAr(v)}</td></tr>`))}
        ${tbl(['الحالة', 'العدد'], Object.entries(m.byState || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${numAr(v)}</td></tr>`))}</div></section>
    <section><h3>ثانياً: نشاط مجلس الإدارة</h3>
      <p>عقد المجلس <b>${numAr(meets.length)}</b> اجتماعاً خلال العام، وأصدر <b>${numAr(decs.length)}</b> قراراً.</p>
      <div class="ann2">${tbl(['الاجتماع', 'التاريخ', 'الحضور', 'القرارات'], meets.slice().reverse().map(x => `<tr><td>${esc(x.title)}</td><td>${dt(x.meeting_date)}</td><td class="c">${x.present ? numAr(x.present) + '/' + numAr(x.seats) : '—'}</td><td class="c">${numAr(x.decisions_count)}</td></tr>`))}
        ${tbl(['تصنيف القرارات', 'العدد'], Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${numAr(v)}</td></tr>`))}</div></section>
    <section><h3>ثالثاً: الموقف المالي</h3>
      <p>بلغت الإيرادات <b>${money(f.revenue)}</b> جنيه، والمصروفات <b>${money(f.expense)}</b> جنيه، بـ${+f.revenue - +f.expense >= 0 ? 'فائض' : 'عجز'} قدره <b>${money(Math.abs(+f.revenue - +f.expense))}</b> جنيه.
        ورصيد البنك الدفتري الحالي ${money(f.bank)} جنيه، والعُهد تحت التسوية ${money(f.custody)} جنيه.</p>
      ${fsTables()}</section>
    <section><h3>رابعاً: الخدمات والمزايا المقدَّمة للأعضاء</h3>
      <p>استفاد <b>${numAr(b.beneficiaries)}</b> عضواً من مزايا النقابة بإجمالي <b>${money(b.total)}</b> جنيه.</p>
      <div class="ann2">${tbl(['البند', 'المستفيدون', 'القيمة'], (b.byCategory || []).map(c => `<tr><td>${esc(c.category)}</td><td class="n">${numAr(c.people)}</td><td class="n">${money(c.total)}</td></tr>`))}
        ${tbl(['المنحة', 'المصروف', 'القيمة'], ((r.grants || {}).byType || []).map(g => `<tr><td>${esc(g.type)}</td><td class="n">${numAr(g.paid)}</td><td class="n">${money(g.amount)}</td></tr>`))}</div></section>
    <section><h3>خامساً: الأنشطة والرحلات</h3>
      ${tbl(['النشاط', 'التاريخ', 'المشاركون', 'المحصّل', 'دعم النقابة'], (r.activities || []).map(a => `<tr><td>${esc(a.title)}</td><td>${dt(a.date)}</td><td class="n">${numAr(a.people)}</td><td class="n">${money(a.collected)}</td><td class="n">${money(a.subsidy)}</td></tr>`))}
      ${(r.summer || []).length ? tbl(['المصيف', 'الحالة', 'الطلبات', 'الدعم'], r.summer.map(x => `<tr><td>${esc(x.title)}</td><td>${esc(x.status)}</td><td class="n">${numAr(x.applied)}</td><td class="n">${money(x.subsidy)}</td></tr>`)) : ''}</section>
    ${edSigs(null, 'ANNUAL-' + y)}
    </div>`;
}

// ───────── ملخص العضو ─────────
function memberStrip() {
  const s = S.mySum; if (!s) return '';
  const it = (i, v, l, href) => `<a class="kpi" href="${href}"><i>${i}</i><div><b>${v}</b><small>${l}</small></div></a>`;
  return `<div class="kpis">${it('🏅', money(s.ben), 'إجمالي استفاداتك', '#/mybenefits')}${it('🎫', numAr(s.bk), 'حجوزات قائمة', '#/mytrips')}
    ${it('🎁', numAr(s.grt), 'طلبات منح تحت الإجراء', '#/grants')}${it('👨‍👩‍👧', numAr(s.fam), 'أفراد الأسرة', '#/family')}</div>`;
}

// ───────── بوابة العضو المؤسسية (المرحلة 36) ─────────
function homeView() {
  const pr = S.me.profile, p = pr.person, c = pr.completeness;
  const elig = pr.eligibleToday, ms = S.mySum || { ben: 0, bk: 0, grt: 0, fam: (pr.family || []).length };
  const openReqs = (ms.bk || 0) + (ms.grt || 0);
  const tiles = [
    { i: '🚌', b: 'الرحلات والفعاليات', s: 'احجز لك ولأسرتك وتابع المقاعد', href: '#/trips', internal: true },
    { i: '🏖️', b: 'المصايف', s: 'قدّم على مصيف الصيف وتابع الفوج', href: '#/summer', internal: true },
    { i: '🎁', b: 'المنح والمناسبات', s: elig ? 'زواج، مولود، وفاة، تفوق، علاج' : 'لأعضاء النقابة العامة', href: '#/grants', internal: true },
    { i: '📱', b: 'أجهزة بالتقسيط', s: 'عروض التقسيط المتاحة', href: '#/devices', internal: true },
    { i: '🕋', b: 'العمرة والحج', s: 'عروض الشركات المعتمدة', href: '#/umrah', internal: true },
    { i: '📚', b: 'الكتب الخارجية', s: 'احجز كتب أولادك بالتقسيط', href: C.BOOKS_URL },
  ];
  return `<div class="mp-hero">
      <div class="mp-hero-top">
        <div>
          <h2>أهلاً بك، ${esc((p.full_name || '').split(' ').slice(0, 2).join(' '))} 👋</h2>
          <div class="mp-sub">الرقم الوظيفي: <b>${esc(p.job_id || '—')}</b>${p.workplace ? ' · ' + esc(p.workplace) : ''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="mp-badge ${elig ? 'gold' : ''}">${elig ? '✓ عضو النقابة العامة — مستحق الدعم' : esc(p.union_org || 'التنظيم غير محدد')}</span>
          ${p.member_state ? `<span class="mp-badge">${esc(p.member_state)}</span>` : ''}
        </div>
      </div>
      <div class="mp-stats">
        <a class="mp-stat" href="#/mybenefits"><small>إجمالي استفاداتي</small><b>${money(ms.ben || 0)} ج</b></a>
        <a class="mp-stat" href="#/myrequests"><small>طلبات وحجوزات جارية</small><b>${numAr(openReqs)}</b></a>
        <a class="mp-stat" href="#/family"><small>أفراد الأسرة المسجّلون</small><b>${numAr(ms.fam || 0)}</b></a>
        <a class="mp-stat" href="#/profile"><small>اكتمال الملف الشخصي</small><b>${numAr(c.percent)}%</b></a>
      </div>
    </div>
    ${c.percent < 100 ? `<a class="card" style="display:block;text-decoration:none;color:inherit" href="#/profile">
      <h2>ملفك الشخصي مكتمل بنسبة ${numAr(c.percent)}%<span class="sp"></span><span class="pill warn">استكمال البيانات</span></h2>
      <div class="prog"><div style="width:${c.percent}%"></div></div>
      <div class="muted" style="margin-top:4px">البيانات الناقصة: ${c.missing.map(esc).join('، ')}</div></a>` : ''}
    <div class="mp-docs">
      <button type="button" class="mp-doc gold" data-act="prtMemberCert"><i>📜</i><div><b>إفادة عضوية نقابية رسمية</b><small>معاينة وطباعة إفادة معتمدة بـ QR</small></div></button>
      <button type="button" class="mp-doc" data-act="prtMemberBen"><i>🏅</i><div><b>كشف استفاداتي المعتمد</b><small>تقرير المنح والدعم والتوفير</small></div></button>
      <a class="mp-doc" href="#/card"><i>💳</i><div><b>بطاقة العضوية الرقمية</b><small>اعرض البطاقة أو اطبعها</small></div></a>
      <a class="mp-doc" href="#/tickets"><i>💬</i><div><b>الشكاوى والمقترحات</b><small>تواصل مباشر مع اللجنة النقابية</small></div></a>
    </div>
    ${installCard()}
    ${(S.homeNews || []).length ? `<div class="card"><h2>📰 أحدث أخبار وإعلانات النقابة<span class="sp"></span><a href="#/news" class="pill" style="text-decoration:none">كل الأخبار</a></h2>
      ${S.homeNews.map(n => newsItem(n, false)).join('')}</div>` : ''}
    <div class="card" style="padding-bottom:10px"><h2 style="margin-bottom:10px">🎯 الخدمات النقابية والأنشطة</h2>
      <div class="tiles">${tiles.map(t => `<a class="tile" href="${esc(t.href)}" ${t.internal ? '' : 'target="_blank" rel="noopener"'}><i>${t.i}</i><b>${t.b}</b><small>${esc(t.s)}</small></a>`).join('')}</div>
    </div>`;
}

function memberCertHTML(pr) {
  const p = (pr && pr.person) || {};
  const today = new Date().toISOString().slice(0, 10);
  const elig = pr && pr.eligibleToday;
  return erpDoc({
    compact: true,
    dept: 'شئون العضوية والسجلات النقابية', kind: 'إفادة عضوية رسمية', code: 'CERT',
    refLbl: 'الرقم الوظيفي', refNo: p.job_id || '—', date: today,
    ctrl: [['التنظيم النقابي', p.union_org || '—'], ['حالة العضوية', p.member_state || '—']],
    title: 'إفادة قيد وعضوية نقابية رسمية',
    sub: 'صادرة آلياً من سجل العضوية المعتمد باللجنة النقابية',
    status: elig ? 'عضوية سارية — مستحق الدعم' : (p.member_state || 'مقيّد'),
    statusCls: elig ? 'ok' : 'warn',
    body: `<div class="ed-box gold" style="font-size:14px;line-height:2;padding:14px 16px">
        تشهد <b>${esc(C.ORG_NAME)}</b> بأن السيد/ <b>${esc(p.full_name || '—')}</b>، الحامل للرقم الوظيفي (<b>${esc(p.job_id || '—')}</b>)،
        ${p.national_id ? `والرقم القومي (<b>${esc(p.national_id)}</b>)،` : ''}
        مقيّد بسجلات اللجنة النقابية وفق البيانات الموضحة أدناه، وقد أُعطيت له هذه الإفادة بناءً على طلبه لتقديمها لمن يهمه الأمر دون أدنى مسئولية مالية على اللجنة.
      </div>`
      + edGrid([
        [6, 'الاسم الرباعي', `<b>${esc(p.full_name || '—')}</b>`],
        [3, 'الرقم الوظيفي', `<b>${esc(p.job_id || '—')}</b>`],
        [3, 'الرقم القومي', esc(p.national_id || '—')],
        [6, 'جهة العمل الحالية', esc(p.workplace || '—')],
        [3, 'الوظيفة / الدرجة', esc([p.job_title, p.grade].filter(Boolean).join(' — ') || '—')],
        [3, 'تاريخ التعيين', p.hire_date ? dt(p.hire_date) : '—'],
        [4, 'التنظيم النقابي', `<b>${esc(p.union_org || '—')}</b>`],
        [4, 'حالة القيد الحالية', `<b>${esc(p.member_state || '—')}</b>`],
        [4, 'الاستحقاق للدعم النقابي', elig ? '<b class="ed-in">مستحق للدعم والمنح ✓</b>' : 'غير مستحق حالياً'],
      ])
      + `<div class="ed-box">يُمكن التحقق من صحة وسريان هذه الإفادة عبر مسح رمز الاستجابة السريعة (QR) المطبوع بأعلى المستند أو مراجعة إدارة العضوية باللجنة.</div>`
  });
}

function memberBenefitsPrintHTML(pr, ben) {
  const p = (pr && pr.person) || {}, items = (ben && ben.items) || [];
  const tot = +((ben && ben.total) || 0);
  const rows = items.map((x, i) => `<tr>
    <td class="c">${numAr(i + 1)}</td>
    <td class="c" style="white-space:nowrap">${dt(x.benefit_date || x.date)}</td>
    <td><b>${esc(x.category || x.kind || '—')}</b></td>
    <td>${esc(x.description || x.notes || '—')}</td>
    <td class="n"><b>${money(x.amount)}</b></td>
  </tr>`).join('') || '<tr><td colspan="5" class="c">لا توجد استفادات مسجّلة حتى تاريخه</td></tr>';
  return erpDoc({
    dept: 'إدارة المزايا والخدمات النقابية', kind: 'كشف استفادات عضو', code: 'BEN-MEM',
    refLbl: 'الرقم الوظيفي', refNo: p.job_id || '—',
    title: 'كشف بيان الاستفادات والمزايا النقابية للعضو',
    sub: `${esc(p.full_name || '—')} — ${esc(p.workplace || 'اللجنة النقابية')}`,
    status: `${numAr(items.length)} بند استفادة`, statusCls: 'ok',
    body: edMoney(tot, 'إجمالي ما استفاد به العضو من المنح والدعم والتوفير')
      + edGrid([
        [6, 'اسم العضو', `<b>${esc(p.full_name || '—')}</b>`],
        [3, 'الرقم الوظيفي', esc(p.job_id || '—')],
        [3, 'جهة العمل', esc(p.workplace || '—')],
      ])
      + `<div class="ed-sec">بيان الاستفادات المسجّلة بسجل المزايا (${numAr(items.length)} بند)</div>
        <table class="ed-tbl"><thead><tr><th class="c" style="width:32px">م</th><th class="c" style="width:82px">التاريخ</th><th style="width:140px">نوع الاستفادة</th><th>البيان والتفاصيل</th><th class="n" style="width:100px">القيمة (ج.م)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th colspan="4">الإجمالي العام للاستفادات</th><th class="n">${money(tot)}</th></tr></tfoot></table>`
  });
}

function ticketsView() {
  const data = S.tickets || { staff: false, items: [] }, items = data.items || [], staff = !!data.staff;
  const stCls = s => s === 'تم الرد' ? 'replied' : s === 'مغلق' ? 'closed' : '';
  const stPillT = s => `<span class="pill ${s === 'تم الرد' ? 'ok' : s === 'مغلق' ? '' : 'warn'}">${esc(s)}</span>`;
  return `${!staff ? `<div class="card"><h2>💬 إرسال شكوى أو مقترح أو استفسار للجنة النقابية</h2>
      <form id="tktf">
        <div class="grid2">
          <label class="f"><span>التصنيف</span><select class="input" name="category">${options(['استفسار', 'شكوى', 'مقترح تطوير', 'طلب إفادة / مستند', 'مشكلة في البيانات'], 'استفسار', false)}</select></label>
          <label class="f"><span>عنوان الرسالة</span><input class="input" name="subject" required placeholder="ملخص قصير للموضوع…"></label>
        </div>
        <label class="f"><span>التفاصيل</span><textarea class="input" name="body" rows="3" required placeholder="اكتب التفاصيل كاملة ليتمكن مجلس الإدارة من خدمتك بسرعة…"></textarea></label>
        <div id="ferr"></div>
        <div class="acts"><button class="btn gold" type="submit">📨 إرسال للجنة النقابية</button></div>
      </form></div>` : `<div class="card row" style="align-items:center">
      <div><h2 style="margin:0">💬 صندوق شكاوى ومقترحات الأعضاء</h2><div class="muted">الرد على أي رسالة يُرسل إشعاراً فورياً في بوابة العضو.</div></div>
      <span class="sp"></span>
      <span class="pill ${data.openCount ? 'warn' : 'ok'}">${numAr(data.openCount || 0)} رسالة مفتوحة</span>
    </div>`}
    <div class="card"><h2>${staff ? `📋 جميع الرسائل الواردة (${numAr(items.length)})` : `📋 رسائلي السابقة ومتابعة الردود (${numAr(items.length)})`}</h2>
      ${items.map(t => `<div class="tkt-card ${stCls(t.status)}">
        <div class="row" style="align-items:center;gap:8px">
          <span class="pill">${esc(t.ticket_no)}</span>
          <span class="pill">${esc(t.category)}</span>
          <b>${esc(t.subject)}</b>
          <span class="sp"></span>
          ${stPillT(t.status)}
        </div>
        ${staff ? `<div class="muted" style="font-size:12.5px;margin-top:4px">👤 <b>${esc(t.full_name)}</b> (${esc(t.job_id || '—')})${t.workplace ? ' · ' + esc(t.workplace) : ''} · ${dt(t.created_at)}</div>`
                : `<div class="muted" style="font-size:12px;margin-top:4px">تاريخ الإرسال: ${dt(t.created_at)}</div>`}
        <div style="margin-top:6px;line-height:1.7">${esc(t.body)}</div>
        ${t.reply ? `<div class="tkt-reply"><b>✓ رد الإدارة (${esc(t.replied_by || 'اللجنة النقابية')} — ${dt(t.replied_at)}):</b><div style="margin-top:3px">${esc(t.reply)}</div></div>` : ''}
        ${staff ? `<div class="row" style="margin-top:8px"><button class="btn sm ${t.reply ? 'sec' : 'gold'}" data-tktrpl="${t.id}">${t.reply ? '✏️ تحديث الرد' : '↩️ الرد على العضو'}</button></div>` : ''}
      </div>`).join('') || '<div class="empty">لا توجد رسائل مسجّلة حتى الآن</div>'}
    </div>`;
}

function activationsView() {
  const data = S.actvs || { items: [], pendingCount: 0 }, items = data.items || [];
  return `<div class="card row" style="align-items:center">
      <div><h2 style="margin:0">🔑 طلبات تفعيل حسابات الأعضاء (تحديث الرقم القومي)</h2>
      <div class="muted">الأعضاء الذين لم يكن رقمهم القومي مسجّلاً بقاعدة البيانات وأرسلوا بياناتهم لتفعيل دخول بوابة العضو.</div></div>
      <span class="sp"></span><span class="pill ${data.pendingCount ? 'warn' : 'ok'}">${numAr(data.pendingCount || 0)} بانتظار المراجعة</span>
    </div>
    ${grid('actv', [
      { t: 'التاريخ', v: x => dt(x.created_at), raw: x => x.created_at },
      { t: 'الرقم الوظيفي', v: x => `<b>${esc(x.job_id)}</b>`, raw: x => x.job_id },
      { t: 'الاسم بالقاعدة', v: x => `<b>${esc(x.full_name)}</b>`, raw: x => x.full_name },
      { t: 'الرقم القومي المقدّم', v: x => `<span class="dt">${esc(x.national_id)}</span>`, raw: x => x.national_id },
      { t: 'الموبايل', v: x => `<span class="dt">${esc(x.phone)}</span>`, raw: x => x.phone },
      { t: 'الحالة', v: x => `<span class="pill ${x.status === 'معتمد' ? 'ok' : x.status === 'مرفوض' ? 'bad' : 'warn'}">${esc(x.status)}</span>`, raw: x => x.status },
      { t: 'إجراء', v: x => x.status === 'معلّق' ? `<div class="row" style="gap:4px"><button class="btn sm ok" data-actvok="${x.id}">✓ اعتماد وتفعيل</button><button class="btn sm bad" data-actvno="${x.id}">✕ رفض</button></div>` : esc(x.notes || '—'), raw: () => '' },
    ], items, { title: '📋 سجل طلبات التفعيل', file: 'activation-requests', empty: 'لا توجد طلبات تفعيل معلّقة 👌' })}`;
}

// ───────── ملفي ─────────
const kv = (k, v) => `<div class="kv"><span>${esc(k)}</span><span>${v == null || v === '' ? '<span class="muted">—</span>' : esc(v)}</span></div>`;
function profileBody(pr, admin, part) {
  const p = pr.person, c = pr.completeness, em = p.emergency || {};
  const reqPending = (pr.requests || []).filter(r => r.status === 'معلّق');
  const P = {}; P.head = `
  <div class="card"><h2>${esc(p.full_name)}<span class="sp"></span>
      <span class="pill ${pr.eligibleToday ? 'ok' : 'warn'}">${pr.eligibleToday ? 'مستحق الدعم' : 'غير مستحق الدعم'}</span></h2>
    <div class="muted">الرقم الوظيفي ${esc(p.job_id || '—')}</div>
    <div class="prog"><div style="width:${c.percent}%"></div></div>
    <div class="row"><b>الملف مكتمل ${c.percent}%</b></div>
    ${c.missing.length ? `<div class="chips" style="margin-top:6px">${c.missing.map(m => `<span class="chip">${esc(m)}</span>`).join('')}</div>` : ''}
  </div>`; P.job = `
  <div class="card"><h2>🏢 البيانات الوظيفية والنقابية<span class="sp"></span>
      ${admin ? (can('profile.movement') ? '<button class="btn sm" data-act="movement">+ حركة</button>' : '')
              : '<button class="btn sm sec" data-act="request">طلب تعديل</button>'}
      ${admin && can('profile.edit') ? '<button class="btn sm sec" data-act="editAdmin">تعديل</button>' : ''}</h2>
    ${kv('التنظيم النقابي', p.union_org)}${kv('الحالة', p.member_state)}${kv('جهة العمل', p.workplace)}
    ${kv('الوظيفة', p.job_title)}${kv('الدرجة', p.grade)}${kv('الرقم القومي', p.national_id)}
    ${kv('تاريخ التعيين', p.hire_date)}${kv('الرقم التأميني', p.insurance_no)}
    ${p.monthly_dues != null ? kv('الاستقطاع الشهري', p.monthly_dues + ' ج') : ''}
    ${reqPending.length ? `<div class="alert warn" style="margin-top:10px">طلبات تعديل تحت المراجعة: ${reqPending.map(r => esc(FIELD_LBL[r.field] || r.field) + ' ← ' + esc(r.new_value)).join(' · ')}
      <button class="btn sm sec" data-act="myCrPrint" style="margin-inline-start:8px">🖨️ طباعة الطلب</button></div>` : ''}
  </div>`; P.personal = `
  <div class="card"><h2>📇 ${admin ? "البيانات الشخصية" : "بياناتي الشخصية"}<span class="sp"></span>
      ${(!admin || can('profile.edit')) ? '<button class="btn sm sec" data-act="editSelf">تعديل</button>' : ''}</h2>
    ${kv('الموبايل', p.phone)}${kv('موبايل 2', p.phone2)}${kv('البريد', p.email)}${kv('العنوان', p.address)}
    ${kv('المؤهل', p.qualification)}${kv('التخصص', p.specialization)}${kv('الحالة الاجتماعية', p.marital_status)}
    ${kv('النوع', p.gender)}${kv('تاريخ الميلاد', p.birth_date)}${kv('فصيلة الدم', p.blood_type)}
    ${kv('للطوارئ', em.name ? `${em.name} (${em.relation || ''}) ${em.phone || ''}` : '')}
  </div>`; P.board = `
  ${(pr.board || []).length ? `<div class="card"><h2>🏛️ ${admin ? 'عضوية المجلس' : 'عضويتي في المجلس'}</h2>
    <div class="tl">${pr.board.map(b => `<div class="it"><b>${esc(b.role)}</b>
      <div class="muted">${esc(b.term)} · من ${dt(b.from_date)}${b.to_date ? ' إلى ' + dt(b.to_date) : ' — حتى الآن'} · ${esc(b.join_method)}</div></div>`).join('')}</div></div>` : ''}`;
  P.career = `<div class="card"><h2>🕓 ${admin ? 'المسيرة الوظيفية' : 'مسيرتي'}</h2>${movementsHTML(pr)}</div>`;
  return part ? P[part] : P.head + P.job + P.personal + P.board + P.career;
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
    if (!(await uiConfirm(`هل تريد إزالة «${m.full_name}» من أفراد الأسرة الحاليين؟ ستظل البيانات التاريخية محفوظة في السجل.`, { title: '🗑️ حذف فرد من الأسرة', tone: 'bad', okText: 'حذف من الأسرة' }))) return;
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
      <a class="btn sec block" href="#/help" style="margin-top:14px;display:block;text-align:center;text-decoration:none">❓ مركز المساعدة</a>
      <button class="btn bad block" style="margin-top:10px" data-act="logout">تسجيل الخروج</button></div>`;
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
  const p = pr.person, c = pr.completeness, b = S.personBen, fam = pr.family || [], board = (pr.board || []).find(x => !x.to_date);
  const tab = S.ptab || 'data';
  const tabs = [['data', '🏢 البيانات'], ['family', `👨‍👩‍👧 الأسرة (${fam.length})`], ['ben', '🏅 المزايا', !!b], ['career', '🕓 المسيرة'], ['board', '🏛️ المجلس', (pr.board || []).length > 0], ['card', '💳 البطاقة'], ['docs', '📎 المستندات']].filter(t => t[2] !== false);
  const kpi = (i, v, l, t) => `<a class="kpi" ${t ? `data-ptab="${t}"` : ''}><i>${i}</i><div><b>${v}</b><small>${l}</small></div></a>`;
  const body = tab === 'docs' ? docsBox('person', p.id, '📎 مستندات العضو (بطاقة، مؤهل، قرارات…)') : tab === 'card' ? cardView(pr, true) : tab === 'family' ? familyView(pr, true) : tab === 'ben' ? benefitsBody(b, '🏅 ما استفاد به من النقابة', can('benefits.manage')) : tab === 'career' ? profileBody(pr, true, 'career')
    : tab === 'board' ? profileBody(pr, true, 'board') : `<div class="dgrid">${profileBody(pr, true, 'job')}${profileBody(pr, true, 'personal')}</div>`;
  return `<a href="#/admin" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ الأعضاء</a>
    <div class="card p360"><div class="pav">${esc((p.full_name || '؟').trim()[0])}</div>
      <div class="pinfo"><h1>${esc(p.full_name)}</h1>
        <div class="muted">${esc(p.job_title || '—')} · ${esc(p.workplace || '—')} · رقم وظيفي ${esc(p.job_id || '—')}</div>
        <div class="row" style="margin-top:6px"><span class="pill ${pr.eligibleToday ? 'ok' : 'warn'}">${pr.eligibleToday ? 'مستحق الدعم' : 'غير مستحق الدعم'}</span>
          ${p.union_org ? `<span class="pill">${esc(p.union_org)}</span>` : ''}${p.member_state ? `<span class="pill ${p.member_state === 'نشط' ? 'ok' : 'warn'}">${esc(p.member_state)}</span>` : ''}
          ${board ? `<span class="pill ok">🏛️ ${esc(board.role)}</span>` : ''}</div></div>
      <div class="pacts">${can('profile.movement') ? '<button class="btn sm" data-act="movement">+ حركة</button>' : ''}${can('profile.edit') ? '<button class="btn sm sec" data-act="editAdmin">تعديل</button>' : ''}</div></div>
    <div class="kpis">${b ? kpi('🏅', money(b.total), 'إجمالي ما استفاد به', 'ben') : ''}${kpi('👨‍👩‍👧', numAr(fam.length), 'أفراد الأسرة', 'family')}
      ${kpi('📋', c.percent + '%', 'اكتمال الملف' + (c.missing.length ? ' — ناقص ' + c.missing.length : ''), 'data')}${kpi('🕓', numAr((pr.movements || []).length), 'حركة مسجّلة', 'career')}</div>
    ${c.missing.length ? `<div class="alert warn">بيانات ناقصة: ${c.missing.map(esc).join('، ')}</div>` : ''}
    <div class="subtabs">${tabs.map(([k, t]) => `<button data-ptab="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    ${body}`;
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
        <button class="btn sm bad" data-act="reject" data-id="${r.id}">رفض</button><button class="btn sm sec" data-crprint="${r.id}">🖨️ طباعة</button></div></div>`).join('')
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
const govTabs = act => `<div class="subtabs">${[['#/board', '🏛️ تشكيل المجلس والمقاعد'], ['#/meetings', '🗓️ الجلسات والمحاضر'], ['#/decisions', '⚖️ سجل ومتابعة القرارات']]
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
const EXEC_STATES = ['لم يبدأ', 'قيد التنفيذ', 'منفّذ', 'لا يتطلب تنفيذ'];
const execPill = s => `<span class="pill ${s === 'منفّذ' ? 'ok' : s === 'قيد التنفيذ' ? 'warn' : s === 'لم يبدأ' ? 'bad' : ''}">${esc(s || 'لم يبدأ')}</span>`;

// ───────── المحرك المؤسسي الموحّد للمستندات والسندات والتقارير الرسمية (ERP Document Engine) ─────────
function tafqeetInt(n) {
  n = Math.floor(Math.abs(n));
  if (!n) return '';
  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
    'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hunds = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  const sub1000 = x => {
    const p = [], h = Math.floor(x / 100), r = x % 100;
    if (h) p.push(hunds[h]);
    if (r > 0 && r < 20) p.push(ones[r]);
    else if (r >= 20) { const o = r % 10, t = Math.floor(r / 10); p.push(o ? ones[o] + ' و' + tens[t] : tens[t]); }
    return p.join(' و');
  };
  const parts = [], mil = Math.floor(n / 1e6), th = Math.floor((n % 1e6) / 1e3), rem = n % 1e3;
  if (mil === 1) parts.push('مليون');
  else if (mil === 2) parts.push('مليونان');
  else if (mil >= 3 && mil <= 10) parts.push(sub1000(mil) + ' ملايين');
  else if (mil > 10) parts.push(sub1000(mil) + ' مليوناً');
  if (th === 1) parts.push('ألف');
  else if (th === 2) parts.push('ألفان');
  else if (th >= 3 && th <= 10) parts.push(sub1000(th) + ' آلاف');
  else if (th > 10) parts.push(sub1000(th) + ' ألفاً');
  if (rem > 0) parts.push(sub1000(rem));
  return parts.join(' و');
}
function tafqeet(amount) {
  const v = Math.abs(+(amount || 0)), egp = Math.floor(v + 1e-6), pt = Math.round((v - egp) * 100);
  if (!egp && !pt) return 'صفر جنيه مصري لا غير';
  const unit = (n, pl, acc, sg) => { const r = n % 100; return r >= 3 && r <= 10 ? pl : r >= 11 ? acc : sg; };
  const parts = [];
  if (egp > 0) parts.push(tafqeetInt(egp) + ' ' + unit(egp, 'جنيهات مصرية', 'جنيهاً مصرياً', 'جنيه مصري'));
  if (pt > 0) parts.push(tafqeetInt(pt) + ' ' + unit(pt, 'قروش', 'قرشاً', 'قرش'));
  return 'فقط وقدره ' + parts.join(' و') + ' لا غير';
}
function getOfficialSigs(sigs) {
  if (sigs && (sigs.treasurer || sigs.secretary || sigs.chair)) return sigs;
  if (S.gov && S.gov.signatories) return S.gov.signatories;
  const seats = (S.gov && S.gov.term && S.gov.term.seats || []).filter(s => !s.to_date);
  const byRole = r => (seats.find(s => s.role === r) || {}).full_name || '';
  return { treasurer: byRole('أمين الصندوق'), secretary: byRole('الأمين العام'), chair: byRole('رئيس المجلس') };
}
const govMinutesSigs = s => [
  ['أمين الصندوق', s.treasurer],
  ['الأمين العام', s.secretary],
  ['رئيس اللجنة النقابية', s.chair],
];
function edSigs(customCols, refCode = '', sigsObj = null) {
  const s = getOfficialSigs(sigsObj);
  const cols = customCols || [
    ['أمين الصندوق', s.treasurer],
    ['رئيس اللجنة النقابية', s.chair],
  ];
  const stampTime = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `<div class="ed-foot">
    <div class="ed-sigs" style="grid-template-columns:repeat(${cols.length},1fr)">
      ${cols.map(([role, name]) => `<div class="ed-sig"><div class="ed-sig-hd">${esc(role)}</div>
        <div class="ed-sig-bd"><div class="ed-sig-nm" data-sigrole="${esc(role)}">${esc(name || '')}</div><div class="ed-sig-ln">التوقيع: ........................</div></div></div>`).join('')}
    </div>
    <div class="ed-sealrow">
      <span>مستند رسمي صادر آلياً من منظومة النقابة (ERP)${refCode ? ' · مرجع: <b>' + esc(refCode) + '</b>' : ''}</span>
      <span class="ed-seal">خاتم اللجنة النقابية المعتمد</span>
      <span>تاريخ الطباعة: ${stampTime}</span>
    </div></div>`;
}
const edMoney = (amt, lbl = 'المبلغ الإجمالي') => `<div class="ed-moneybox">
  <div class="ed-mnum"><small>${esc(plain(lbl))}</small><b>${money(amt)} ج.م</b></div>
  <div class="ed-mwords"><small>المبلغ بالحروف العربية (التفقيط المعتمد)</small><b>${esc(tafqeet(amt))}</b></div></div>`;
const edGrid = cells => `<div class="ed-grid">${cells.map(([sp, lbl, val]) =>
  `<div class="ed-f s${sp}"><span class="ed-fl">${esc(plain(lbl))}</span><div class="ed-fv">${val || '—'}</div></div>`).join('')}</div>`;

function erpDoc(o) {
  const refNo = String(o.refNo || '—'), docDate = o.date || new Date().toISOString().slice(0, 10);
  const qrPayload = o.qrData || `NEKABA-ERP|${o.code || 'DOC'}|${encodeURI(refNo).slice(0, 48)}|${docDate}`;
  const ctrlRows = [[o.refLbl || 'رقم المستند', refNo], ['التاريخ', dt(docDate)], ...(o.ctrl || [])];
  const sigCols = o.sigCols ? o.sigCols(getOfficialSigs(o.sigs)) : null;
  return `<div class="erp-doc${o.compact ? ' compact-a4' : ''}" data-doctitle="${esc(plain(o.title))}">
    <div class="ed-crown"></div>
    <div class="ed-inner">
      <img class="ed-wm" src="img/logo-union.png" alt="">
      <div class="ed-body">
        <div class="ed-mast">
          <div class="ed-org">
            <div class="ed-sub">النقابة العامة للعاملين بالاتصالات</div>
            <div class="ed-name">${esc(C.ORG_NAME)}</div>
            <span class="ed-dept">${esc(plain(o.dept || 'الإدارة العامة'))}</span>
          </div>
          <div class="ed-crest">
            <div class="ed-crest-ring"><img src="img/logo-union.png" alt=""></div>
            <span class="ed-kind">${esc(plain(o.kind || 'مستند رسمي معتمد'))}</span>
          </div>
          <div class="ed-ctrl">
            <div class="ed-ctrl-rows">${ctrlRows.map(([k, v]) => `<div class="ed-ctrl-r"><span>${esc(plain(k))}</span><b>${esc(plain(v || '—'))}</b></div>`).join('')}</div>
            <div class="ed-qr" data-dqr="${esc(qrPayload)}"></div>
          </div>
        </div>
        <div class="ed-banner">
          <div><h1>${o.title}</h1>${o.sub ? `<small>${o.sub}</small>` : ''}</div>
          ${o.status ? `<span class="ed-st ${o.statusCls || ''}">${esc(plain(o.status))}</span>` : ''}
        </div>
        ${o.body || ''}
        ${edSigs(sigCols, refNo, o.sigs)}
      </div>
    </div></div>`;
}

function meetingMinutesHTML(m) {
  const q = m.seats ? m.present >= Math.floor(m.seats / 2) + 1 : false;
  const attRows = (m.attendance.length ? m.attendance : (m.board || []).map(b => ({ ...b, status: '—' })))
    .map((a, i) => `<tr><td class="c">${numAr(i + 1)}</td><td><b>${esc(a.full_name)}</b></td><td>${esc(a.role || 'عضو مجلس إدارة')}</td><td class="c">${esc(a.status)}</td><td>${esc(a.notes || '')}</td></tr>`).join('');
  const decHtml = (m.decisions || []).map(d => `<div class="ed-box">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px">
      <b style="color:#0f3d5e">قرار رقم (${esc(d.decision_no)}) — [${esc(d.category)}]</b>
      <small style="font-weight:700;color:#475569">${d.amount != null && +d.amount > 0 ? 'السقف المالي: ' + money(d.amount) + ' ج · ' : ''}${esc(d.status)}</small>
    </div>
    <div>${esc(d.text)}</div>
    ${d.votes_for != null ? `<div style="font-size:11.5px;color:#475569;margin-top:4px;border-top:1px dashed #cbd5e1;padding-top:3px">نتيجة التصويت: موافق (${numAr(d.votes_for)}) · معترض (${numAr(d.votes_against ?? 0)}) · ممتنع (${numAr(d.votes_abstain ?? 0)})</div>` : ''}</div>`).join('')
    || '<div class="ed-box">لم تصدر قرارات مسجّلة في هذه الجلسة.</div>';
  return erpDoc({
    dept: 'أمانة سر مجلس الإدارة', kind: 'وثيقة حوكمة رسمية',
    refLbl: 'رقم الجلسة', refNo: `MTG-${m.meeting_no}`, date: m.meeting_date,
    ctrl: [['نوع الجلسة', m.kind]],
    title: 'محضر اجتماع مجلس الإدارة', sub: `${esc(m.title)} — ${esc(m.term_title || '')}`,
    status: m.present ? (q ? 'نصاب قانوني مكتمل' : 'أقل من النصاب') : m.status, statusCls: m.present ? (q ? 'ok' : 'bad') : 'warn',
    sigs: m.signatories, sigCols: govMinutesSigs,
    body: edGrid([
      [3, 'رقم الجلسة', `جلسة رقم (${numAr(m.meeting_no)})`],
      [3, 'تاريخ الانعقاد', dt(m.meeting_date)],
      [3, 'وقت الانعقاد', esc(m.meeting_time || '—')],
      [3, 'النصاب القانوني', m.present ? `${numAr(m.present)} من ${numAr(m.seats)} عضو` : 'غير مسجّل'],
      [12, 'مقر الانعقاد', esc(m.venue || 'مقر اللجنة النقابية')],
    ]) + `<div class="ed-sec">أولاً: إثبات حضور أعضاء مجلس الإدارة</div>
      <table class="ed-tbl"><thead><tr><th style="width:38px" class="c">م</th><th>اسم عضو المجلس</th><th>الصفة بالمجلس</th><th class="c" style="width:95px">حالة الحضور</th><th>ملاحظات</th></tr></thead><tbody>${attRows}</tbody></table>
      ${(m.agenda || []).length ? `<div class="ed-sec">ثانياً: جدول الأعمال المعروض</div><div class="ed-box gold"><ol style="margin:0;padding-inline-start:20px">${m.agenda.map(a => `<li>${esc(a)}</li>`).join('')}</ol></div>` : ''}
      <div class="ed-sec">${(m.agenda || []).length ? 'ثالثاً' : 'ثانياً'}: القرارات الصادرة عن المجلس (${numAr((m.decisions || []).length)})</div>${decHtml}
      ${m.notes ? `<div class="ed-sec">ملاحظات ختامية</div><div class="ed-box">${esc(m.notes)}</div>` : ''}
      <div style="font-size:12px;color:#334155;margin-top:8px">أُقفل المحضر عقب تلاوته والتصديق عليه من السادة الحاضرين في تاريخه وساعته.</div>`
  });
}
function attendanceSheetHTML(m, blank = false) {
  const list = !blank && m.attendance && m.attendance.length ? m.attendance : (m.board || []);
  const rows = list.map((a, i) => `<tr><td class="c">${numAr(i + 1)}</td><td><b>${esc(a.full_name)}</b></td><td class="c">${esc(a.job_id || '—')}</td><td>${esc(a.role || 'عضو مجلس إدارة')}</td>
    <td class="c">${blank ? '' : esc(a.status || '')}</td><td style="width:28%"></td></tr>`).join('');
  return erpDoc({
    compact: true,
    dept: 'أمانة سر مجلس الإدارة', kind: blank ? 'نموذج توقيع حي' : 'كشف حضور رسمي',
    refLbl: 'رقم الجلسة', refNo: `ATT-${m.meeting_no}`, date: m.meeting_date,
    title: 'كشف حضور وتوقيع أعضاء مجلس الإدارة', sub: esc(m.title),
    status: blank ? 'نموذج للتوقيع الحي' : `${numAr(m.present || 0)} حاضر من ${numAr(m.seats || list.length)}`, statusCls: blank ? 'warn' : 'ok',
    sigs: m.signatories, sigCols: govMinutesSigs,
    body: edGrid([
      [3, 'رقم الجلسة', numAr(m.meeting_no)], [3, 'التاريخ', dt(m.meeting_date)],
      [3, 'الوقت', esc(m.meeting_time || '—')], [3, 'المقر', esc(m.venue || 'مقر اللجنة')],
    ]) + `<div class="ed-sec">بيان السادة أعضاء مجلس الإدارة والتوقيع بالحضور</div>
      <table class="ed-tbl"><thead><tr><th style="width:34px" class="c">م</th><th>الاسم الرباعي</th><th class="c">الرقم الوظيفي</th><th>الصفة بالمجلس</th><th class="c" style="width:76px">الحالة</th><th>التوقيع الحي بالحضور</th></tr></thead><tbody>${rows}</tbody></table>`
  });
}
function allowanceSheetHTML(m, rateOverride) {
  const alw = m.allowance || {}, rate = +(rateOverride || alw.rate || 75);
  const att = (m.attendance || []).filter(a => a.status === 'حاضر');
  const tot = alw.paid && !rateOverride ? +alw.total : att.length * rate;
  const share = att.length ? +(tot / att.length).toFixed(2) : rate;
  const rows = att.map((a, i) => {
    const amt = i === att.length - 1 ? +(tot - share * (att.length - 1)).toFixed(2) : share;
    return `<tr><td class="c">${numAr(i + 1)}</td><td><b>${esc(a.full_name)}</b></td><td class="c">${esc(a.job_id || '—')}</td><td>${esc(a.role || 'عضو مجلس إدارة')}</td>
      <td class="n"><b>${money(amt)}</b></td><td style="width:26%"></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="c">لم يُسجَّل حاضرون لهذه الجلسة بعد</td></tr>';
  return erpDoc({
    compact: true,
    dept: 'الإدارة المالية والخزينة · شئون المجلس', kind: 'كشف صرف مالي',
    refLbl: 'مرجع الكشف', refNo: `ALW-${m.meeting_no}`, date: m.meeting_date,
    ctrl: [['الحساب المحاسبي', '5401 بدلات جلسات']],
    title: 'كشف صرف بدل حضور جلسة مجلس الإدارة', sub: `${esc(m.title)} — المنعقدة بتاريخ ${dt(m.meeting_date)}`,
    status: alw.paid ? `صُرف ضمن شيك ${alw.cheque_no || ''}` : 'معد للصرف والتسوية', statusCls: alw.paid ? 'ok' : 'warn',
    sigs: m.signatories, sigCols: govMinutesSigs,
    body: edMoney(tot, 'إجمالي بدلات الجلسة') + edGrid([
      [4, 'رقم وتاريخ الجلسة', `جلسة (${numAr(m.meeting_no)}) — ${dt(m.meeting_date)}`],
      [4, 'عدد الحاضرين المستحقين', `${numAr(att.length)} عضو مجلس`],
      [4, 'فئة البدل للعضو الحاضر', `${money(rate)} جنيه مصري`],
    ]) + `<div class="ed-sec">بيان السادة المستحقين وتوقيع الاستلام</div>
      <table class="ed-tbl"><thead><tr><th style="width:32px" class="c">م</th><th>اسم العضو المستحق</th><th class="c" style="width:82px">الرقم الوظيفي</th><th>الصفة بالمجلس</th><th class="n" style="width:82px">المبلغ (ج.م)</th><th>التوقيع بالاستلام</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th colspan="4">الإجمالي العام للكشف</th><th class="n">${money(tot)}</th><th>${esc(tafqeet(tot))}</th></tr></tfoot></table>
      <div class="ed-box ${alw.paid ? '' : 'gold'}">${alw.paid
        ? `<b>✓ إثبات الصرف المالي:</b> تم صرف وتسوية هذا الكشف ضمن تسوية الشيك رقم (${esc(alw.cheque_no || 'بدون رقم')}) بتاريخ ${dt(alw.settle_date)}، وأُدرج في سجل مزايا السادة الأعضاء.`
        : 'يُعتمد هذا الكشف ويُرفق بأصل التوقيعات ضمن مستندات تسوية العهدة بالخزينة لقيده على حـ/ 5401 (بدلات جلسات المجلس).'}</div>`
  });
}
function decisionExtractHTML(d) {
  const hasCeil = d.amount != null && +d.amount > 0;
  return erpDoc({
    dept: 'أمانة سر مجلس الإدارة', kind: 'مستخرج قرار رسمي',
    refLbl: 'رقم القرار', refNo: d.decision_no, date: d.meeting_date,
    ctrl: [['رقم الجلسة', `جلسة (${numAr(d.meeting_no)})`], ['التصنيف', d.category]],
    title: 'مستخرج رسمي من قرار مجلس الإدارة', sub: esc(d.term_title || 'الدورة النقابية الجارية'),
    status: `${d.status} · ${d.exec_status || 'لم يبدأ'}`, statusCls: d.status === 'معتمد' ? 'ok' : 'bad',
    sigs: d.signatories,
    body: (hasCeil ? edMoney(d.amount, 'السقف المالي المعتمد للقرار') : '') + edGrid([
      [3, 'رقم القرار', `(${esc(d.decision_no)})`],
      [3, 'تاريخ صدور القرار', dt(d.meeting_date)],
      [3, 'الجلسة الصادر عنها', `${esc(d.meeting_title || 'جلسة ' + d.meeting_no)} (${esc(d.meeting_kind || 'عادي')})`],
      [3, 'نتيجة التصويت', d.votes_for != null ? `موافق ${numAr(d.votes_for)} / معترض ${numAr(d.votes_against ?? 0)} / ممتنع ${numAr(d.votes_abstain ?? 0)}` : 'معتمد بالإجماع'],
    ]) + `<div class="ed-sec">منطوق القرار المعتمد</div>
      <div class="ed-box gold" style="font-size:14.5px;padding:14px 16px">
        <div style="font-weight:800;color:#0f3d5e;margin-bottom:6px">بعد الاطلاع على لائحة النظام الأساسي واللائحة المالية، قرّر مجلس إدارة اللجنة النقابية في جلسته رقم (${numAr(d.meeting_no)}) المنعقدة بتاريخ ${dt(d.meeting_date)} ما يلي:</div>
        <div style="font-weight:700;color:#0f172a">${esc(d.text)}</div>
      </div>
      <div class="ed-sec">بيانات التنفيذ والمتابعة المالية</div>` + edGrid([
      [4, 'حالة التنفيذ الحالية', esc(d.exec_status || 'لم يبدأ')],
      [4, 'المسئول عن التنفيذ', esc(d.assignee_display || 'الإدارة المختصة')],
      [4, 'الموعد المستهدف / تاريخ التنفيذ', d.executed_at ? 'نُفّذ في ' + dt(d.executed_at) : d.due_date ? 'مستهدف ' + dt(d.due_date) : '—'],
      [6, 'صافي المنصرف الفعلي المرتبط بالقرار', +d.spent > 0 ? `${money(d.spent)} ج.م (${numAr((d.cheques || []).length)} شيك)` : 'لا يوجد منصرف مسجّل بعد'],
      [6, 'ملاحظات المتابعة', esc(d.follow_up || '—')],
    ]) + `<div style="font-size:12px;color:#334155;margin-top:8px">أُعطي هذا المستخرج الرسمي طبق الأصل من سجل قرارات مجلس الإدارة للعمل بموجبه وإرفاقه بالمستندات المالية والإدارية.</div>`
  });
}

function decisionCardHTML(d, showMeet = true) {
  const hasCeil = d.amount != null && +d.amount > 0, spent = +(d.spent || 0);
  const over = hasCeil && spent > +d.amount + 0.005;
  const overdue = d.due_date && d.due_date < new Date().toISOString().slice(0, 10) && ['لم يبدأ', 'قيد التنفيذ'].includes(d.exec_status);
  const pct = hasCeil ? Math.min(100, Math.round((spent / +d.amount) * 100)) : 0;
  const cls = over || overdue ? 'over' : d.exec_status === 'منفّذ' ? 'done' : d.exec_status === 'قيد التنفيذ' ? 'prog' : '';
  return `<div class="dec-card ${cls}" data-decopen="${d.id}">
    <div class="row" style="align-items:center;gap:6px;margin-bottom:4px">
      <span class="dec-no">قرار ${esc(d.decision_no)}</span>
      <span class="pill">${esc(d.category)}</span>
      ${execPill(d.exec_status)}
      ${overdue ? '<span class="pill bad">⏰ متأخر</span>' : ''}
      ${over ? `<span class="pill bad">⚠️ تجاوز السقف بـ ${money(spent - +d.amount)}</span>` : ''}
      <span class="sp"></span>
      <button class="btn sm sec" type="button" data-decprt="${d.id}" title="طباعة مستخرج القرار">🖨️ مستخرج</button>
    </div>
    <div style="font-weight:700;margin:4px 0">${esc(d.text)}</div>
    <div class="muted" style="font-size:12px;display:flex;flex-wrap:wrap;gap:10px">
      ${showMeet && d.meeting_title ? `<span>🗓️ ${esc(d.meeting_title)} (${dt(d.meeting_date)})</span>` : ''}
      ${d.assignee || d.assignee_display ? `<span>👤 المسئول: <b>${esc(d.assignee || d.assignee_display)}</b></span>` : ''}
      ${d.due_date ? `<span>🎯 الموعد: ${dt(d.due_date)}</span>` : ''}
      ${d.cheques_count ? `<span>🧾 ${numAr(d.cheques_count)} شيك مرتبط</span>` : ''}
      ${d.votes_for != null ? `<span>🗳️ موافق ${numAr(d.votes_for)} / معترض ${numAr(d.votes_against ?? 0)}</span>` : ''}
    </div>
    ${hasCeil || spent > 0 ? `<div class="pbar-wrap">
      <div class="row" style="justify-content:space-between;font-size:12px">
        <span>💰 المنصرف الفعلي: <b>${money(spent)} ج</b></span>
        <span>${hasCeil ? `السقف المعتمد: <b>${money(d.amount)} ج</b> (${numAr(pct)}%)` : 'بلا سقف رقمي محدد'}</span>
      </div>
      ${hasCeil ? `<div class="pbar ${over ? 'over' : ''}"><i style="width:${pct}%"></i></div>` : ''}
    </div>` : ''}
  </div>`;
}

function decisionModalHTML(d, canManage) {
  const hasCeil = d.amount != null && +d.amount > 0, spent = +(d.spent || 0), over = hasCeil && spent > +d.amount + 0.005;
  const pct = hasCeil ? Math.min(100, Math.round((spent / +d.amount) * 100)) : 0;
  return `<div class="gov-hero" style="margin:-4px 0 12px">
      <div class="gh-meta"><span class="gh-chip gh-gold">قرار رقم ${esc(d.decision_no)}</span>
        <span class="gh-chip">🗓️ ${esc(d.meeting_title)} · ${dt(d.meeting_date)}</span>
        <span class="gh-chip">${esc(d.category)}</span></div>
      <div style="font-size:15px;font-weight:700;line-height:1.7">${esc(d.text)}</div>
      <div class="gh-acts">
        <button class="btn sm gold" type="button" data-act="decModalPrint">🖨️ طباعة مستخرج رسمي للقرار</button>
        <a class="btn sm" href="#/meeting/${d.meeting_id}" style="text-decoration:none">🗓️ فتح الجلسة</a>
      </div></div>
    ${hasCeil || spent > 0 || (d.cheques || []).length ? `<div class="form-sec">
      <div class="form-sec-hd"><span>💰 الموقف المالي والشيكات المرتبطة بالقرار</span>
        ${over ? `<span class="pill bad">تجاوز السقف بـ ${money(spent - +d.amount)} ج</span>` : hasCeil ? `<span class="pill ok">متبقي من السقف ${money(+d.amount - spent)} ج</span>` : ''}</div>
      <div class="alw-stats">
        <div class="alw-stat"><small>السقف المعتمد</small><b>${hasCeil ? money(d.amount) + ' ج' : 'غير محدد'}</b></div>
        <div class="alw-stat"><small>صافي المنصرف الفعلي</small><b style="color:${over ? 'var(--bad)' : 'var(--ok)'}">${money(spent)} ج</b></div>
        <div class="alw-stat"><small>الشيكات المرتبطة</small><b>${numAr((d.cheques || []).length)}</b></div></div>
      ${hasCeil ? `<div class="pbar ${over ? 'over' : ''}"><i style="width:${pct}%"></i></div>` : ''}
      ${(d.cheques || []).map(c => `<div class="kv" style="align-items:center">
        <span><a href="#/cheque/${c.id}"><b>شيك ${esc(c.cheque_no || 'بدون رقم')}</b></a> — ${esc(c.payee_name)} <small class="muted">(${dt(c.issue_date)})</small></span>
        <span><b>${money(c.amount)}</b> ${stPill(c.status)}</span></div>`).join('')}
      ${(d.activities || []).map(a => `<div class="kv"><span>🚌 نشاط: <a href="#/actadmin/${a.id}"><b>${esc(a.title)}</b></a> (${dt(a.start_date)})</span><span class="pill">${esc(a.status)}</span></div>`).join('')}
    </div>` : ''}
    ${canManage ? `<form id="dcf" class="form-sec">
      <div class="form-sec-hd"><span>⚙️ متابعة التنفيذ وتحديث بيانات القرار</span></div>
      <input type="hidden" name="exec_status" value="${esc(d.exec_status || 'لم يبدأ')}">
      <div class="muted" style="font-size:12px">حالة التنفيذ (اضغط للاختيار):</div>
      <div class="step-seg">${[['لم يبدأ', '📌 لم يبدأ'], ['قيد التنفيذ', '⚙️ قيد التنفيذ'], ['منفّذ', '✅ منفّذ'], ['لا يتطلب تنفيذ', '➖ لا يتطلب']].map(([v, l]) =>
        `<button type="button" data-step="${v}" class="${(d.exec_status || 'لم يبدأ') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="grid2">
        <label class="f"><span>الفئة</span><select class="input" name="category">${options(DEC_CATS, d.category, false)}</select></label>
        <label class="f"><span>سقف المبلغ المعتمد (ج)</span><input class="input" name="amount" inputmode="decimal" value="${esc(d.amount ?? '')}" placeholder="اختياري"></label></div>
      <div class="grid2">
        <label class="f"><span>المسئول عن التنفيذ (اسم أو صفة)</span><input class="input" name="assignee_name" value="${esc(d.assignee_name || d.assignee_display || '')}" placeholder="مثلاً: أمين الصندوق / لجنة الرحلات"></label>
        <label class="f"><span>أو الرقم الوظيفي للمسئول</span><input class="input" name="assignee_job" inputmode="numeric" value="${esc(d.assignee_job || '')}" placeholder="اختياري لربطه بملفه"></label></div>
      <div class="grid2">
        <label class="f"><span>الموعد المستهدف للتنفيذ</span><input class="input" type="date" name="due_date" value="${esc(d.due_date || '')}"></label>
        <label class="f"><span>تاريخ تمام التنفيذ</span><input class="input" type="date" name="executed_at" value="${esc(d.executed_at || '')}"></label></div>
      <div class="grid2">
        <label class="f"><span>ملاحظات المتابعة وما تم إنجازه</span><input class="input" name="follow_up" value="${esc(d.follow_up || '')}" placeholder="خطوات التنفيذ، رقم المحضر، أو سبب التأجيل"></label>
        <label class="f"><span>حالة اعتماد القرار</span><select class="input" name="status">${options(['معتمد', 'مرفوض', 'مؤجل', 'ملغى'], d.status || 'معتمد', false)}</select></label></div>
      <div id="ferr"></div>
      <div class="acts"><button class="btn" type="submit">💾 حفظ متابعة القرار</button><button class="btn sec" type="button" data-close>إغلاق</button></div>
    </form>` : `<div class="acts"><button class="btn sec" type="button" data-close>إغلاق</button></div>`}
    ${docsBox('decision', d.id, '📎 مستندات ومرفقات القرار (خطابات، عروض أسعار، محاضر)').replace('class="card docbox"', 'class="docbox inl"')}`;
}

function meetingsView() {
  const all = S.meetings || [], g = S.gov || {}, mf = S.meetF || 'all', rate = S.govRate || g.allowanceRate || 75;
  const withAtt = all.filter(m => m.present > 0), noAtt = all.filter(m => !m.present), unpaid = withAtt.filter(m => !m.allowance_paid);
  const items = mf === 'att' ? withAtt : mf === 'noatt' ? noAtt : mf === 'unpaid' ? unpaid : all;
  const kpi = (i, v, l, cls = '') => `<div class="kpi ${cls}"><i>${i}</i><div><b>${v}</b><small>${l}</small></div></div>`;
  return govTabs('#/meetings') + `<div class="kpis">
      ${kpi('🗓️', numAr(all.length), 'إجمالي الجلسات المسجّلة')}
      ${kpi('✅', numAr(withAtt.length), 'مسجّل حضورها ونصابها', 'ok')}
      ${kpi('📝', numAr(noAtt.length), 'بانتظار تفريغ الحضور', noAtt.length ? 'warn' : 'ok')}
      ${kpi('💼', money(rate) + ' ج', 'فئة بدل الجلسة للعضو')}</div>
    <div class="card"><div class="row" style="align-items:center;gap:8px">
        <b style="font-size:16px">📅 سجل جلسات مجلس الإدارة</b><span class="sp"></span>
        ${g.canManage ? `<button class="btn sm sec" data-act="alwRateSet">⚙️ فئة البدل (${numAr(rate)} ج)</button><button class="btn sm" data-act="meetNew">+ تسجيل جلسة جديدة</button>` : ''}</div>
      <div class="fchips">
        ${[['all', `الكل (${numAr(all.length)})`], ['att', `✓ مسجّل الحضور (${numAr(withAtt.length)})`], ['noatt', `📝 حضور ناقص (${numAr(noAtt.length)})`], ['unpaid', `💰 بدل لم يُصرف (${numAr(unpaid.length)})`]]
          .map(([k, l]) => `<button type="button" class="fchip ${mf === k ? 'on' : ''}" data-mfchip="${k}">${l}</button>`).join('')}
      </div>
      <div class="list">${items.map(m => {
        const q = m.seats ? m.present >= Math.floor(m.seats / 2) + 1 : false;
        return `<div class="li" data-meet="${m.id}" style="align-items:center"><div class="nm">
            <b><span class="dec-no" style="margin-inline-end:6px">#${numAr(m.meeting_no)}</span>${esc(m.title)}</b>
            <span class="muted">${dt(m.meeting_date)} · ${esc(m.kind)}${m.venue ? ' · ' + esc(m.venue) : ''} · ${numAr(m.decisions_count)} قرار</span></div>
          <div class="row" style="gap:4px;justify-content:flex-end">
            ${m.allowance_paid ? `<span class="pill ok" title="صُرف بدل الجلسة">💼 ${money(m.allowance_amount)}</span>` : m.present ? `<span class="pill warn">💼 ${money(m.allowance_amount)} لم يُصرف</span>` : ''}
            <span class="pill ${m.present ? (q ? 'ok' : 'bad') : ''}">${m.present ? `${numAr(m.present)}/${numAr(m.seats)} ${q ? 'نصاب' : 'بلا نصاب'}` : 'حضور غير مسجّل'}</span>
          </div></div>`;
      }).join('') || '<div class="empty">لا اجتماعات مطابقة للفلتر</div>'}</div></div>`;
}

function attSegRows(board, attMap) {
  return board.map(b => {
    const cur = attMap[b.person_id] || 'حاضر';
    return `<div class="att-row" data-attrow="${b.person_id}">
      <div><b>${esc(b.full_name)}</b> <small class="muted">· ${esc(b.role || 'عضو مجلس')}</small></div>
      <input type="hidden" data-att="${b.person_id}" value="${esc(cur)}">
      <div class="att-seg">${[['حاضر', '✓ حاضر'], ['غائب بعذر', '⏳ بعذر'], ['غائب', '✕ غائب']].map(([v, l]) =>
        `<button type="button" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  }).join('');
}

function meetingView() {
  const m = S.meeting, g = S.gov || {}; if (!m) return '';
  const q = m.seats ? m.present >= Math.floor(m.seats / 2) + 1 : false;
  const pct = m.seats ? Math.min(100, Math.round((m.present / m.seats) * 100)) : 0;
  const alw = m.allowance || { rate: 75, present: m.present || 0, total: 0, paid: false };
  const presentList = (m.attendance || []).filter(a => a.status === 'حاضر');
  const attMap = {}; (m.attendance || []).forEach(a => (attMap[a.person_id] = a.status));
  const showQuickAtt = g.canManage && (!m.attendance.length || S.quickAttOpen);
  return `<a href="#/meetings" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ سجل الاجتماعات</a>
  <div class="gov-hero">
    <div class="gh-meta">
      <span class="gh-chip gh-gold">جلسة رقم ${numAr(m.meeting_no)} · ${esc(m.kind)}</span>
      <span class="gh-chip">📅 ${dt(m.meeting_date)}${m.meeting_time ? ' · ' + esc(m.meeting_time) : ''}</span>
      <span class="gh-chip">📍 ${esc(m.venue || 'مقر اللجنة النقابية')}</span>
      <span class="gh-chip">${esc(m.status)}</span>
    </div>
    <h2>${esc(m.title)}</h2>
    <div style="font-size:13px;opacity:.95">النصاب القانوني: <b>${m.present ? `${numAr(m.present)} حاضرون من ${numAr(m.seats)} (${q ? 'نصاب مكتمل ✓' : 'أقل من النصاب'})` : 'الحضور غير مسجّل بعد'}</b></div>
    <div class="qbar ${!m.present ? 'empty' : q ? '' : 'bad'}"><i style="width:${pct}%"></i></div>
    <div class="gh-acts">
      <button class="btn sm gold" data-act="prtMinutes">🖨️ محضر الاجتماع</button>
      <button class="btn sm" data-act="prtAttend">🖨️ كشف الحضور والتوقيع</button>
      ${!m.attendance.length ? '<button class="btn sm" data-act="prtAttendBlank">🖨️ كشف توقيع فارغ</button>' : ''}
      <button class="btn sm" data-act="prtAllow">🖨️ كشف صرف البدلات</button>
      ${g.canManage ? '<button class="btn sm" data-act="meetEdit">✏️ تعديل شامل</button>' : ''}
    </div>
  </div>

  <div class="alw-card">
    <div class="row" style="align-items:center;gap:8px">
      <b style="font-size:16px;color:var(--brand)">💼 بدل حضور الجلسة</b><span class="sp"></span>
      ${alw.paid ? `<span class="pill ok">✓ صُرف البدل${alw.cheque_no ? ' — شيك ' + esc(alw.cheque_no) : ''} (${dt(alw.settle_date)})</span>`
                 : m.present ? '<span class="pill warn">⏳ محسوب وجاهز للصرف في التسوية</span>' : '<span class="pill">سجّل الحضور لحساب البدل</span>'}
    </div>
    <div class="alw-stats">
      <div class="alw-stat"><small>فئة البدل للعضو الحاضر</small><b>${money(alw.rate)} ج</b></div>
      <div class="alw-stat"><small>الحاضرون المستحقون</small><b>${numAr(m.present || 0)} عضو</b></div>
      <div class="alw-stat"><small>إجمالي بدل الجلسة</small><b>${money(alw.total)} ج</b></div>
    </div>
    ${presentList.length ? `<div class="mchips">${presentList.map(a => `<span class="mchip"><b>${esc(a.full_name)}</b><small class="muted">${esc(a.role)}</small><i>+${money(alw.rate)}</i></span>`).join('')}</div>` : ''}
    <div class="row" style="margin-top:10px;gap:8px">
      <button class="btn sm sec" data-act="prtAllow">🖨️ طباعة كشف البدلات للتوقيع</button>
      ${alw.paid && alw.cheque_id ? `<a class="btn sm sec" href="#/cheque/${alw.cheque_id}" style="text-decoration:none">🧾 فتح شيك التسوية</a>`
        : !alw.paid && m.present && can('treasury.settlement') ? '<a class="btn sm gold" href="#/settlements" style="text-decoration:none">💰 إدراج البدل في تسوية عهدة</a>' : ''}
    </div>
  </div>

  ${(m.agenda || []).length ? `<div class="card"><h2>📋 جدول الأعمال</h2><ol style="margin:6px 0;padding-inline-start:20px">${m.agenda.map(a => `<li style="margin-bottom:4px">${esc(a)}</li>`).join('')}</ol></div>` : ''}

  <div class="card">
    <div class="row" style="align-items:center;margin-bottom:8px">
      <h2 style="margin:0">⚖️ القرارات الصادرة (${numAr(m.decisions.length)})</h2><span class="sp"></span>
      <small class="muted">اضغط على أي قرار لمتابعة تنفيذه ومرفقاته وشيكاته</small></div>
    ${m.decisions.map(d => decisionCardHTML(d, false)).join('') || '<div class="empty">لا قرارات مسجّلة لهذه الجلسة</div>'}
  </div>

  <div class="card">
    <div class="row" style="align-items:center;margin-bottom:8px">
      <h2 style="margin:0">👥 سجل الحضور (${numAr(m.attendance.length)})</h2><span class="sp"></span>
      ${g.canManage && m.attendance.length ? `<button class="btn sm sec" data-act="toggleQuickAtt">${S.quickAttOpen ? 'إلغاء' : '✏️ تعديل سريع للحضور'}</button>` : ''}
    </div>
    ${showQuickAtt ? `<div class="form-sec" id="qattBox" data-seats="${(m.board || []).length}">
        <div class="form-sec-hd"><span id="qattStat">حدد حالة كل عضو مجلس بنقرة واحدة:</span>
          <button class="btn sm sec" type="button" data-act="attAllPresent">✓ تحديد الكل حاضر</button></div>
        ${attSegRows(m.board || [], attMap)}
        <div class="acts" style="margin-top:8px"><button class="btn" type="button" data-act="saveQuickAtt">💾 حفظ كشف الحضور وحساب البدل</button></div>
      </div>`
      : m.attendance.map(a => `<div class="kv"><span><b>${esc(a.full_name)}</b> <small class="muted">· ${esc(a.role || '')}</small></span>
          <span class="pill ${a.status === 'حاضر' ? 'ok' : a.status === 'غائب' ? 'bad' : 'warn'}">${esc(a.status)}</span></div>`).join('') || '<div class="empty">الحضور غير مسجّل</div>'}
  </div>
  ${docsBox('meeting', m.id, '📎 محضر الاجتماع الموقّع ومستنداته')}`;
}

function decisionsView() {
  const items = S.decisions || [], f = S.decF || {}, sm = S.decSummary || {};
  const kpi = (i, v, l, cls = '') => `<div class="kpi ${cls}"><i>${i}</i><div><b>${v}</b><small>${l}</small></div></div>`;
  const chipKey = f.alert ? 'al:' + f.alert : f.exec_status ? 'ex:' + f.exec_status : 'all';
  return govTabs('#/decisions') + `<div class="kpis">
      ${kpi('⚖️', numAr(sm.total || items.length), 'إجمالي القرارات المعتمدة')}
      ${kpi('✅', numAr(sm.executed || 0), 'قرارات منفّذة', 'ok')}
      ${kpi('⏳', numAr((sm.in_progress || 0) + (sm.not_started || 0)), 'قيد التنفيذ أو لم تبدأ', (sm.in_progress || sm.not_started) ? 'warn' : 'ok')}
      ${kpi('💰', money(sm.total_spent || 0), `منصرف فعلي (من سقوف ${money(sm.total_ceiling || 0)})`, (sm.exceeded || 0) > 0 ? 'bad' : 'ok')}</div>
    ${(sm.overdue || 0) > 0 || (sm.exceeded || 0) > 0 ? `<div class="alert bad" style="margin-bottom:12px">
      تنبيه رقابي: ${sm.overdue ? `<b>${numAr(sm.overdue)}</b> قرار متأخر عن موعد تنفيذه` : ''}${sm.overdue && sm.exceeded ? ' · ' : ''}${sm.exceeded ? `<b>${numAr(sm.exceeded)}</b> قرار تجاوز المنصرف عليه سقفه المعتمد` : ''} — اضغط الفلتر بالأسفل للمراجعة.</div>` : ''}
    <div class="card">
      <form id="df" class="row" style="gap:8px">
        <input class="input" style="flex:2;min-width:150px" name="q" value="${esc(f.q || '')}" placeholder="🔎 ابحث في نص القرار، رقمه (مثل 31/3)، أو اسم المسئول…">
        <select class="input" style="flex:1;min-width:120px" name="category"><option value="">كل الفئات</option>${options(DEC_CATS, f.category, false)}</select>
        <button class="btn">بحث</button>
        <button class="btn sec" type="button" data-act="decExecRep">🖨️ تقرير متابعة القرارات</button></form>
      <div class="fchips">
        ${[['all', `الكل (${numAr(sm.total || items.length)})`],
           ['ex:قيد التنفيذ', `⚙️ قيد التنفيذ (${numAr(sm.in_progress || 0)})`],
           ['ex:لم يبدأ', `📌 لم يبدأ (${numAr(sm.not_started || 0)})`],
           ['ex:منفّذ', `✅ منفّذ (${numAr(sm.executed || 0)})`],
           ['al:exceeded', `⚠️ تجاوز السقف (${numAr(sm.exceeded || 0)})`],
           ['al:overdue', `⏰ متأخر (${numAr(sm.overdue || 0)})`],
           ['ex:لا يتطلب تنفيذ', `➖ إجرائي (${numAr(sm.no_exec || 0)})`]]
          .map(([k, l]) => `<button type="button" class="fchip ${chipKey === k ? 'on' : ''}" data-dfchip="${k}">${l}</button>`).join('')}
      </div></div>
    <div>${items.map(d => decisionCardHTML(d, true)).join('') || '<div class="card empty">لا قرارات مطابقة للبحث</div>'}</div>`;
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
const decRow = (d, i) => `<div class="card" style="box-shadow:none;border:1px solid var(--line);border-inline-start:4px solid var(--brand2);padding:10px;margin-bottom:8px" data-dec>
      <div class="row" style="align-items:center;margin-bottom:6px"><span class="dec-no">قرار #${numAr(i + 1)}</span><span class="sp"></span>
        <select class="input" style="width:auto;padding:4px 8px" name="d_status">${options(['معتمد', 'مرفوض', 'مؤجل', 'ملغى'], d.status || 'معتمد', false)}</select></div>
      <label class="f"><span>منطوق القرار</span><textarea class="input" name="d_text" rows="2" placeholder="اكتب نص القرار بوضوح…">${esc(d.text)}</textarea></label>
      <div class="grid2"><label class="f"><span>الفئة</span><select class="input" name="d_category">${options(DEC_CATS, d.category || 'إداري', false)}</select></label>
        <label class="f"><span>السقف المالي المعتمد (إن وُجد)</span><input class="input" name="d_amount" inputmode="decimal" value="${esc(d.amount)}" placeholder="0.00"></label></div>
      <div class="grid2"><label class="f"><span>التصويت (موافق / معترض / ممتنع)</span><div class="row" style="gap:4px">
        <input class="input" style="flex:1" name="d_for" inputmode="numeric" value="${esc(d.votes_for)}" placeholder="موافق">
        <input class="input" style="flex:1" name="d_against" inputmode="numeric" value="${esc(d.votes_against)}" placeholder="معترض">
        <input class="input" style="flex:1" name="d_abstain" inputmode="numeric" value="${esc(d.votes_abstain)}" placeholder="ممتنع"></div></label>
        <label class="f"><span>حالة التنفيذ</span><select class="input" name="d_exec">${options(EXEC_STATES, d.exec_status || 'لم يبدأ', false)}</select></label></div>
      <div class="grid2"><label class="f"><span>المسئول عن التنفيذ (اختياري)</span><input class="input" name="d_assignee" value="${esc(d.assignee_name || d.assignee_display || '')}" placeholder="مثلاً: أمين الصندوق"></label>
        <label class="f"><span>موعد التنفيذ المستهدف</span><input class="input" type="date" name="d_due" value="${esc(d.due_date || '')}"></label></div></div>`;
function meetingForm(m) {
  const board = (m && m.board && m.board.length) ? m.board : (S.gov ? S.gov.term.seats.filter(s => !s.to_date) : []);
  const att = {}; ((m && m.attendance) || []).forEach(a => (att[a.person_id] = a.status));
  const decs = (m && m.decisions && m.decisions.length) ? m.decisions : [{}];
  return `<h3>${m && m.id ? '✏️ تعديل بيانات ومحضر الجلسة' : '🗓️ تسجيل جلسة مجلس إدارة جديدة'}</h3><form id="mtf">
    <div class="form-sec">
      <div class="form-sec-hd"><span>📌 أولاً: بيانات الانعقاد وجدول الأعمال</span></div>
      <label class="f"><span>عنوان الجلسة</span><input class="input" name="title" value="${esc(m && m.title)}" required placeholder="مثلاً: الاجتماع الدوري رقم 32"></label>
      <div class="grid2"><label class="f"><span>تاريخ الانعقاد</span><input class="input" type="date" name="meeting_date" value="${esc(m && m.meeting_date)}" required></label>
        <label class="f"><span>نوع الاجتماع</span><select class="input" name="kind">${options(['عادي', 'طارئ', 'سنوي', 'جمعية عمومية'], (m && m.kind) || 'عادي', false)}</select></label></div>
      <div class="grid2"><label class="f"><span>وقت الانعقاد</span><input class="input" name="meeting_time" value="${esc(m && m.meeting_time)}" placeholder="مثلاً: 5:00 مساءً"></label>
        <label class="f"><span>مقر الانعقاد</span><input class="input" name="venue" value="${esc((m && m.venue) || 'مقر اللجنة النقابية')}"></label></div>
      <label class="f"><span>جدول الأعمال (اكتب كل بند في سطر مستقل)</span><textarea class="input" name="agenda" rows="3" placeholder="1- التصديق على محضر الجلسة السابقة&#10;2- مناقشة طلبات المنح والأنشطة">${esc(((m && m.agenda) || []).join('\n'))}</textarea></label>
    </div>
    <div class="form-sec" data-seats="${board.length}">
      <div class="form-sec-hd"><span id="mtfQuorum">👥 ثانياً: سجل الحضور والنصاب</span>
        <button class="btn sm sec" type="button" data-act="attAllPresent">✓ الكل حاضر</button></div>
      ${attSegRows(board, att)}
    </div>
    <div class="form-sec">
      <div class="form-sec-hd"><span>⚖️ ثالثاً: القرارات الصادرة والتصويت</span>
        <button class="btn sm sec" type="button" data-act="decAdd">+ إضافة قرار</button></div>
      <div id="decs">${decs.map(decRow).join('')}</div>
    </div>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">💾 حفظ الجلسة والمحضر</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
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
      <button class="btn bad block" style="margin-top:8px" data-act="myCancel" data-id="${b.id}">إلغاء الحجز</button>` : ''}
    <button class="btn sec block" style="margin-top:8px" data-act="bkPrint">🖨️ طباعة إيصال الحجز</button></div>`;
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
      ${!['انتهى', 'مغلق', 'ملغى'].includes(a.status) ? '<button class="btn sm bad" data-act="actCancelAll">إلغاء النشاط</button>' : ''}</div>
    <div class="row" style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">
      <span class="muted" style="font-size:12.5px">🖨️ الكشوف الرسمية للرحلة:</span>
      <button class="btn sm gold" type="button" data-act="actRepFull">🎫 كشف الحجز والمشتركين والدفع</button>
      <button class="btn sm sec" type="button" data-act="actRepBus">🚌 كشف المقاعد وتفقد المشرف</button>
      <button class="btn sm sec" type="button" data-act="actRepUnpaid">⚠️ كشف متابعة المتأخرات</button>
    </div></div>
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
      <button class="btn sm sec" type="button" data-act="sumRepPrint">🖨️ كشف إسكان وتحصيل المصيف</button>
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
      ${admin && g.status === 'معتمد' && can('treasury.cheque.issue') ? `<button class="btn sm gold" data-act="grtPay" data-id="${g.id}">صرف شيك</button>` : ''}
      <button class="btn sm sec" data-grtprint="${g.id}">🖨️ طباعة الطلب</button><button class="btn sm sec" data-grtdocs="${g.id}">📎 المستندات</button></div>
    <div data-grtdocbox="${g.id}"></div></div>`;
}
function calcGrantRate(t, rel, isBoard) {
  if (!t) return null;
  const rs = t.rates || [];
  const pick = rKey => rs.find(x => (x.relation || '') === (rKey || ''));
  if (isBoard && pick('عضو مجلس إدارة')) return { amount: +pick('عضو مجلس إدارة').amount, label: 'فئة عضو مجلس الإدارة (أو بموجب موافقة)' };
  if (rel && pick(rel)) return { amount: +pick(rel).amount, label: `صلة القرابة: ${rel}` };
  if (pick('')) return { amount: +pick('').amount, label: 'الفئة الافتراضية باللائحة' };
  return t.amount ? { amount: +t.amount, label: 'اللائحة المعتمدة' } : null;
}
function grantsView() {
  const types = S.grtTypes || [], my = S.grtMy || [], fam = (S.me.profile && S.me.profile.family) || [];
  const schedRows = types.flatMap(t => (t.rates || []).map(r => `<div class="kv"><span><b>${esc(t.name)}</b> — ${esc(r.relation || 'الدرجة الأولى / الافتراضي')}${r.notes ? ` <small class="muted">(${esc(r.notes)})</small>` : ''}</span><b style="color:var(--brand)">${money(r.amount)} ج.م</b></div>`)).join('');
  return `${S.grtElig === false ? '<div class="alert warn">المنح لأعضاء النقابة العامة النشطين.</div>' : ''}
  ${S.grtIsBoard ? '<div class="alert ok" style="margin-bottom:10px">🏛️ <b>عضو مجلس إدارة:</b> يُطبَّق عليك تلقائياً فئة أعضاء مجلس الإدارة المعتمدة باللائحة (أو المبلغ المحدد بموافقة المجلس).</div>' : ''}
  ${schedRows ? `<div class="card"><h2>💰 لائحة مبالغ المنح المعتمدة للدورة الحالية</h2>${schedRows}</div>` : ''}
  <div class="card"><h2>📝 تقديم طلب منحة</h2><form id="gaf">
    <div class="grid2">
      <label class="f"><span>نوع المنحة</span><select class="input" name="type">${types.map(t => `<option value="${t.code}">${esc(t.name)}</option>`).join('')}</select></label>
      <label class="f"><span>تاريخ الواقعة</span><input class="input" type="date" name="event_date" required></label>
    </div>
    <label class="f"><span>المستفيد / صاحب الواقعة</span><select class="input" name="who"><option value="self" data-rel="العضو">أنا (العضو نفسه)</option>
      ${fam.map(f => `<option value="${f.id}" data-rel="${esc(f.relation)}">${esc(f.full_name)} (${esc(f.relation)})</option>`).join('')}<option value="other">شخص آخر من الأسرة (اكتب اسمه وصلته)</option></select></label>
    <div class="grid2" id="gother" hidden><input class="input" name="subject_name" placeholder="الاسم بالكامل"><select class="input" name="subject_relation">${options(['أب', 'أم', 'زوج', 'زوجة', 'ابن', 'ابنة'], '', false)}</select></div>
    <div id="grtAmtBox" style="margin:8px 0"></div>
    <div class="muted" id="gdocs"></div>
    <label class="f" style="margin-top:6px"><span>ملاحظات</span><input class="input" name="notes" placeholder="أي تفاصيل إضافية (اختياري)"></label>
    <div id="ferr"></div><button class="btn gold block" type="submit">تقديم طلب المنحة</button></form></div>
  <h3 style="margin:14px 4px 6px">طلباتي السابقة</h3>${my.map(g => grantCard(g, false)).join('') || '<div class="card empty">لا طلبات</div>'}`;
}
function grantsAdminView() {
  const c = S.grtCounts || {}, f = S.grtF || {};
  const allRates = (S.grtTypes || []).flatMap(t => (t.rates || []).map(r => ({ ...r, type_name: t.name, type_code: t.code })));
  return `<div class="subtabs">${[['', '📂 المفتوحة'], ['مقدَّم', '🆕 جديد'], ['ناقص مستندات', '⚠️ ناقص مستندات'], ['مستوفى', '📋 جاهز للاعتماد'], ['معتمد', '🧾 معتمد للصرف'], ['مصروف', '✅ مصروف'], ['مرفوض', '✕ مرفوض']]
      .map(([s, t]) => `<button data-gst="${s}" class="${(f.status || '') === s ? 'on' : ''}">${t}${s && c[s] ? `<span class="st-cnt">${numAr(c[s])}</span>` : ''}</button>`).join('')}</div>
    <div class="card row">
      <div style="flex:1;min-width:200px"><b>🎁 إدارة طلبات واستخراج المنح الاجتماعية</b><div class="muted">تسجيل طلب منحة لعضو أو أسرته مع مطابقة المستندات وإحالتها للاعتماد ثم استخراج الشيك البنكي.</div></div>
      ${can('grants.review') ? '<button class="btn gold" data-act="grtStaffNew">+ إنشاء طلب استخراج منحة</button>' : ''}
      <button class="btn sec" type="button" data-act="grtRepPrint">🖨️ سجل المنح</button>
      ${can('treasury.cheque.issue') || can('finance.view') ? '<a class="btn sec" href="#/payreqs" style="text-decoration:none">🧾 طابور الشيكات</a>' : ''}
    </div>
    ${(S.grtList || []).map(g => grantCard(g, true)).join('') || '<div class="card empty">لا توجد طلبات منح في هذا التصنيف حالياً</div>'}
    ${can('grants.approve') ? `<div class="card">
      <div class="row" style="align-items:center;margin-bottom:8px">
        <div><h2 style="margin:0">💰 فئات ومبالغ المنح المرنة (قابلة للتعديل في أي وقت)</h2>
        <div class="muted">تشمل فئة الدرجة الأولى، الزوج/الزوجة/العضو، الزواج، وفئة أعضاء مجلس الإدارة (مع حرية تعديل المبلغ عند الاعتماد بموافقة/قرار).</div></div>
        <span class="sp"></span>
        <button class="btn sm gold" data-act="grtRate">⚙️ + إضافة / تعديل فئة منحة</button>
      </div>
      ${allRates.map(r => `<div class="kv" style="align-items:center">
        <div><b>${esc(r.type_name)}</b> — <span class="pill">${esc(r.relation || 'افتراضي / درجة أولى')}</span>
          <small class="muted">سارية من ${dt(r.valid_from)}${r.notes ? ' · ' + esc(r.notes) : ''}</small></div>
        <div class="row" style="gap:8px;align-items:center"><b style="color:var(--brand)">${money(r.amount)} ج.م</b>
          <button class="btn sm bad" data-grtdel="${r.id}" title="حذف هذه الفئة">🗑️</button></div>
      </div>`).join('') || '<div class="empty">لا فئات مسجّلة</div>'}
    </div>` : ''}`;
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

// ───────── مركز التقارير والكشوف الرسمية المعتمدة ─────────
function reportsView() {
  const r = S.rep; if (!r) return '<div class="spin"></div>';
  const m = r.members, b = r.benefits, f = r.finance, num = v => Number(v || 0).toLocaleString('ar-EG');
  const kv2 = o => Object.entries(o || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => kvh(esc(k), num(v))).join('');
  const cards = [
    ['gold', '🏦', 'كشف حساب العمليات والشيكات', 'حركة البنك والخزينة بالرصيد المتحرك بعد كل عملية وسجل الشيكات الصادرة والمنصرفة والمعلّقة.', '<button class="btn sm gold" type="button" data-act="opsRepOpen">🖨️ استخراج الكشف</button>', can('finance.view') || can('reports.view')],
    ['gold', '🧾', 'تقرير تسوية سلفة عهدة (مفردة / مجمّعة)', 'كشف رسمي ببنود الصرف المسوّاة والحسابات المحاسبية والشيكات المجمّعة والمبالغ المتبقية وطريقة معالجتها.', '<button class="btn sm gold" type="button" data-act="stlRepPick">🖨️ اختيار تسوية وطباعتها</button>', can('finance.view') || can('reports.view')],
    ['ok', '🏛️', 'تقرير الجمعية العمومية (نقابة عامة)', 'حصر قانوني وإحصائي لأعضاء الجمعية العمومية بالنقابة العامة وحساب النصاب القانوني وكشف التوقيع.', '<button class="btn sm" type="button" data-act="gaRepPrint">🖨️ استخراج الكشف</button>', can('profile.view') || can('reports.view') || can('governance.view')],
    ['', '📑', 'الميزانية العمومية والحساب الختامي', 'قائمة المركز المالي وقائمة الإيرادات والمصروفات المقارنة وميزان المراجعة بالمجاميع والأرصدة.', '<button class="btn sm" type="button" data-act="hubFsPrint">🖨️ الميزانية</button><button class="btn sm sec" type="button" data-act="hubTbPrint">⚖️ الميزان</button>', can('finance.view') || can('reports.view')],
    ['', '🎯', 'الموازنة التقديرية ومتابعة الانحرافات', 'مقارنة الاعتمادات التقديرية السنوية بالمحقق الفعلي ونسب التنفيذ والوفورات والتجاوزات.', '<button class="btn sm" type="button" data-act="hubBudPrint">🖨️ طباعة الموازنة</button>', can('finance.view') || can('reports.view')],
    ['', '🏦', 'مذكرة مطابقة وتسوية البنك المعتمدة', 'مذكرة التسوية البنكية الرسمية شاملة الشيكات الصادرة لم تُقدم للصرف والإيداعات بالطريق.', '<button class="btn sm" type="button" data-act="hubBankPrint">🖨️ مذكرة التسوية</button>', can('finance.view')],
    ['gold', '🚌', 'كشوف حجز الرحلات والمشتركين والدفع', 'كشف الاشتراكات والتحصيل المالي وأرقام الإيصالات وكشف تسكين الأتوبيس وتفقد المشرف.', '<button class="btn sm gold" type="button" data-act="hubTripPick">🖨️ اختيار رحلة / نشاط</button>', can('activities.manage') || can('reports.view') || can('finance.view')],
    ['', '🎁', 'سجل المنح الاجتماعية المنصرفة', 'تقرير تحليلي وتفصيلي بالمنح الاجتماعية حسب النوع والمستفيدين وأرقام الشيكات الصادرة.', '<button class="btn sm" type="button" data-act="hubGrtPrint">🖨️ سجل المنح</button>', canGrtAdmin() || can('reports.view')],
    ['', '⚖️', 'متابعة تنفيذ قرارات مجلس الإدارة', 'موقف تنفيذ القرارات والاعتمادات المالية والمنصرف الفعلي مقابل السقوف المعتمدة.', '<button class="btn sm" type="button" data-act="hubDecPrint">🖨️ تقرير القرارات</button>', can('governance.view') || can('governance.manage') || can('reports.view')],
    ['ok', '🏅', 'عدالة توزيع المزايا والدعم النقابي', 'بيان شامل للمزايا الممنوحة للأعضاء حسب البند والسنة ومزايا أعضاء مجلس الإدارة بشفافية.', '<button class="btn sm" type="button" data-act="hubBenPrint">🖨️ تقرير المزايا</button>', can('benefits.view') || can('reports.view')],
    ['', '🧾', 'بيان العُهد والسلف المفتوحة وأعمارها', 'حصر رقابي بجميع شيكات العُهد المفتوحة تحت التسوية وأعمارها الزمنية (+٣٠ / +٩٠ يوماً).', '<button class="btn sm" type="button" data-act="hubAdvPrint">🖨️ العهد المفتوحة</button>', can('finance.view') || can('reports.view')],
    ['', '📈', 'التقرير التنفيذي والمالي الشامل', 'ملخص الإدارة العليا لمؤشرات العضوية والموقف المالي والمزايا والأنشطة عن السنة المختارة.', '<button class="btn sm" type="button" data-act="repPrint">🖨️ التقرير الشامل</button>', true],
  ].filter(c => c[5]);
  return `<div class="card"><div class="row" style="margin-bottom:8px">
      <div style="flex:1;min-width:220px"><h2 style="margin:0">📑 مركز التقارير والكشوف المؤسسية المعتمدة</h2>
        <div class="muted">جميع التقارير تصدر بتنسيق A4 مؤسسي موحّد وممهورة بتوقيع أمين الصندوق ورئيس اللجنة النقابية.</div></div>
      <form id="repf" class="row"><select class="input" name="year"><option value="">كل السنوات</option>
        ${(r.years || []).map(y => `<option ${String(y) === String(r.year) ? 'selected' : ''}>${y}</option>`).join('')}</select><button class="btn">تحديث السنة</button></form>
    </div></div>
    <div class="rep-hub">${cards.map(([cls, ic, ttl, desc, btns]) => `<div class="rep-card ${cls}">
      <div class="rep-card-hd"><div class="rep-ic">${ic}</div><h3>${ttl}</h3></div>
      <p>${desc}</p>
      <div class="rep-card-ft">${btns}</div>
    </div>`).join('')}</div>
    <div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-bottom:14px">
      <div class="tile"><i>⬆️</i><b>${money(f.revenue)}</b><small>الإيرادات</small></div>
      <div class="tile"><i>⬇️</i><b>${money(f.expense)}</b><small>المصروفات</small></div>
      <div class="tile"><i>🎁</i><b>${money(b.total)}</b><small>المزايا (${num(b.people)} مستفيد)</small></div>
      <div class="tile"><i>🏦</i><b>${money(f.bank)}</b><small>البنك الدفتري (الآن)</small></div></div>
    <div class="dgrid">
      <div class="card"><h2>👥 الأعضاء (${num(m.total)})</h2><b>التنظيم</b>${kv2(m.byOrg)}<b style="display:block;margin-top:8px">الحالة</b>${kv2(m.byState)}</div>
      <div class="card"><h2>🎁 المزايا حسب البند</h2>${(b.byCategory || []).map(c => kvh(`${esc(c.category)} <small class="muted">(${num(c.people)})</small>`, money(c.total))).join('') || '<div class="empty">لا شيء</div>'}</div>
      <div class="card"><h2>🎁 المنح</h2>${(r.grants.byType || []).map(g => kvh(`${esc(g.type)} <small class="muted">(${num(g.paid)} مصروفة${g.open ? ' · ' + num(g.open) + ' تحت الإجراء' : ''})</small>`, money(g.amount))).join('') || '<div class="empty">لا طلبات</div>'}</div>
      <div class="card"><h2>🚌 الأنشطة (${(r.activities || []).length})</h2>${(r.activities || []).map(a => `<div class="kv" style="display:block"><div class="row"><b style="flex:1">${esc(a.title)}</b><small class="muted">${esc(a.kind)} · ${dt(a.date)}</small></div>
        <div class="muted">${num(a.people)} مشارك · محصّل ${num(a.collected)} · دعم ${num(a.subsidy)} · مصروفات ${num(a.expenses)}</div></div>`).join('') || '<div class="empty">لا أنشطة</div>'}</div>
      ${(r.summer || []).length ? `<div class="card"><h2>🏖️ المصايف</h2>${r.summer.map(s => kvh(esc(s.title) + ' <small class="muted">' + esc(s.status) + '</small>', `${num(s.applied)} طلب · ${num(s.slots)} خانة · دعم ${num(s.subsidy)}`)).join('')}</div>` : ''}
      <div class="card"><h2>📒 الإيرادات والمصروفات حسب الحساب</h2>${(f.byAccount || []).map(a => kvh(`<small class="muted">${esc(a.code)}</small> ${esc(a.name)} <small class="muted">(${esc(a.type)})</small>`, money(a.amount))).join('')}
        ${kvh('<b>الفائض / (العجز)</b>', `<b>${money(+f.revenue - +f.expense)}</b>`)}${kvh('الخزينة الآن', money(f.cash))}${kvh('عُهد تحت التسوية الآن', money(f.custody))}</div>
    </div>`;
}

// ───────── سجل المزايا ─────────
const KIND_ICON = { 'منحة': '🎁', 'بدل': '💼', 'جائزة': '🏆', 'دعم': '🤝', 'إعفاء': '🎟️', 'خصم': '📚', 'ميزة عينية': '📦' };
function benefitsBody(b, title, admin) {
  if (!b) return '<div class="spin"></div>';
  const kinds = Object.entries(b.byKind || {});
  return `<div class="card"><h2>${title}</h2>${admin ? '<button class="btn sm" style="float:left" data-act="benAdd">+ ميزة مباشرة</button>' : ''}
      <div style="font-size:28px;font-weight:800;color:var(--brand)">${money(b.total)} <small style="font-size:14px">ج</small></div>
      <div class="chips" style="margin-top:8px">${kinds.map(([k, v]) => `<span class="pill">${KIND_ICON[k] || '•'} ${esc(k)}: ${money(v)}</span>`).join('')}</div>
      ${(b.byYear || []).length > 1 ? `<div style="margin-top:10px">${b.byYear.map(y => kvh('سنة ' + y.year, money(y.total))).join('')}</div>` : ''}</div>
    <div class="card list">${(b.items || []).map(x => `<div class="li"><div class="av" style="width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#eaf2f8;flex:none">${KIND_ICON[x.kind] || '•'}</div>
      <div class="nm"><b>${esc(x.category)}</b><span class="muted">${dt(x.date)} · ${esc(x.source)}${x.basis ? ' · ' + esc(x.basis) : ''}${x.board_role ? ' · بصفته ' + esc(x.board_role) : ''}${x.notes ? ' · ' + esc(x.notes) : ''}</span></div>
      <b>${money(x.amount)}</b>${admin && x.source === 'يدوي' ? `<button class="btn sm sec" data-act="benCancel" data-ref="${esc(x.ref)}" title="إلغاء بسبب">✕</button>` : ''}</div>`).join('') || '<div class="empty">لا توجد مزايا مسجّلة</div>'}</div>`;
}
function benefitsReportView() {
  const r = S.benRep; if (!r) return '<div class="spin"></div>';
  const years = (r.byYear || []).map(y => y.year);
  return `<div class="card"><form id="byf" class="row"><select class="input" style="flex:1" name="year"><option value="">كل السنوات</option>
      ${years.map(y => `<option ${String(y) === String(r.year) ? 'selected' : ''}>${y}</option>`).join('')}</select><button class="btn">عرض</button>
      <button class="btn sec" type="button" data-act="benRepPrint">🖨️ طباعة تقرير المزايا</button></form></div>
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
function gridReportHTML(id) {
  const g = G[id]; if (!g) return '';
  const st = (S.grid && S.grid[id]) || { q: '' }, rows = gridView(id);
  const cols = g.cols.filter(c => !['سند', 'إجراء', 'إجراءات', ''].includes(c.t));
  const cleanTitle = plain(g.o.title || 'كشف رسمي').replace(/^[\p{Extended_Pictographic}\s]+/u, '').trim() || 'كشف بيانات رسمي';
  const cleanCell = html => String(html ?? '').replace(/<button[\s\S]*?<\/button>/gi, '').replace(/<a [^>]*>([\s\S]*?)<\/a>/gi, '$1');
  const isMoneyCol = c => c.num && rows.some(r => String(c.v(r) || '').includes('class="dt"'));
  const hasMoney = cols.some(isMoneyCol);
  const activeRows = rows.filter(r => r.status !== 'ملغى' && r.status !== 'مسترجعة');
  const foot = hasMoney && rows.length ? `<tfoot><tr><th></th>${cols.map((c, idx) => idx === 0
    ? `<th>الإجمالي المعتمد${activeRows.length !== rows.length ? ' (بدون الملغى)' : ''}</th>`
    : isMoneyCol(c) ? `<th class="n">${money(activeRows.reduce((s, r) => s + (+cellRaw(c, r) || 0), 0))}</th>` : '<th></th>').join('')}</tr></tfoot>` : '';
  const bodyRows = rows.map((r, i) => `<tr><td class="c">${numAr(i + 1)}</td>${cols.map(c => `<td class="${c.num ? 'n' : ''}">${cleanCell(c.v(r))}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${cols.length + 1}" class="c">${esc(g.o.empty || 'لا توجد سجلات مطابقة')}</td></tr>`;
  return erpDoc({
    dept: 'مركز المعلومات والتقارير المؤسسية', kind: 'كشف رسمي مستخرج', code: 'GRID',
    refLbl: 'كود الكشف', refNo: String(g.o.file || id).toUpperCase(),
    ctrl: [['عدد السجلات', `${numAr(rows.length)} سجل`]],
    title: cleanTitle,
    sub: st.q ? `فلتر البحث المطبّق: «${esc(st.q)}» — معروض ${numAr(rows.length)} من إجمالي ${numAr(g.rows.length)} سجل` : `بيان تفصيلي مستخرج من سجلات المنظومة (${numAr(rows.length)} سجل)`,
    status: `${numAr(rows.length)} سجل`, statusCls: 'ok',
    body: `<table class="ed-tbl"><thead><tr><th class="c" style="width:36px">م</th>${cols.map(c => `<th class="${c.num ? 'n' : ''}">${esc(c.t)}</th>`).join('')}</tr></thead><tbody>${bodyRows}</tbody>${foot}</table>`
  });
}
function bindGrids() {
  document.querySelectorAll('[data-gq]').forEach(i => i.oninput = () => { const id = i.dataset.gq; S.grid[id].q = i.value;
    document.querySelector(`[data-gb="${id}"]`).innerHTML = gridRows(id); bindPage(true); });
  document.querySelectorAll('[data-gs]').forEach(th => th.onclick = () => { const [id, i] = th.dataset.gs.split(':'), st = S.grid[id];
    if (st.sort === +i) st.dir = -st.dir; else { st.sort = +i; st.dir = 1; } render(); });
  document.querySelectorAll('[data-gx]').forEach(b => b.onclick = () => { const id = b.dataset.gx, g = G[id];
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = [g.cols.map(c => q(c.t)).join(','), ...gridView(id).map(r => g.cols.map(c => q(cellRaw(c, r))).join(','))].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = (g.o.file || id) + '-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
  document.querySelectorAll('[data-gp]').forEach(b => b.onclick = () => printDoc(gridReportHTML(b.dataset.gp)));
}

// ───────── المالية والخزينة (بوابة التنقّل المؤسسية الموحّدة + دورة طلبات الصرف والشيكات) ─────────
const money = v => `<span class="dt">${Number(v || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
const PURPOSES = ['منحة', 'عهدة', 'دعم نشاط', 'مصروف', 'أخرى'];
const PAY_PURPOSES = ['مصروف', 'عهدة', 'دعم نشاط', 'أخرى'];
const RCPT_KINDS = ['حصة الاشتراكات', 'تحويل النقابة العامة', 'اشتراكات', 'رد عهدة', 'إيرادات أخرى', 'رسوم بنكية'];
const FIN_GROUPS = [
  ['ops', '💰', 'العمليات والصرف', [
    ['#/finance', '📊', 'ملخص المالية', () => can('finance.view')],
    ['#/payreqs', '📝', 'طلبات الصرف والشيكات', () => can('finance.view') || can('treasury.payment.request') || can('treasury.payment.approve') || can('treasury.cheque.issue')],
    ['#/cheques', '🧾', 'سجل الشيكات', () => can('finance.view')],
    ['#/settlements', '🧮', 'التسويات والعُهد', () => can('finance.view')],
    ['#/receipts', '📥', 'المقبوضات', () => can('finance.view')],
  ]],
  ['bank', '🏦', 'البنك والأطراف', [
    ['#/bank', '🏦', 'البنك والمطابقة', () => can('finance.view')],
    ['#/chqbooks', '📗', 'دفاتر الشيكات', () => can('finance.view')],
    ['#/parties', '🏢', 'الأطراف والموردون', () => can('finance.view')],
  ]],
  ['acct', '📒', 'القيود والدفاتر', [
    ['#/journal', '✍️', 'عملية مالية / قيد', () => can('finance.journal')],
    ['#/entries', '📒', 'دفتر القيود', () => can('finance.view')],
    ['#/trial', '⚖️', 'ميزان المراجعة', () => can('finance.view')],
  ]],
  ['rep', '📊', 'القوائم والرقابة', [
    ['#/statements', '📑', 'القوائم المالية', () => can('finance.view')],
    ['#/budget', '🎯', 'الموازنة التقديرية', () => can('finance.view')],
    ['#/dues', '🧮', 'حصة الاشتراكات', () => can('finance.view')],
    ['#/policy', '📜', 'اللائحة المالية', () => can('finance.view')],
    ['#/periods', '🔒', 'إقفال الفترات والسنوات', () => can('finance.view')],
  ]],
];
function finTabs(act) {
  const groups = FIN_GROUPS.map(([k, ic, lbl, items]) => [k, ic, lbl, items.filter(x => x[3]())]).filter(g => g[3].length);
  if (!groups.length) return '';
  const owner = (groups.find(g => g[3].some(i => i[0] === act)) || groups[0])[0];
  const curGrp = S.finGrp && groups.some(g => g[0] === S.finGrp) ? S.finGrp : owner;
  const activeGrp = groups.find(g => g[0] === curGrp) || groups[0];
  return `<div class="mod-nav noprint">
    <div class="mn-groups">
      ${groups.map(([k, ic, lbl]) => `<button type="button" class="mn-grp ${!S.finAll && curGrp === k ? 'on' : ''}" data-fgrp="${k}"><i>${ic}</i>${lbl}</button>`).join('')}
      <button type="button" class="mn-grp mn-all-btn ${S.finAll ? 'on' : ''}" data-fgrp="all">⊞ كل الأقسام</button>
    </div>
    ${S.finAll
      ? `<div class="mn-mega">${groups.map(([, ic, lbl, items]) => `<div class="mn-col"><div class="mn-col-hd"><span>${ic}</span>${lbl}</div>
          ${items.map(([h, ii, t]) => `<button type="button" class="mn-item ${act === h ? 'on' : ''}" data-go="${h}"><i>${ii}</i>${t}</button>`).join('')}</div>`).join('')}</div>`
      : `<div class="mn-items">${activeGrp[3].map(([h, ii, t]) => `<button type="button" class="mn-item ${act === h ? 'on' : ''}" data-go="${h}"><i>${ii}</i>${t}</button>`).join('')}</div>`}
  </div>`;
}
const periodForm = f => `<form id="pf" class="row" style="margin-bottom:10px"><input class="input" style="flex:1" type="date" name="from" value="${esc(f.from || '')}">
  <input class="input" style="flex:1" type="date" name="to" value="${esc(f.to || '')}"><button class="btn sm">عرض الفترة</button></form>`;
function finSummaryView() {
  const s = S.fin || {}, y = s.year || {};
  return finTabs('#/finance') + `<div class="card">${periodForm(S.finP || { from: s.from, to: s.to })}
    <div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
      <div class="tile" data-ledger="1102"><i>🏦</i><b>${money(s.bank)}</b><small>رصيد البنك الدفتري (1102)</small></div>
      <div class="tile" data-ledger="1103"><i>🧾</i><b>${money(s.custody)}</b><small>عُهد تحت التسوية (${s.unsettled || 0} شيك مفتوح)</small></div>
      <div class="tile"><i>⬆️</i><b>${money(y.revenue)}</b><small>إيرادات الفترة</small></div>
      <div class="tile"><i>⬇️</i><b>${money(y.expense)}</b><small>مصروفات الفترة</small></div></div></div>
  <div class="card row">
    ${can('treasury.payment.request') || can('treasury.cheque.issue') ? '<button class="btn gold" data-act="payReqNew">📝 + طلب صرف واستخراج شيك</button>' : ''}
    ${can('grants.review') ? '<button class="btn sec" data-act="grtStaffNew">🎁 + طلب استخراج منحة</button>' : ''}
    ${can('treasury.cheque.issue') ? '<button class="btn sec" data-act="chqNew">⚡ إصدار شيك مباشر</button>' : ''}
    ${can('treasury.receipt') ? '<button class="btn sec" data-act="rcptNew">📥 + إيداع / تحصيل</button>' : ''}
    <button class="btn sec" data-act="opsRepOpen">🖨️ كشف حساب العمليات والشيكات</button>
  </div>
  <div class="dgrid">
    <div class="card"><h2>📊 المصروفات حسب المجموعة</h2>${(s.byGroup || []).map(g => kvh(g.name, money(g.amount))).join('') || '<div class="empty">لا مصروفات في الفترة</div>'}</div>
    <div class="card"><h2>🧾 العُهد المفتوحة</h2>${(s.openCustody || []).map(o => kvh(esc(o.party), money(o.balance))).join('') || '<div class="empty">لا عُهد مفتوحة 👌</div>'}</div>
  </div>`;
}
const kvh = (k, vHtml) => `<div class="kv"><span>${k}</span><span>${vHtml}</span></div>`;
const stPill = st => `<span class="pill ${['مسوّى', 'معتمدة', 'مصروف', 'معتمد'].includes(st) ? 'ok' : ['صادر', 'مسودة', 'مرحّل الرصيد', 'مقدَّم'].includes(st) ? 'warn' : ['ملغى', 'مسترجعة', 'مرفوض'].includes(st) ? 'bad' : ''}">${esc(st)}</span>`;

function paymentRequestHTML(r) {
  const accTxt = r.requires_settlement ? '1103 — عُهد تحت التسوية (بذمة المستلم لحين التسوية)' : `${esc(r.expense_account || '')} — ${esc(r.account_name || '')}`;
  return erpDoc({
    dept: 'الإدارة المالية والخزينة · الرقابة على الصرف', kind: 'إذن وطلب استخراج شيك', code: 'PAYREQ',
    refLbl: 'رقم طلب الصرف', refNo: r.req_no, date: r.req_date,
    ctrl: [['سند الصرف', r.auth_basis], ['طبيعة الصرف', r.purpose]],
    title: 'استمارة طلب صرف واستخراج شيك بنكي (إذن صرف)',
    sub: 'مستند رقابة داخلية ومراجعة واعتماد مالي سابق لإصدار الشيك البنكي',
    status: r.status, statusCls: ['مصروف', 'معتمد'].includes(r.status) ? 'ok' : r.status === 'مقدَّم' ? 'warn' : 'bad',
    sigCols: s => [['مقدّم الطلب', r.requested_by_name || ''], ['أمين الصندوق', s.treasurer], ['رئيس اللجنة النقابية', s.chair]],
    body: edMoney(r.amount, 'المبلغ المطلوب استخراج شيك به') + edGrid([
      [6, 'يُحرر الشيك لأمر السيد / الجهة', `<b>${esc(r.payee_name)}</b>${r.person?.job_id ? ` <small>(رقم وظيفي: ${esc(r.person.job_id)})</small>` : ''}`],
      [3, 'تاريخ الطلب', dt(r.req_date)],
      [3, 'طبيعة الصرف', esc(r.purpose)],
      [6, 'التوجيه المحاسبي عند الإصدار', accTxt],
      [6, 'سند الصلاحية الإدارية', r.decision ? `قرار مجلس رقم (${esc(r.decision.decision_no)}) — ${esc(r.decision.text)}` : `${esc(r.auth_basis)} (لا يشترط قرار مجلس)`],
      [12, 'البيان التفصيلي والغرض من الصرف', `<b>${esc(r.description)}</b>`],
      [12, 'المستندات والفواتير المؤيدة للصرف', esc(r.supporting_docs || 'مرفق بأصل المستندات المؤيدة')],
      [4, 'مقدّم الطلب', esc(r.requested_by_name || '—')],
      [4, 'معتمِد الصرف', esc(r.approved_by_name || 'قيد الاعتماد') + (r.approval_note ? ` (${esc(r.approval_note)})` : '')],
      [4, 'بيانات الشيك المستخرج', r.cheque ? `شيك رقم ${esc(r.cheque.cheque_no || 'بدون رقم')} بتاريخ ${dt(r.cheque.issue_date)}` : 'لم يُستخرج الشيك بعد'],
    ]) + (r.reject_reason ? `<div class="ed-box" style="border-color:#dc2626;background:#fef2f2;color:#991b1b"><b>سبب الرفض / الإلغاء:</b> ${esc(r.reject_reason)}</div>` : '')
      + `<div class="ed-box gold"><b>ضوابط الرقابة الداخلية والمحاسبية:</b> لا يترتب على هذا الطلب أي قيد محاسبي بالدفاتر إلا عند الإصدار الفعلي للشيك البنكي واستلامه، ويُحفظ هذا الإذن مرفقاً بأصل الفواتير ومستند الصرف في الأرشيف المالي.</div>`
  });
}

function payReqsView() {
  const d = S.payReqs || {}, items = d.items || [], grants = d.approvedGrants || [], c = d.counts || {}, f = S.payF || {};
  const canReq = can('treasury.payment.request') || can('treasury.cheque.issue');
  const canApp = can('treasury.payment.approve');
  const canChq = can('treasury.cheque.issue');
  const kpi = (i, v, l, cls = '') => `<div class="kpi ${cls}"><i>${i}</i><div><b>${numAr(v)}</b><small>${l}</small></div></div>`;
  return finTabs('#/payreqs')
    + `<div class="kpis">
        ${kpi('⏳', c.pending || 0, 'طلبات صرف بانتظار الاعتماد', c.pending ? 'warn' : 'ok')}
        ${kpi('🧾', c.approved || 0, 'أوامر صرف جاهزة لاستخراج شيك', c.approved ? 'warn' : 'ok')}
        ${kpi('🎁', c.grantsReady || 0, 'منح معتمدة جاهزة لاستخراج شيك', c.grantsReady ? 'warn' : 'ok')}
        ${kpi('✅', c.paid || 0, 'طلبات صُرفت بشيكات بنكية', 'ok')}
      </div>
      <div class="card row">
        <div style="flex:1;min-width:220px">
          <b>📝 دورة طلبات الصرف واستخراج الشيكات والمنح</b>
          <div class="muted">الدورة الإدارية والمحاسبية السليمة: تقديم طلب الصرف بالمستندات ⇐ اعتماد الصرف (مع فصل المهام) ⇐ استخراج الشيك البنكي وترحيل القيد آلياً. قرار المجلس اختياري.</div>
        </div>
        ${canReq ? '<button class="btn gold" data-act="payReqNew">+ طلب صرف واستخراج شيك</button>' : ''}
        ${can('grants.review') ? '<button class="btn sec" data-act="grtStaffNew">🎁 + طلب استخراج منحة</button>' : ''}
      </div>
      ${grants.length ? `<div class="card" style="border-inline-start:5px solid var(--gold);background:#fffdf8">
        <h2>🎁 منح اجتماعية معتمدة جاهزة لاستخراج الشيك (${numAr(grants.length)})</h2>
        ${grants.map(g => `<div class="kv" style="align-items:center;flex-wrap:wrap">
          <div><b>${esc(g.type_name)} — ${esc(g.person?.full_name || '')}</b> <small class="muted">(${esc(g.req_no)} · رقم وظيفي ${esc(g.person?.job_id || '—')})</small>
            <div class="muted">المستفيد: ${esc(g.subject_name || '')} (${esc(g.subject_relation || '')}) · الواقعة: ${dt(g.event_date)}${g.decision ? ' · قرار ' + esc(g.decision.decision_no) : ' · صرف لائحي'}</div></div>
          <div class="row" style="gap:8px">
            <b style="font-size:16px;color:var(--brand)">${money(g.amount)} ج.م</b>
            <button class="btn sm sec" data-grtprint="${g.id}">🖨️ الاستمارة</button>
            ${canChq ? `<button class="btn sm gold" data-grtissue="${g.id}">🧾 استخراج الشيك</button>` : ''}
          </div></div>`).join('')}
      </div>` : ''}
      <div class="subtabs">
        ${[['', '📂 الكل'], ['مقدَّم', '⏳ بانتظار الاعتماد', c.pending], ['معتمد', '🧾 جاهز لاستخراج شيك', c.approved], ['مصروف', '✅ مصروف بشيك', c.paid], ['مرفوض', '✕ مرفوض', c.rejected]]
          .map(([s, t, n]) => `<button data-payf="${s}" class="${(f.status || '') === s ? 'on' : ''}">${t}${n ? `<span class="st-cnt">${numAr(n)}</span>` : ''}</button>`).join('')}
      </div>
      <div class="card"><form id="prf" class="row">
        <input class="input" style="flex:1;min-width:180px" name="q" value="${esc(f.q || '')}" placeholder="🔎 بحث برقم الطلب، اسم المستفيد، أو البيان…">
        <button class="btn">بحث</button>
      </form></div>
      ${items.map(r => {
        const cls = r.status === 'مصروف' ? 'st-ok' : ['مقدَّم', 'معتمد'].includes(r.status) ? 'st-warn' : 'st-bad';
        const stageIdx = r.status === 'مقدَّم' ? 1 : r.status === 'معتمد' ? 2 : r.status === 'مصروف' ? 3 : -1;
        return `<div class="req-card ${cls}">
          <div class="row">
            <span class="dec-no">${esc(r.req_no)}</span>
            <span class="pill">${esc(r.purpose)}</span>
            <span class="pill ${r.decision ? 'ok' : ''}">${r.decision ? '⚖️ قرار ' + esc(r.decision.decision_no) : '📜 ' + esc(r.auth_basis)}</span>
            <span class="sp" style="flex:1"></span>
            <b style="font-size:18px;color:var(--brand)">${money(r.amount)} ج.م</b>
            ${stPill(r.status)}
          </div>
          <div style="margin-top:6px;font-size:15px"><b>المستفيد: ${esc(r.payee_name)}</b>${r.person?.job_id ? ` <small class="muted">(${esc(r.person.job_id)})</small>` : ''} — ${esc(r.description)}</div>
          <div class="req-meta">
            <span>📅 تاريخ الطلب: ${dt(r.req_date)}</span>
            <span>📒 الحساب: <b>${r.requires_settlement ? '1103 عُهد تحت التسوية' : esc((r.expense_account || '') + ' ' + (r.account_name || ''))}</b></span>
            ${r.supporting_docs ? `<span>📎 المسوّغات: ${esc(r.supporting_docs)}</span>` : ''}
            <span>👤 قدّمه: ${esc(r.requested_by_name || '—')}</span>
            ${r.approved_by_name ? `<span>✓ المعتمِد: ${esc(r.approved_by_name)}</span>` : ''}
            ${r.cheque ? `<span>🧾 الشيك: <a href="#/cheque/${r.cheque.id}"><b>${esc(r.cheque.cheque_no || 'بدون رقم')}</b></a> (${dt(r.cheque.issue_date)})</span>` : ''}
          </div>
          ${r.reject_reason ? `<div class="alert bad" style="margin:6px 0">${esc(r.reject_reason)}</div>` : ''}
          ${stepper({ stages: ['تقديم الطلب', 'اعتماد الصرف', 'استخراج الشيك', 'تم الصرف'], idx: stageIdx })}
          <div class="row" style="margin-top:8px">
            ${r.status === 'مقدَّم' && canApp ? `<button class="btn sm" data-payapp="${r.id}">✓ اعتماد الصرف</button><button class="btn sm bad" data-payrej="${r.id}">✕ رفض</button>` : ''}
            ${r.status === 'معتمد' && canChq ? `<button class="btn sm gold" data-payissue="${r.id}">🧾 استخراج وإصدار الشيك</button>` : ''}
            ${r.cheque ? `<a class="btn sm sec" href="#/cheque/${r.cheque.id}" style="text-decoration:none">فتح الشيك وسند الصرف</a>` : ''}
            <button class="btn sm sec" data-payprt="${r.id}">🖨️ إذن الصرف (A4)</button>
            <button class="btn sm sec" data-paydocs="${r.id}">📎 المرفقات${r.docs_count ? ` (${numAr(r.docs_count)})` : ''}</button>
            ${r.status === 'مقدَّم' ? `<button class="btn sm bad" data-paycan="${r.id}">إلغاء الطلب</button>` : ''}
          </div>
          <div data-paydocbox="${r.id}"></div>
        </div>`;
      }).join('') || '<div class="card empty">لا توجد طلبات صرف مطابقة — اضغط «+ طلب صرف واستخراج شيك» لإنشاء طلب جديد</div>'}`;
}

function chequesView() {
  const f = S.chqF || {};
  return finTabs('#/cheques') + `<div class="card row">
      <form id="cf" class="row" style="flex:1"><input class="input" style="flex:2;min-width:140px" name="q" value="${esc(f.q || '')}" placeholder="🔎 مستفيد / رقم شيك / بيان">
        <select class="input" style="flex:1;min-width:105px" name="purpose"><option value="">كل الأغراض</option>${options(PURPOSES, f.purpose, false)}</select>
        <select class="input" style="flex:1;min-width:105px" name="status"><option value="">كل الحالات</option>${options(['صادر', 'مسوّى', 'مرحّل الرصيد'], f.status, false)}</select>
        <button class="btn">بحث</button></form>
      <button class="btn sec" type="button" data-act="opsRepOpen">🖨️ كشف العمليات والشيكات</button>
      ${can('treasury.payment.request') || can('treasury.cheque.issue') ? '<button class="btn gold" data-act="payReqNew">📝 + طلب استخراج شيك</button>' : ''}
      ${can('treasury.cheque.issue') ? '<button class="btn sec" data-act="chqNew">⚡ شيك مباشر</button>' : ''}
    </div>` + grid('chq', [
    { t: 'التاريخ', v: c => dt(c.issue_date), raw: c => c.issue_date },
    { t: 'رقم الشيك', v: c => esc(c.cheque_no || '—'), raw: c => c.cheque_no || '' },
    { t: 'المستفيد', v: c => `<b>${esc(c.payee_name)}</b>`, raw: c => c.payee_name },
    { t: 'الغرض', v: c => esc(c.purpose), raw: c => c.purpose },
    { t: 'القرار', v: c => esc(c.decision_no || '—'), raw: c => c.decision_no || '' },
    { t: 'المبلغ', v: c => money(c.amount), raw: c => +c.amount, num: true },
    { t: 'الحالة', v: c => stPill(c.status), raw: c => c.status },
    { t: 'الصرف من البنك', v: c => c.status === 'ملغى' ? '<span class="pill bad">ملغى</span>' : c.cleared_date ? `<span class="pill ok">منصرف ${dt(c.cleared_date)}</span>` : '<span class="pill warn">لم يُصرف</span>', raw: c => c.status === 'ملغى' ? 'ملغى' : c.cleared_date ? 'منصرف' : 'لم يُصرف' },
  ], S.cheques, { title: '🧾 الشيكات', file: 'cheques', attr: c => `data-chq="${c.id}"`, empty: 'لا شيكات',
    foot: `<tr><td colspan="5"><b>الإجمالي (بدون الملغى)</b></td><td class="n"><b>${money((S.cheques || []).filter(c => c.status !== 'ملغى').reduce((x, c) => x + +c.amount, 0))}</b></td><td></td><td></td></tr>` });
}
function chequeView() {
  const c = S.cheque; if (!c) return '';
  const st = c.settlement;
  return `<a href="#/cheques" class="btn sm sec" style="display:inline-block;margin-bottom:10px;text-decoration:none">→ الشيكات</a>
  <div class="card"><h2>شيك ${esc(c.cheque_no || 'بدون رقم')}<span class="sp"></span>${stPill(c.status)}</h2>
    ${kvh('المستفيد', esc(c.payee_name))}${kvh('التاريخ', dt(c.issue_date))}${kvh('المبلغ', money(c.amount))}${kvh('الغرض', esc(c.purpose))}
    ${kvh('القرار', c.decision ? esc(c.decision.decision_no + ' — ' + c.decision.text) : '<span class="muted">غير مربوط</span>')}
    ${c.notes ? kvh('البيان', esc(c.notes)) : ''}
    ${kvh('الصرف من البنك', c.status === 'ملغى' ? `<span class="pill bad">ملغى</span> ${esc(c.void_reason || '')}` : c.cleared_date ? `<span class="pill ok">منصرف ${dt(c.cleared_date)}</span>` : '<span class="pill warn">لم يُصرف بعد</span>')}
    ${c.entry_id ? `<button class="btn sm sec" data-entry="${c.entry_id}" style="margin-top:8px">عرض القيد</button>` : ''}
    ${c.void_entry_id ? `<button class="btn sm sec" data-entry="${c.void_entry_id}" style="margin-top:8px">قيد الإلغاء</button>` : ''}
    <button class="btn sm sec" data-act="voucher" style="margin-top:8px">🖨️ سند الصرف</button>
    ${can('treasury.cheque.issue') && c.status !== 'ملغى' ? `<button class="btn sm ${c.cleared_date ? 'sec' : ''}" data-act="chqClear" style="margin-top:8px">${c.cleared_date ? 'إلغاء تأكيد الصرف' : '✓ تأكيد الصرف من البنك'}</button>` : ''}
    ${can('treasury.cheque.issue') && c.status === 'صادر' && !c.cleared_date && !st ? '<button class="btn sm bad" data-act="chqVoid" style="margin-top:8px">✗ إلغاء الشيك</button>' : ''}
    ${c.requires_settlement && c.status === 'صادر' && can('treasury.settlement') ? `<button class="btn sm gold" data-act="settleNew" style="margin-top:8px">${st && st.status === 'مسودة' ? '✏️ استكمال مسودة التسوية' : 'تسوية العهدة'}</button>` : ''}</div>
  ${st ? `<div class="card"><h2>🧮 التسوية (${dt(st.settle_date)})<span class="sp"></span><span class="pill ${st.status === 'مسودة' ? 'warn' : 'ok'}">${esc(st.status || 'معتمدة')}</span></h2>
    ${st.status === 'مسودة' ? '<div class="alert warn">مسودة محفوظة — لا قيد ولا مزايا لحد الاعتماد.</div>' : ''}
    ${(st.cheques || []).length > 1 ? kvh('شيكات المجموعة', st.cheques.map(x => `<a href="#/cheque/${x.id}">${esc(x.cheque_no || 'بدون رقم')}</a> (${money(x.amount)})`).join(' + ')) : ''}
    ${kvh('العهدة', money(st.advance))}${+st.prev_balance ? kvh('رصيد مرحّل سابق' + (st.carried_from_no ? ' من شيك ' + esc(st.carried_from_no) : ''), money(st.prev_balance)) : ''}
    ${+st.subscriptions ? kvh('اشتراكات المشاركين', money(st.subscriptions)) : ''}${kvh('المصروف', money(st.spent))}
    ${+st.returned ? kvh(esc(st.return_mode), money(st.returned)) : ''}
    ${(st.lines || []).map(l => `<div class="kv"><span>${esc(l.category)}${l.notes ? ' <small class="muted">' + esc(l.notes) + '</small>' : ''}</span><span>${money(l.amount)}</span></div>`).join('')}
    <div class="row" style="margin-top:8px">
    <button class="btn sm gold" type="button" data-stlprt="${st.id}">🖨️ كشف التسوية (A4)</button>
    ${st.entry_id ? `<button class="btn sm sec" data-entry="${st.entry_id}">عرض قيد التسوية</button>` : ''}
    ${st.status === 'مسودة' && can('treasury.settlement') ? '<button class="btn sm bad" data-act="stlDraftDel">🗑️ حذف المسودة</button>' : ''}
    ${st.status !== 'مسودة' && can('finance.journal') ? '<button class="btn sm bad" data-act="stlReverse">↩️ استرجاع التسوية (قيد عكسي)</button>' : ''}</div></div>` : ''}
  ${(c.reversed || []).length ? `<div class="card"><h2>↩️ تسويات مسترجعة</h2>${c.reversed.map(r => `<div class="kv"><span>${dt(r.settle_date)} — مصروف ${money(r.spent)} <small class="muted">السبب: ${esc(r.reason || '')}</small></span>
    <span class="row" style="gap:6px"><button class="btn sm sec" data-stlprt="${r.id}">🖨️ الكشف</button>${r.reverse_entry_id ? `<button class="btn sm sec" data-entry="${r.reverse_entry_id}">القيد العكسي</button>` : ''}</span></div>`).join('')}</div>` : ''}
  ${docsBox('cheque', c.id, '📎 مستندات الشيك والتسوية (قرار، فواتير، إيصالات)')}`;
}
function receiptsView() {
  return finTabs('#/receipts') + `${can('treasury.receipt') ? '<div class="card"><button class="btn" data-act="rcptNew">+ إيداع / تحصيل / رسوم</button></div>' : ''}
  ${grid('rcpt', [
    { t: 'التاريخ', v: r => dt(r.receipt_date), raw: r => r.receipt_date },
    { t: 'رقم الإيصال', v: r => esc(r.receipt_no), raw: r => r.receipt_no },
    { t: 'النوع', v: r => `<b>${esc(r.kind)}</b>`, raw: r => r.kind },
    { t: 'الجهة', v: r => esc(r.party || '—'), raw: r => r.party || '' },
    { t: 'المبلغ', v: r => money(r.amount), raw: r => +r.amount, num: true },
    { t: 'سند', v: r => `<button class="btn sm sec" data-rcptv="${r.id}">🖨️ سند قبض</button>`, raw: () => '' },
  ], S.receipts, { title: '📥 المقبوضات', file: 'receipts', attr: r => r.entry_id ? `data-entry="${r.entry_id}"` : '', empty: 'لا مقبوضات في الفترة',
    foot: `<tr><td colspan="4"><b>الإجمالي</b></td><td class="n"><b>${money((S.receipts || []).reduce((x, r) => x + +r.amount, 0))}</b></td><td></td></tr>` })}`;
}


// ───────── الموازنة التقديرية مقابل الفعلي ─────────
function budgetView() {
  const b = S.bud || {}, items = b.items || [], ed = S.budEdit;
  const part = type => { const rows = items.filter(x => x.type === type), bt = rows.reduce((a, x) => a + +x.budget, 0), at = rows.reduce((a, x) => a + +x.actual, 0);
    const groups = [...new Set(rows.map(x => x.grp))];
    const pctBar = (a, bd) => { if (!+bd) return '<span class="muted">—</span>'; const p = Math.round(100 * a / bd), over = type === 'مصروفات' ? p > 100 : p < 100;
      return `<div class="pb ${over ? 'bad' : 'ok'}"><i style="width:${Math.min(p, 100)}%"></i></div><small>${numAr(p)}%</small>`; };
    return { bt, at, html: `<div class="card"><h2>${type === 'إيرادات' ? '⬆️ الإيرادات' : '⬇️ المصروفات'}</h2><div class="gtw"><table class="bt">
      <thead><tr><th>الحساب</th><th class="n">الموازنة</th><th class="n">الفعلي</th><th class="n">الانحراف</th><th>نسبة التنفيذ</th></tr></thead><tbody>
      ${groups.map(g => { const gr = rows.filter(x => x.grp === g), gb = gr.reduce((a, x) => a + +x.budget, 0), ga = gr.reduce((a, x) => a + +x.actual, 0);
        return `<tr class="bg"><td>${esc(g)} — ${esc(gr[0].grp_name || '')}</td><td class="n">${money(gb)}</td><td class="n">${money(ga)}</td><td class="n">${money(gb - ga)}</td><td>${pctBar(ga, gb)}</td></tr>` +
          gr.map(x => `<tr><td data-l="الحساب"><span class="muted">${esc(x.code)}</span> ${esc(x.name)}</td>
            <td class="n" data-l="الموازنة">${ed ? `<input class="input bi" type="number" min="0" step="0.01" data-bacc="${esc(x.code)}" value="${+x.budget || ''}" placeholder="0">` : money(x.budget)}</td>
            <td class="n" data-l="الفعلي"><a href="#/ledger/${esc(x.code)}">${money(x.actual)}</a></td>
            <td class="n ${(type === 'مصروفات' ? +x.budget - +x.actual : +x.actual - +x.budget) < 0 && +x.budget ? 'neg' : ''}" data-l="الانحراف">${money(+x.budget - +x.actual)}</td>
            <td data-l="التنفيذ">${pctBar(+x.actual, +x.budget)}</td></tr>`).join(''); }).join('')}
      </tbody><tfoot><tr><td>الإجمالي</td><td class="n">${money(bt)}</td><td class="n">${money(at)}</td><td class="n">${money(bt - at)}</td><td>${pctBar(at, bt)}</td></tr></tfoot></table></div></div>` };
  };
  const rv = part('إيرادات'), ex = part('مصروفات');
  const kpi = (i, v, l, c = '') => `<div class="kpi ${c}"><i>${i}</i><div><b>${v}</b><small>${l}</small></div></div>`;
  return finTabs('#/budget') + `<div class="card"><form id="byr" class="row"><select class="input" style="flex:1" name="year">${(b.years || []).map(y => `<option ${+y === +b.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <button class="btn">عرض</button>${ed ? '<button class="btn gold" type="button" data-act="budSave">💾 حفظ الموازنة</button>' : ''}<button class="btn sec" type="button" data-act="budPrint">🖨️ طباعة الموازنة</button></form>
      <div class="muted" style="margin-top:6px">الموازنة التقديرية لسنة ${b.year} مقابل الفعلي من القيود المرحّلة.${ed ? ' اكتب مبلغ كل بند ثم احفظ — كل تعديل يُسجَّل في سجل التدقيق.' : ''}</div></div>
    <div class="kpis">${kpi('⬆️', money(rv.bt), 'إيرادات مقدّرة')}${kpi('✅', money(rv.at), 'إيرادات فعلية', rv.at >= rv.bt ? 'ok' : 'warn')}
      ${kpi('⬇️', money(ex.bt), 'مصروفات مقدّرة')}${kpi('🧾', money(ex.at), 'مصروفات فعلية', ex.at > ex.bt && ex.bt ? 'bad' : 'ok')}
      ${kpi('📊', money(rv.bt - ex.bt), 'الفائض المقدّر')}${kpi(rv.at - ex.at >= 0 ? '📈' : '📉', money(rv.at - ex.at), 'الفائض الفعلي', rv.at - ex.at >= 0 ? 'ok' : 'bad')}</div>
    <div id="buderr"></div>${rv.html}${ex.html}`;
}

// ───────── البنك: المطابقة ودفاتر الشيكات ─────────
function bankView() {
  const r = S.recon || {}, f = S.bankF || {}, ed = can('treasury.cheque.issue'), diff = r.difference == null ? null : +r.difference, today = new Date().toISOString().slice(0, 10);
  const rows = (items, kind) => items.map(x => `<tr><td>${ed ? `<input type="checkbox" data-clr="${kind}" value="${x.id}">` : ''}</td>
      <td>${dt(kind === 'cheque' ? x.issue_date : x.receipt_date)}</td><td>${esc(kind === 'cheque' ? (x.cheque_no || '—') : x.receipt_no)}</td>
      <td>${esc(kind === 'cheque' ? x.payee_name : (x.kind + (x.party ? ' — ' + x.party : '')))}${x.stale ? ' <span class="pill bad">متقادم +6 شهور</span>' : ''}</td><td class="n">${money(x.amount)}</td>
      ${kind === 'cheque' ? `<td>${ed ? `<button class="btn sm sec" data-chqgo="${x.id}">فتح</button>` : ''}</td>` : '<td></td>'}</tr>`).join('');
  return finTabs('#/bank') + `<div class="card"><form id="bankf" class="row">
      <label style="flex:1;min-width:140px"><span class="muted" style="font-size:12px">تاريخ كشف البنك</span><input class="input" type="date" name="date" value="${esc(f.date || r.date || today)}"></label>
      <label style="flex:1;min-width:140px"><span class="muted" style="font-size:12px">الرصيد في كشف البنك</span><input class="input" type="number" step="0.01" name="stmtBalance" value="${esc(f.stmtBalance ?? '')}" placeholder="مثال: 14000"></label>
      <button class="btn" style="align-self:flex-end">احسب المطابقة</button>
      <button class="btn sec" type="button" data-act="bankRepPrint" style="align-self:flex-end">🖨️ طباعة مذكرة التسوية</button></form></div>
    <div class="card recon"><h2>🏦 مذكرة تسوية البنك — ${dt(r.date)}</h2>
      ${kvh('الرصيد في الدفاتر (حساب 1102)', money(r.book_balance))}
      ${kvh(`(+) شيكات صادرة لم تُصرف بعد <small class="muted">(${numAr((r.cheques || []).length)})</small>`, money(r.outstanding_cheques))}
      ${kvh(`(−) إيداعات لم تظهر في البنك بعد <small class="muted">(${numAr((r.deposits || []).length)})</small>`, money(r.deposits_in_transit))}
      ${kvh('<b>= الرصيد المتوقع في كشف البنك</b>', `<b>${money(r.adjusted)}</b>`)}
      ${r.stmt_balance != null ? kvh('الرصيد الفعلي في كشف البنك', money(r.stmt_balance)) : ''}
      ${diff == null ? '<div class="alert warn" style="margin-top:10px">اكتب رصيد كشف البنك واحسب المطابقة.</div>'
        : `<div class="alert ${Math.abs(diff) < 0.01 ? 'ok' : 'bad'}" style="margin-top:10px;font-size:16px">${Math.abs(diff) < 0.01 ? '✓ مطابق — لا يوجد فرق' : `فرق غير مفسَّر: <b>${money(diff)}</b><br><small>علِّم الشيكات اللي ظهرت في كشف البنك كـ«منصرفة»، والإيداعات اللي ظهرت كـ«مودعة». الفرق الباقي غالباً مصاريف أو فوايد بنكية في الكشف ماتسجّلتش — سجّلها من «المقبوضات» (رسوم بنكية / إيرادات أخرى).</small>`}</div>`}
      ${ed && diff != null ? `<div class="row" style="margin-top:10px"><button class="btn sec" data-act="reconSave">💾 حفظ المطابقة</button>${Math.abs(diff) < 0.01 ? '<button class="btn gold" data-act="reconApprove">✓ اعتماد المطابقة</button>' : ''}</div>` : ''}</div>
    ${ed ? `<div class="card"><details class="paste"><summary><b>📋 لصق كشف البنك</b> <span class="muted">— انسخ سطور الكشف من ملف البنك (Excel أو PDF) والصقها هنا</span></summary>
      <div class="muted" style="margin-top:6px">المنظومة بتدوّر في كل سطر على رقم شيك من الشيكات المعلّقة (وتتأكد من المبلغ)، وعلى إيداعات بنفس المبلغ، وبتعلّمهم بتاريخ السطر. بعدها راجع واضغط «✓ المحدد ظهر في الكشف».</div>
      <textarea class="input" id="stmtBox" rows="6" dir="ltr" style="margin-top:6px" placeholder="مثال: 15/11/2026  شيك 100006859333  300.00"></textarea>
      <button class="btn sm" data-act="stmtMatch" style="margin-top:6px">مطابقة</button><div id="stmtRes"></div></details></div>` : ''}
    <div class="card"><h2>🧾 شيكات صادرة لم تُصرف من البنك<span class="sp"></span>${ed ? '<input class="input" type="date" id="clrDate" style="max-width:160px" value="' + esc(f.date || today) + '"><button class="btn sm" data-act="clrSel" data-kind="cheque">✓ المحدد ظهر في الكشف</button>' : ''}</h2>
      <div class="muted" style="margin-bottom:6px">حدّد الشيكات اللي ظهرت في كشف البنك (اتصرفت) واضغط التأكيد. اللي يفضل هنا هو الشيكات اللي مع المستفيدين ولسه ما صرفوهاش.</div>
      <div class="gtw"><table class="bt"><thead><tr><th>${ed ? '<input type="checkbox" data-all="cheque">' : ''}</th><th>التاريخ</th><th>رقم الشيك</th><th>المستفيد</th><th class="n">المبلغ</th><th></th></tr></thead>
      <tbody>${rows(r.cheques || [], 'cheque') || '<tr><td colspan="6"><div class="empty">لا شيكات معلّقة 👌</div></td></tr>'}</tbody></table></div></div>
    <div class="card"><h2>📥 إيداعات لم تظهر في البنك<span class="sp"></span>${ed ? '<button class="btn sm" data-act="clrSel" data-kind="receipt">✓ المحدد ظهر في الكشف</button>' : ''}</h2>
      <div class="gtw"><table class="bt"><thead><tr><th>${ed ? '<input type="checkbox" data-all="receipt">' : ''}</th><th>التاريخ</th><th>الإيصال</th><th>البيان</th><th class="n">المبلغ</th><th></th></tr></thead>
      <tbody>${rows(r.deposits || [], 'receipt') || '<tr><td colspan="6"><div class="empty">لا إيداعات معلّقة</div></td></tr>'}</tbody></table></div></div>
    ${ed ? `<div class="card"><h2>⚡ تأكيد جماعي للفترات القديمة</h2><div class="muted">لو متأكد إن كل الشيكات والإيداعات لحد تاريخ معيّن اتصرفت وظهرت في البنك، أكّدها مرة واحدة (بتاريخ إصدار كل شيك). تقدر تلغي تأكيد أي شيك بعدها من شاشته.</div>
      <div class="row" style="margin-top:8px"><input class="input" type="date" id="uptoDate" style="max-width:180px"><button class="btn sec" data-act="clrUpto">تأكيد كل ما قبل هذا التاريخ</button></div></div>` : ''}
    <div class="card"><h2>📚 المطابقات السابقة</h2>${(r.history || []).map(x => kvh(`${dt(x.stmt_date)} <span class="pill ${x.status === 'معتمدة' ? 'ok' : ''}">${esc(x.status)}</span> <small class="muted">${esc(x.created_by || '')}${x.approved_by ? ' · اعتمد ' + esc(x.approved_by) : ''}</small>`,
      `${money(x.stmt_balance)} <small class="muted">فرق ${money(x.difference)}</small>`)).join('') || '<div class="empty">لا مطابقات محفوظة</div>'}</div>`;
}

function matchStatement() {
  const r = S.recon || {}, norm = v => String(v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٬،]/g, ',').replace(/٫/g, '.');
  const lines = norm($('#stmtBox').value).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const chq = {}; (r.cheques || []).forEach(c => { if (c.cheque_no) chq[String(c.cheque_no)] = c; });
  const deps = (r.deposits || []).slice(), usedDep = new Set(), hits = [], unmatched = [];
  let lastDate = null;
  for (const l of lines) {
    const dm = l.match(/(\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/), date = dm ? parseAnyDate(dm[1]) : lastDate; if (date) lastDate = date;
    const amounts = (l.replace(dm ? dm[1] : '', ' ').match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d{1,2}|\d+/g) || []).map(x => +x.replace(/,/g, ''));
    const tokens = l.match(/\d{6,18}/g) || [];
    const c = tokens.map(t => chq[t] || Object.values(chq).find(x => x.cheque_no.endsWith(t) && t.length >= 6)).find(Boolean);
    if (c) { const okAmt = amounts.some(a => Math.abs(a - +c.amount) < 0.01);
      const cb = document.querySelector(`[data-clr=cheque][value="${c.id}"]`); if (cb && okAmt) { cb.checked = true; cb.closest('tr').classList.add('hit'); }
      hits.push({ kind: 'شيك ' + c.cheque_no, amt: +c.amount, date, ok: okAmt }); delete chq[c.cheque_no]; continue; }
    const d = deps.find(x => !usedDep.has(x.id) && amounts.some(a => Math.abs(a - +x.amount) < 0.01));
    if (d) { usedDep.add(d.id); const cb = document.querySelector(`[data-clr=receipt][value="${d.id}"]`); if (cb) { cb.checked = true; cb.closest('tr').classList.add('hit'); }
      hits.push({ kind: 'إيداع ' + d.receipt_no, amt: +d.amount, date, ok: true }); continue; }
    const big = amounts.filter(a => a > 0 && a < 1e8); if (big.length) unmatched.push({ l, date });
  }
  const dates = hits.filter(h => h.ok && h.date).map(h => h.date).sort(); if (dates.length && $('#clrDate')) $('#clrDate').value = dates[dates.length - 1];
  $('#stmtRes').innerHTML = `<div class="alert ${hits.length ? 'ok' : 'warn'}" style="margin-top:8px">اتعلّم ${hits.filter(h => h.ok).length} (شيكات وإيداعات) — راجعهم في الجداول تحت (باللون الأخضر) واضغط «✓ المحدد ظهر في الكشف».
    ${hits.filter(h => !h.ok).length ? `<br>⚠️ رقم شيك موجود بس المبلغ مختلف: ${hits.filter(h => !h.ok).map(h => esc(h.kind)).join('، ')}` : ''}</div>
    ${unmatched.length ? `<div class="alert warn">سطور مالهاش مقابل في الدفاتر (${unmatched.length}) — غالباً مصاريف/فوائد بنكية أو تحويلات لازم تتسجّل من «المقبوضات»:<br><span dir="ltr" style="font-size:12px">${unmatched.slice(0, 30).map(u => esc(u.l)).join('<br>')}</span></div>` : ''}`;
}
function booksView() {
  const items = S.books || [], ed = can('treasury.cheque.issue');
  return finTabs('#/chqbooks') + `${ed ? `<div class="card"><h2>➕ تسجيل دفتر شيكات</h2><form id="cbf" class="row">
      <input class="input" name="bookNo" placeholder="رقم الدفتر (اختياري)" style="flex:1;min-width:120px">
      <input class="input" name="firstNo" placeholder="أول رقم شيك" required inputmode="numeric" dir="ltr" style="flex:2;min-width:150px">
      <input class="input" name="lastNo" placeholder="آخر رقم شيك" required inputmode="numeric" dir="ltr" style="flex:2;min-width:150px">
      <input class="input" type="date" name="receivedDate" style="flex:1;min-width:130px"><button class="btn">تسجيل</button></form>
      <div class="muted" style="margin-top:6px">بعد تسجيل أول دفتر، أي شيك جديد لازم رقمه يكون جوه دفتر نشط ومايكونش ورقة تالفة.</div><div id="cberr"></div></div>` : ''}
    ${items.map(b => `<div class="card"><h2>📗 دفتر ${esc(b.book_no || '')} <span class="dt" style="font-size:13px">${esc(b.first_no)} ← ${esc(b.last_no)}</span><span class="sp"></span><span class="pill ${b.status === 'نشط' ? 'ok' : ''}">${esc(b.status)}</span></h2>
      <div class="kpis" style="margin-bottom:8px">${[['📄', b.size, 'ورقة'], ['✅', b.issued - b.voided, 'شيك صحيح'], ['✗', b.voided, 'شيك ملغى'], ['🗑️', b.spoiled, 'ورقة تالفة/ملغاة'], ['⏳', b.outstanding, 'لم يُصرف (' + Number(b.outstanding_amount).toLocaleString('ar-EG') + ' ج)'], ['📦', b.remaining, 'متبقي']]
        .map(([i, v, l]) => `<div class="kpi"><i>${i}</i><div><b>${numAr(v)}</b><small>${l}</small></div></div>`).join('')}</div>
      ${kvh('الرقم التالي المتاح', b.next_no ? `<b class="dt">${esc(b.next_no)}</b>` : '<span class="muted">الدفتر خلص</span>')}${kvh('تاريخ الاستلام', dt(b.received_date))}
      ${(b.gaps || []).length ? `<div class="alert warn" style="margin-top:8px">⚠️ أرقام متخطّاة (لا شيك ولا مسجّلة تالفة): ${b.gaps.map(g => `<span class="dt">${esc(g)}</span>`).join('، ')} — سجّلها تالفة لو اتقطعت.</div>` : ''}
      ${(b.spoiled_list || []).length ? `<details style="margin-top:6px"><summary class="muted">الأوراق التالفة/الملغاة (${b.spoiled_list.length})</summary>${b.spoiled_list.map(x => kvh(`<span class="dt">${esc(x.cheque_no)}</span> — ${esc(x.reason)}`, dt(x.date))).join('')}</details>` : ''}
      ${ed ? `<div class="row" style="margin-top:8px"><input class="input" placeholder="رقم ورقة تالفة/ملغاة" data-spno="${b.id}" dir="ltr" style="flex:1;min-width:150px"><input class="input" placeholder="السبب" data-spr="${b.id}" style="flex:2;min-width:150px">
        <button class="btn sm bad" data-spoil="${b.id}">تسجيل كورقة تالفة</button><button class="btn sm sec" data-bookedit="${b.id}">✏️ تعديل الدفتر</button>${b.status === 'نشط' ? `<button class="btn sm sec" data-bookclose="${b.id}">إقفال الدفتر</button>` : ''}</div>` : ''}</div>`).join('')
      || '<div class="card empty">لا دفاتر مسجّلة بعد — سجّل الدفتر الحالي بأول وآخر رقم.</div>'}`;
}
// ───────── استوديو المستندات والسندات والتقارير الرسمية المعتمدة (A4 Document Studio) ─────────
function printDoc(html) {
  const m = $('#modal');
  m.className = 'modal doc-studio';
  m.innerHTML = `<div class="sheet"><div class="ds-bar noprint">
      <div class="ds-ttl">📄 <b>مستند رسمي (A4)</b><small>معاينة الطباعة المعتمدة</small></div>
      <button class="btn sm sec" type="button" data-dszoom>🔍 ١٠٠٪</button>
      <button class="btn sm gold" type="button" data-vprint>🖨️ طباعة / PDF</button>
      <button class="btn sm sec" type="button" data-close>✕ إغلاق</button>
    </div>
    <div class="ds-stage"><div class="erp-paper">${html}</div></div></div>`;
  m.hidden = false;
  const fitScale = window.innerWidth < 830 ? Math.min(1, Math.max(0.42, (window.innerWidth - 24) / 794)) : 0.8;
  let fitted = window.innerWidth < 830;
  const syncZoom = () => {
    m.style.setProperty('--ds-zoom', fitted ? fitScale.toFixed(3) : '1');
    m.classList.toggle('ds-fit', fitted);
    const zb = m.querySelector('[data-dszoom]');
    if (zb) zb.textContent = fitted ? '🔍 حجم ١٠٠٪' : '📐 ملاءمة الصفحة';
  };
  syncZoom();
  m.querySelector('[data-dszoom]').onclick = () => { fitted = !fitted; syncZoom(); };
  m.querySelector('[data-close]').onclick = closeModal;
  m.querySelector('[data-vprint]').onclick = () => { document.body.dataset.printVoucher = 1; window.print(); delete document.body.dataset.printVoucher; };
  loadQR().then(Q => {
    m.querySelectorAll('[data-dqr]').forEach(el => {
      try { const q = Q(0, 'M'); q.addData(el.dataset.dqr); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }); } catch (_) {}
    });
  }).catch(() => {});
  if (isStaff() && !S.gov && (can('governance.view') || can('governance.manage'))) {
    loadGov().then(() => {
      const s = getOfficialSigs(), map = { 'أمين الصندوق': s.treasurer, 'الأمين العام': s.secretary, 'رئيس اللجنة النقابية': s.chair };
      m.querySelectorAll('[data-sigrole]').forEach(el => { if (!el.textContent.trim() && map[el.dataset.sigrole]) el.textContent = map[el.dataset.sigrole]; });
    });
  }
}

function voucherHTML(c) {
  const stTxt = c.status === 'ملغى' ? 'شيك ملغى' : c.cleared_date ? 'منصرف من البنك' : c.status;
  const stCls = c.status === 'ملغى' ? 'bad' : ['مسوّى'].includes(c.status) || c.cleared_date ? 'ok' : 'warn';
  return erpDoc({
    dept: 'الإدارة المالية والخزينة', kind: 'سند صرف مالي', code: 'CHQ',
    refLbl: 'رقم الشيك', refNo: c.cheque_no || 'بدون رقم', date: c.issue_date,
    ctrl: [['حساب البنك', '1102 — الجاري'], ['طبيعة الصرف', c.purpose]],
    title: 'سند صرف بشيك بنكي', sub: 'أمر دفع رسمي مسحوب على الحساب الجاري للجنة النقابية بالبنك',
    status: stTxt, statusCls: stCls,
    sigCols: s => [['توقيع المستلم', c.payee_name], ['أمين الصندوق', s.treasurer], ['رئيس اللجنة النقابية', s.chair]],
    body: edMoney(c.amount, 'صافي قيمة الشيك المنصرف') + edGrid([
      [6, 'يُصرف لأمر السيد / الجهة المستفيدة', `<b>${esc(c.payee_name)}</b>`],
      [3, 'رقم الشيك البنكي', `<span class="dt">${esc(c.cheque_no || 'بدون رقم')}</span>`],
      [3, 'تاريخ الإصدار', dt(c.issue_date)],
      [4, 'الغرض / طبيعة الصرف', esc(c.purpose)],
      [4, 'الحساب المسحوب عليه', '1102 — البنك (الحساب الجاري)'],
      [4, 'موقف التسوية والصرف البنكي', esc(c.status) + (c.cleared_date ? ' · صُرف ' + dt(c.cleared_date) : '')],
      [12, 'وذلك قيمة / البيان التفصيلي للصرف', esc(c.notes || c.purpose)],
      [12, 'سند الاعتماد (قرار مجلس الإدارة)', c.decision ? `قرار مجلس الإدارة رقم (${esc(c.decision.decision_no)}) — ${esc(c.decision.text)}` : 'وفق الصلاحيات المعتمدة باللائحة المالية'],
    ]) + (c.status === 'ملغى' ? `<div class="ed-box" style="border-color:#dc2626;background:#fef2f2;color:#991b1b"><b>✗ تنبيه إلغاء:</b> أُلغي هذا الشيك بقيد عكسي — السبب: ${esc(c.void_reason || '—')}</div>` : '')
      + `<div class="ed-box gold"><b>إقرار استلام:</b> أقر أنا الموقّع أدناه باستلام الشيك البنكي المبيّن رقمه وقيمته أعلاه على سبيل (${esc(c.purpose)})${c.requires_settlement ? '، وأتعهد بتقديم الفواتير ومستندات التسوية المعتمدة في الموعد المقرر باللائحة المالية.' : ' خالصاً ومبرئاً لذمة اللجنة النقابية عن البيان المذكور.'}</div>`
  });
}

function receiptVoucherHTML(r) {
  const dest = r.cash_account === '1101' ? '1101 — خزينة اللجنة النقابية' : '1102 — البنك (الحساب الجاري)';
  return erpDoc({
    dept: 'الإدارة المالية والخزينة', kind: 'سند قبض وتوريد', code: 'RCPT',
    refLbl: 'رقم الإيصال', refNo: r.receipt_no, date: r.receipt_date,
    ctrl: [['جهة الإيداع', r.cash_account === '1101' ? '1101 الخزينة' : '1102 البنك']],
    title: 'سند قبض وتوريد مالي', sub: 'إيصال استلام وتوريد مبالغ مالية بحسابات اللجنة النقابية',
    status: 'مرحّل بالدفاتر', statusCls: 'ok',
    sigCols: s => [['المُسلِّم / المورِّد', r.party || ''], ['أمين الصندوق', s.treasurer], ['رئيس اللجنة النقابية', s.chair]],
    body: edMoney(r.amount, 'المبلغ المقبوض والمورَّد') + edGrid([
      [6, 'استلمنا من السيد / الجهة', `<b>${esc(r.party || '—')}</b>`],
      [3, 'رقم سند القبض', `<span class="dt">${esc(r.receipt_no)}</span>`],
      [3, 'تاريخ التحصيل', dt(r.receipt_date)],
      [6, 'بند الإيراد / نوع التحصيل', esc(r.kind)],
      [6, 'أُودع في حساب', dest],
      [12, 'وذلك قيمة / البيان التفصيلي', esc(r.notes || r.kind)],
    ]) + `<div class="ed-box">قُيّد المبلغ بالحسابات المالية للجنة النقابية بموجب قيد يومية آلي مرحّل، ويُعد هذا السند إيصالاً رسمياً بالاستلام بعد توقيعه وختمه بخاتم اللجنة.</div>`
  });
}

function grantRequestHTML(g) {
  const p = g.person || (S.me.profile && S.me.profile.person) || {};
  const docsRows = (g.docs || []).map((d, i) => `<tr><td class="c">${numAr(i + 1)}</td><td><b>${esc(d.name)}</b></td><td class="c">${d.received ? '☑ مستوفى ومطابق' : '☐ قيد الاستيفاء'}</td></tr>`).join('')
    || '<tr><td colspan="3" class="c">لا توجد مرفقات إلزامية محددة</td></tr>';
  return erpDoc({
    dept: 'لجنة الرعاية الاجتماعية والمنح', kind: 'استمارة منحة اجتماعية', code: 'GRT',
    refLbl: 'رقم الطلب', refNo: g.req_no, date: String(g.created_at || '').slice(0, 10) || g.event_date,
    ctrl: [['نوع المنحة', g.type_name]],
    title: `استمارة طلب وصرف منحة — ${esc(g.type_name)}`, sub: 'صندوق الرعاية الاجتماعية ومزايا السادة أعضاء اللجنة النقابية',
    status: g.status, statusCls: ['مصروف', 'معتمد'].includes(g.status) ? 'ok' : ['مرفوض', 'ملغى'].includes(g.status) ? 'bad' : 'warn',
    sigCols: s => [['مقدّم الطلب', p.full_name || ''], ['أمين الصندوق', s.treasurer], ['رئيس اللجنة النقابية', s.chair]],
    body: (g.amount ? edMoney(g.amount, 'قيمة المنحة المقررة / المعتمدة') : '') + edGrid([
      [5, 'اسم العضو الرباعي', `<b>${esc(p.full_name || '')}</b>`],
      [3, 'الرقم الوظيفي', `<span class="dt">${esc(p.job_id || '—')}</span>`],
      [4, 'جهة العمل والتنظيم', esc([p.workplace, p.union_org].filter(Boolean).join(' · ') || '—')],
      [4, 'نوع المنحة الاجتماعية', esc(g.type_name)],
      [4, 'تاريخ الواقعة', dt(g.event_date)],
      [4, 'المستفيد وصلته بالعضو', esc((g.subject_name || p.full_name || '') + (g.subject_relation ? ` (${g.subject_relation})` : ''))],
      [4, 'تاريخ قيد الطلب', dt(String(g.created_at || '').slice(0, 10))],
      [4, 'سند الاعتماد', g.decision ? `قرار رقم (${esc(g.decision.decision_no)})` : esc(g.exception_note || 'وفق اللائحة المالية')],
      [4, 'بيانات الصرف البنكي', g.cheque ? `شيك رقم ${esc(g.cheque.cheque_no || '—')} بتاريخ ${dt(g.cheque.issue_date)}` : 'لم يُصرف بعد'],
    ]) + `<div class="ed-sec">قائمة فحص ومراجعة المستندات المسوّغة للصرف</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:38px">م</th><th>بيان المستند المطلوب</th><th class="c" style="width:150px">موقف الاستيفاء</th></tr></thead><tbody>${docsRows}</tbody></table>`
      + (g.reject_reason ? `<div class="ed-box" style="border-color:#dc2626;background:#fef2f2;color:#991b1b"><b>سبب رفض الطلب:</b> ${esc(g.reject_reason)}</div>` : '')
      + `<div class="ed-box gold"><b>إقرار مقدّم الطلب:</b> أقر أنا العضو الموقّع أدناه بصحة كافة البيانات والمستندات المقدمة، وعدم سبق صرف ذات المنحة عن نفس الواقعة، وأتحمل المسئولية القانونية الكاملة حال ثبوت خلاف ذلك.</div>`
  });
}

function bookingHTML(b, a, p) {
  const rest = Math.max(0, +b.total - +b.paid);
  const pRows = (b.people || []).map((x, i) => `<tr><td class="c">${numAr(i + 1)}</td><td><b>${esc(x.full_name)}</b></td><td class="c">${esc(x.relation || '—')}</td><td class="c">${esc(x.seat_no || '—')}</td><td class="n">${money(x.price)}</td></tr>`).join('');
  return erpDoc({
    dept: 'لجنة الأنشطة والرحلات والخدمات', kind: 'إيصال حجز نشاط', code: 'BKG',
    refLbl: 'رقم الحجز', refNo: b.booking_no, date: String(b.created_at || '').slice(0, 10) || a.start_date,
    ctrl: [['عدد الأفراد', `${numAr((b.people || []).length)} مشارك`]],
    title: `إيصال حجز واشتراك نشاط — ${esc(a.title)}`, sub: `${esc(a.location || 'رحلة / فعالية نقابية')} · تاريخ التنفيذ: ${dt(a.start_date)}${a.end_date && a.end_date !== a.start_date ? ' ← ' + dt(a.end_date) : ''}`,
    status: b.status, statusCls: b.status === 'مؤكد' ? 'ok' : b.status === 'ملغى' ? 'bad' : 'warn',
    sigCols: s => [['العضو الحاجز', p.full_name || ''], ['أمين الصندوق', s.treasurer], ['رئيس اللجنة النقابية', s.chair]],
    body: edMoney(+b.paid || +b.total, +b.paid ? 'المبلغ المسدّد من الاشتراك' : 'إجمالي قيمة الحجز المطلوب') + edGrid([
      [5, 'اسم العضو الحاجز', `<b>${esc(p.full_name || '')}</b>`],
      [3, 'الرقم الوظيفي', `<span class="dt">${esc(p.job_id || '—')}</span>`],
      [4, 'وجهة / مقر النشاط', esc(a.location || '—')],
    ]) + `<div class="ed-sec">بيان السادة المشاركين والمقاعد المخصّصة</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:38px">م</th><th>اسم المشارك</th><th class="c">صلة القرابة</th><th class="c">رقم المقعد</th><th class="n">الاشتراك (ج.م)</th></tr></thead>
      <tbody>${pRows}</tbody>
      <tfoot>
        <tr><th colspan="4">إجمالي قيمة الاشتراك بعد الدعم</th><th class="n">${money(b.total)}</th></tr>
        ${+b.subsidy ? `<tr><th colspan="4">دعم اللجنة النقابية الممنوح للعضو وأسرته</th><th class="n">${money(b.subsidy)}</th></tr>` : ''}
        <tr><th colspan="4">المسدّد الفعلي · المتبقي للسداد: ${money(rest)} ج.م</th><th class="n">${money(b.paid)}</th></tr>
      </tfoot></table>`
  });
}

function changeReqHTML(items, person) {
  const rows = (items || []).map((r, i) => `<tr><td class="c">${numAr(i + 1)}</td><td><b>${esc(FIELD_LBL[r.field] || r.field)}</b></td><td>${esc(r.old_value || '—')}</td><td><b>${esc(r.new_value)}</b></td><td>${esc(r.reason || '—')}</td><td class="c">${esc(r.status || 'معلّق')}</td></tr>`).join('')
    || '<tr><td colspan="6" class="c">لا توجد طلبات تعديل معلّقة</td></tr>';
  return erpDoc({
    dept: 'شئون العضوية وسجلات الأعضاء', kind: 'نموذج تحديث بيانات', code: 'CHG',
    refLbl: 'الرقم الوظيفي', refNo: person.job_id || '—',
    title: 'استمارة طلب تعديل وتحديث بيانات عضو', sub: 'تُرفق بصور المستندات الرسمية المؤيدة للتعديل لاعتمادها في ملف العضو',
    status: items.length && items.every(r => r.status === 'معتمد') ? 'معتمد' : 'قيد المراجعة والاعتماد',
    statusCls: items.length && items.every(r => r.status === 'معتمد') ? 'ok' : 'warn',
    sigCols: s => [['مقدّم الطلب', person.full_name || ''], ['أمين الصندوق', s.treasurer], ['رئيس اللجنة النقابية', s.chair]],
    body: edGrid([
      [6, 'اسم العضو الرباعي', `<b>${esc(person.full_name || '')}</b>`],
      [3, 'الرقم الوظيفي', `<span class="dt">${esc(person.job_id || '—')}</span>`],
      [3, 'عدد البنود المطلوب تعديلها', `${numAr(items.length)} بند`],
    ]) + `<div class="ed-sec">تفاصيل التعديلات المطلوبة على سجل العضوية</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:36px">م</th><th>البيان</th><th>القيمة المسجّلة حالياً</th><th>القيمة الصحيحة المطلوبة</th><th>السبب / السند</th><th class="c">الحالة</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="ed-box gold"><b>إقرار:</b> أقر أنا العضو الموقّع أدناه بصحة البيانات المطلوب إثباتها في سجلات اللجنة النقابية، ومرفق طيّه صور المستندات الرسمية الدالة عليها.</div>`
  });
}

function openAdvancesReportHTML(items) {
  const list = items || [], today = new Date(), age = c => Math.floor((today - new Date(c.issue_date)) / 864e5);
  const tot = list.reduce((a, c) => a + +c.amount, 0);
  const over30 = list.filter(c => age(c) > 30).length, over90 = list.filter(c => age(c) > 90).length;
  const rows = list.map((c, i) => `<tr><td class="c">${numAr(i + 1)}</td><td>${dt(c.issue_date)}</td><td class="c"><span class="dt">${esc(c.cheque_no || '—')}</span></td>
    <td><b>${esc(c.payee_name)}</b></td><td>${esc(c.notes || c.purpose)}</td><td class="c">${numAr(age(c))} يوم</td><td class="n"><b>${money(c.amount)}</b></td></tr>`).join('')
    || '<tr><td colspan="7" class="c">لا توجد عُهد أو سلف مفتوحة تحت التسوية حالياً</td></tr>';
  return erpDoc({
    dept: 'الإدارة المالية والخزينة · الرقابة على العُهد', kind: 'تقرير رقابي مالي', code: 'ADV',
    refLbl: 'حساب المراقبة', refNo: '1103 — عُهد مفتوحة',
    title: 'بيان العُهد والسلف المفتوحة تحت التسوية', sub: 'حصر تفصيلي بالشيكات المنصرفة كعُهد أو دعم أنشطة ولم تُقفل بتسوية معتمدة حتى تاريخه',
    status: list.length ? `${numAr(list.length)} عهدة مفتوحة` : 'رصيد صفري منطبق', statusCls: list.length ? 'warn' : 'ok',
    body: edMoney(tot, 'إجمالي رصيد العُهد المفتوحة (حـ/ 1103)') + edGrid([
      [4, 'إجمالي عدد الشيكات المفتوحة', `${numAr(list.length)} شيك`],
      [4, 'عُهد تجاوزت ٣٠ يوماً', `${numAr(over30)} عهدة`],
      [4, 'عُهد متقادمة (+٩٠ يوماً)', `${numAr(over90)} عهدة`],
    ]) + `<div class="ed-sec">بيان الشيكات وأصحاب العُهد وأعمارها الزمنية</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:36px">م</th><th>تاريخ الصرف</th><th class="c">رقم الشيك</th><th>صاحب العهدة</th><th>الغرض والبيان</th><th class="c">العمر</th><th class="n">المبلغ (ج.م)</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><th colspan="6">الإجمالي العام للعُهد تحت التسوية</th><th class="n">${money(tot)}</th></tr></tfoot></table>`
  });
}

function partyStatementHTML(x, items) {
  const list = items || [], validTot = list.filter(i => i.status !== 'ملغى').reduce((a, i) => a + +i.amount, 0);
  const rows = list.map((it, i) => `<tr><td class="c">${numAr(i + 1)}</td><td>${dt(it.date)}</td><td class="c">${esc(it.doc || '—')}</td>
    <td>${esc(it.notes || '—')}</td><td class="c">${esc(it.status || '')}</td><td class="n"><b>${money(it.amount)}</b></td></tr>`).join('')
    || '<tr><td colspan="6" class="c">لا توجد معاملات مسجّلة لهذا الطرف</td></tr>';
  return erpDoc({
    dept: 'الإدارة المالية والخزينة · حسابات الموردين والأطراف', kind: 'كشف حساب رسمي', code: 'PRTY',
    refLbl: 'تصنيف الطرف', refNo: x.kind || 'طرف خارجي',
    title: `كشف حساب مالي لطرف خارجي — ${esc(x.name)}`, sub: 'حصر شامل لجميع الشيكات والمدفوعات المسجّلة بالدفاتر المالية للجنة النقابية',
    status: x.active !== false ? 'طرف نشط' : 'موقوف', statusCls: x.active !== false ? 'ok' : 'bad',
    body: edMoney(validTot, 'صافي إجمالي المنصرف المعتمد (بدون الملغى)') + edGrid([
      [5, 'اسم المورد / الجهة', `<b>${esc(x.name)}</b>`],
      [3, 'التصنيف', esc(x.kind || '—')],
      [4, 'رقم التليفون', `<span class="dt">${esc(x.phone || '—')}</span>`],
      [5, 'البطاقة الضريبية / السجل التجاري', esc(x.tax_id || '—')],
      [5, 'العنوان', esc(x.address || '—')],
      [2, 'عدد المعاملات', numAr(list.length)],
    ]) + `<div class="ed-sec">سجل المعاملات والمدفوعات الزمنية</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:36px">م</th><th>التاريخ</th><th class="c">المستند / الشيك</th><th>البيان التفصيلي</th><th class="c">الحالة</th><th class="n">المبلغ (ج.م)</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><th colspan="5">صافي الإجمالي المعتمد (مستبعداً الملغى)</th><th class="n">${money(validTot)}</th></tr></tfoot></table>`
  });
}

function financialStatementsReportHTML(t = S.trial) {
  t = t || {};
  const items = t.items || [], names = Object.fromEntries((S.accts || []).map(a => [a.code, a.name])), parents = Object.fromEntries((S.accts || []).map(a => [a.code, a.parent]));
  const grp = (type, val) => {
    const g = {};
    items.filter(x => x.type === type).forEach(x => {
      const k = parents[x.code] || x.code.slice(0, 2), v = val(x);
      if (Math.abs(v) < 0.005) return;
      (g[k] = g[k] || { name: names[k] || k, total: 0, rows: [] }).total += v;
      g[k].rows.push([x.code, x.name, v]);
    });
    return Object.entries(g).sort();
  };
  const tot = gs => gs.reduce((a, [, g]) => a + g.total, 0);
  const pct = (v, base) => base > 0.005 ? numAr(Math.round((1000 * v) / base) / 10) + '%' : '—';
  const renderSec = (gs, base, emptyMsg) => gs.map(([k, g]) =>
    `<tr style="background:#f1f5f9;font-weight:800"><td class="c">${esc(k)}</td><td>${esc(g.name)}</td><td class="n">${money(g.total)}</td><td class="c">${pct(g.total, base)}</td></tr>` +
    g.rows.map(([c, n, v]) => `<tr><td class="c">${esc(c)}</td><td style="padding-inline-start:20px">${esc(n)}</td><td class="n">${money(v)}</td><td class="c">${pct(v, base)}</td></tr>`).join('')
  ).join('') || `<tr><td colspan="4" class="c">${emptyMsg}</td></tr>`;
  const rev = grp('إيرادات', x => +x.credit - +x.debit), exp = grp('مصروفات', x => +x.debit - +x.credit);
  const revTot = tot(rev), expTot = tot(exp), surplus = revTot - expTot;
  const ast = grp('أصول', x => +x.closing), lia = grp('خصوم', x => -x.closing), fnd = grp('أرصدة', x => -x.closing);
  const accum = -items.filter(x => x.type === 'إيرادات' || x.type === 'مصروفات').reduce((a, x) => a + +x.closing, 0);
  const astTot = tot(ast), liaTot = tot(lia), fndTot = tot(fnd), rightTot = liaTot + fndTot + accum, ok = Math.abs(astTot - rightTot) < 0.01;
  const accVal = code => +((items.find(x => x.code === code) || {}).closing || 0);
  return erpDoc({
    dept: 'الإدارة المالية والحسابات الختامية والميزانيات', kind: 'الميزانية العمومية والحساب الختامي', code: 'BS-FS',
    refLbl: 'تاريخ الميزانية', refNo: t.to || new Date().toISOString().slice(0, 10), date: t.to,
    ctrl: [['بداية الفترة', dt(t.from)], ['تاريخ الإقفال', dt(t.to)]],
    title: 'الميزانية العمومية (قائمة المركز المالي) والحساب الختامي للإيرادات والمصروفات',
    sub: `معدّة وفق النظام المحاسبي الموحد من واقع القيود المرحّلة عن الفترة من ${dt(t.from)} حتى ${dt(t.to)}`,
    status: ok ? 'ميزانية متوازنة ومطابقة ✓' : 'تحتاج مراجعة توازن', statusCls: ok ? 'ok' : 'bad',
    body: edMoney(astTot, 'إجمالي الميزانية العمومية (إجمالي الأصول = إجمالي الخصوم وصافي الأرصدة)') + edGrid([
      [3, 'إجمالي الإيرادات المحققة', `<b>${money(revTot)} ج.م</b>`],
      [3, 'إجمالي المصروفات والأعباء', `<b>${money(expTot)} ج.م</b>`],
      [3, surplus >= 0 ? 'صافي فائض الفترة' : 'صافي عجز الفترة', `<b style="color:${surplus >= 0 ? '#166534' : '#991b1b'}">${money(Math.abs(surplus))} ج.م</b>`],
      [3, 'نقدية بالبنك والخزينة (1101+1102)', `<b>${money(accVal('1101') + accVal('1102'))} ج.م</b>`],
    ]) + `<div class="ed-sec">أولاً: الحساب الختامي — قائمة الإيرادات والمصروفات (${dt(t.from)} ← ${dt(t.to)})</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:76px">رقم الحساب</th><th>بيان الحساب / المجموعة المحاسبية</th><th class="n" style="width:140px">المبلغ (ج.م)</th><th class="c" style="width:72px">الوزن %</th></tr></thead>
      <tbody>
        <tr style="background:#e8eff7;font-weight:800;color:#0f3d5e"><td colspan="2">١. الإيرادات المحققة خلال الفترة</td><td class="n">${money(revTot)}</td><td class="c">١٠٠٪</td></tr>
        ${renderSec(rev, revTot, 'لا توجد إيرادات مسجّلة في الفترة')}
        <tr style="background:#e8eff7;font-weight:800;color:#0f3d5e"><td colspan="2">٢. المصروفات والمنح والأنشطة خلال الفترة</td><td class="n">${money(expTot)}</td><td class="c">١٠٠٪</td></tr>
        ${renderSec(exp, expTot, 'لا توجد مصروفات مسجّلة في الفترة')}
      </tbody>
      <tfoot><tr><th colspan="2">${surplus >= 0 ? 'صافي فائض الإيرادات عن المصروفات المرحّل لقائمة المركز المالي' : 'صافي عجز الفترة المرحّل لقائمة المركز المالي'}</th><th class="n">${money(Math.abs(surplus))}</th><th class="c">${revTot > 0 ? pct(Math.abs(surplus), revTot) : '—'}</th></tr></tfoot></table>
      <div class="ed-sec">ثانياً: الميزانية العمومية (قائمة المركز المالي) كما في ${dt(t.to)}</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:76px">رقم الحساب</th><th>بيان الأصول والخصوم وصافي الأرصدة والصناديق</th><th class="n" style="width:140px">الرصيد (ج.م)</th><th class="c" style="width:72px">الوزن %</th></tr></thead>
      <tbody>
        <tr style="background:#e8eff7;font-weight:800;color:#0f3d5e"><td colspan="2">أولاً: الأصول (النقدية بالصندوق والبنوك والعُهد والمدينون)</td><td class="n">${money(astTot)}</td><td class="c">١٠٠٪</td></tr>
        ${renderSec(ast, astTot, 'لا توجد أرصدة أصول')}
        <tr style="background:#e8eff7;font-weight:800;color:#0f3d5e"><td colspan="2">ثانياً: الخصوم والالتزامات المتداولة</td><td class="n">${money(liaTot)}</td><td class="c">${pct(liaTot, rightTot)}</td></tr>
        ${renderSec(lia, rightTot, 'لا توجد التزامات قائمة')}
        <tr style="background:#e8eff7;font-weight:800;color:#0f3d5e"><td colspan="2">ثالثاً: المال الاحتياطي والصناديق والفائض المتراكم</td><td class="n">${money(fndTot + accum)}</td><td class="c">${pct(fndTot + accum, rightTot)}</td></tr>
        ${renderSec(fnd, rightTot, '—')}
        <tr><td class="c">—</td><td>صافي الفائض / (العجز) المتراكم للنشاط حتى ${dt(t.to)}</td><td class="n"><b>${money(accum)}</b></td><td class="c">${pct(Math.abs(accum), rightTot)}</td></tr>
      </tbody>
      <tfoot><tr><th colspan="2">إجمالي الخصوم والمال الاحتياطي والفائض المتراكم (${ok ? 'مطابق لإجمالي الأصول ✓' : 'غير مطابق'})</th><th class="n">${money(rightTot)}</th><th class="c">١٠٠٪</th></tr></tfoot></table>
      <div class="ed-box gold"><b>إقرار واعتماد الميزانية:</b> أُعدت هذه الميزانية العمومية والحساب الختامي من واقع دفاتر اليومية والأستاذ العام والقيود المحاسبية المؤيدة بالمستندات، وتعبّر بصدق وعدالة عن المركز المالي للجنة النقابية في ${dt(t.to)}.</div>`
  });
}

function trialBalanceReportHTML(t = S.trial) {
  t = t || {};
  const items = (t.items || []).filter(x => Math.abs(+x.opening || 0) > 0.004 || Math.abs(+x.debit || 0) > 0.004 || Math.abs(+x.credit || 0) > 0.004 || Math.abs(+x.closing || 0) > 0.004);
  let opDr = 0, opCr = 0, mvDr = 0, mvCr = 0, clDr = 0, clCr = 0;
  const rows = items.map(x => {
    const op = +x.opening || 0, dr = +x.debit || 0, cr = +x.credit || 0, cl = +x.closing || 0;
    const oD = op > 0 ? op : 0, oC = op < 0 ? -op : 0;
    const cD = cl > 0 ? cl : 0, cC = cl < 0 ? -cl : 0;
    opDr += oD; opCr += oC; mvDr += dr; mvCr += cr; clDr += cD; clCr += cC;
    return `<tr>
      <td class="c"><b>${esc(x.code)}</b></td>
      <td>${esc(x.name)} <small class="muted">(${esc(x.type || '')})</small></td>
      <td class="n">${oD ? money(oD) : '—'}</td><td class="n">${oC ? money(oC) : '—'}</td>
      <td class="n">${dr ? money(dr) : '—'}</td><td class="n">${cr ? money(cr) : '—'}</td>
      <td class="n"><b>${cD ? money(cD) : '—'}</b></td><td class="n"><b>${cC ? money(cC) : '—'}</b></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="c">لا توجد أرصدة أو حركات خلال الفترة</td></tr>';
  const ok = Math.abs(mvDr - mvCr) < 0.01 && Math.abs(clDr - clCr) < 0.01;
  return erpDoc({
    dept: 'الإدارة المالية والحسابات العامة', kind: 'ميزان المراجعة المعتمد', code: 'TB',
    refLbl: 'نهاية الفترة', refNo: t.to || new Date().toISOString().slice(0, 10), date: t.to,
    ctrl: [['بداية الفترة', dt(t.from)], ['عدد الحسابات المتحركة', numAr(items.length)]],
    title: 'ميزان المراجعة بالمجاميع والأرصدة (ستة أعمدة)',
    sub: `شامل أرصدة أول المدة وحركة الفترة والأرصدة الختامية من ${dt(t.from)} إلى ${dt(t.to)}`,
    status: ok ? 'متوازن حسابياً ✓' : 'غير متوازن', statusCls: ok ? 'ok' : 'bad',
    body: edGrid([
      [4, 'إجمالي حركة الفترة (مدين / دائن)', `<b>${money(mvDr)} / ${money(mvCr)} ج.م</b>`],
      [4, 'إجمالي الأرصدة الختامية (مدين / دائن)', `<b>${money(clDr)} / ${money(clCr)} ج.م</b>`],
      [4, 'حالة التوازن المحاسبي', ok ? '<b style="color:#166534">متوازن ومطابق تماماً ✓</b>' : '<b style="color:#991b1b">يوجد فرق يحتاج مراجعة</b>'],
    ]) + `<div class="ed-sec">جدول ميزان المراجعة التحليلي بالمجاميع والأرصدة</div>
      <table class="ed-tbl">
        <thead>
          <tr>
            <th class="c" rowspan="2" style="width:58px">الكود</th>
            <th rowspan="2">اسم الحساب</th>
            <th class="c" colspan="2">رصيد أول المدة</th>
            <th class="c" colspan="2">حركة الفترة</th>
            <th class="c" colspan="2">الرصيد الختامي</th>
          </tr>
          <tr>
            <th class="n">مدين</th><th class="n">دائن</th>
            <th class="n">مدين</th><th class="n">دائن</th>
            <th class="n">مدين</th><th class="n">دائن</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <th colspan="2">الإجمالي العام لميزان المراجعة</th>
            <th class="n">${money(opDr)}</th><th class="n">${money(opCr)}</th>
            <th class="n">${money(mvDr)}</th><th class="n">${money(mvCr)}</th>
            <th class="n">${money(clDr)}</th><th class="n">${money(clCr)}</th>
          </tr>
        </tfoot>
      </table>`
  });
}

function budgetReportHTML(b = S.bud) {
  b = b || {};
  const items = b.items || [], yr = b.year || new Date().getFullYear();
  const buildPart = type => {
    const rows = items.filter(x => x.type === type), bt = rows.reduce((a, x) => a + +x.budget, 0), at = rows.reduce((a, x) => a + +x.actual, 0);
    const groups = [...new Set(rows.map(x => x.grp))];
    const pct = (a, bd) => +bd ? numAr(Math.round((100 * a) / bd)) + '%' : '—';
    const stLbl = (a, bd) => {
      if (!+bd && !+a) return '—';
      if (!+bd) return 'غير مقدّر';
      if (type === 'مصروفات') return a > bd ? 'تجاوز' : a === bd ? 'مطابق' : 'وفر مالي';
      return a >= bd ? 'محقق ✓' : 'قيد التحقيق';
    };
    const trs = groups.map(g => {
      const gr = rows.filter(x => x.grp === g && (+x.budget || +x.actual));
      if (!gr.length) return '';
      const gb = gr.reduce((a, x) => a + +x.budget, 0), ga = gr.reduce((a, x) => a + +x.actual, 0);
      return `<tr style="background:#f1f5f9;font-weight:800"><td class="c">${esc(g)}</td><td>${esc(gr[0].grp_name || 'مجموعة رئيسية')}</td>
        <td class="n">${money(gb)}</td><td class="n">${money(ga)}</td><td class="n">${money(gb - ga)}</td><td class="c">${pct(ga, gb)}</td><td class="c">${stLbl(ga, gb)}</td></tr>` +
        gr.map(x => `<tr><td class="c">${esc(x.code)}</td><td style="padding-inline-start:18px">${esc(x.name)}</td>
          <td class="n">${money(x.budget)}</td><td class="n">${money(x.actual)}</td><td class="n">${money(+x.budget - +x.actual)}</td>
          <td class="c">${pct(+x.actual, +x.budget)}</td><td class="c">${stLbl(+x.actual, +x.budget)}</td></tr>`).join('');
    }).join('') || '<tr><td colspan="7" class="c">لا توجد تقديرات أو حركات فعلية مسجّلة</td></tr>';
    return { bt, at, tbl: `<table class="ed-tbl"><thead><tr><th class="c" style="width:62px">الكود</th><th>البند / الحساب بالموازنة</th><th class="n">المعتمد التقديري</th><th class="n">المنفّذ الفعلي</th><th class="n">الانحراف (وفر/عجز)</th><th class="c" style="width:68px">التنفيذ</th><th class="c" style="width:82px">التقييم</th></tr></thead>
      <tbody>${trs}</tbody><tfoot><tr><th colspan="2">إجمالي ${type}</th><th class="n">${money(bt)}</th><th class="n">${money(at)}</th><th class="n">${money(bt - at)}</th><th class="c">${pct(at, bt)}</th><th class="c">${stLbl(at, bt)}</th></tr></tfoot></table>` };
  };
  const rv = buildPart('إيرادات'), ex = buildPart('مصروفات');
  const estSurplus = rv.bt - ex.bt, actSurplus = rv.at - ex.at;
  return erpDoc({
    dept: 'الإدارة المالية والتخطيط والموازنات التقديرية', kind: 'الموازنة التقديرية المعتمدة', code: 'BUD',
    refLbl: 'السنة المالية', refNo: String(yr),
    ctrl: [['الفائض المقدّر', money(estSurplus)], ['الفائض الفعلي', money(actSurplus)]],
    title: `الموازنة التقديرية المعتمدة ومقارنة الأداء الفعلي لعام ${esc(yr)}`,
    sub: 'تحليل الاعتمادات التقديرية ومعدلات التنفيذ الفعلي والوفورات والانحرافات المالية',
    status: `موازنة عام ${yr}`, statusCls: ex.at > ex.bt && ex.bt ? 'warn' : 'ok',
    body: edGrid([
      [4, 'إجمالي الإيرادات (مقدّر / فعلي)', `${money(rv.bt)} / <b>${money(rv.at)} ج.م</b>`],
      [4, 'إجمالي المصروفات (مقدّر / فعلي)', `${money(ex.bt)} / <b>${money(ex.at)} ج.م</b>`],
      [4, 'صافي الفائض أو العجز (مقدّر / فعلي)', `${money(estSurplus)} / <b>${money(actSurplus)} ج.م</b>`],
    ]) + `<div class="ed-sec">أولاً: موازنة الإيرادات التقديرية والمحققة</div>${rv.tbl}
      <div class="ed-sec">ثانياً: موازنة المصروفات والاعتمادات والوفورات</div>${ex.tbl}
      <div class="ed-box gold"><b>ملاحظة رقابية:</b> تُقاس نسب التنفيذ الفعلي آلياً من واقع القيود المحاسبية المرحّلة حتى تاريخه، ولا يجوز تجاوز الاعتماد المقرر لأي بند إلا بقرار مسبّب من مجلس الإدارة.</div>`
  });
}

function comprehensiveReportHTML() {
  const r = S.rep || {}, m = r.members || {}, b = r.benefits || {}, f = r.finance || {};
  const yrLbl = r.year ? `سنة ${r.year}` : 'تراكمي شامل لجميع السنوات';
  const memRows = Object.entries(m.byState || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n"><b>${numAr(v)}</b></td></tr>`).join('');
  const orgRows = Object.entries(m.byOrg || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n"><b>${numAr(v)}</b></td></tr>`).join('');
  const accRows = (f.byAccount || []).map(a => `<tr><td class="c">${esc(a.code)}</td><td>${esc(a.name)}</td><td class="c">${esc(a.type)}</td><td class="n">${money(a.amount)}</td></tr>`).join('')
    || '<tr><td colspan="4" class="c">لا توجد حركات مالية</td></tr>';
  const benRows = (b.byCategory || []).map(c => `<tr><td><b>${esc(c.category)}</b></td><td class="c">${numAr(c.people)}</td><td class="n">${money(c.total)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="c">لا توجد مزايا مسجّلة</td></tr>';
  const actRows = (r.activities || []).map(a => `<tr><td><b>${esc(a.title)}</b></td><td class="c">${dt(a.date)}</td><td class="c">${numAr(a.people)}</td><td class="n">${money(a.collected)}</td><td class="n">${money(a.subsidy)}</td></tr>`).join('')
    || '<tr><td colspan="5" class="c">لا توجد أنشطة مسجّلة</td></tr>';
  return erpDoc({
    dept: 'الأمانة العامة والإدارة المالية', kind: 'تقرير تنفيذي شامل', code: 'EXEC',
    refLbl: 'نطاق التقرير', refNo: r.year || 'ALL',
    title: `التقرير التنفيذي والمالي الشامل للجنة النقابية (${esc(yrLbl)})`,
    sub: 'ملخص مؤشرات العضوية والموقف المالي والمزايا والمنح والأنشطة النقابية',
    status: yrLbl, statusCls: 'ok',
    body: edGrid([
      [3, 'إجمالي الأعضاء المسجّلين', `<b>${numAr(m.total)} عضو</b>`],
      [3, 'إجمالي الإيرادات', `<b>${money(f.revenue)} ج.م</b>`],
      [3, 'إجمالي المصروفات', `<b>${money(f.expense)} ج.م</b>`],
      [3, 'رصيد البنك الدفتري الحالي', `<b>${money(f.bank)} ج.م</b>`],
      [4, 'صافي الفائض / (العجز)', `<b>${money(+f.revenue - +f.expense)} ج.م</b>`],
      [4, 'إجمالي المزايا الممنوحة للأعضاء', `<b>${money(b.total)} ج.م (${numAr(b.people)} مستفيد)</b>`],
      [4, 'عُهد تحت التسوية حالياً', `<b>${money(f.custody)} ج.م</b>`],
    ]) + `<div class="ed-sec">أولاً: هيكل العضوية حسب التنظيم النقابي والحالة</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <table class="ed-tbl"><thead><tr><th>التنظيم النقابي</th><th class="n">العدد</th></tr></thead><tbody>${orgRows}</tbody></table>
        <table class="ed-tbl"><thead><tr><th>حالة العضوية</th><th class="n">العدد</th></tr></thead><tbody>${memRows}</tbody></table>
      </div>
      <div class="ed-sec">ثانياً: بيان الإيرادات والمصروفات حسب الحساب</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:68px">الكود</th><th>اسم الحساب</th><th class="c" style="width:90px">النوع</th><th class="n">المبلغ (ج.م)</th></tr></thead><tbody>${accRows}</tbody></table>
      <div class="ed-sec">ثالثاً: المزايا والمنح والخدمات الاجتماعية</div>
      <table class="ed-tbl"><thead><tr><th>بند الميزة / المنحة</th><th class="c">عدد المستفيدين</th><th class="n">الإجمالي (ج.م)</th></tr></thead><tbody>${benRows}</tbody></table>
      <div class="ed-sec">رابعاً: الأنشطة والرحلات والفعاليات (${numAr((r.activities || []).length)})</div>
      <table class="ed-tbl"><thead><tr><th>اسم النشاط</th><th class="c">التاريخ</th><th class="c">المشاركون</th><th class="n">المحصّل</th><th class="n">دعم النقابة</th></tr></thead><tbody>${actRows}</tbody></table>`
  });
}

function annualReportHTML(A = S.annual) {
  A = A || {};
  const y = A.year || new Date().getFullYear(), r = A.rep || {}, m = r.members || {}, b = A.ben || {}, f = r.finance || {};
  const meets = (A.meetings || []).filter(x => String(x.meeting_date).startsWith(y)), decs = (A.decisions || []).filter(x => String(x.meeting_date).startsWith(y));
  const surplus = (+f.revenue || 0) - (+f.expense || 0);
  const orgRows = Object.entries(m.byOrg || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n"><b>${numAr(v)}</b></td></tr>`).join('') || '<tr><td colspan="2" class="c">—</td></tr>';
  const stRows = Object.entries(m.byState || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n"><b>${numAr(v)}</b></td></tr>`).join('') || '<tr><td colspan="2" class="c">—</td></tr>';
  const meetRows = meets.slice().reverse().map((x, i) => `<tr><td class="c">${numAr(i + 1)}</td><td><b>${esc(x.title)}</b></td><td class="c">${dt(x.meeting_date)}</td><td class="c">${x.present ? numAr(x.present) + ' / ' + numAr(x.seats) : '—'}</td><td class="c">${numAr(x.decisions_count)}</td></tr>`).join('') || '<tr><td colspan="5" class="c">لا توجد اجتماعات مسجّلة خلال العام</td></tr>';
  const accRows = (f.byAccount || []).map(a => `<tr><td class="c">${esc(a.code)}</td><td>${esc(a.name)}</td><td class="c">${esc(a.type)}</td><td class="n"><b>${money(a.amount)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="c">لا توجد حركات مالية</td></tr>';
  const benRows = (b.byCategory || []).map(c => `<tr><td><b>${esc(c.category)}</b></td><td class="c">${numAr(c.people)}</td><td class="n">${money(c.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="c">لا توجد مزايا مسجّلة</td></tr>';
  return erpDoc({
    dept: 'مجلس الإدارة · الجمعية العمومية العادية', kind: 'التقرير السنوي والحساب الختامي', code: 'ANNUAL',
    refLbl: 'السنة المالية', refNo: String(y),
    ctrl: [['اجتماعات المجلس', numAr(meets.length)], ['القرارات الصادرة', numAr(decs.length)]],
    title: `التقرير السنوي لمجلس الإدارة والحساب الختامي عن عام ${esc(y)}`,
    sub: 'مقدّم إلى السادة أعضاء الجمعية العمومية الموقرة للنظر والاعتماد',
    status: `عام ${y}`, statusCls: 'ok',
    body: edGrid([
      [3, 'إجمالي الأعضاء المسجّلين', `<b>${numAr(m.total)} عضو</b>`],
      [3, 'إجمالي الإيرادات السنوية', `<b>${money(f.revenue)} ج.م</b>`],
      [3, 'إجمالي المصروفات السنوية', `<b>${money(f.expense)} ج.م</b>`],
      [3, surplus >= 0 ? 'فائض العام' : 'عجز العام', `<b>${money(Math.abs(surplus))} ج.م</b>`],
      [4, 'رصيد البنك الدفتري الحالي', `<b>${money(f.bank)} ج.م</b>`],
      [4, 'العُهد المفتوحة تحت التسوية', `<b>${money(f.custody)} ج.م</b>`],
      [4, 'إجمالي المزايا والمنح للأعضاء', `<b>${money(b.total)} ج.م (${numAr(b.beneficiaries || b.people || 0)} مستفيد)</b>`],
    ]) + `<div class="ed-sec">أولاً: بيان العضوية والتشكيل النقابي</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <table class="ed-tbl"><thead><tr><th>التنظيم النقابي</th><th class="n">العدد</th></tr></thead><tbody>${orgRows}</tbody></table>
        <table class="ed-tbl"><thead><tr><th>حالة العضوية</th><th class="n">العدد</th></tr></thead><tbody>${stRows}</tbody></table>
      </div>
      <div class="ed-sec">ثانياً: نشاط مجلس الإدارة والاجتماعات والقرارات (${numAr(meets.length)} جلسة · ${numAr(decs.length)} قرار)</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:36px">م</th><th>عنوان الجلسة</th><th class="c">التاريخ</th><th class="c">الحضور</th><th class="c">القرارات</th></tr></thead><tbody>${meetRows}</tbody></table>
      <div class="ed-sec">ثالثاً: ملخص الحساب الختامي للإيرادات والمصروفات</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:68px">الكود</th><th>الحساب</th><th class="c" style="width:90px">الطبيعة</th><th class="n">المبلغ (ج.م)</th></tr></thead><tbody>${accRows}</tbody></table>
      <div class="ed-sec">رابعاً: المزايا والمنح والخدمات الاجتماعية المؤداة للأعضاء</div>
      <table class="ed-tbl"><thead><tr><th>بند الخدمة / الميزة</th><th class="c">عدد المستفيدين</th><th class="n">الإجمالي (ج.م)</th></tr></thead><tbody>${benRows}</tbody></table>`
  });
}

// ───────── تقارير المرحلة 33 المؤسسية المتخصصة ─────────

// 1 & 2) تقرير وكشف تسوية سلفة عهدة (مفردة أو مجمّعة متعددة الشيكات)
function settlementReportHTML(st) {
  if (!st) return '';
  const chqs = st.cheques || [];
  const isGrp = st.is_grouped || chqs.length > 1;
  const lines = st.lines || [], byAcc = st.by_account || [];
  const adv = +st.advance || 0, prev = +st.prev_balance || 0, subs = +st.subscriptions || 0;
  const avail = +(st.available_total ?? (adv + prev + subs)), spent = +st.spent || 0, ret = +st.returned || 0;
  const rem = +(st.remaining_balance ?? (avail - spent - ret));
  const unspent = +(avail - spent).toFixed(2);
  const cust = st.custodian || {};
  const chqRows = chqs.map((c, i) => `<tr>
    <td class="c">${numAr(i + 1)}</td>
    <td class="c"><span class="dt ed-chqno">${esc(c.cheque_no || 'بدون رقم')}</span></td>
    <td class="c">${dt(c.issue_date)}</td>
    <td>${esc(c.purpose || 'عهدة')}${c.notes ? ' — ' + esc(c.notes) : ''}</td>
    <td class="c">${esc(c.decision_no || 'لائحي')}</td>
    <td class="c">${c.cleared_date ? 'منصرف ' + dt(c.cleared_date) : esc(c.status || 'صادر')}</td>
    <td class="n"><b>${money(c.amount)}</b></td>
  </tr>`).join('') || '<tr><td colspan="7" class="c">—</td></tr>';

  const lineRows = lines.map((l, i) => {
    const bens = (l.beneficiaries_list || []).map(b => `${esc(b.full_name)}${b.job_id ? ' (' + esc(b.job_id) + ')' : ''}${b.amount ? ': ' + money(b.amount) : ''}`).join(' ، ');
    return `<tr>
      <td class="c">${numAr(i + 1)}</td>
      <td class="c" style="white-space:nowrap">${dt(l.doc_date || st.settle_date)}</td>
      <td><b>${esc(l.category)}</b><div style="font-size:10px;color:#64748b"><span class="dt">${esc(l.account || '')}</span> ${esc(l.account_name || '')}</div></td>
      <td>${esc(l.notes || '—')}${bens ? `<div style="font-size:10.5px;color:#475569;margin-top:2px">👥 المستفيدون: ${bens}</div>` : ''}</td>
      <td class="n"><b>${money(l.amount)}</b></td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="c">لا توجد بنود مصروفات مسجّلة في هذه التسوية</td></tr>';

  const accRows = byAcc.map(a => `<tr>
    <td class="c"><span class="dt"><b>${esc(a.account)}</b></span></td>
    <td>${esc(a.account_name || '')}</td>
    <td class="c">${numAr(a.lines_count)}</td>
    <td class="n"><b>${money(a.total)}</b></td>
  </tr>`).join('');

  let dispTxt = 'تسوية متوازنة بالكامل (المتاح يساوي المنصرف الفعلي — رصيد متبقي صفر)';
  let remTfqLbl = '';
  let remTfqVal = 0;
  if (unspent > 0.005) {
    if (ret > 0.005) {
      dispTxt = `توريد ورد مبلغ (${money(ret)} ج.م) بطريقة (${esc(st.return_mode || 'رد نقدي للخزينة')})` + (Math.abs(rem) > 0.005 ? ` · ومتبقي (${money(rem)} ج.م)` : ' — رصيد العهدة مقفل بالكامل ✓');
      remTfqLbl = 'تفقيط المبلغ المردود / المورّد';
      remTfqVal = ret;
    } else if (st.return_mode === 'ترحيل' || rem > 0.005) {
      dispTxt = `ترحيل الفائض المتبقي وقدره (${money(unspent)} ج.م) كرصيد مرحّل للعهدة التالية لنفس صاحب العهدة` + (st.carried_to_info ? ` (استُخدم في تسوية شيك ${esc(st.carried_to_info.cheque_no || '')} بتاريخ ${dt(st.carried_to_info.settle_date)})` : ' (جاهز للترحيل الآلي)');
      remTfqLbl = 'تفقيط الفائض المرحّل للعهدة التالية';
      remTfqVal = unspent;
    }
  } else if (unspent < -0.005) {
    dispTxt = `زيادة منصرف عن المتاح بمبلغ (${money(Math.abs(unspent))} ج.م) — ${st.decision ? 'معتمدة بقرار رقم ' + esc(st.decision.decision_no) : 'تُعالج وفق الاعتماد المالي'}`;
    remTfqLbl = 'تفقيط زيادة المنصرف (المستحق لصاحب العهدة)';
    remTfqVal = Math.abs(unspent);
  }

  return erpDoc({
    dept: 'الإدارة المالية والخزينة · الرقابة على العُهد والسلف',
    kind: isGrp ? 'كشف تسوية عهدة مجمّعة' : 'كشف تسوية عهدة مالية',
    code: isGrp ? 'STL-GRP' : 'STL',
    refLbl: 'قيد التسوية', refNo: st.entry_no || (st.status === 'مسودة' ? 'مسودة' : String(st.id || '').slice(0, 8).toUpperCase()),
    date: st.settle_date,
    ctrl: [['عدد الشيكات المسوّاة', `${numAr(chqs.length)} شيك`], ['عدد الفواتير والبنود', `${numAr(lines.length)} بند`]],
    title: isGrp
      ? `كشف تسوية عهدة مالية مجمّعة (${numAr(chqs.length)} شيكات)`
      : `كشف تسوية عهدة مالية (سلفة مفردة)`,
    sub: `تاريخ التسوية والإقفال: ${dt(st.settle_date)} · قيد اليومية: ${st.entry_no ? esc(st.entry_no) : 'مسودة قبل الترحيل'}`,
    status: st.status || 'معتمدة',
    statusCls: st.status === 'معتمدة' ? 'ok' : st.status === 'مسودة' ? 'warn' : 'bad',
    sigCols: s => [['صاحب العهدة / مسؤول التسوية', st.payee_name || ''], ['أمين الصندوق', s.treasurer], ['رئيس اللجنة النقابية', s.chair]],
    body: `<div class="ed-cust-bar">
        <div><span class="ed-cust-lbl">اسم مسؤول التسوية (صاحب العهدة):</span><span class="ed-cust-nm">${esc(st.payee_name || '—')}</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${cust.job_id ? `<span class="ed-cust-meta">الرقم الوظيفي: ${esc(cust.job_id)}</span>` : ''}
          <span class="ed-cust-meta">${esc(cust.workplace || 'اللجنة النقابية')}</span>
          <span class="ed-cust-meta">${isGrp ? `تسوية مجمّعة (${numAr(chqs.length)} شيكات)` : 'تسوية عهدة مفردة'}</span>
        </div>
      </div>
      <div class="ed-kpi4">
        <div class="ed-kpi"><small>${isGrp ? 'إجمالي الشيكات المجمّعة' : 'قيمة شيك العهدة'}</small><b>${money(adv)} ج.م</b></div>
        <div class="ed-kpi amber"><small>رصيد مرحّل من قبل${subs ? ' + اشتراكات' : ''}</small><b>${money(prev + subs)} ج.م</b></div>
        <div class="ed-kpi green"><small>إجمالي ميزانية التسوية</small><b>${money(avail)} ج.م</b></div>
        <div class="ed-kpi rose"><small>المنصرف الفعلي بالفواتير</small><b>${money(spent)} ج.م</b></div>
      </div>`
    + edGrid([
      [4, 'رقم قيد اليومية المرحّل', st.entry_no ? `<span class="dt"><b>${esc(st.entry_no)}</b></span>` : 'مسودة (قبل الترحيل)'],
      [5, 'قرار مجلس الإدارة المرتبط', st.decision ? `قرار (${esc(st.decision.decision_no)}) — ${esc(st.decision.text)}` : 'صرف وتسوية وفق اللائحة المالية'],
      [3, 'مُعد التسوية بالمنظومة', esc(st.created_by_name || 'الإدارة المالية')],
    ])
    + `<div class="ed-sec">أولاً: تفاصيل الشيكات ${isGrp ? 'المجمّعة' : 'المسوّاة'} (${numAr(chqs.length)} شيك)</div>
      <table class="ed-tbl">
        <thead><tr><th class="c" style="width:32px">م</th><th class="c" style="width:92px">رقم الشيك</th><th class="c" style="width:76px">تاريخ الإصدار</th><th>الغرض والبيان عند الصرف</th><th class="c" style="width:78px">القرار</th><th class="c" style="width:94px">حالة الشيك</th><th class="n" style="width:96px">المبلغ (ج.م)</th></tr></thead>
        <tbody>${chqRows}</tbody>
        <tfoot><tr><th colspan="6">إجمالي قيمة الشيكات المشمولة في التسوية (حـ/ 1103 عُهد تحت التسوية)</th><th class="n">${money(adv)}</th></tr></tfoot>
      </table>`
    + `<div class="ed-sec">ثانياً: بيان الفواتير والمصروفات المدرجة (${numAr(lines.length)} بند)</div>
      <table class="ed-tbl">
        <thead><tr><th class="c" style="width:30px">م</th><th class="c" style="width:76px">التاريخ</th><th style="width:165px">التصنيف المحاسبي</th><th>البيان والملاحظات والمستفيدون</th><th class="n" style="width:96px">المبلغ (ج.م)</th></tr></thead>
        <tbody>${lineRows}</tbody>
        <tfoot><tr><th colspan="4">إجمالي مبلغ الفواتير والمصروفات الفعلية المعتمدة</th><th class="n">${money(spent)}</th></tr></tfoot>
      </table>
      <div class="ed-tfq-strip blue"><small>تفقيط إجمالي الفواتير:</small><span>${esc(tafqeet(spent))}</span></div>
      <div class="ed-tfq-strip green"><small>تفقيط إجمالي ميزانية التسوية:</small><span>${esc(tafqeet(avail))}</span></div>
      ${remTfqVal > 0.005 ? `<div class="ed-tfq-strip gold"><small>${remTfqLbl}:</small><span>${esc(tafqeet(remTfqVal))}</span></div>` : ''}`
    + (byAcc.length > 1 ? `<div class="ed-sec">ثالثاً: ملخص التوزيع المحاسبي على حسابات المصروفات</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:90px">كود الحساب</th><th>اسم الحساب بدليل الحسابات</th><th class="c" style="width:90px">عدد البنود</th><th class="n" style="width:135px">الإجمالي المحمّل</th></tr></thead>
      <tbody>${accRows}</tbody></table>` : '')
    + `<div class="ed-sec">${byAcc.length > 1 ? 'رابعاً' : 'ثالثاً'}: الموقف المالي النهائي للسلفة وبيان المبالغ المتبقية</div>
      <table class="ed-tbl">
        <tbody>
          <tr><td>(+) إجمالي الشيكات المنصرفة كعهدة</td><td class="n" style="width:160px"><b>${money(adv)} ج.م</b></td></tr>
          ${prev ? `<tr><td>(+) رصيد فائض مرحّل من عهدة سابقة${st.carried_from_info ? ` (شيك رقم ${esc(st.carried_from_info.cheque_no || '—')} بتاريخ ${dt(st.carried_from_info.settle_date)})` : ''}</td><td class="n"><b>${money(prev)} ج.م</b></td></tr>` : ''}
          ${subs ? `<tr><td>(+) اشتراكات وتحصيلات نقدية مضافة على العهدة (حـ/ 4201)</td><td class="n"><b>${money(subs)} ج.م</b></td></tr>` : ''}
          <tr style="background:#ecfdf5;font-weight:800"><td>(=) إجمالي ميزانية التسوية المتاحة تحت يد صاحب العهدة</td><td class="n ed-in">${money(avail)} ج.م</td></tr>
          <tr><td>(−) يُخصم: إجمالي المصروفات الفعلية المسوّاة بالمستندات</td><td class="n ed-out">${money(spent)} ج.م</td></tr>
          <tr style="background:#fffbeb;font-weight:800"><td>(=) الفائض / الرصيد قبل التوريد أو الترحيل</td><td class="n">${money(unspent)} ج.م</td></tr>
          ${ret ? `<tr><td>(−) المبلغ المورّد / المردود فعلياً (${esc(st.return_mode || 'رد نقدي')})</td><td class="n">${money(ret)} ج.م</td></tr>` : ''}
        </tbody>
        <tfoot>
          <tr><th>صافي الرصيد المتبقي بذمة صاحب العهدة بعد التسوية</th><th class="n">${money(rem)} ج.م</th></tr>
        </tfoot>
      </table>
      <div class="ed-box gold"><b>بيان معالجة الرصيد وإخلاء الطرف:</b> ${dispTxt}. وقد روجعت كافة الفواتير والمستندات المؤيدة للصرف وأُرفقت بأصل ملف التسوية.</div>`
    + (st.status === 'مسترجعة' ? `<div class="ed-box" style="border-color:#dc2626;background:#fef2f2;color:#991b1b"><b>↩️ تنبيه استرجاع محاسبي:</b> أُلغيت هذه التسوية بقيد عكسي رقم (${esc(st.reverse_entry_no || '—')}) — السبب: ${esc(st.reverse_reason || '—')}.</div>` : '')
  });
}

// 3) تقرير كشف حساب العمليات والشيكات (دفتر الأستاذ والبنك والخزينة)
function operationsAndChequesReportHTML(rep) {
  if (!rep) return '';
  let runBal = +rep.opening || 0;
  const ops = (rep.operations || []).map((o, i) => {
    const db = +o.debit || 0, cr = +o.credit || 0;
    runBal += db - cr;
    const isIn = db > 0 && cr === 0;
    const kindLbl = o.status === 'معكوس' ? 'معكوس' : isIn ? 'وارد / إيداع' : 'صرف / شيك';
    const refCell = o.doc_ref
      ? `<span class="dt ed-chqno">${esc(o.doc_ref)}</span><div class="dt" style="font-size:9.5px;color:#64748b">${esc(o.entry_no || '')}</div>`
      : `<span class="dt"><b>${esc(o.entry_no || '')}</b></span>`;
    return `<tr>
      <td class="c">${numAr(i + 1)}</td>
      <td class="c" style="white-space:nowrap">${dt(o.date)}</td>
      <td class="c"><span class="ed-type ${isIn ? 'in' : 'out'}">${kindLbl}</span></td>
      <td class="c">${refCell}</td>
      <td>${o.party ? `<b>${esc(o.party)}</b><div style="font-size:11px;color:#475569">${esc(o.description || '')}</div>` : `<b>${esc(o.description || '')}</b>`}${o.status === 'معكوس' ? ' <span style="color:#b91c1c;font-weight:700">[معكوس]</span>' : ''}</td>
      <td class="n ${db ? 'ed-in' : ''}">${db ? money(db) : '—'}</td>
      <td class="n ${cr ? 'ed-out' : ''}">${cr ? money(cr) : '—'}</td>
      <td class="n ed-bal">${money(runBal)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="c">لا توجد عمليات مالية مسجّلة خلال هذه الفترة</td></tr>';

  const chqs = rep.cheques || [], cs = rep.cheques_summary || {};
  const chqRows = chqs.map((c, i) => `<tr>
    <td class="c">${numAr(i + 1)}</td>
    <td class="c" style="white-space:nowrap">${dt(c.issue_date)}</td>
    <td class="c"><span class="dt ed-chqno">${esc(c.cheque_no || 'بدون رقم')}</span></td>
    <td><b>${esc(c.payee_name || '')}</b></td>
    <td>${esc(c.purpose || '')} <small class="muted">(${esc(c.expense_account || '')})</small></td>
    <td class="c">${c.status === 'ملغى' ? '<span class="ed-type out">ملغى</span>' : c.cleared_date ? '<span class="ed-type in">صُرف ' + dt(c.cleared_date) + '</span>' : '<span class="ed-type">' + esc(c.status || 'صادر') + ' (معلّق)</span>'}</td>
    <td class="n"><b>${money(c.amount)}</b></td>
  </tr>`).join('') || '<tr><td colspan="7" class="c">لا توجد شيكات صادرة خلال هذه الفترة</td></tr>';

  return erpDoc({
    dept: 'الإدارة المالية والخزينة · دفتر الأستاذ وحسابات البنوك',
    kind: 'كشف حساب العمليات والشيكات', code: 'OPS-CHQ',
    refLbl: 'الحساب', refNo: rep.account === 'ALL' ? '1101+1102' : rep.account, date: rep.to,
    ctrl: [['الفترة من', dt(rep.from)], ['إلى تاريخ', dt(rep.to)], ['عدد الحركات', `${numAr((rep.operations || []).length)} حركة`]],
    title: `كشف حساب الخزينة والبنك والعمليات والشيكات (${esc(rep.account_label)})`,
    sub: `دفتر الأستاذ التفصيلي بالرصيد المتحرك وسجل الشيكات الصادرة عن الفترة من ${dt(rep.from)} إلى ${dt(rep.to)}`,
    status: `${numAr((rep.operations || []).length)} عملية · ${numAr(cs.total_count || 0)} شيك`, statusCls: 'ok',
    body: `<div class="ed-open-bar">
        <span>الرصيد الافتتاحي للفترة (في ${dt(rep.from)}):</span>
        <b>${money(rep.opening)} ج.م</b>
      </div>
      <div class="ed-kpi4">
        <div class="ed-kpi"><small>رصيد أول المدة</small><b>${money(rep.opening)} ج.م</b></div>
        <div class="ed-kpi green"><small>إجمالي الوارد والإيداعات (+)</small><b>+ ${money(rep.total_debit)} ج.م</b></div>
        <div class="ed-kpi rose"><small>إجمالي المنصرف والشيكات (−)</small><b>− ${money(rep.total_credit)} ج.م</b></div>
        <div class="ed-kpi amber"><small>الرصيد الدفتري الختامي</small><b>${money(rep.closing)} ج.م</b></div>
      </div>`
    + edGrid([
      [4, 'شيكات صادرة لم تُصرف من البنك حتى تاريخه', `<b>${money(rep.uncleared_cheques_total)} ج.م (${numAr(rep.uncleared_cheques_count)} شيك)</b>`],
      [4, 'إيداعات بالطريق لم تظهر بالبنك', `<b>${money(rep.uncleared_deposits_total)} ج.م</b>`],
      [4, 'الرصيد المتوقع بكشف البنك', `<b>${money(rep.expected_bank_balance)} ج.م</b>`],
    ])
    + `<div class="ed-sec">أولاً: كشف حساب العمليات المالية التفصيلي بالرصيد المتحرك (${numAr((rep.operations || []).length)} حركة)</div>
      <table class="ed-tbl">
        <thead>
          <tr>
            <th class="c" style="width:24px">م</th>
            <th class="c" style="width:68px">التاريخ</th>
            <th class="c" style="width:66px">النوع</th>
            <th class="c" style="width:82px">رقم الشيك / القيد</th>
            <th>الجهة / البيان</th>
            <th class="n" style="width:74px">وارد (+)</th>
            <th class="n" style="width:74px">منصرف (−)</th>
            <th class="n" style="width:82px">الرصيد</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background:#ecfdf5;font-weight:800"><td colspan="7" style="color:#065f46">الرصيد الافتتاحي المنقول في ${dt(rep.from)}</td><td class="n ed-in">${money(rep.opening)}</td></tr>
          ${ops}
        </tbody>
        <tfoot>
          <tr><th colspan="5">إجمالي الحركة والرصيد الختامي في ${dt(rep.to)}</th><th class="n ed-in">${money(rep.total_debit)}</th><th class="n ed-out">${money(rep.total_credit)}</th><th class="n ed-bal">${money(rep.closing)}</th></tr>
        </tfoot>
      </table>
      <div class="ed-tfq-strip blue"><small>تفقيط الرصيد الختامي:</small><span>${esc(tafqeet(Math.abs(+rep.closing || 0)))}${+rep.closing < 0 ? ' (بالعجز / بالسالب)' : ''}</span></div>`
    + `<div class="ed-sec">ثانياً: سجل الشيكات البنكية الصادرة خلال الفترة (${numAr(cs.total_count || 0)} شيك — الصحيح منها ${numAr(cs.valid_count || 0)} بقيمة ${money(cs.valid_amount)} ج.م)</div>
      <table class="ed-tbl">
        <thead>
          <tr>
            <th class="c" style="width:26px">م</th>
            <th class="c" style="width:72px">تاريخ الإصدار</th>
            <th class="c" style="width:88px">رقم الشيك</th>
            <th>اسم المستفيد</th>
            <th>الغرض والحساب</th>
            <th class="c" style="width:106px">الحالة والصرف البنكي</th>
            <th class="n" style="width:84px">المبلغ (ج.م)</th>
          </tr>
        </thead>
        <tbody>${chqRows}</tbody>
        <tfoot>
          <tr><th colspan="6">إجمالي الشيكات الصحيحة (منصرف بالبنك: ${money(cs.cleared_amount)} · معلّق: ${money(cs.uncleared_amount)}${+cs.voided_count ? ' · ملغى مستبعد: ' + numAr(cs.voided_count) : ''})</th><th class="n">${money(cs.valid_amount)}</th></tr>
        </tfoot>
      </table>`
  });
}

// 4) تقرير وكشف الجمعية العمومية (نقابة عامة)
function generalAssemblyReportHTML(rep) {
  if (!rep) return '';
  const items = rep.items || [], wpList = rep.by_workplace || [], comp = rep.completeness || {};
  const stateLbl = rep.filter_state === 'الكل' ? 'جميع المقيدين بالنقابة العامة' : `الأعضاء (${rep.filter_state})`;
  const wpRows = wpList.map((w, i) => `<tr>
    <td class="c">${numAr(i + 1)}</td>
    <td><b>${esc(w.workplace)}</b></td>
    <td class="n"><b>${numAr(w.count)}</b></td>
    <td class="c">${items.length ? numAr(Math.round((1000 * w.count) / Math.max(1, wpList.reduce((a, x) => a + +x.count, 0))) / 10) + '%' : '—'}</td>
  </tr>`).join('') || '<tr><td colspan="4" class="c">—</td></tr>';

  const memRows = items.map((m, i) => `<tr>
    <td class="c">${numAr(i + 1)}</td>
    <td class="c"><span class="dt"><b>${esc(m.job_id || '—')}</b></span></td>
    <td><b>${esc(m.full_name)}</b></td>
    <td class="c"><span class="dt">${esc(m.national_id || '—')}</span></td>
    <td>${esc(m.workplace || '—')}</td>
    <td>${esc(m.job_title || m.grade || '—')}</td>
    <td class="c"><span class="dt">${esc(m.phone || '—')}</span></td>
    <td></td>
  </tr>`).join('') || '<tr><td colspan="8" class="c">لا يوجد أعضاء مطابقون لمعيار التصفية</td></tr>';

  return erpDoc({
    dept: 'شئون العضوية والجمعية العمومية · النقابة العامة للعاملين بالاتصالات',
    kind: 'تقرير وكشف الجمعية العمومية', code: 'GA-GEN',
    refLbl: 'تاريخ الحصر', refNo: String(rep.as_of || new Date().toISOString().slice(0, 10)), date: rep.as_of,
    ctrl: [['التنظيم النقابي', 'النقابة العامة'], ['نطاق الكشف', stateLbl]],
    title: 'التقرير الإحصائي والكشف الرسمي لأعضاء الجمعية العمومية (النقابة العامة)',
    sub: `${rep.filter_workplace ? 'جهة العمل: ' + esc(rep.filter_workplace) + ' · ' : ''}مُعد وفق أحكام قانون المنظمات النقابية العمالية ولائحة النظام الأساسي`,
    status: `${numAr(items.length)} عضو بالكشف`, statusCls: 'ok',
    body: edGrid([
      [3, 'أعضاء النقابة العامة النشطون (لهم حق التصويت)', `<b>${numAr(rep.active_voting)} عضو</b>`],
      [3, 'النصاب القانوني للاجتماع الأول (٥٠٪ + ١)', `<b style="color:#0f3d5e">${numAr(rep.quorum_first)} عضو حاضر</b>`],
      [3, 'النصاب القانوني للاجتماع الثاني (٢٥٪)', `<b>${numAr(rep.quorum_second)} عضو حاضر</b>`],
      [3, 'إجمالي المقيدين بالنقابة العامة (نشط + معاش)', `<b>${numAr(rep.total_general_union)} عضو</b>`],
      [4, 'استيفاء الرقم القومي بالكشف', `${numAr(comp.with_nid || 0)} من ${numAr(items.length)}`],
      [4, 'استيفاء رقم التليفون بالكشف', `${numAr(comp.with_phone || 0)} من ${numAr(items.length)}`],
      [4, 'نطاق الكشف المطبوع أدناه', `<b>${esc(stateLbl)}${rep.filter_workplace ? ' — ' + esc(rep.filter_workplace) : ''} (${numAr(items.length)})</b>`],
    ])
    + (!rep.filter_workplace && wpList.length > 1 ? `<div class="ed-sec">أولاً: التوزيع الإحصائي لأعضاء الجمعية العمومية حسب مقر / جهة العمل</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:38px">م</th><th>جهة / مقر العمل</th><th class="n" style="width:110px">عدد الأعضاء</th><th class="c" style="width:90px">النسبة %</th></tr></thead>
      <tbody>${wpRows}</tbody></table>` : '')
    + `<div class="ed-sec">${!rep.filter_workplace && wpList.length > 1 ? 'ثانياً' : 'أولاً'}: الكشف الاسمي لأعضاء الجمعية العمومية — النقابة العامة (${numAr(items.length)} عضو)</div>
      <table class="ed-tbl">
        <thead>
          <tr>
            <th class="c" style="width:34px">م</th>
            <th class="c" style="width:68px">الرقم الوظيفي</th>
            <th>الاسم الرباعي للعضو</th>
            <th class="c" style="width:108px">الرقم القومي</th>
            <th>جهة العمل</th>
            <th>الوظيفة / الدرجة</th>
            <th class="c" style="width:88px">التليفون</th>
            <th class="c" style="width:96px">التوقيع بالحضور</th>
          </tr>
        </thead>
        <tbody>${memRows}</tbody>
      </table>
      <div class="ed-box gold"><b>إقرار صحة الحصر:</b> أُعد هذا الكشف آلياً من قاعدة بيانات العضوية المعتمدة باللجنة النقابية، ويقتصر حق الحضور والتصويت بالجمعية العمومية للنقابة العامة على الأعضاء النشطين المسددين لاشتراكاتهم النقابية.</div>`
  });
}

// 9) ابتكار كشوف احترافية لحجز الرحلات والمشتركين والدفع وتسكين الأتوبيس
function tripManifestReportHTML(a, items, sum, mode = 'full') {
  if (!a) return '';
  const active = (items || []).filter(b => b.status !== 'ملغى');
  const confirmed = active.filter(b => ['مؤكد', 'معلق الدفع'].includes(b.status));
  const wait = active.filter(b => b.status === 'قائمة انتظار');
  const totReq = confirmed.reduce((s, b) => s + (+b.total || 0), 0);
  const totPaid = confirmed.reduce((s, b) => s + (+b.paid || 0), 0);
  const totSub = confirmed.reduce((s, b) => s + (+b.subsidy || 0), 0);
  const totRest = Math.max(0, totReq - totPaid);
  const sups = (a.supervisors || []).map(s => `${esc(s.full_name)} (${esc(s.task || 'مشرف')})`).join(' · ') || 'لم يُحدد بعد';

  if (mode === 'bus') {
    const pax = [];
    confirmed.forEach(b => {
      (b.people || []).forEach(p => {
        pax.push({
          seat_no: p.seat_no,
          pax_name: p.full_name,
          relation: p.relation || 'عضو',
          age: p.age,
          member_name: b.person?.full_name || '',
          job_id: b.person?.job_id || '',
          phone: b.person?.phone || '',
          paid_ok: (+b.paid || 0) >= (+b.total || 0) - 0.01,
          rest: Math.max(0, (+b.total || 0) - (+b.paid || 0))
        });
      });
    });
    pax.sort((x, y) => (+x.seat_no || 9999) - (+y.seat_no || 9999));
    const pRows = pax.map((p, i) => `<tr>
      <td class="c"><b>${p.seat_no ? numAr(p.seat_no) : '—'}</b></td>
      <td class="c">${numAr(i + 1)}</td>
      <td><b>${esc(p.pax_name)}</b></td>
      <td class="c">${esc(p.relation)}${p.age ? ' (' + numAr(p.age) + ')' : ''}</td>
      <td>${esc(p.member_name)} <small class="muted">(${esc(p.job_id)})</small></td>
      <td class="c"><span class="dt">${esc(p.phone || '—')}</span></td>
      <td class="c">${p.paid_ok ? '✓ خالص' : 'متبقي ' + money(p.rest)}</td>
      <td class="c">☐ ذهاب &nbsp; ☐ عودة</td>
    </tr>`).join('') || '<tr><td colspan="8" class="c">لا يوجد مشاركون مسجّلون بعد</td></tr>';

    return erpDoc({
      dept: 'لجنة الأنشطة والرحلات · التشغيل الميداني وتفقد الأفواج',
      kind: 'كشف تسكين وتفقد الرحلة', code: 'TRIP-BUS',
      refLbl: 'تاريخ الرحلة', refNo: String(a.start_date || ''), date: a.start_date,
      ctrl: [['الوجهة', a.location || '—'], ['إجمالي الركاب', `${numAr(pax.length)} راكب`]],
      title: `كشف تسكين المقاعد وتفقد المشرفين — ${esc(a.title)}`,
      sub: `الوجهة: ${esc(a.location || '—')} · من ${dt(a.start_date)} إلى ${dt(a.end_date || a.start_date)} · المشرفون: ${sups}`,
      status: `${numAr(pax.length)} مقعد / مشارك`, statusCls: 'ok',
      body: edGrid([
        [4, 'إجمالي السعة المقررة / المشغول', `${numAr(a.capacity)} / <b>${numAr(pax.length)} مقعد</b>`],
        [4, 'نقطة وموعد التجمع والانطلاق', esc((a.program && a.program[0] && (a.program[0].time ? a.program[0].time + ' — ' + a.program[0].text : a.program[0].text)) || a.location || 'مقر اللجنة النقابية')],
        [4, 'مشرفو الفوج المعتمدون', sups],
      ]) + `<div class="ed-sec">قائمة تسكين المقاعد وتفقد الركاب (ذهاباً وعودةً)</div>
        <table class="ed-tbl">
          <thead><tr><th class="c" style="width:46px">المقعد</th><th class="c" style="width:32px">م</th><th>اسم الراكب / المشارك</th><th class="c" style="width:76px">الصلة</th><th>العضو المسئول</th><th class="c" style="width:90px">موبايل التواصل</th><th class="c" style="width:82px">موقف السداد</th><th class="c" style="width:110px">تفقد المشرف</th></tr></thead>
          <tbody>${pRows}</tbody>
        </table>`
    });
  }

  const list = mode === 'unpaid' ? confirmed.filter(b => (+b.total - +b.paid) > 0.01) : confirmed;
  const rows = list.map((b, i) => {
    const rest = Math.max(0, (+b.total || 0) - (+b.paid || 0));
    const rcpts = (b.payments || []).filter(p => +p.amount > 0).map(p => p.receipt_no).filter(Boolean).join('، ') || '—';
    const seats = (b.people || []).map(p => p.seat_no).filter(Boolean).join('، ') || '—';
    const names = (b.people || []).map(p => `${esc(p.full_name)} (${esc(p.relation || 'عضو')})`).join(' · ');
    return `<tr>
      <td class="c">${numAr(i + 1)}</td>
      <td class="c"><span class="dt">${esc(b.booking_no || '')}</span></td>
      <td><b>${esc(b.person?.full_name || '')}</b> <small class="muted">(${esc(b.person?.job_id || '—')})</small>
        <div style="font-size:10.5px;color:#475569;margin-top:2px">👥 (${numAr((b.people || []).length)}): ${names}</div>
        ${b.person?.phone ? `<div class="dt" style="font-size:10.5px;color:#64748b">📱 ${esc(b.person.phone)}</div>` : ''}</td>
      <td class="c">${esc(seats)}</td>
      <td class="n">${money(b.total)}</td>
      <td class="n"><b>${money(b.paid)}</b></td>
      <td class="n" style="${rest > 0.01 ? 'color:#b91c1c;font-weight:800' : 'color:#166534'}">${rest > 0.01 ? money(rest) : 'خالص ✓'}</td>
      <td class="c"><span class="dt">${esc(rcpts)}</span></td>
      <td class="c">${esc(b.status)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="9" class="c">${mode === 'unpaid' ? 'جميع الحجوزات مسدّدة بالكامل ولا توجد متأخرات 👌' : 'لا توجد حجوزات مسجّلة حتى الآن'}</td></tr>`;

  const waitRows = mode === 'full' && wait.length ? `<div class="ed-sec">ثانياً: قائمة الانتظار الاحتياطية (${numAr(wait.length)} طلب)</div>
    <table class="ed-tbl"><thead><tr><th class="c" style="width:36px">م</th><th>رقم الحجز</th><th>اسم العضو</th><th class="c">الرقم الوظيفي</th><th class="c">عدد الأفراد</th><th class="c">التليفون</th><th class="n">قيمة الاشتراك</th></tr></thead>
    <tbody>${wait.map((b, i) => `<tr><td class="c">${numAr(i + 1)}</td><td class="c">${esc(b.booking_no)}</td><td><b>${esc(b.person?.full_name || '')}</b></td><td class="c">${esc(b.person?.job_id || '')}</td><td class="c">${numAr((b.people || []).length)}</td><td class="c"><span class="dt">${esc(b.person?.phone || '—')}</span></td><td class="n">${money(b.total)}</td></tr>`).join('')}</tbody></table>` : '';

  return erpDoc({
    dept: 'لجنة الأنشطة والرحلات · الإدارة المالية والتحصيل',
    kind: mode === 'unpaid' ? 'كشف متأخرات تحصيل رحلة' : 'كشف حجز المشتركين والدفع',
    code: mode === 'unpaid' ? 'TRIP-DUE' : 'TRIP-PAY',
    refLbl: 'تاريخ التنفيذ', refNo: String(a.start_date || ''), date: a.start_date,
    ctrl: [['نوع النشاط', a.kind || 'رحلة'], ['الحالة', a.status || '—']],
    title: mode === 'unpaid'
      ? `كشف متابعة سداد المتأخرات المالية للمشتركين — ${esc(a.title)}`
      : `الكشف الشامل لحجز الرحلة والمشتركين والتحصيل المالي — ${esc(a.title)}`,
    sub: `الوجهة: ${esc(a.location || '—')} · الفترة: ${dt(a.start_date)}${a.end_date && a.end_date !== a.start_date ? ' ← ' + dt(a.end_date) : ''} · المشرفون: ${sups}`,
    status: totRest > 0.01 ? `متبقي للتحصيل ${money(totRest)} ج.م` : 'مكتمل التحصيل ✓',
    statusCls: totRest > 0.01 ? 'warn' : 'ok',
    body: edMoney(mode === 'unpaid' ? totRest : totPaid, mode === 'unpaid' ? 'إجمالي المبالغ المتبقية المطلوب تحصيلها قبل الرحلة' : 'إجمالي الاشتراكات المحصّلة فعلياً بإيصالات رسمية') + edGrid([
      [3, 'السعة / المقاعد المحجوزة', `${numAr(a.capacity)} / <b>${numAr(sum?.seats_used ?? confirmed.reduce((x, b) => x + (b.seats || 0), 0))} مقعد</b>`],
      [3, 'إجمالي الاشتراكات المطلوبة', `<b>${money(totReq)} ج.م</b>`],
      [3, 'المحصّل الفعلي / المتبقي', `<b style="color:#166534">${money(totPaid)}</b> / <b style="color:#b91c1c">${money(totRest)}</b>`],
      [3, 'إجمالي دعم اللجنة النقابية', `<b>${money(totSub)} ج.م</b>`],
    ]) + `<div class="ed-sec">${mode === 'unpaid' ? 'بيان الحجوزات التي عليها مبالغ متبقية للسداد' : 'أولاً: كشف الحجوزات والمشتركين والموقف المالي وأرقام الإيصالات'} (${numAr(list.length)} حجز)</div>
      <table class="ed-tbl">
        <thead>
          <tr>
            <th class="c" style="width:30px">م</th>
            <th class="c" style="width:86px">رقم الحجز</th>
            <th>العضو الحاجز والمرافقون</th>
            <th class="c" style="width:58px">المقاعد</th>
            <th class="n" style="width:78px">المطلوب</th>
            <th class="n" style="width:78px">المسدّد</th>
            <th class="n" style="width:78px">المتبقي</th>
            <th class="c" style="width:92px">أرقام الإيصالات</th>
            <th class="c" style="width:68px">الحالة</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <th colspan="4">الإجمالي المالي للكشف</th>
            <th class="n">${money(list.reduce((s, b) => s + +b.total, 0))}</th>
            <th class="n">${money(list.reduce((s, b) => s + +b.paid, 0))}</th>
            <th class="n">${money(list.reduce((s, b) => s + Math.max(0, +b.total - +b.paid), 0))}</th>
            <th colspan="2"></th>
          </tr>
        </tfoot>
      </table>` + waitRows
  });
}

// 10) تقارير مؤسسية مبتكرة إضافية (مذكرة البنك · تنفيذ القرارات · سجل المنح · عدالة المزايا · كشف المصيف)
function bankReconReportHTML(r = S.recon) {
  r = r || {};
  const diff = r.difference == null ? null : +r.difference;
  const chqRows = (r.cheques || []).map((c, i) => `<tr><td class="c">${numAr(i + 1)}</td><td class="c">${dt(c.issue_date)}</td><td class="c"><span class="dt"><b>${esc(c.cheque_no || '—')}</b></span></td><td>${esc(c.payee_name || '')}</td><td class="c">${c.stale ? 'متقادم (+٦ شهور)' : 'ساري'}</td><td class="n"><b>${money(c.amount)}</b></td></tr>`).join('')
    || '<tr><td colspan="6" class="c">لا توجد شيكات معلّقة لم تُصرف من البنك 👌</td></tr>';
  const depRows = (r.deposits || []).map((d, i) => `<tr><td class="c">${numAr(i + 1)}</td><td class="c">${dt(d.receipt_date)}</td><td class="c"><span class="dt">${esc(d.receipt_no || '')}</span></td><td>${esc(d.kind + (d.party ? ' — ' + d.party : ''))}</td><td class="n"><b>${money(d.amount)}</b></td></tr>`).join('')
    || '<tr><td colspan="5" class="c">لا توجد إيداعات معلّقة بالطريق</td></tr>';
  return erpDoc({
    dept: 'الإدارة المالية والخزينة · الرقابة والمطابقة البنكية', kind: 'مذكرة تسوية البنك', code: 'RECON',
    refLbl: 'تاريخ المطابقة', refNo: String(r.date || new Date().toISOString().slice(0, 10)), date: r.date,
    ctrl: [['حساب البنك', '1102 — الجاري']],
    title: `مذكرة مطابقة وتسوية حساب البنك المعتمدة كما في ${dt(r.date)}`,
    sub: 'مطابقة الرصيد الدفتري لحساب البنك (1102) مع الرصيد الوارد بكشف حساب البنك الرسمي',
    status: diff != null && Math.abs(diff) < 0.01 ? 'مطابق تماماً ✓' : diff == null ? 'مذكرة موقف دفتري' : 'يوجد فرق قيد التسوية',
    statusCls: diff != null && Math.abs(diff) < 0.01 ? 'ok' : 'warn',
    body: edMoney(r.adjusted, 'الرصيد المعدّل المتوقع بكشف حساب البنك') + `<div class="ed-sec">أولاً: معادلة التسوية والمطابقة البنكية</div>
      <table class="ed-tbl"><tbody>
        <tr><td>الرصيد الدفتري لحساب البنك بالدفاتر المحاسبية (حـ/ 1102) في ${dt(r.date)}</td><td class="n" style="width:165px"><b>${money(r.book_balance)} ج.م</b></td></tr>
        <tr><td>(+) يُضاف: شيكات صادرة للمستفيدين ولم تُقدّم للصرف بالبنك بعد (${numAr((r.cheques || []).length)} شيك)</td><td class="n">+ ${money(r.outstanding_cheques)} ج.م</td></tr>
        <tr><td>(−) يُخصم: إيداعات وتحصيلات بالطريق لم تظهر بكشف البنك بعد (${numAr((r.deposits || []).length)} إيصال)</td><td class="n">− ${money(r.deposits_in_transit)} ج.م</td></tr>
        <tr style="background:#eef4fa;font-weight:800"><td>(=) الرصيد المتوقع ظهوره في كشف حساب البنك</td><td class="n">${money(r.adjusted)} ج.م</td></tr>
        ${r.stmt_balance != null ? `<tr><td>الرصيد الفعلي الوارد في كشف حساب البنك المرفق</td><td class="n"><b>${money(r.stmt_balance)} ج.م</b></td></tr>
        <tr style="background:${Math.abs(diff) < 0.01 ? '#f0fdf4' : '#fef2f2'};font-weight:800"><td>الفرق بين الكشف البنكي والرصيد المعدّل</td><td class="n">${money(diff)} ج.م</td></tr>` : ''}
      </tbody></table>
      <div class="ed-sec">ثانياً: بيان الشيكات الصادرة ولم تُصرف من البنك حتى ${dt(r.date)}</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:36px">م</th><th class="c">تاريخ الإصدار</th><th class="c">رقم الشيك</th><th>اسم المستفيد</th><th class="c">الحالة</th><th class="n">المبلغ (ج.م)</th></tr></thead><tbody>${chqRows}</tbody></table>
      <div class="ed-sec">ثالثاً: بيان الإيداعات بالطريق التي لم تظهر بالكشف البنكي</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:36px">م</th><th class="c">تاريخ الإيصال</th><th class="c">رقم الإيصال</th><th>البيان والجهة</th><th class="n">المبلغ (ج.م)</th></tr></thead><tbody>${depRows}</tbody></table>`
  });
}

function decisionsExecReportHTML(items = S.decisions, sm = S.decSummary) {
  const list = items || [], s = sm || {};
  const totCeiling = list.reduce((a, d) => a + (+d.amount || 0), 0), totSpent = list.reduce((a, d) => a + (+d.spent || 0), 0);
  const rows = list.map((d, i) => `<tr>
    <td class="c">${numAr(i + 1)}</td>
    <td class="c"><span class="dt"><b>${esc(d.decision_no)}</b></span></td>
    <td class="c">${dt(d.meeting_date)}</td>
    <td class="c">${esc(d.category)}</td>
    <td><b>${esc(d.text)}</b>${d.assignee_name ? `<div style="font-size:10.5px;color:#475569">المكلف: ${esc(d.assignee_name)}</div>` : ''}</td>
    <td class="c">${esc(d.exec_status || 'لم يبدأ')}</td>
    <td class="n">${d.amount != null ? money(d.amount) : '—'}</td>
    <td class="n"><b>${+d.spent ? money(d.spent) : '—'}</b></td>
  </tr>`).join('') || '<tr><td colspan="8" class="c">لا توجد قرارات مسجّلة</td></tr>';
  return erpDoc({
    dept: 'شئون مجلس الإدارة والرقابة على التنفيذ', kind: 'تقرير متابعة قرارات المجلس', code: 'DEC-REP',
    refLbl: 'عدد القرارات', refNo: numAr(list.length),
    title: 'تقرير متابعة تنفيذ قرارات مجلس الإدارة والاعتمادات المالية المنصرفة عليها',
    sub: 'مقارنة السقوف المالية المعتمدة بقرارات المجلس مع المنصرف الفعلي بالشيكات والقيود وموقف التنفيذ',
    status: `منفّذ ${numAr(s.done || 0)} من ${numAr(s.total || list.length)}`, statusCls: s.overdue ? 'warn' : 'ok',
    body: edGrid([
      [3, 'إجمالي القرارات المسجّلة', `<b>${numAr(s.total || list.length)} قرار</b>`],
      [3, 'تم التنفيذ / جارٍ التنفيذ', `<b style="color:#166534">${numAr(s.done || 0)}</b> / <b>${numAr(s.doing || 0)}</b>`],
      [3, 'إجمالي السقوف المعتمدة', `<b>${money(totCeiling)} ج.م</b>`],
      [3, 'إجمالي المنصرف الفعلي عليها', `<b>${money(totSpent)} ج.م</b>`],
    ]) + `<div class="ed-sec">سجل القرارات وموقف التنفيذ والصرف المالي</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:32px">م</th><th class="c" style="width:74px">رقم القرار</th><th class="c" style="width:76px">تاريخ الجلسة</th><th class="c" style="width:76px">التصنيف</th><th>نص القرار والتكليف</th><th class="c" style="width:78px">التنفيذ</th><th class="n" style="width:84px">السقف المعتمد</th><th class="n" style="width:84px">المنصرف الفعلي</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><th colspan="6">الإجمالي العام للاعتمادات والمنصرف</th><th class="n">${money(totCeiling)}</th><th class="n">${money(totSpent)}</th></tr></tfoot></table>`
  });
}

function grantsRegisterReportHTML(items = S.grtList) {
  const list = items || [], paid = list.filter(g => g.status === 'مصروف'), approved = list.filter(g => g.status === 'معتمد');
  const totPaid = paid.reduce((a, g) => a + (+g.amount || 0), 0), totApp = approved.reduce((a, g) => a + (+g.amount || 0), 0);
  const byType = {};
  paid.forEach(g => { const k = g.type_name || 'منحة'; (byType[k] = byType[k] || { cnt: 0, amt: 0 }).cnt++; byType[k].amt += (+g.amount || 0); });
  const sumRows = Object.entries(byType).map(([k, v], i) => `<tr><td class="c">${numAr(i + 1)}</td><td><b>${esc(k)}</b></td><td class="c">${numAr(v.cnt)}</td><td class="n"><b>${money(v.amt)}</b></td></tr>`).join('')
    || '<tr><td colspan="4" class="c">لا توجد منح مصروفة</td></tr>';
  const rows = list.map((g, i) => `<tr>
    <td class="c">${numAr(i + 1)}</td>
    <td class="c"><span class="dt">${esc(g.req_no)}</span></td>
    <td><b>${esc(g.person?.full_name || '')}</b> <small class="muted">(${esc(g.person?.job_id || '—')})</small></td>
    <td>${esc(g.type_name)} <small class="muted">(${esc(g.subject_relation || 'العضو')})</small></td>
    <td class="c">${dt(g.event_date)}</td>
    <td class="c">${esc(g.status)}</td>
    <td class="c"><span class="dt">${esc(g.cheque?.cheque_no || '—')}</span></td>
    <td class="n"><b>${g.amount ? money(g.amount) : '—'}</b></td>
  </tr>`).join('') || '<tr><td colspan="8" class="c">لا توجد طلبات منح</td></tr>';
  return erpDoc({
    dept: 'لجنة الرعاية الاجتماعية والمنح النقابية', kind: 'سجل المنح الاجتماعية', code: 'GRT-REG',
    refLbl: 'إجمالي الطلبات', refNo: numAr(list.length),
    title: 'التقرير التحليلي والكشف التفصيلي لسجل المنح الاجتماعية',
    sub: 'حصر شامل لطلبات المنح الاجتماعية المنصرفة والمعتمدة وقيد المراجعة وأرقام شيكات الصرف',
    status: `${numAr(paid.length)} منحة مصروفة`, statusCls: 'ok',
    body: edMoney(totPaid, 'إجمالي قيمة المنح الاجتماعية المنصرفة بشيكات بنكية') + edGrid([
      [4, 'منح مصروفة فعلياً', `<b>${numAr(paid.length)} منحة (${money(totPaid)} ج.م)</b>`],
      [4, 'منح معتمدة بانتظار الشيك', `<b>${numAr(approved.length)} منحة (${money(totApp)} ج.م)</b>`],
      [4, 'طلبات قيد الاستيفاء والمراجعة', `<b>${numAr(list.filter(g => ['مقدَّم', 'تحت المراجعة'].includes(g.status)).length)} طلب</b>`],
    ]) + `<div class="ed-sec">أولاً: الملخص الإحصائي للمنح المنصرفة حسب النوع</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:36px">م</th><th>نوع المنحة الاجتماعية</th><th class="c" style="width:120px">العدد المنصرف</th><th class="n" style="width:150px">إجمالي المنصرف (ج.م)</th></tr></thead><tbody>${sumRows}</tbody></table>
      <div class="ed-sec">ثانياً: السجل التفصيلي لطلبات المنح الاجتماعية (${numAr(list.length)} طلب)</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:32px">م</th><th class="c" style="width:94px">رقم الطلب</th><th>اسم العضو</th><th>نوع المنحة والصلة</th><th class="c" style="width:76px">تاريخ الواقعة</th><th class="c" style="width:72px">الحالة</th><th class="c" style="width:86px">رقم الشيك</th><th class="n" style="width:88px">المبلغ</th></tr></thead><tbody>${rows}</tbody></table>`
  });
}

function benefitsSummaryReportHTML(r = S.benRep) {
  if (!r) return '';
  const yrLbl = r.year ? `سنة ${r.year}` : 'شامل كافة السنوات';
  const catRows = (r.byCategory || []).map((c, i) => `<tr><td class="c">${numAr(i + 1)}</td><td><b>${esc(c.category)}</b></td><td class="c">${esc(c.kind || '—')}</td><td class="c">${numAr(c.people)}</td><td class="n"><b>${money(c.total)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="c">لا توجد مزايا مسجّلة</td></tr>';
  const brdRows = (r.board || []).map((b, i) => `<tr><td class="c">${numAr(i + 1)}</td><td><b>${esc(b.full_name)}</b></td><td>${esc(b.role || '—')}</td><td>${Object.entries(b.byKind || {}).map(([k, v]) => `${esc(k)}: ${money(v)}`).join(' · ')}</td><td class="n"><b>${money(b.total)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="c">لا توجد مزايا مسجّلة لأعضاء المجلس</td></tr>';
  return erpDoc({
    dept: 'لجنة الرعاية الاجتماعية والشفافية والحوكمة', kind: 'تقرير عدالة توزيع المزايا', code: 'BEN-REP',
    refLbl: 'النطاق الزمني', refNo: r.year || 'ALL',
    title: `تقرير عدالة توزيع المزايا والدعم والمنح النقابية (${esc(yrLbl)})`,
    sub: 'بيان إحصائي وشفاف لإجمالي المزايا الممنوحة للأعضاء وإفصاح مزايا السادة أعضاء مجلس الإدارة',
    status: `${numAr(r.beneficiaries || 0)} عضو مستفيد`, statusCls: 'ok',
    body: edMoney(r.total, `إجمالي قيمة المزايا والمنح والدعم المقدّم للأعضاء (${esc(yrLbl)})`) + edGrid([
      [4, 'إجمالي عدد المستفيدين', `<b>${numAr(r.beneficiaries || 0)} عضو</b>`],
      [4, 'متوسط نصيب المستفيد', `<b>${money((+r.total || 0) / Math.max(1, +r.beneficiaries || 1))} ج.م</b>`],
      [4, 'النطاق الزمني للتقرير', `<b>${esc(yrLbl)}</b>`],
    ]) + `<div class="ed-sec">أولاً: توزيع المزايا والدعم حسب البند ونوع الخدمة</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:36px">م</th><th>بند الميزة / الخدمة</th><th class="c">التصنيف</th><th class="c">عدد المستفيدين</th><th class="n">إجمالي القيمة (ج.م)</th></tr></thead><tbody>${catRows}</tbody></table>
      <div class="ed-sec">ثانياً: بيان الإفصاح والشفافية لما تقاضاه أو استفاد به أعضاء مجلس الإدارة خلال عضويتهم</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:36px">م</th><th>اسم عضو المجلس</th><th>الصفة بالمجلس</th><th>تفصيل النوع</th><th class="n">الإجمالي (ج.م)</th></tr></thead><tbody>${brdRows}</tbody></table>`
  });
}

function summerManifestReportHTML(s = S.season, items = S.sumApps, m = S.sumSum) {
  if (!s) return '';
  const list = (items || []).filter(a => !['مسحوب', 'ملغى'].includes(a.status));
  const rows = list.map((a, i) => {
    const rest = Math.max(0, (+a.member_price || 0) - (+a.paid || 0));
    return `<tr>
      <td class="c">${numAr(i + 1)}</td>
      <td class="c"><span class="dt">${esc(a.app_no)}</span></td>
      <td><b>${esc(a.person?.full_name || '')}</b> <small class="muted">(${esc(a.person?.job_id || '—')})</small></td>
      <td>${a.alloc ? `${esc(a.alloc.batch || '')} — ${esc(a.alloc.resort || '')} (${esc(a.alloc.unit || '')})` : 'احتياطي / لم يُخصّص'}</td>
      <td class="c">${esc(a.status)}</td>
      <td class="n">${a.member_price != null ? money(a.member_price) : '—'}</td>
      <td class="n"><b>${money(a.paid)}</b></td>
      <td class="n">${a.member_price != null ? money(rest) : '—'}</td>
      <td class="n">${+a.deposit_paid ? money(a.deposit_paid) : '—'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="c">لا توجد طلبات مسجّلة بالموسم</td></tr>';
  return erpDoc({
    dept: 'لجنة المصايف والنشاط الصيفي · الإسكان والتحصيل', kind: 'كشف إسكان وتحصيل المصيف', code: 'SUM-MAN',
    refLbl: 'سنة الموسم', refNo: String(s.year || ''),
    title: `كشف تخصيص الوحدات والأفواج والتحصيل المالي — ${esc(s.title)}`,
    sub: `طريقة التخصيص: ${esc(s.method)} · الحالة: ${esc(s.status)}${s.lottery_seed ? ' · البذرة المعلنة: ' + esc(s.lottery_seed) : ''}`,
    status: esc(s.status), statusCls: 'ok',
    body: edGrid([
      [3, 'إجمالي الخانات / مقبول', `${numAr(s.total_slots)} / <b>${numAr((m || {}).accepted || 0)}</b>`],
      [3, 'الاشتراكات المحصّلة', `<b>${money((m || {}).collected || 0)} ج.م</b>`],
      [3, 'دعم اللجنة النقابية', `<b>${money((m || {}).subsidy || 0)} ج.م</b>`],
      [3, 'التأمينات المحصّلة', `<b>${money((m || {}).deposits_held || 0)} ج.م</b>`],
    ]) + `<div class="ed-sec">كشف الأعضاء والوحدات المخصّصة وموقف السداد والتأمين (${numAr(list.length)} طلب)</div>
      <table class="ed-tbl"><thead><tr><th class="c" style="width:32px">م</th><th class="c" style="width:94px">رقم الطلب</th><th>اسم العضو</th><th>الفوج والقرية والوحدة</th><th class="c">الحالة</th><th class="n">المطلوب</th><th class="n">المسدّد</th><th class="n">المتبقي</th><th class="n">التأمين</th></tr></thead><tbody>${rows}</tbody></table>`
  });
}

function settlementsView() {
  const items = S.openAdv || [], drafts = S.stlDrafts || [], carries = S.stlCarries || [], hist = S.stlItems || [];
  const today = new Date(), age = c => Math.floor((today - new Date(c.issue_date)) / 864e5);
  const tot = items.reduce((a, c) => a + +c.amount, 0), over30 = items.filter(c => age(c) > 30);
  const approved = hist.filter(s => s.status === 'معتمدة');
  const totRetOrCarry = approved.reduce((a, s) => a + (+s.returned || 0) + (s.return_mode === 'ترحيل' ? Math.max(0, (+s.advance || 0) + (+s.prev_balance || 0) + (+s.subscriptions || 0) - (+s.spent || 0)) : 0), 0);
  const byParty = {}; items.forEach(c => { byParty[c.payee_name] = (byParty[c.payee_name] || 0) + +c.amount; });
  const canStl = can('treasury.settlement'), canRev = can('finance.journal');
  const openIssued = items.filter(c => c.status === 'صادر');
  const kpi = (i, v, l, cls = '') => `<div class="kpi ${cls}"><i>${i}</i><div><b>${v}</b><small>${l}</small></div></div>`;
  const chqList = arr => (arr || []).map(x => `<a href="#/cheque/${x.id}">${esc(x.cheque_no || 'بدون رقم')}</a>`).join(' + ') || '—';
  return finTabs('#/settlements') + `<div class="kpis">${kpi('🧾', money(tot), `عُهد وسلف مفتوحة (${numAr(items.length)})`, items.length ? 'warn' : 'ok')}
      ${kpi('⏳', numAr(over30.length), 'متأخرة +30 يوماً', over30.length ? 'warn' : 'ok')}${kpi('📝', numAr(drafts.length), 'مسودات محفوظة', drafts.length ? 'warn' : '')}
      ${kpi('✅', numAr(approved.length), 'تسويات معتمدة', 'ok')}
      ${kpi('🔄', money(totRetOrCarry), `مرتد أو مرحّل (${numAr(carries.length)} جاهز للترحيل)`, carries.length ? 'warn' : '')}</div>
    <div class="card"><div class="muted">من هنا تسوّي عهدة بشيك واحد أو <b>تسوية مجمّعة لعدة شيكات</b>، وتجلب أي <b>رصيد مرحّل سابق آلياً</b>، وتحفظ <b>مسودة</b> قبل الاعتماد، وتسترجع أي تسوية معتمدة <b>بقيد عكسي</b> عند الخطأ.</div>
      <div class="row" style="margin-top:8px;gap:8px">${canStl && openIssued.length ? '<button class="btn sm gold" data-act="stlPick">+ تسوية شيك مفرد / تسوية مجمّعة</button>' : ''}
        <button class="btn sm sec" type="button" data-act="stlRepPick">🖨️ طباعة كشف تسوية (مفردة / مجمّعة)</button>
        <button class="btn sm sec" data-act="advPrint">🖨️ طباعة كشف العهد المفتوحة</button></div></div>
    ${drafts.length ? `<div class="card"><h2>📝 مسودات التسوية المحفوظة (${numAr(drafts.length)})</h2>
      ${drafts.map(d => `<div class="kv" style="align-items:center"><div><b>${esc(d.payee_name)}</b> — شيكات: ${chqList(d.cheques)}
        <div class="muted" style="font-size:13px">العهدة ${money(d.advance)}${+d.prev_balance ? ' + مرحّل ' + money(d.prev_balance) : ''} · مصروف مسجّل ${money(d.spent)}</div></div>
        <div class="row" style="gap:6px"><button class="btn sm sec" data-stlprt="${d.id}">🖨️ معاينة الكشف</button>${canStl ? `<button class="btn sm gold" data-stopen="${d.cheque_id}">✏️ استكمال</button><button class="btn sm bad" data-stddel="${d.id}">🗑️ حذف</button>` : ''}</div></div>`).join('')}</div>` : ''}
    ${carries.length ? `<div class="card"><h2>🔄 أرصدة مرحّلة جاهزة للترحيل الآلي (${numAr(carries.length)})</h2>
      <div class="muted" style="margin-bottom:6px">تظهر تلقائياً عند تسوية العهدة التالية لنفس صاحب العهدة وتُستخدم مرة واحدة.</div>
      ${carries.map(x => kvh(`<b>${esc(x.payee_name)}</b> — شيك <a href="#/cheque/${x.cheque_id}">${esc(x.cheque_no || 'بدون رقم')}</a> (${dt(x.settle_date)})`, `<b>${money(x.amount)}</b>`)).join('')}</div>` : ''}
    ${grid('adv', [
      { t: 'التاريخ', v: c => dt(c.issue_date), raw: c => c.issue_date },
      { t: 'رقم الشيك', v: c => esc(c.cheque_no || '—'), raw: c => c.cheque_no || '' },
      { t: 'صاحب العهدة', v: c => `<b>${esc(c.payee_name)}</b>`, raw: c => c.payee_name },
      { t: 'البيان', v: c => esc(c.notes || '—'), raw: c => c.notes || '' },
      { t: 'المبلغ', v: c => money(c.amount), raw: c => +c.amount, num: true },
      { t: 'العمر', v: c => { const a = age(c); return `<span class="pill ${a > 90 ? 'bad' : a > 30 ? 'warn' : 'ok'}">${numAr(a)} يوم</span>`; }, raw: c => age(c), num: true },
      { t: 'الحالة', v: c => stPill(c.status) + (c.draft_id ? ' <span class="pill warn">مسودة</span>' : ''), raw: c => c.status },
      { t: 'إجراء', v: c => canStl && c.status === 'صادر' ? `<button class="btn sm gold" data-stopen="${c.id}">${c.draft_id ? '✏️ مسودة' : 'تسوية'}</button>` : '', raw: () => '' },
    ], items, { title: '🧮 العُهد والسلف تحت التسوية', file: 'open-advances', attr: c => `data-chq="${c.id}"`, empty: 'لا عُهد مفتوحة 👌',
      foot: `<tr><td colspan="4"><b>الإجمالي</b></td><td class="n"><b>${money(tot)}</b></td><td colspan="3"></td></tr>` })}
    ${grid('stl', [
      { t: 'تاريخ التسوية', v: s => dt(s.settle_date), raw: s => s.settle_date },
      { t: 'صاحب العهدة', v: s => `<b>${esc(s.payee_name)}</b>`, raw: s => s.payee_name },
      { t: 'الشيكات', v: s => chqList(s.cheques) + ((s.cheques || []).length > 1 ? ` <span class="pill ok">مجمّعة (${numAr(s.cheques.length)})</span>` : ''), raw: s => (s.cheques || []).map(x => x.cheque_no).join('+') },
      { t: 'العهدة', v: s => money(s.advance) + (+s.prev_balance ? `<div class="muted" style="font-size:12px">+ مرحّل ${money(s.prev_balance)}${s.carried_from_no ? ' (' + esc(s.carried_from_no) + ')' : ''}</div>` : ''), raw: s => +s.advance, num: true },
      { t: 'المصروف', v: s => money(s.spent), raw: s => +s.spent, num: true },
      { t: 'المتبقي/التصرف', v: s => +s.returned ? `${money(s.returned)} <small class="muted">${esc(s.return_mode)}</small>` : s.return_mode === 'ترحيل' ? `<span class="pill warn">ترحيل ${money(+s.advance + +s.prev_balance + +s.subscriptions - +s.spent)}</span>` : '—', raw: s => s.return_mode },
      { t: 'الحالة', v: s => stPill(s.status) + (s.reverse_reason ? `<div class="muted" style="font-size:12px">${esc(s.reverse_reason)}</div>` : ''), raw: s => s.status },
      { t: 'إجراءات', v: s => `<div class="row" style="gap:4px"><button class="btn sm gold" data-stlprt="${s.id}">🖨️ كشف التسوية</button>${s.entry_id ? `<button class="btn sm sec" data-entry="${s.entry_id}">القيد</button>` : ''}${s.reverse_entry_id ? `<button class="btn sm sec" data-entry="${s.reverse_entry_id}">قيد العكس</button>` : ''}${s.status === 'معتمدة' && canRev ? `<button class="btn sm bad" data-strev="${s.id}">↩️ استرجاع</button>` : ''}</div>`, raw: () => '' },
    ], hist, { title: '📋 سجل التسويات (المعتمدة والمسترجعة)', file: 'settlements', attr: s => `data-chq="${s.cheque_id}"`, empty: 'لا تسويات مسجّلة' })}
    <div class="card"><h2>👥 العُهد المفتوحة حسب صاحب العهدة</h2>${bars(byParty, true)}</div>`;
}


// ───────── حصة الاشتراكات (6/3/1) واللائحة المالية ─────────
function duesView() {
  const d = S.dues || {}, sp = d.split || { total: 10, local: 6, general: 3, federation: 1 }, ed = S.duesEdit;
  const next = d.lastTo ? new Date(new Date(d.lastTo).getTime() + 864e5).toISOString().slice(0, 7) : '';
  const kpi = (i, v, l, c = '') => `<div class="kpi ${c}"><i>${i}</i><div><b>${v}</b><small>${l}</small></div></div>`;
  return finTabs('#/dues') + `<div class="card"><h2>🧮 اشتراك المرتب الشهري (${numAr(sp.total)} ج للعضو)</h2>
      <div class="kpis" style="margin:0">${kpi('🏢', numAr(sp.local) + ' ج', 'نصيب اللجنة — إيراد اللجنة', 'ok')}${kpi('🏛️', numAr(sp.general) + ' ج', 'النقابة العامة — لا يُثبت عندنا')}${kpi('🏷️', numAr(sp.federation) + ' ج', 'حصة مركزية / أخرى — لا تُثبت عندنا')}</div>
      <div class="muted" style="margin-top:8px">النقابة العامة تحصّل الاستقطاع من المرتبات وتحوّل نصيب اللجنة (${numAr(sp.local)} ج/عضو/شهر) لحساب اللجنة كل 3–4 شهور. اللجنة تُثبت <b>الاستحقاق</b> شهرياً (مدين: مستحق من النقابة العامة 1204 / دائن: إيراد 4102) ثم <b>الوارد</b> عند التحويل (مدين: البنك / دائن: 1204)، فيظهر ما لم يُحوَّل بعد كرصيد مستحق.</div></div>
    <div class="kpis">${kpi('👥', numAr(d.membersNow), 'أعضاء النقابة العامة النشطون الآن')}${kpi('📈', money(d.accrued), 'إجمالي المستحق')}${kpi('📥', money(d.received), 'الوارد فعلاً', 'ok')}
      ${kpi('⏳', money(d.outstanding), 'لم يُحوَّل بعد (رصيد 1204)', +d.outstanding > 0 ? 'warn' : 'ok')}</div>
    ${ed ? `<div class="card"><h2>➕ إثبات استحقاق فترة</h2><form id="duesf" class="row">
      <label style="flex:1;min-width:130px"><span class="muted" style="font-size:12px">أول شهر</span><input class="input" type="month" name="from" value="${esc(next)}" required></label>
      <label style="flex:1;min-width:100px"><span class="muted" style="font-size:12px">عدد الشهور</span><input class="input" type="number" name="months" min="1" max="12" value="3" required></label>
      <label style="flex:1;min-width:130px"><span class="muted" style="font-size:12px">عدد المستقطع منهم (اختياري)</span><input class="input" type="number" name="members" min="0" placeholder="${esc(d.membersNow)} محسوب"></label>
      <label style="flex:2;min-width:160px"><span class="muted" style="font-size:12px">مصدر العدد</span><input class="input" name="basis" placeholder="كشف الاستقطاع من النقابة العامة"></label>
      <button class="btn" style="align-self:flex-end">إثبات الاستحقاق</button></form>
      <div class="muted" style="margin-top:6px">الأصح إدخال العدد الفعلي من كشف الاستقطاع؛ لو فاضي يُحسب من المنظومة (النقابة العامة + نشط في منتصف الفترة).</div><div id="duesErr"></div></div>
    <div class="card row"><button class="btn sec" data-act="duesRcpt">📥 تسجيل وارد حصة الاشتراكات (تحويل النقابة العامة)</button></div>` : ''}
    ${grid('dues', [
      { t: 'الفترة', v: x => `${dt(x.from)} ← ${dt(x.to)}`, raw: x => x.from },
      { t: 'الشهور', v: x => numAr(x.months), raw: x => x.months, num: true },
      { t: 'الأعضاء', v: x => `${numAr(x.members)}${x.members !== x.members_calc ? ` <small class="muted">(محسوب ${numAr(x.members_calc)})</small>` : ''}`, raw: x => x.members, num: true },
      { t: 'المصدر', v: x => esc(x.basis || ''), raw: x => x.basis || '' },
      { t: 'المستحق', v: x => money(x.amount), raw: x => +x.amount, num: true },
      { t: 'الوارد منه', v: x => money(x.paid), raw: x => +x.paid, num: true },
      { t: 'الحالة', v: x => +x.paid >= +x.amount - 0.005 ? '<span class="pill ok">محوَّل</span>' : +x.paid > 0 ? '<span class="pill warn">جزئي</span>' : '<span class="pill bad">لم يُحوَّل</span>', raw: x => +x.paid >= +x.amount ? 'محوّل' : 'لم يُحوَّل' },
    ], d.periods, { title: '📅 فترات الاستحقاق', file: 'dues-periods', attr: x => x.entry_id ? `data-entry="${x.entry_id}"` : '', empty: 'لم تُثبت أي فترة بعد' })}
    <div class="card"><h2>📥 التحويلات الواردة</h2>${(d.receipts || []).map(r => kvh(`${dt(r.date)} <small class="muted">${esc(r.no)}${r.notes ? ' · ' + esc(r.notes) : ''}</small>`, money(r.amount))).join('') || '<div class="empty">لا تحويلات مسجّلة</div>'}</div>`;
}
function periodsView() {
  const data = S.periods || { years: [], canClose: false, isAdmin: false };
  const yrs = data.years || [];
  const moNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return finTabs('#/periods') + `<div class="card">
      <h2>🔒 إقفال الفترات المحاسبية والسنوات المالية</h2>
      <div class="muted">إقفال أي شهر يمنع إدخال أو تعديل أي قيود محاسبية داخل ذلك الشهر (التصحيح لاحقاً يتم بقيد عكسي في فترة مفتوحة). أما <b>إقفال السنة المالية</b> فيُرحّل تلقائياً صافي الفائض أو العجز من الإيرادات (4xxx) والمصروفات (5xxx) إلى حـ/ <b>3201 فائض/عجز سنوات سابقة</b> ويُقفل الأشهر الـ 12 بالكامل.</div>
    </div>`
    + yrs.map(y => {
      const net = (+y.revenues || 0) - (+y.expenses || 0);
      const isClosedYr = !!y.closing_entry_id;
      return `<div class="card">
        <div class="row" style="align-items:center;gap:8px;flex-wrap:wrap">
          <h2 style="margin:0">📅 السنة المالية ${numAr(y.year)}</h2>
          <span class="pill">${numAr(y.entries_count)} قيد مرحّل</span>
          <span class="pill ${y.closed_months === 12 ? 'ok' : 'warn'}">${numAr(y.closed_months)} / ١٢ شهر مقفول</span>
          ${isClosedYr ? `<span class="pill ok">✓ مقفولة سنوياً (${esc(y.closing_entry_no || 'قيد إقفال')})</span>` : ''}
          ${+y.draft_settlements ? `<span class="pill bad">⚠️ ${numAr(y.draft_settlements)} مسودة تسوية معلّقة</span>` : ''}
          <span class="sp"></span>
          ${isClosedYr
            ? `<button class="btn sm sec" data-entry="${y.closing_entry_id}">📒 عرض قيد الإقفال</button>`
            : data.canClose ? `<button class="btn sm gold" data-yrclose="${y.year}" ${+y.draft_settlements ? 'disabled title="اعتمد أو احذف مسودات التسوية أولاً"' : ''}>🔒 إقفال سنة ${numAr(y.year)} وترحيل الفائض/العجز</button>` : ''}
        </div>
        <div class="kpis" style="margin:10px 0 6px">
          <div class="kpi ok"><i>📈</i><div><b>${money(y.revenues)} ج</b><small>إجمالي إيرادات ${numAr(y.year)}</small></div></div>
          <div class="kpi warn"><i>📉</i><div><b>${money(y.expenses)} ج</b><small>إجمالي مصروفات ${numAr(y.year)}</small></div></div>
          <div class="kpi ${net >= 0 ? 'ok' : 'bad'}"><i>⚖️</i><div><b>${money(net)} ج</b><small>${net >= 0 ? 'صافي الفائض القابل للترحيل (3201)' : 'صافي العجز المرحّل (3201)'}</small></div></div>
        </div>
        <div class="period-grid">${(y.months || []).map(m => {
          const cl = m.status === 'مقفولة';
          const dis = cl ? !data.isAdmin : !data.canClose;
          return `<button type="button" class="period-m ${cl ? 'closed' : ''}" data-ptog="${y.year}-${m.month}" data-pst="${cl ? 'مفتوحة' : 'مقفولة'}" ${dis ? 'disabled' : ''}>
            <b>${moNames[m.month - 1]}</b>
            <small>${cl ? '🔒 مقفول' : '🔓 مفتوح'}</small>
          </button>`;
        }).join('')}</div>
      </div>`;
    }).join('');
}

function policyView() {
  const items = S.pol || [], ed = S.polEdit;
  return finTabs('#/policy') + `<div class="card"><h2>📜 اللائحة المالية — حدود بنود الصرف</h2>
      <div class="muted">لكل بند مصروف: حد الصرف الواحد، والسقف السنوي، واشتراط قرار المجلس، وجهة الاعتماد، والمستندات، ورقم المادة. المنظومة تتحقق عند صرف الشيك وعند التسوية: «منع» يوقف العملية، و«تنبيه» يسمح مع التنبيه. أدخل القيم من اللائحة المعتمدة فقط.</div></div>
    ${grid('pol', [
      { t: 'البند', v: x => `<b>${esc(x.account)}</b> ${esc(x.name)}`, raw: x => x.account },
      { t: 'حد الصرف الواحد', v: x => x.policy && x.policy.max_per_txn ? money(x.policy.max_per_txn) : '<span class="muted">—</span>', raw: x => +(x.policy || {}).max_per_txn || 0, num: true },
      { t: 'السقف السنوي', v: x => x.policy && x.policy.annual_cap ? money(x.policy.annual_cap) : '<span class="muted">—</span>', raw: x => +(x.policy || {}).annual_cap || 0, num: true },
      { t: 'المصروف هذا العام', v: x => { const cap = +(x.policy || {}).annual_cap; return money(x.spent) + (cap ? ` <small class="muted">(${Math.round(100 * x.spent / cap)}%)</small>` : ''); }, raw: x => +x.spent, num: true },
      { t: 'قرار مجلس', v: x => x.policy ? (x.policy.requires_decision ? '✅' : '—') : '<span class="muted">غير محدد</span>', raw: x => x.policy && x.policy.requires_decision ? 'نعم' : 'لا' },
      { t: 'التطبيق', v: x => x.policy ? `<span class="pill ${x.policy.enforce === 'منع' ? 'bad' : 'warn'}">${esc(x.policy.enforce)}</span>${x.policy.active ? '' : ' <span class="pill">موقوف</span>'}` : '', raw: x => (x.policy || {}).enforce || '' },
      { t: 'المادة', v: x => esc((x.policy || {}).article_ref || ''), raw: x => (x.policy || {}).article_ref || '' },
    ], items, { title: 'بنود المصروفات', file: 'financial-policy', attr: x => ed ? `data-pol="${esc(x.account)}"` : '', empty: 'لا بنود' })}
    ${ed ? '<div class="muted card">اضغط على أي بند لتعديل حدوده.</div>' : ''}`;
}
function policyForm(x) {
  const p = x.policy || { requires_decision: false, enforce: 'منع', active: true };
  return `<h3>${esc(x.account)} — ${esc(x.name)}</h3><form id="polf">
    <div class="grid2"><label class="f"><span>حد الصرف الواحد (فاضي = بلا حد)</span><input class="input" name="max_per_txn" inputmode="decimal" value="${esc(p.max_per_txn || '')}"></label>
      <label class="f"><span>السقف السنوي (فاضي = بلا سقف)</span><input class="input" name="annual_cap" inputmode="decimal" value="${esc(p.annual_cap || '')}"></label></div>
    <div class="grid2"><label class="f"><span>جهة الاعتماد</span><input class="input" name="approver" value="${esc(p.approver || '')}" placeholder="مثال: مجلس الإدارة / الرئيس وأمين الصندوق"></label>
      <label class="f"><span>رقم المادة في اللائحة</span><input class="input" name="article_ref" value="${esc(p.article_ref || '')}"></label></div>
    <label class="f"><span>المستندات المطلوبة</span><input class="input" name="required_docs" value="${esc(p.required_docs || '')}" placeholder="فاتورة ضريبية، قرار، كشف توقيع المستفيدين…"></label>
    <div class="grid2"><label class="f"><span>التطبيق</span><select class="input" name="enforce">${options(['منع', 'تنبيه'], p.enforce, false)}</select></label>
      <label class="f"><span>ملاحظات</span><input class="input" name="notes" value="${esc(p.notes || '')}"></label></div>
    <label class="f"><input type="checkbox" name="requires_decision" ${p.requires_decision ? 'checked' : ''}> يشترط قرار مجلس</label>
    <label class="f"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''}> البند مفعّل</label>
    <label class="f"><span>سبب التعديل / رقم قرار اعتماد اللائحة</span><input class="input" name="reason" required></label>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">حفظ</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}

// ───────── العمليات المالية (قيد يدوي منضبط) والأطراف الخارجية ─────────
const JTPL = {
  'مصروف نقدي من الخزينة': [['exp', 'debit'], ['1101', 'credit']],
  'مصروف من البنك (تحويل/خصم مباشر)': [['exp', 'debit'], ['1102', 'credit']],
  'إيداع نقدية الخزينة في البنك': [['1102', 'debit'], ['1101', 'credit']],
  'سحب من البنك للخزينة': [['1101', 'debit'], ['1102', 'credit']],
  'قيد يومية حر (متعدد الأطراف)': null,
};
function journalView() {
  const t = S.jTpl || 'مصروف نقدي من الخزينة', acc = (S.accounts || []).filter(a => a.postable), tpl = JTPL[t];
  const accOpts = (sel, only) => acc.filter(a => !only || a.type === only).map(a => `<option value="${a.code}" ${a.code === sel ? 'selected' : ''}>${a.code} — ${esc(a.name)}</option>`).join('');
  const decs = (S.allDecs || []).map(d => `<option value="${d.id}">${esc(d.decision_no)} — ${esc(String(d.text).slice(0, 60))}</option>`).join('');
  const lineRow = (a = '', side = 'debit') => `<div class="row jl" style="margin-bottom:6px"><select class="input" name="jacc" style="flex:3">${accOpts(a)}</select>
      <input class="input" name="jdr" inputmode="decimal" placeholder="مدين" style="flex:1" ${side === 'debit' ? '' : 'value=""'}><input class="input" name="jcr" inputmode="decimal" placeholder="دائن" style="flex:1">
      <input class="input" name="jparty" placeholder="الطرف" list="partyList" style="flex:2"></div>`;
  return finTabs('#/journal') + `<div class="card"><h2>✍️ عملية مالية</h2>
      <div class="muted">كل عملية تُسجَّل <b>قيداً مرحّلاً متوازناً لا يُعدَّل</b> (التصحيح بقيد عكسي)، وتخضع للائحة المالية، ويُرفق مستندها بعد التسجيل من شاشة القيد/الأرشيف. استخدم القيد الحر للتسويات المحاسبية فقط.</div>
      <div class="chips" style="margin-top:10px">${Object.keys(JTPL).map(k => `<button class="btn sm ${k === t ? '' : 'sec'}" data-jtpl="${esc(k)}">${esc(k)}</button>`).join('')}</div></div>
    <div class="card"><form id="jf">
      <div class="grid2"><label class="f"><span>التاريخ</span><input class="input" type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="f"><span>قرار المجلس (لو البند يشترطه)</span><select class="input" name="decision_id"><option value="">— بدون —</option>${decs}</select></label></div>
      <label class="f"><span>البيان</span><input class="input" name="description" required placeholder="مثال: شراء أدوات مكتبية بفاتورة رقم …"></label>
      ${tpl ? `<div class="grid2"><label class="f"><span>${tpl[0][0] === 'exp' ? 'بند المصروف' : 'من / إلى'}</span>${tpl[0][0] === 'exp' ? `<select class="input" name="exp">${accOpts(null, 'مصروفات')}</select>` : `<input class="input" disabled value="${esc(tpl[0][0])} ⇐ ${esc(tpl[1][0])}">`}</label>
          <label class="f"><span>المبلغ</span><input class="input" name="amount" inputmode="decimal" required></label></div>
        <label class="f"><span>الطرف (المورد/المستلم)</span><input class="input" name="party" list="partyList"></label>`
        : `<b>السطور</b><div id="jls">${lineRow()}${lineRow('', 'credit')}</div><button class="btn sm sec" type="button" data-act="jlAdd">+ سطر</button><div class="alert" id="jbal" style="margin-top:8px"></div>`}
      <div id="polMsg"></div><div id="ferr"></div><button class="btn" type="submit" style="margin-top:8px">تسجيل وترحيل</button></form>
      <datalist id="partyList">${(S.partyNames || []).map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>`;
}
function journalLines(f) {
  const t = S.jTpl || 'مصروف نقدي من الخزينة', tpl = JTPL[t];
  if (tpl) { const amt = +f.amount.value, acc = x => x === 'exp' ? f.exp.value : x;
    return tpl.map(([a, side]) => ({ account: acc(a), [side]: amt, party: f.party.value.trim() || null })); }
  return [...f.querySelectorAll('.jl')].map(r => ({ account: r.querySelector('[name=jacc]').value, debit: +r.querySelector('[name=jdr]').value || 0,
    credit: +r.querySelector('[name=jcr]').value || 0, party: r.querySelector('[name=jparty]').value.trim() || null })).filter(l => l.debit || l.credit);
}
const PARTY_KINDS = ['مورد', 'شركة نقل', 'شركة سياحة', 'فندق/مصيف', 'جهة حكومية', 'بنك', 'فرد غير عضو', 'أخرى'];
function partiesView() {
  const ed = S.partiesEdit;
  return finTabs('#/parties') + `<div class="card row"><span class="muted" style="flex:1">الموردون والجهات والأفراد غير الأعضاء اللي بنصرف لهم شيكات أو نتعامل معهم. الاسم هنا يظهر اقتراحاً في نموذج الشيك والعمليات المالية، ويتجمّع له كشف بكل ما صُرف له.</span>
      ${ed ? '<button class="btn" data-act="partyNew">+ طرف جديد</button>' : ''}</div>
    ${grid('parties', [
      { t: 'الاسم', v: x => `<b>${esc(x.name)}</b>${x.active ? '' : ' <span class="pill">موقوف</span>'}`, raw: x => x.name },
      { t: 'النوع', v: x => esc(x.kind), raw: x => x.kind },
      { t: 'التليفون', v: x => x.phone ? `<span class="dt">${esc(x.phone)}</span>` : '—', raw: x => x.phone || '' },
      { t: 'رقم ضريبي/سجل', v: x => esc(x.tax_id || '—'), raw: x => x.tax_id || '' },
      { t: 'شيكات', v: x => numAr(x.cheques), raw: x => +x.cheques, num: true },
      { t: 'إجمالي المصروف له', v: x => money(x.paid), raw: x => +x.paid, num: true },
      { t: 'آخر تعامل', v: x => dt(x.last), raw: x => x.last || '' },
    ], S.parties, { title: '🏢 الأطراف الخارجية', file: 'parties', attr: x => `data-party="${esc(x.id)}"`, empty: 'لا أطراف مسجّلة بعد' })}`;
}
function partyForm(x) {
  x = x || { kind: 'مورد', active: true };
  return `<h3>${x.id ? 'تعديل طرف' : 'طرف جديد'}</h3><form id="ptf">
    <label class="f"><span>الاسم (كما يُكتب في الشيك)</span><input class="input" name="name" required value="${esc(x.name || '')}"></label>
    <div class="grid2"><label class="f"><span>النوع</span><select class="input" name="kind">${options(PARTY_KINDS, x.kind, false)}</select></label>
      <label class="f"><span>التليفون</span><input class="input" name="phone" dir="ltr" value="${esc(x.phone || '')}"></label></div>
    <div class="grid2"><label class="f"><span>رقم ضريبي/سجل تجاري</span><input class="input" name="tax_id" value="${esc(x.tax_id || '')}"></label>
      <label class="f"><span>العنوان</span><input class="input" name="address" value="${esc(x.address || '')}"></label></div>
    <label class="f"><span>ملاحظات</span><input class="input" name="notes" value="${esc(x.notes || '')}"></label>
    ${x.id ? `<label class="f"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> نشط</label>` : ''}
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">حفظ</button>${x.id ? '<button class="btn sec" type="button" data-act="partyStmt">📄 كشف حساب</button>' : ''}<button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}

// ───────── القوائم المالية (عرض وتجميع لأرصدة ميزان المراجعة المحسوبة على الخادم) ─────────
function statementsView() {
  const t = S.trial || {}, items = t.items || [], names = Object.fromEntries((S.accts || []).map(a => [a.code, a.name])), parents = Object.fromEntries((S.accts || []).map(a => [a.code, a.parent]));
  const grp = (type, val) => { const g = {}; items.filter(x => x.type === type).forEach(x => { const k = parents[x.code] || x.code.slice(0, 2), v = val(x);
      if (Math.abs(v) < 0.005) return; (g[k] = g[k] || { name: names[k] || k, total: 0, rows: [] }).total += v; g[k].rows.push([x.code, x.name, v]); });
    return Object.entries(g).sort(); };
  const tot = gs => gs.reduce((a, [, g]) => a + g.total, 0);
  const sec = (title, gs, label) => `<tr class="sh"><td colspan="2">${title}</td></tr>${gs.map(([k, g]) => `<tr class="sg"><td>${esc(k)} — ${esc(g.name)}</td><td class="n">${money(g.total)}</td></tr>
      ${g.rows.map(([c, n, v]) => `<tr class="sr" data-ledger="${c}"><td>${esc(c)} ${esc(n)}</td><td class="n">${money(v)}</td></tr>`).join('')}`).join('') || '<tr><td colspan="2" class="muted">لا حركة</td></tr>'}
    <tr class="st"><td>${label}</td><td class="n">${money(tot(gs))}</td></tr>`;
  const rev = grp('إيرادات', x => +x.credit - +x.debit), exp = grp('مصروفات', x => +x.debit - +x.credit);
  const surplus = tot(rev) - tot(exp);
  const ast = grp('أصول', x => +x.closing), lia = grp('خصوم', x => -x.closing), fnd = grp('أرصدة', x => -x.closing);
  const accum = -items.filter(x => x.type === 'إيرادات' || x.type === 'مصروفات').reduce((a, x) => a + +x.closing, 0);
  const right = tot(lia) + tot(fnd) + accum, ok = Math.abs(tot(ast) - right) < 0.01;
  return finTabs('#/statements') + `<div class="card">${periodForm(S.finP || { from: t.from, to: t.to })}
      <div class="row"><span class="muted" style="flex:1">الفترة من ${dt(t.from)} إلى ${dt(t.to)} — من القيود المرحّلة</span>
        <button class="btn sm gold" data-act="stPrint">🖨️ طباعة الميزانية والحساب الختامي (A4)</button>
        <button class="btn sm sec" data-act="tbPrint">⚖️ طباعة ميزان المراجعة</button></div></div>
    ${fsTables()}`;
}
function fsTables() {
  const t = S.trial || {}, items = t.items || [], names = Object.fromEntries((S.accts || []).map(a => [a.code, a.name])), parents = Object.fromEntries((S.accts || []).map(a => [a.code, a.parent]));
  const grp = (type, val) => { const g = {}; items.filter(x => x.type === type).forEach(x => { const k = parents[x.code] || x.code.slice(0, 2), v = val(x);
      if (Math.abs(v) < 0.005) return; (g[k] = g[k] || { name: names[k] || k, total: 0, rows: [] }).total += v; g[k].rows.push([x.code, x.name, v]); });
    return Object.entries(g).sort(); };
  const tot = gs => gs.reduce((a, [, g]) => a + g.total, 0);
  const sec = (title, gs, label) => `<tr class="sh"><td colspan="2">${title}</td></tr>${gs.map(([k, g]) => `<tr class="sg"><td>${esc(k)} — ${esc(g.name)}</td><td class="n">${money(g.total)}</td></tr>
      ${g.rows.map(([c, n, v]) => `<tr class="sr" data-ledger="${c}"><td>${esc(c)} ${esc(n)}</td><td class="n">${money(v)}</td></tr>`).join('')}`).join('') || '<tr><td colspan="2" class="muted">لا حركة</td></tr>'}
    <tr class="st"><td>${label}</td><td class="n">${money(tot(gs))}</td></tr>`;
  const rev = grp('إيرادات', x => +x.credit - +x.debit), exp = grp('مصروفات', x => +x.debit - +x.credit);
  const surplus = tot(rev) - tot(exp);
  const ast = grp('أصول', x => +x.closing), lia = grp('خصوم', x => -x.closing), fnd = grp('أرصدة', x => -x.closing);
  const accum = -items.filter(x => x.type === 'إيرادات' || x.type === 'مصروفات').reduce((a, x) => a + +x.closing, 0);
  const right = tot(lia) + tot(fnd) + accum, ok = Math.abs(tot(ast) - right) < 0.01;
  return `<div class="dgrid fs">
    <div class="card"><div class="fsh"><b>${esc(C.ORG_NAME)}</b><h2>قائمة الإيرادات والمصروفات</h2><small>عن الفترة من ${dt(t.from)} إلى ${dt(t.to)}</small></div>
      <table class="fst">${sec('الإيرادات', rev, 'إجمالي الإيرادات')}${sec('المصروفات', exp, 'إجمالي المصروفات')}
      <tr class="sf ${surplus >= 0 ? 'ok' : 'bad'}"><td>${surplus >= 0 ? 'فائض الفترة' : 'عجز الفترة'}</td><td class="n">${money(Math.abs(surplus))}</td></tr></table></div>
    <div class="card"><div class="fsh"><b>${esc(C.ORG_NAME)}</b><h2>قائمة المركز المالي</h2><small>في ${dt(t.to)}</small></div>
      <table class="fst">${sec('الأصول', ast, 'إجمالي الأصول')}${sec('الخصوم', lia, 'إجمالي الخصوم')}${sec('الأرصدة والصناديق', fnd, 'إجمالي الأرصدة')}
      <tr class="sg"><td>الفائض (العجز) المتراكم</td><td class="n">${money(accum)}</td></tr>
      <tr class="sf"><td>إجمالي الخصوم والأرصدة والفائض</td><td class="n">${money(right)}</td></tr></table>
      <div class="alert ${ok ? 'ok' : 'bad'}" style="margin-top:10px">${ok ? 'القائمة متوازنة ✓ (الأصول = الخصوم + الأرصدة + الفائض)' : 'القائمة غير متوازنة — راجع الميزان'}</div></div></div>`;
}
function trialView() {
  const t = S.trial || {}, items = t.items || [];
  const sum = k => items.reduce((a, x) => a + Number(x[k] || 0), 0);
  return finTabs('#/trial') + `<div class="card">${periodForm(S.finP || { from: t.from, to: t.to })}
    <div class="row"><span class="muted" style="flex:1">ميزان المراجعة من القيود المرحّلة</span><button class="btn sm gold" type="button" data-act="tbPrint">🖨️ طباعة ميزان المراجعة بالمجاميع والأرصدة (A4)</button></div></div>
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
  return `<div class="row" style="margin-bottom:10px"><a href="#/trial" class="btn sm sec" style="text-decoration:none">→ الميزان</a>
    <button class="btn sm sec" type="button" data-act="opsRepOpen">🖨️ كشف حساب العمليات والشيكات</button></div>
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
  return finTabs('#/entries') + `<div class="card"><form id="ef" class="row"><input class="input" style="flex:1" name="q" value="${esc((S.entF || {}).q || '')}" placeholder="بحث في البيان أو رقم القيد"><button class="btn">بحث</button>
    <button class="btn sec" type="button" data-act="opsRepOpen">🖨️ كشف حساب العمليات والشيكات</button></form></div>
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
    ${docsBox('entry', e.id, '📎 مستندات القيد').replace('class="card docbox"', 'class="docbox inl"')}
    <div class="acts">${e.status === 'مرحّل' && can('finance.journal') ? '<button class="btn bad" data-act="revEntry">قيد عكسي</button>' : ''}
      <button class="btn sec" type="button" data-close>إغلاق</button></div>`;
}
function chequeForm(nextNo = '') {
  const today = new Date().toISOString().slice(0, 10);
  const decs = (S.decOpts || []).map(d => `<option value="${d.id}">${esc(d.decision_no)} — ${esc(String(d.text || '').slice(0, 65))}</option>`).join('');
  return `<h3>⚡ إصدار شيك بنكي مباشر</h3>
    <div class="alert warn" style="margin-bottom:10px;font-size:12.5px">💡 <b>تنبيه رقابي:</b> يُفضَّل استخدام «طلب صرف واستخراج شيك» لتوثيق دورة المراجعة وفصل المهام. يُستخدم الإصدار المباشر للحالات العاجلة المعتمدة فقط ويُرحِّل القيد فوراً.</div>
    <form id="chf">
    <div class="form-sec"><div class="form-sec-hd"><span>🧾 بيانات الشيك والمستفيد</span>${nextNo ? `<small class="muted">الرقم المقترح من الدفتر النشط: <b class="dt">${esc(nextNo)}</b></small>` : ''}</div>
      <div class="grid3">
        <label class="f"><span>طبيعة الصرف</span><select class="input" name="purpose" id="chPurpose">${options(PURPOSES, 'عهدة', false)}</select></label>
        <label class="f"><span>المبلغ (ج.م)</span><input class="input" name="amount" inputmode="decimal" required placeholder="0.00"></label>
        <label class="f"><span>تاريخ الإصدار</span><input class="input" type="date" name="date" value="${today}" required></label>
      </div>
      <div class="grid2">
        <label class="f"><span>المستفيد (الاسم كما يُحرر في الشيك)</span><input class="input" name="payee_name" required list="partyList2" placeholder="اسم العضو أو المورد أو الجهة"><datalist id="partyList2">${(S.partyNames || []).map(n => `<option value="${esc(n)}">`).join('')}</datalist></label>
        <label class="f"><span>رقم الشيك البنكي</span><input class="input" name="cheque_no" inputmode="numeric" dir="ltr" value="${esc(nextNo || '')}" placeholder="من دفتر الشيكات النشط"></label>
      </div>
      <div class="grid2">
        <label class="f"><span>الرقم الوظيفي (اختياري — إن كان عضواً)</span><input class="input" name="person_job" inputmode="numeric" dir="ltr" placeholder="مثال: 97117"></label>
        <label class="f" id="chAcc"><span>بند / حساب المصروف</span><select class="input" name="expense_account">${(S.accounts || []).filter(a => a.postable && a.type === 'مصروفات')
          .map(a => `<option value="${a.code}">${a.code} — ${esc(a.name)}</option>`).join('')}</select></label>
      </div>
    </div>
    <div class="form-sec"><div class="form-sec-hd"><span>⚖️ السند الإداري والبيان</span></div>
      <label class="f"><span>قرار مجلس الإدارة (اختياري — للصرف غير اللائحي أو الاستثنائي فقط)</span><select class="input" name="decision_id"><option value="">— بدون قرار (صرف لائحي / ضمن الصلاحية المعتمدة) —</option>${decs}</select></label>
      <label class="f"><span>البيان التفصيلي للصرف</span><input class="input" name="notes" placeholder="وذلك قيمة…"></label>
    </div>
    <div id="chqCustAlert"></div><div id="polMsg"></div><div id="ferr"></div>
    <div class="acts"><button class="btn gold" type="submit">🧾 إصدار الشيك وترحيل القيد</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}

function payReqForm() {
  const today = new Date().toISOString().slice(0, 10);
  const decs = (S.decOpts || []).map(d => `<option value="${d.id}">${esc(d.decision_no)} — ${esc(String(d.text || '').slice(0, 65))}</option>`).join('');
  const accs = (S.accounts || []).filter(a => a.postable && a.type === 'مصروفات')
    .map(a => `<option value="${a.code}">${a.code} — ${esc(a.name)}</option>`).join('');
  return `<h3>📝 طلب صرف واستخراج شيك بنكي (إذن صرف)</h3>
    <div class="alert" style="margin-bottom:10px;font-size:12.5px">🛡️ <b>الدورة المالية والمحاسبية السليمة:</b> يُسجَّل الطلب للمراجعة والاعتماد مع فصل المهام، <b>ولا يُرحَّل أي قيد محاسبي</b> إلا عند استخراج الشيك الفعلي بعد الاعتماد.</div>
    <form id="prqf">
      <div class="form-sec"><div class="form-sec-hd"><span>👤 الجهة / المستفيد وطبيعة الصرف</span></div>
        <div class="grid3">
          <label class="f"><span>طبيعة الصرف</span><select class="input" name="purpose" id="prqPurpose">${options(PAY_PURPOSES, 'مصروف', false)}</select></label>
          <label class="f"><span>المبلغ المطلوب (ج.م)</span><input class="input" name="amount" inputmode="decimal" required placeholder="0.00"></label>
          <label class="f"><span>تاريخ الطلب</span><input class="input" type="date" name="date" value="${today}" required></label>
        </div>
        <label class="f" id="prqSettleWrap" hidden style="flex-direction:row;align-items:center;gap:8px;margin-top:6px"><input type="checkbox" name="requires_settlement" id="prqSettle"> <span>يُصرف كسلفة / عهدة نشاط تحت التسوية (يُقيد على حساب 1103 لحين تقديم الفواتير)</span></label>
        <div class="grid2" style="margin-top:6px">
          <div class="f"><span>بحث سريع عن عضو (اختياري — بالاسم أو الرقم الوظيفي)</span>
            <div class="mlookup"><input class="input" id="prqMemQ" autocomplete="off" placeholder="🔎 اكتب اسم العضو أو رقمه الوظيفي…"><div class="mlookup-list" id="prqMemList" hidden></div></div>
            <input type="hidden" name="person_id" id="prqPid">
            <div id="prqPicked"></div>
          </div>
          <label class="f"><span>اسم المستفيد كما يُكتب في الشيك (عضو / مورد / جهة)</span>
            <input class="input" name="payee_name" id="prqPayee" required list="partyListReq" placeholder="اسم المستفيد أو الشركة الموردة">
            <datalist id="partyListReq">${(S.partyNames || []).map(n => `<option value="${esc(n)}">`).join('')}</datalist>
          </label>
        </div>
      </div>
      <div class="form-sec"><div class="form-sec-hd"><span>📒 التوجيه المحاسبي والمستندات المؤيدة</span></div>
        <div class="grid2">
          <label class="f" id="prqAcc"><span>بند المصروف بالموازنة ودليل الحسابات</span><select class="input" name="expense_account">${accs}</select></label>
          <label class="f"><span>المستندات المؤيدة المرفقة</span><input class="input" name="supporting_docs" placeholder="مثال: فاتورة ضريبية رقم … / ٣ عروض أسعار / مذكرة عرض"></label>
        </div>
        <label class="f"><span>البيان التفصيلي والغرض من استخراج الشيك</span><textarea class="input" name="description" rows="2" required placeholder="اكتب تفاصيل العملية والغرض من الصرف بوضوح…"></textarea></label>
        <label class="f"><span>قرار مجلس الإدارة (اختياري — للصرف غير اللائحي أو لتجاوز حد الاعتماد المباشر)</span>
          <select class="input" name="decision_id"><option value="">— بدون قرار مجلس (صرف لائحي / ضمن الصلاحية المالية) —</option>${decs}</select></label>
      </div>
      <div id="polMsg"></div><div id="ferr"></div>
      <div class="acts"><button class="btn gold" type="submit">📤 تقديم طلب الصرف للاعتماد</button><button class="btn sec" type="button" data-close>إلغاء</button></div>
    </form>`;
}

function payApproveModalHTML(r) {
  const decs = (S.decOpts || []).map(d => `<option value="${d.id}" ${r.decision_id === d.id ? 'selected' : ''}>${esc(d.decision_no)} — ${esc(String(d.text || '').slice(0, 65))}</option>`).join('');
  return `<h3>✓ اعتماد إذن الصرف (${esc(r.req_no)})</h3>
    <div class="form-sec" style="background:#f8fafc">
      ${kvh('المستفيد', `<b>${esc(r.payee_name)}</b>`)}${kvh('المبلغ المطلوب', `<b style="font-size:16px;color:var(--brand)">${money(r.amount)} ج.م</b>`)}
      ${kvh('التوجيه المحاسبي', r.requires_settlement ? '1103 — عُهد تحت التسوية' : esc((r.expense_account || '') + ' — ' + (r.account_name || '')))}
      ${kvh('البيان', esc(r.description))}${kvh('مقدّم الطلب', esc(r.requested_by_name || '—'))}
    </div>
    <form id="papf">
      <label class="f"><span>ربط بقرار مجلس إدارة (اختياري — مطلوب فقط إن تجاوز المبلغ حد صلاحيتك المباشر)</span>
        <select class="input" name="decision_id"><option value="">— بدون قرار (اعتماد ضمن الصلاحية اللائحية) —</option>${decs}</select></label>
      <label class="f"><span>ملاحظة الاعتماد / التوجيه لأمين الصندوق (اختياري)</span><input class="input" name="note" placeholder="مثال: راجعت الفاتورة الضريبية ويُصرف بشيك…"></label>
      <div id="ferr"></div>
      <div class="acts"><button class="btn" type="submit">✓ اعتماد وإحالة لاستخراج الشيك</button><button class="btn sec" type="button" data-close>إلغاء</button></div>
    </form>`;
}

function issueChequeModalHTML(o) {
  const today = new Date().toISOString().slice(0, 10);
  const decs = o.allowDecision ? (S.decOpts || []).map(d => `<option value="${d.id}" ${o.decision_id === d.id ? 'selected' : ''}>${esc(d.decision_no)} — ${esc(String(d.text || '').slice(0, 60))}</option>`).join('') : '';
  return `<h3>🧾 استخراج وإصدار الشيك البنكي (${esc(o.refNo)})</h3>
    <div class="form-sec" style="background:#fffdf7;border-color:#ead89c">
      ${kvh('يُحرر الشيك لأمر', `<b>${esc(o.payee)}</b>`)}${kvh('صافي مبلغ الشيك', `<b style="font-size:17px;color:var(--brand)">${money(o.amount)} ج.م</b>`)}
      ${kvh('تفقيط المبلغ', `<span style="font-size:12.5px;font-weight:700;color:var(--brand)">${esc(typeof tafqeet === 'function' ? tafqeet(o.amount) : '')}</span>`)}
      ${kvh('القيد الآلي عند الإصدار', `مدين: <b>${esc(o.debitLabel)}</b> ⇐ دائن: <b>1102 البنك (الحساب الجاري)</b>`)}
    </div>
    <form id="ichqf">
      <div class="grid2">
        <label class="f"><span>رقم الشيك البنكي ${o.nextNo ? '<small class="muted">(مقترح تلقائياً من الدفتر)</small>' : ''}</span>
          <input class="input" name="cheque_no" inputmode="numeric" dir="ltr" value="${esc(o.nextNo || '')}" placeholder="رقم الورقة من الدفتر النشط"></label>
        <label class="f"><span>تاريخ تحرير وإصدار الشيك</span>
          <input class="input" type="date" name="date" value="${today}" required></label>
      </div>
      ${o.allowDecision ? `<label class="f"><span>قرار مجلس الإدارة (اختياري)</span><select class="input" name="decision_id"><option value="">— بدون قرار (معتمد لائحياً) —</option>${decs}</select></label>` : ''}
      <div id="ferr"></div>
      <div class="acts"><button class="btn gold" type="submit">🧾 تأكيد إصدار الشيك وترحيل القيد</button><button class="btn sec" type="button" data-close>إلغاء</button></div>
    </form>`;
}

function staffGrantForm() {
  const today = new Date().toISOString().slice(0, 10);
  const types = S.grtTypes || [];
  const decs = (S.decOpts || []).map(d => `<option value="${d.id}">${esc(d.decision_no)} — ${esc(String(d.text || '').slice(0, 60))}</option>`).join('');
  return `<h3>🎁 إنشاء طلب استخراج منحة اجتماعية</h3>
    <div class="alert" style="margin-bottom:10px;font-size:12.5px">📋 ابحث عن العضو للتحقق الآلي من عضوية النقابة العامة وأفراد أسرته المسجّلين، وطابق المستندات لإحالة الطلب مباشرة للاعتماد واستخراج الشيك.</div>
    <form id="sgf">
      <div class="form-sec"><div class="form-sec-hd"><span>👤 ١. بيانات العضو والتحقق من الاستحقاق</span></div>
        <div class="f"><span>ابحث بالاسم أو الرقم الوظيفي أو رقم الموبايل</span>
          <div class="mlookup"><input class="input" id="sgMemQ" autocomplete="off" placeholder="🔎 مثال: اسم العضو أو الرقم الوظيفي…"><div class="mlookup-list" id="sgMemList" hidden></div></div>
        </div>
        <input type="hidden" name="personId" id="sgPid"><input type="hidden" name="jobId" id="sgJob">
        <div id="sgPicked"></div>
      </div>
      <div class="form-sec"><div class="form-sec-hd"><span>🎁 ٢. نوع المنحة والواقعة والمستفيد</span><span id="sgRateHint" class="pill gold"></span></div>
        <div class="grid2">
          <label class="f"><span>نوع المنحة الاجتماعية</span><select class="input" name="type" id="sgType">${types.map(t => `<option value="${t.code}">${esc(t.name)}${t.amount ? ' — ' + Number(t.amount).toLocaleString('ar-EG') + ' ج.م' : ''}</option>`).join('')}</select></label>
          <label class="f"><span>تاريخ الواقعة الفعلي</span><input class="input" type="date" name="event_date" id="sgDate" value="${today}" required></label>
        </div>
        <label class="f"><span>المستفيد / صاحب الواقعة</span>
          <select class="input" name="who" id="sgWho">
            <option value="self">العضو نفسه (أو وفاة العضو)</option>
            <option value="other">فرد أسرة (إدخال الاسم والصلة يدوياً)</option>
          </select>
        </label>
        <div class="grid2" id="sgOther" hidden style="margin-top:6px">
          <label class="f"><span>اسم فرد الأسرة رباعياً</span><input class="input" name="subject_name" placeholder="الاسم كما في شهادة الواقعة"></label>
          <label class="f"><span>صلة القرابة بالعضو</span><select class="input" name="subject_relation">${options(['أب', 'أم', 'زوج', 'زوجة', 'ابن', 'ابنة'], 'ابن', false)}</select></label>
        </div>
      </div>
      <div class="form-sec"><div class="form-sec-hd"><span>📎 ٣. مطابقة المسوّغات والسند الإداري</span></div>
        <div id="sgDocsBox" style="margin-bottom:8px"></div>
        <label class="f" style="flex-direction:row;align-items:center;gap:8px;padding:8px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;cursor:pointer">
          <input type="checkbox" name="staff_verified" id="sgVerified" checked>
          <span><b>تم استلام ومطابقة المستندات المعلَّمة أعلاه</b> (ينتقل الطلب فوراً لحالة «مستوفى» جاهزاً للاعتماد)</span>
        </label>
        <div class="grid2" style="margin-top:8px">
          <label class="f"><span>قرار مجلس الإدارة (اختياري — للاستثناء من المهلة فقط)</span><select class="input" name="decision_id"><option value="">— بدون قرار (صرف لائحي) —</option>${decs}</select></label>
          <label class="f"><span>ملاحظات المراجعة (اختياري)</span><input class="input" name="notes" placeholder="رقم شهادة الواقعة / اسم مستلم الشيك في حالة الوفاة…"></label>
        </div>
      </div>
      <div id="ferr"></div>
      <div class="acts"><button class="btn gold" type="submit">📥 تسجيل طلب استخراج المنحة</button><button class="btn sec" type="button" data-close>إلغاء</button></div>
    </form>`;
}
// «1234, 5678:200» ⇒ [{job_id:'1234'},{job_id:'5678',amount:200}] — كل مستفيد يتسجّل له ميزة بنصيبه على الخادم
function parseBens(v) {
  const a = String(v || '').split(/[,،\s]+/).map(x => x.trim()).filter(Boolean)
    .map(x => { const [j, m] = x.split(':'); return m ? { job_id: j, amount: +m } : { job_id: j }; });
  return a.length ? a : undefined;
}
function benForm() {
  return `<h3>تسجيل ميزة مباشرة</h3><p class="muted">لما استفاد به العضو خارج الخزينة (خصم/دعم سابق على كتب أو مبادرات…) — بسند أو قرار، وتُلغى بسبب فقط.</p><form id="bnf">
    <div class="grid2"><label class="f"><span>النوع</span><select class="input" name="kind">${options(Object.keys(KIND_ICON), 'دعم', false)}</select></label>
      <label class="f"><span>القيمة</span><input class="input" name="amount" inputmode="decimal" required></label></div>
    <label class="f"><span>البند</span><input class="input" name="category" placeholder="مثلاً: دعم مبادرة الكتب 2024" required></label>
    <div class="grid2"><label class="f"><span>التاريخ</span><input class="input" type="date" name="date" required></label>
      <label class="f"><span>السند (مستند/كشف)</span><input class="input" name="basis"></label></div>
    <label class="f"><span>قرار المجلس (اختياري)</span><select class="input" name="decision_id"><option value="">—</option>${(S.decAll || []).map(d => `<option value="${d.id}">${esc((d.decision_no || '') + ' ' + (d.title || d.text || '')).slice(0, 80)}</option>`).join('')}</select></label>
    <label class="f"><span>ملاحظات</span><input class="input" name="notes"></label>
    <div id="ferr"></div><div class="acts"><button class="btn" type="submit">تسجيل</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`;
}
function settleRowHTML(l = {}, idx = 1, meetings = []) {
  const cats = ['بدل جلسات', 'بدل ضيافة', 'بدل انتقال', 'هدايا', 'جوائز نقدية', 'مشروبات ومأكولات', 'مطبوعات ولافتات', 'إيجار سيارة', 'انتقالات بالباص', 'حجز تذاكر', 'رسوم', 'إقامة بالفندق', 'أدوات مكتبية', 'مشتريات أخرى'];
  const v = x => esc(x == null ? '' : String(x));
  const bensTxt = b => (b || []).map(x => x.amount ? `${x.job_id}:${x.amount}` : x.job_id).join(', ');
  const selMids = new Set(l.meeting_ids || []);
  const catVal = l.category || 'بدل ضيافة';
  const isAlw = catVal === 'بدل جلسات';
  const mtList = meetings.length
    ? meetings.map(m => `<label class="stl-alw-item">
        <input type="checkbox" data-rmalw value="${m.id}" ${selMids.has(m.id) ? 'checked' : ''}>
        <div style="flex:1"><b>جلسة #${numAr(m.meeting_no)} — ${esc(m.title)}</b> <small class="muted">(${dt(m.meeting_date)} · ${numAr(m.present)} حاضر × ${money(m.rate)} ج)</small></div>
        <b style="color:var(--brand)">${money(m.total)} ج</b>
      </label>`).join('')
    : '<div class="muted" style="font-size:12px">لا توجد جلسات منعقدة بانتظار صرف بدل جلسات حالياً (يمكنك إدخال المبلغ يدوياً).</div>';
  return `<div class="stl-row" data-sl ${selMids.size ? `data-mids="${esc([...selMids].join(','))}"` : ''}>
    <div class="stl-row-hd"><span>🧾 بند مصروف #<i data-slnum style="font-style:normal">${numAr(idx)}</i></span>
      <button type="button" class="btn sm bad" data-sldel title="حذف هذا البند" style="padding:2px 8px;font-size:11.5px">🗑️ حذف</button>
    </div>
    <div class="row" style="gap:6px">
      <select class="input" style="flex:1.6;min-width:135px" name="cat">${options(cats, catVal, false)}</select>
      <input class="input" style="flex:1;min-width:95px" name="amt" inputmode="decimal" placeholder="المبلغ (ج.م)" value="${v(l.amount)}">
      <input class="input" style="flex:1.15;min-width:125px" type="date" name="doc_date" title="تاريخ الفاتورة (اختياري)" value="${v(l.doc_date)}">
      <input class="input" style="flex:2;min-width:140px" name="note" placeholder="بيان / رقم الفاتورة" value="${v(l.notes)}">
    </div>
    <div class="stl-alw-panel" data-alwpanel ${isAlw ? '' : 'hidden'}>
      <div class="stl-alw-ttl"><span>🏛️ اختر الجلسات غير المسوّاة (يحسب النظام تلقائياً: عدد الحاضرين × فئة البدل ويوزعها على الأعضاء):</span></div>
      ${mtList}
    </div>
    <input class="input" style="margin-top:6px;font-size:12.5px" name="bens" placeholder="المستفيدون (اختياري — يُملأ تلقائياً في بدل الجلسات): أرقام وظيفية مفصولة بفاصلة، ولنصيب محدد 1234:200" value="${v(bensTxt(l.beneficiaries))}">
  </div>`;
}

function settleForm(c, h = {}, dr = null) {
  const v = x => esc(x == null ? '' : String(x)), d = dr || {};
  const today = new Date().toISOString().slice(0, 10);
  const ids = d.cheque_ids || [];
  const grp = (h.group || []).length ? `<div class="form-sec"><div class="form-sec-hd"><span>🧾 شيكات أخرى لنفس صاحب العهدة (تسوية مجمّعة)</span></div>
    <div class="muted" style="font-size:12px;margin-bottom:6px">علّم الشيكات المجمّعة مع هذا الشيك لتُقفل معاً في تسوية واحدة وتقرير مجمّع واحد:</div>
    ${h.group.map(g => `<label style="display:flex;gap:8px;align-items:flex-start;padding:6px 8px;margin:4px 0;background:#fff;border:1px solid var(--line);border-radius:8px;cursor:pointer"><input type="checkbox" name="grp" value="${g.id}" data-amt="${g.amount}" style="margin-top:5px" ${ids.includes(g.id) ? 'checked' : ''}>
      <div style="flex:1"><b>شيك ${esc(g.cheque_no || 'بدون رقم')}</b> — ${dt(g.issue_date)}${g.notes ? '<div class="muted" style="font-size:12.5px">' + esc(g.notes) + '</div>' : ''}</div>
      <b style="color:var(--brand)">${money(g.amount)} ج</b></label>`).join('')}</div>` : '';
  const car = (h.carry || []).length ? `<label class="f"><span>🔄 رصيد مرحّل من تسوية سابقة (يُجلب آلياً)</span><select class="input" name="carried_from"><option value="" data-amt="0">— لا يوجد —</option>
    ${h.carry.map(x => `<option value="${x.id}" data-amt="${x.amount}" ${d.carried_from === x.id ? 'selected' : ''}>شيك ${esc(x.cheque_no || 'بدون رقم')} — تسوية ${dt(x.settle_date)} — متبقي ${money(x.amount)} ج</option>`).join('')}</select></label>` : '';
  const acts = (h.activities || []).length ? `<label class="f"><span>🚌 ربط التسوية برحلة / فعالية (اختياري — لمراجعة الاشتراكات المسجّلة مسبقاً ومنع الازدواج)</span><select class="input" name="activity_id" id="stlActSel"><option value="">— بدون ربط بنشاط —</option>
    ${h.activities.map(a => `<option value="${a.id}" data-paid="${a.paid_bookings || 0}" data-cnt="${a.bookings_count || 0}" ${d.activity_id === a.id ? 'selected' : ''}>${esc(a.title)} (${dt(a.start_date)} · محصّل بإيصالات: ${money(a.paid_bookings || 0)} ج)</option>`).join('')}</select><div id="stlActInfo"></div></label>` : '';
  const initLines = (d.lines || []).length ? d.lines : [{}];
  const linesHtml = initLines.map((l, i) => settleRowHTML(l, i + 1, h.meetings || [])).join('');
  return `<h3>🧮 تسوية عهدة مالية — ${esc(c.payee_name)} <small class="muted">(شيك ${esc(c.cheque_no || 'بدون رقم')})</small></h3>
    ${dr ? '<div class="alert warn">📝 تستكمل حالياً مسودة تسوية محفوظة مسبقاً.</div>' : ''}
    <div class="stl-kpis">
      <div class="stl-kpi"><small>إجمالي الشيكات المختارة</small><b id="stKpiAdv">${money(c.amount)} ج</b></div>
      <div class="stl-kpi amber"><small>مرحّل + اشتراكات</small><b id="stKpiPrev">٠٫٠٠ ج</b></div>
      <div class="stl-kpi green"><small>إجمالي ميزانية التسوية</small><b id="stKpiAvail">${money(c.amount)} ج</b></div>
      <div class="stl-kpi rose"><small>المنصرف بالفواتير</small><b id="stKpiSpent">٠٫٠٠ ج</b></div>
    </div>
    <form id="stf">
      <div class="grid2">
        <label class="f"><span>تاريخ إقفال التسوية</span><input class="input" type="date" name="date" value="${v(d.date || today)}" required></label>
        <label class="f"><span>اشتراكات نقدية بيد صاحب العهدة (لم تُثبت بإيصال مسبق)</span><input class="input" name="subscriptions" inputmode="decimal" value="${v(d.subscriptions ?? 0)}"></label>
      </div>
      ${grp}${car}${acts}
      <div class="row" style="align-items:center;margin:10px 0 6px"><b style="font-size:14.5px;color:var(--brand)">📑 الفواتير وبنود المصروفات</b><span class="sp"></span>
        <button class="btn sm gold" type="button" data-act="slAdd">+ إضافة بند مصروف</button></div>
      <div id="sls">${linesHtml}</div>
      <div class="form-sec" style="margin-top:10px"><div class="form-sec-hd"><span>⚖️ معالجة الفائض / المتبقي (أو اتركه ليقترح النظام تلقائياً عند الاعتماد)</span></div>
        <div class="grid2">
          <label class="f"><span>التصرف في المتبقي</span><select class="input" name="return_mode">${options(['لا يوجد', 'ترحيل', 'توريد للبنك', 'رد للخزينة'], d.return_mode || 'لا يوجد', false)}</select></label>
          <label class="f"><span>المبلغ المردود / المورّد فعلياً (ج.م)</span><input class="input" name="returned" inputmode="decimal" value="${v(d.returned ?? 0)}"></label>
        </div>
      </div>
      <div class="alert warn" id="stCalc"></div>
      <div id="ferr"></div>
      <div class="acts"><button class="btn gold" type="submit">✓ اعتماد التسوية وترحيل القيد</button><button class="btn sec" type="button" data-act="stlDraft">💾 حفظ كمسودة</button><button class="btn sec" type="button" data-close>إلغاء</button></div>
    </form>`;
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
  return `${(r.tasks || []).length ? `<div class="card"><h2>📌 مهام مستنياك</h2>${r.tasks.map(t => `<a class="kv task ${t.level || ''}" href="${esc(t.link)}" style="text-decoration:none;color:inherit"><span>${esc(t.title)}</span><span class="pill ${t.level === 'bad' ? 'bad' : 'warn'}">${t.count}</span></a>`).join('')}</div>` : ''}
    <div class="card list">${(r.items || []).map(n => `<a class="li" href="${esc(n.link || '#/home')}" style="text-decoration:none;color:inherit${n.unread ? ';background:#f3f8fc' : ''}">
      <div class="av" style="width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#eaf2f8;flex:none">${NTF_ICON[n.kind] || '🔔'}</div>
      <div class="nm"><b>${esc(n.title)}${n.unread ? ' <span class="pill ok" style="font-size:10px">جديد</span>' : ''}</b><span class="muted">${esc(n.body || '')} · ${ago(n.at)}</span></div></a>`).join('')
      || '<div class="empty">لا إشعارات</div>'}</div>`;
}

async function boot() {
  if (location.hash.startsWith('#/verify/')) return render();
  if (!S.token) { location.hash = '#/login'; return render(); }
  const r = await call('GET_ME');
  if (!r.success) return;
  S.me = r;
  await Promise.all([loadLists(), isStaff() && (can('governance.view') || can('governance.manage')) ? loadGov() : null]);
  refreshNtf(); if (!S.ntfTimer) S.ntfTimer = setInterval(() => { if (S.token && !document.hidden) refreshNtf(); }, 120000);
  if (isStaff() && r.mustChange) location.hash = '#/account';
  else if (!location.hash || location.hash === '#/login') location.hash = isStaff() ? '#/dash' : '#/home';
  render();
}
async function render() {
  const app = $('#app'), h = location.hash || '#/login';
  if (h.startsWith('#/verify/')) { app.innerHTML = verifyView(null); const r = await call('VERIFY_CARD', { token: h.split('/')[2] }); app.innerHTML = verifyView(r); return; }
  if (!S.token || !S.me || h === '#/login') { app.innerHTML = loginView(); return bindLogin(); }
  let title = 'منصة النقابة', body = '';
  if (h.startsWith('#/dash')) {
    title = 'لوحة القيادة'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const want = can('reports.view') || can('finance.view');
    const [rep, fin] = await Promise.all([want ? call('REP_OVERVIEW', { year: String(new Date().getFullYear()) }) : null,
      can('finance.view') ? call('FIN_SUMMARY', {}) : null, refreshNtf()]);
    S.dash = { rep: rep && rep.success ? rep.report : null, fin: fin && fin.success ? fin : null }; body = dashView();
  }
  else if (h.startsWith('#/users')) {
    title = 'المستخدمون والصلاحيات'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('SYS_USERS'); if (!r.success) return toast(r.message, true); S.sys = r; body = usersView();
  }
  else if (h.startsWith('#/audit')) {
    title = 'سجل التدقيق'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('SYS_AUDIT', S.audF || {}); if (!r.success) return toast(r.message, true); S.audit = r; body = auditView();
  }
  else if (h.startsWith('#/calendar')) {
    title = 'التقويم'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const gov = isStaff() && (can('governance.view') || can('governance.manage'));
    const [a, sm, mt] = await Promise.all([call('ACT_LIST', { all: true }), call('SUM_LIST'), gov ? call('GOV_LIST_MEETINGS') : null]);
    S.acts = a.success ? a.items : []; S.seasons = sm.success ? sm.items : []; S.meetings = mt && mt.success ? mt.items : (gov ? S.meetings : []);
    body = calendarView();
  }
  else if (h.startsWith('#/memberlists')) {
    title = 'كشوف الأعضاء'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('REP_MEMBERS', S.mlF || {}); if (!r.success) return toast(r.message, true); S.mlist = r.report; body = memberListsView();
  }
  else if (h.startsWith('#/annual')) {
    title = 'التقرير السنوي'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const y = S.annY || String(new Date().getFullYear() - (new Date().getMonth() < 2 ? 1 : 0));
    const gov = can('governance.view') || can('governance.manage');
    const [rep, tb, ac, bn, mt, dc] = await Promise.all([call('REP_OVERVIEW', { year: y }), call('FIN_TRIAL_BALANCE', { from: y + '-01-01', to: y + '-12-31' }),
      S.accts ? null : call('FIN_ACCOUNTS'), can('benefits.view') ? call('BEN_REPORT', { year: y }) : null, gov ? call('GOV_LIST_MEETINGS') : null, gov ? call('GOV_LIST_DECISIONS', {}) : null]);
    if (!rep.success) return toast(rep.message, true); if (ac && ac.success) S.accts = ac.items; S.trial = tb.success ? tb : {};
    S.annual = { year: y, rep: rep.report, ben: bn && bn.success ? bn : {}, meetings: mt && mt.success ? mt.items : [], decisions: dc && dc.success ? dc.items : [] };
    body = annualView();
  }
  else if (h.startsWith('#/help')) { title = 'المساعدة'; body = helpView(); }
  else if (h.startsWith('#/archive')) {
    title = 'الأرشيف الإلكتروني'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('DOC_SEARCH', S.arcF || {}); if (!r.success) return toast(r.message, true); S.arc = r.items; body = archiveView();
  }
  else if (h.startsWith('#/inbox')) {
    title = 'صندوق الاعتمادات'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('NTF_INBOX'); if (!r.success) return toast(r.message, true); S.inbox = r.items; body = inboxView();
  }
  else if (h.startsWith('#/myrequests')) {
    title = 'طلباتي'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('NTF_MINE'); if (!r.success) return toast(r.message, true); S.myReq = r.items; body = myReqView();
  }
  else if (h.startsWith('#/tickets')) {
    title = isStaff() ? 'شكاوى ومقترحات الأعضاء' : 'الشكاوى والمقترحات'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('TKT_LIST', { mine: !isStaff() }); if (!r.success) return toast(r.message, true); S.tickets = r; body = ticketsView();
  }
  else if (h.startsWith('#/activations')) {
    title = 'طلبات تفعيل الأعضاء'; app.innerHTML = shell(title, '<div class="spin"></div>');
    const r = await call('ACTV_LIST', {}); if (!r.success) return toast(r.message, true); S.actvs = r; body = activationsView();
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
  else if (h.startsWith('#/card')) { title = 'بطاقة العضوية'; body = S.me.profile ? cardView(S.me.profile, false) : '<div class="empty">الحساب مش مربوط بملف عضو</div>'; }
  else if (h.startsWith('#/profile')) { title = 'ملفي'; body = profileBody(S.me.profile, false); }
  else if (h.startsWith('#/family')) { title = 'أسرتي'; body = familyView(S.me.profile, false); }
  else if (h.startsWith('#/account')) { title = 'حسابي'; body = accountView(); }
  else if (h.startsWith('#/admin')) { title = 'الأعضاء'; body = adminView(); }
  else if (h.startsWith('#/person/')) {
    title = 'ملف عضو'; const id = h.split('/')[2];
    if (!S.person || S.person.person.id !== id) {
      app.innerHTML = shell(title, '<div class="spin"></div>');
      const r = await call('GET_PERSON', { id }); if (!r.success) return toast(r.message, true);
      S.person = r.profile; S.personBen = null; S.ptab = 'data';
      if (can('benefits.view')) { const b = await call('BEN_PERSON', { personId: id }); S.personBen = b.success ? b.benefits : null; }
    }
    body = personView();
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
    S.grtTypes = t.success ? t.items : []; S.grtElig = t.eligibleToday; S.grtIsBoard = !!(t.success && t.isBoardMember); S.grtMy = m.success ? m.items : []; body = grantsView();
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
  else if (['#/finance', '#/payreqs', '#/cheques', '#/cheque/', '#/receipts', '#/trial', '#/statements', '#/budget', '#/bank', '#/chqbooks', '#/settlements', '#/dues', '#/policy', '#/periods', '#/journal', '#/parties', '#/ledger/', '#/entries'].some(x => h.startsWith(x))) {
    title = h.startsWith('#/payreqs') ? 'طلبات الصرف والشيكات' : h.startsWith('#/periods') ? 'إقفال الفترات والسنوات' : 'المالية';
    app.innerHTML = shell(title, '<div class="spin"></div>');
    const P = S.finP || {};
    if (h.startsWith('#/finance')) { const r = await call('FIN_SUMMARY', P); if (!r.success) return toast(r.message, true); S.fin = r; body = finSummaryView(); }
    else if (h.startsWith('#/payreqs')) { const r = await call('FIN_PAY_LIST', S.payF || {}); if (!r.success) return toast(r.message, true); S.payReqs = r; body = payReqsView(); }
    else if (h.startsWith('#/cheques')) { const r = await call('FIN_CHEQUES', { from: '2000-01-01', ...(S.chqF || {}) }); S.cheques = r.success ? r.items : []; body = chequesView(); }
    else if (h.startsWith('#/cheque/')) { const r = await call('FIN_CHEQUE', { id: h.split('/')[2] }); if (!r.success) return toast(r.message, true); S.cheque = r.cheque; body = chequeView(); }
    else if (h.startsWith('#/receipts')) { const r = await call('FIN_RECEIPTS', { from: '2000-01-01', ...P }); S.receipts = r.success ? r.items : []; body = receiptsView(); }
    else if (h.startsWith('#/journal')) {
      if (!S.accounts) { const r = await call('FIN_ACCOUNTS'); S.accounts = r.success ? r.items : []; }
      if (!S.allDecs) { const r = await call('GOV_LIST_DECISIONS'); S.allDecs = r.success ? r.items : []; }
      body = journalView();
    }
    else if (h.startsWith('#/parties')) {
      const r = await call('POL_PARTIES'); if (!r.success) return toast(r.message, true); S.parties = r.items; S.partiesEdit = r.canEdit; body = partiesView();
    }
    else if (h.startsWith('#/dues')) {
      const r = await call('DUES_STATUS'); if (!r.success) return toast(r.message, true); S.dues = r.status; S.duesEdit = r.canEdit; body = duesView();
    }
    else if (h.startsWith('#/policy')) {
      const r = await call('POL_LIST'); if (!r.success) return toast(r.message, true); S.pol = r.items; S.polEdit = r.canEdit; body = policyView();
    }
    else if (h.startsWith('#/periods')) {
      const r = await call('FIN_PERIODS_LIST'); if (!r.success) return toast(r.message, true); S.periods = r; body = periodsView();
    }
    else if (h.startsWith('#/settlements')) {
      const r = await call('FIN_SETTLEMENTS'); if (!r.success) return toast(r.message, true);
      S.openAdv = r.open; S.stlDrafts = r.drafts; S.stlCarries = r.carries; S.stlItems = r.items; body = settlementsView();
    }
    else if (h.startsWith('#/bank')) {
      const f = S.bankF || {}; const r = await call('BANK_RECON', f); if (!r.success) return toast(r.message, true); S.recon = r.recon; body = bankView();
    }
    else if (h.startsWith('#/chqbooks')) {
      const r = await call('BANK_BOOKS'); if (!r.success) return toast(r.message, true); S.books = r.items; body = booksView();
    }
    else if (h.startsWith('#/budget')) {
      const r = await call('REP_BUDGET', { year: S.budYear || String(new Date().getFullYear()) }); if (!r.success) return toast(r.message, true);
      S.bud = r.report; S.budEdit = r.canEdit; body = budgetView();
    }
    else if (h.startsWith('#/statements')) {
      const [t, a] = await Promise.all([call('FIN_TRIAL_BALANCE', { from: (P.from || new Date().getFullYear() + '-01-01'), to: P.to || new Date().toISOString().slice(0, 10) }), S.accts ? null : call('FIN_ACCOUNTS')]);
      if (!t.success) return toast(t.message, true); S.trial = t; if (a && a.success) S.accts = a.items; body = statementsView();
    }
    else if (h.startsWith('#/trial')) { const r = await call('FIN_TRIAL_BALANCE', { from: '2000-01-01', ...P }); S.trial = r.success ? r : {}; body = trialView(); }
    else if (h.startsWith('#/ledger/')) { const r = await call('FIN_LEDGER', { account: h.split('/')[2], from: '2000-01-01', ...P }); S.ledger = r.success ? r : {}; body = ledgerView(); }
    else { const r = await call('FIN_ENTRIES', { from: '2000-01-01', ...(S.entF || {}) }); S.entries = r.success ? r.items : []; body = entriesView(); }
  }
  else if (h.startsWith('#/board') || h.startsWith('#/meetings') || h.startsWith('#/meeting/') || h.startsWith('#/decisions')) {
    title = 'المجلس';
    if (!S.gov) { app.innerHTML = shell(title, '<div class="spin"></div>'); await loadGov(); }
    if (h.startsWith('#/board')) body = boardView();
    else if (h.startsWith('#/meetings')) {
      if (!S.meetings) { const r = await call('GOV_LIST_MEETINGS'); S.meetings = r.success ? r.items : []; if (r.success) S.govRate = r.allowanceRate; }
      body = meetingsView();
    } else if (h.startsWith('#/meeting/')) {
      const id = h.split('/')[2];
      if (!S.meeting || S.meeting.id !== id) {
        S.quickAttOpen = false;
        app.innerHTML = shell(title, '<div class="spin"></div>');
        const r = await call('GOV_GET_MEETING', { id }); if (!r.success) return toast(r.message, true); S.meeting = r.meeting;
      }
      body = meetingView();
    } else {
      if (!S.decisions) { const r = await call('GOV_LIST_DECISIONS', S.decF || {}); S.decisions = r.success ? r.items : []; S.decSummary = r.success ? r.summary : {}; }
      body = decisionsView();
    }
  }
  else { location.hash = isStaff() ? '#/dash' : '#/home'; return; }
  closeDP();
  app.innerHTML = shell(title, body);
  bindPage();
  enhanceUI(app);
}

// ───────── الأحداث ─────────
function bindPage(gridOnly) {
  const app = $('#app');
  if (!gridOnly) bindGrids();
  app.querySelectorAll('[data-fgrp]').forEach(b => b.onclick = () => {
    if (b.dataset.fgrp === 'all') S.finAll = !S.finAll;
    else { S.finAll = false; S.finGrp = b.dataset.fgrp; }
    render();
  });
  const byr = $('#byr'); if (byr) byr.onsubmit = e => { e.preventDefault(); S.budYear = formData(byr).year; render(); };
  app.querySelectorAll('[data-act=budPrint]').forEach(b => b.onclick = () => printDoc(budgetReportHTML()));
  app.querySelectorAll('[data-act=budSave]').forEach(b => b.onclick = async () => {
    const items = [...app.querySelectorAll('[data-bacc]')].map(i => ({ account: i.dataset.bacc, amount: i.value === '' ? 0 : +i.value }))
      .filter(x => { const o = (S.bud.items || []).find(y => y.code === x.account); return o && +o.budget !== x.amount; });
    if (!items.length) return toast('مفيش تغييرات');
    const r = await busy(b, () => call('REP_BUDGET_SAVE', { year: S.bud.year, items }));
    if (!r.success) { $('#buderr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    S.bud = r.report; toast(`اتحفظ ${r.saved} بند ✓`); render(); });
  app.querySelectorAll('[data-act=stPrint]').forEach(b => b.onclick = () => printDoc(financialStatementsReportHTML()));
  app.querySelectorAll('[data-act=tbPrint]').forEach(b => b.onclick = () => printDoc(trialBalanceReportHTML()));
  app.querySelectorAll('[data-act=bankRepPrint]').forEach(b => b.onclick = () => printDoc(bankReconReportHTML()));
  app.querySelectorAll('[data-act=userNew]').forEach(b => b.onclick = () => openModal(userForm(null), () => bindUserForm(null)));
  app.querySelectorAll('[data-user]').forEach(tr => tr.onclick = () => { const u = S.sys.users.find(x => x.username === tr.dataset.user); openModal(userForm(u), () => bindUserForm(u)); });
  const auf = $('#auf'); if (auf) auf.onsubmit = e => { e.preventDefault(); S.audF = Object.fromEntries(Object.entries(formData(auf)).filter(([, v]) => v)); render(); };
  app.querySelectorAll('[data-aud]').forEach(tr => tr.onclick = async () => { const r = await call('SYS_AUDIT_GET', { id: +tr.dataset.aud });
    if (!r.success || !r.item) return toast(r.message || 'غير موجود', true); openModal(auditModal(r.item), m => m.querySelector('[data-close]').onclick = closeModal); });
  app.querySelectorAll('[data-cal]').forEach(b => b.onclick = () => { const k = +b.dataset.cal, n = new Date(), m = S.calM || new Date(n.getFullYear(), n.getMonth(), 1);
    S.calM = k ? new Date(m.getFullYear(), m.getMonth() + k, 1) : new Date(n.getFullYear(), n.getMonth(), 1); render(); });
  const mlf = $('#mlf'); if (mlf) mlf.onsubmit = e => { e.preventDefault(); S.mlF = Object.fromEntries(Object.entries(formData(mlf)).filter(([, v]) => v)); render(); };
  app.querySelectorAll('[data-mlp]').forEach(b => b.onclick = () => { S.mlF = ({ '': {}, pens: { member_state: 'معاش', missing: 'retirement_date' }, phone: { missing: 'phone' },
    nid: { missing: 'national_id' }, gen: { union_org: 'النقابة العامة', member_state: 'نشط' } })[b.dataset.mlp]; render(); });
  if ($('#mqr')) drawCardQR(location.hash.startsWith('#/person/') ? S.person.person.id : null);
  app.querySelectorAll('[data-act=cardReissue]').forEach(b => b.onclick = async () => {
    const ok = await uiConfirm({ title: 'إعادة إصدار بطاقة العضوية', msg: 'سيتم إلغاء البطاقة السابقة ورمز QR الخاص بها فوراً وإصدار بطاقة جديدة. هل تود المتابعة؟', tone: 'warn', okText: 'إصدار بطاقة جديدة' });
    if (ok) drawCardQR(S.person.person.id, true).then(() => toast('اتصدرت بطاقة جديدة ✓'));
  });
  const bankf = $('#bankf'); if (bankf) bankf.onsubmit = e => { e.preventDefault(); S.bankF = Object.fromEntries(Object.entries(formData(bankf)).filter(([, v]) => v !== '')); render(); };
  app.querySelectorAll('[data-all]').forEach(c => c.onchange = () => app.querySelectorAll(`[data-clr=${c.dataset.all}]`).forEach(x => x.checked = c.checked));
  app.querySelectorAll('[data-chqgo]').forEach(b => b.onclick = () => { location.hash = '#/cheque/' + b.dataset.chqgo; });
  app.querySelectorAll('[data-act=clrSel]').forEach(b => b.onclick = async () => { const kind = b.dataset.kind, ids = [...app.querySelectorAll(`[data-clr=${kind}]:checked`)].map(x => x.value);
    if (!ids.length) return toast('حدّد من الجدول الأول', true);
    const r = await busy(b, () => call('BANK_CLEAR', { kind, ids, date: ($('#clrDate') || {}).value || (S.bankF || {}).date || new Date().toISOString().slice(0, 10) }));
    if (!r.success) return toast(r.message, true); toast(`اتأكد ${r.updated} ✓`); render(); });
  app.querySelectorAll('[data-act=stmtMatch]').forEach(b => b.onclick = matchStatement);
  app.querySelectorAll('[data-act=clrUpto]').forEach(b => b.onclick = async () => { const d = $('#uptoDate').value; if (!d) return toast('حدد التاريخ', true);
    const ok = await uiConfirm({ title: 'تأكيد جماعي للصرف البنكي', msg: `سيتم تأكيد صرف جميع الشيكات والإيداعات الصادرة حتى تاريخ ${d}. هل أنت متأكد؟`, tone: 'warn', okText: 'تأكيد الصرف الجماعي' });
    if (!ok) return;
    const r = await busy(b, () => call('BANK_CLEAR_UPTO', { upto: d })); if (!r.success) return toast(r.message, true); toast(`اتأكد ${r.updated} شيك ✓`); render(); });
  app.querySelectorAll('[data-act=reconSave],[data-act=reconApprove]').forEach(b => b.onclick = async () => { const f = S.bankF || {};
    const r = await busy(b, () => call('BANK_RECON_SAVE', { date: f.date || S.recon.date, stmtBalance: f.stmtBalance, approve: b.dataset.act === 'reconApprove' }));
    if (!r.success) return toast(r.message, true); toast(b.dataset.act === 'reconApprove' ? 'اتعتمدت المطابقة ✓' : 'اتحفظت ✓'); render(); });
  const cbf = $('#cbf'); if (cbf) cbf.onsubmit = async e => { e.preventDefault(); const r = await busy(cbf.querySelector('button'), () => call('BANK_BOOK_SAVE', formData(cbf)));
    if (!r.success) { $('#cberr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; } toast('اتسجّل الدفتر ✓'); render(); };
  app.querySelectorAll('[data-spoil]').forEach(b => b.onclick = async () => { const id = b.dataset.spoil;
    const r = await busy(b, () => call('BANK_SPOIL', { bookId: id, chequeNo: app.querySelector(`[data-spno="${id}"]`).value.trim(), reason: app.querySelector(`[data-spr="${id}"]`).value.trim() }));
    if (!r.success) return toast(r.message, true); toast('اتسجّلت ✓'); render(); });
  app.querySelectorAll('[data-bookclose]').forEach(b => b.onclick = async () => { const bk = S.books.find(x => x.id === b.dataset.bookclose);
    const ok = await uiConfirm({ title: 'إقفال دفتر الشيكات', msg: `هل تريد إقفال الدفتر (${bk.first_no} ← ${bk.last_no}) واعتباره منتهياً؟`, tone: 'warn', okText: 'إقفال الدفتر' });
    if (!ok) return;
    const r = await call('BANK_BOOK_SAVE', { id: bk.id, bookNo: bk.book_no, firstNo: bk.first_no, lastNo: bk.last_no, status: 'منتهي', notes: bk.notes }); if (!r.success) return toast(r.message, true); render(); });
  app.querySelectorAll('[data-bookedit]').forEach(b => b.onclick = () => {
    const bk = S.books.find(x => x.id === b.dataset.bookedit); if (!bk) return;
    openModal(`<h3>✏️ تعديل بيانات دفتر الشيكات</h3><form id="bkef">
      <div class="grid2">
        <label class="f"><span>رقم / اسم الدفتر</span><input class="input" name="bookNo" value="${esc(bk.book_no || '')}"></label>
        <label class="f"><span>الحالة</span><select class="input" name="status">${options(['نشط', 'منتهي'], bk.status || 'نشط', false)}</select></label>
      </div>
      <div class="grid2">
        <label class="f"><span>أول رقم شيك</span><input class="input" name="firstNo" dir="ltr" inputmode="numeric" required value="${esc(bk.first_no)}"></label>
        <label class="f"><span>آخر رقم شيك</span><input class="input" name="lastNo" dir="ltr" inputmode="numeric" required value="${esc(bk.last_no)}"></label>
      </div>
      <div class="grid2">
        <label class="f"><span>تاريخ الاستلام</span><input class="input" type="date" name="receivedDate" value="${esc(bk.received_date || '')}"></label>
        <label class="f"><span>ملاحظات</span><input class="input" name="notes" value="${esc(bk.notes || '')}"></label>
      </div>
      <div id="ferr"></div><div class="acts"><button class="btn gold" type="submit">💾 حفظ التعديل</button><button class="btn sec" type="button" data-close>إلغاء</button></div>
    </form>`, () => {
      $('#modal [data-close]').onclick = closeModal;
      $('#bkef').onsubmit = async e => { e.preventDefault();
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('BANK_BOOK_SAVE', { id: bk.id, ...formData(e.target) }));
        if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('تم تعديل الدفتر ✓'); render();
      };
    });
  });
  app.querySelectorAll('[data-act=chqClear]').forEach(b => b.onclick = async () => { const c = S.cheque;
    let d = '';
    if (c.cleared_date) {
      const ok = await uiConfirm({ title: 'إلغاء تأكيد الصرف البنكي', msg: 'سيتم إعادة الشيك إلى حالة «لم يُصرف من البنك بعد» في مذكرة التسوية. هل تود المتابعة؟', tone: 'warn', okText: 'إلغاء التأكيد' });
      if (!ok) return;
    } else {
      d = await uiPrompt({ title: 'تأكيد صرف الشيك من البنك', msg: `حدد تاريخ ظهور الشيك رقم (${c.cheque_no || 'بدون رقم'}) في كشف حساب البنك:`, label: 'تاريخ الصرف البنكي', kind: 'date', value: new Date().toISOString().slice(0, 10), okText: 'تأكيد الصرف' });
      if (d === null) return;
    }
    const r = await call('BANK_CLEAR', { kind: 'cheque', ids: [c.id], date: d }); if (!r.success || !r.updated) return toast(r.message || 'التاريخ قبل تاريخ الإصدار', true);
    toast('اتحدّث ✓'); render(); });
  app.querySelectorAll('[data-act=chqVoid]').forEach(b => b.onclick = async () => {
    const reason = await uiPrompt({ title: 'إلغاء الشيك البنكي بقيد عكسي', msg: 'سيتم إنشاء قيد محاسبي عكسي تلقائياً، وإذا كان الشيك مرتبطاً بطلب صرف أو منحة سيعود الطلب لحالة «معتمد» لإصدار شيك بديل.', label: 'سبب الإلغاء (إجباري للتدقيق)', placeholder: 'مثال: خطأ في بيانات المستفيد / تلف الورقة…', tone: 'bad', okText: 'تأكيد إلغاء الشيك' });
    if (!reason) return;
    const r = await busy(b, () => call('BANK_VOID', { id: S.cheque.id, reason })); if (!r.success) return toast(r.message, true); toast('اتلغى الشيك بقيد عكسي ✓'); render(); });
  app.querySelectorAll('[data-rcptv]').forEach(b => b.onclick = ev => { ev.stopPropagation(); const r = (S.receipts || []).find(x => x.id === b.dataset.rcptv); if (r) printDoc(receiptVoucherHTML(r)); });
  app.querySelectorAll('[data-grtprint]').forEach(b => b.onclick = () => {
    const g = [...(S.grtList || []), ...(S.grtMy || []), ...((S.payReqs && S.payReqs.approvedGrants) || [])].find(x => x.id === b.dataset.grtprint);
    if (g) printDoc(grantRequestHTML(g));
  });
  app.querySelectorAll('[data-act=advPrint]').forEach(b => b.onclick = () => printDoc(openAdvancesReportHTML(S.openAdv || [])));
  app.querySelectorAll('[data-act=bkPrint]').forEach(b => b.onclick = () => { const a = S.trip, mb = a && a.myBooking; if (mb) printDoc(bookingHTML(mb, a, (S.me.profile || {}).person || {})); });
  app.querySelectorAll('[data-crprint]').forEach(b => b.onclick = () => { const r = (S.requests || []).find(x => x.id === b.dataset.crprint); if (r) printDoc(changeReqHTML([r], { full_name: r.full_name, job_id: r.job_id })); });
  app.querySelectorAll('[data-act=myCrPrint]').forEach(b => b.onclick = () => { const pr = S.me.profile; printDoc(changeReqHTML((pr.requests || []).filter(r => r.status === 'معلّق'), pr.person)); });
  loadDocBoxes();
  app.querySelectorAll('[data-act=annGo]').forEach(b => b.onclick = () => { S.annY = $('#annY').value; render(); });
  app.querySelectorAll('[data-act=annPrint]').forEach(b => b.onclick = () => printDoc(annualReportHTML()));
  app.querySelectorAll('[data-act=pasteApply]').forEach(b => b.onclick = () => applyPaste(b.dataset.mode));
  app.querySelectorAll('[data-act=fixSave]').forEach(b => b.onclick = async () => {
    const items = [...app.querySelectorAll('[data-fix]')].filter(i => i.value.trim()).map(i => ({ personId: i.dataset.fix, v: i.value.trim() }));
    const reason = $('#fixReason').value.trim(); if (!items.length) return toast('مفيش حاجة مكتوبة', true); if (!reason) return toast('اكتب مصدر البيانات', true);
    const okConfirm = await uiConfirm({ title: 'حفظ التحديثات الجماعية', msg: `سيتم حفظ وتحديث ${numAr(items.length)} سجل عضو، مع تسجيل كل تعديل في سجل التدقيق الرسمي.`, tone: 'warn', okText: 'حفظ واعتماد' });
    if (!okConfirm) return;
    let ok = 0, bad = [];
    await busy(b, async () => {
      if (b.dataset.mode === 'ret') {
        const r = await call('SYS_BULK_RETIRE', { reason, items: items.map(x => ({ personId: x.personId, date: x.v })) });
        if (!r.success) return toast(r.message, true); ok = r.fixed; bad = r.skipped || [];
      } else for (const x of items) {
        if (!/^01\d{9}$/.test(x.v.replace(/\s/g, ''))) { bad.push({ personId: x.personId, why: 'رقم غير صحيح' }); continue; }
        const r = await call('SAVE_PERSON', { id: x.personId, fields: { phone: x.v.replace(/\s/g, '') }, reason }); if (r.success) ok++; else bad.push({ personId: x.personId, why: r.message });
      }
    });
    const nm = id => ((S.mlist.items || []).find(x => x.id === id) || {}).full_name || id;
    toast(`اتحفظ ${ok} ✓`); const res = $('#fixres');
    if (bad.length) { res.innerHTML = `<div class="alert warn" style="margin-top:8px">ما اتحفظش (${bad.length}):<br>${bad.map(x => `${esc(nm(x.personId))} — ${esc(x.why)}`).join('<br>')}</div>`; }
    else render(); });
  const hq = $('#helpq'); if (hq) hq.oninput = () => { S.helpQ = hq.value; const pos = hq.selectionStart; render().then(() => { const n = $('#helpq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); };
  const ha = $('#helpall'); if (ha) ha.onchange = () => { S.helpAll = ha.checked; render(); };
  app.querySelectorAll('[data-grtdocs]').forEach(b => b.onclick = () => { const box = app.querySelector(`[data-grtdocbox="${b.dataset.grtdocs}"]`);
    if (box.innerHTML) { box.innerHTML = ''; return; } box.innerHTML = docsBox('grant', b.dataset.grtdocs, '📎 مستندات الطلب (صور أو PDF)').replace('class="card docbox"', 'class="docbox inl"'); loadDocBoxes(); });
  const arcf = $('#arcf'); if (arcf) arcf.onsubmit = e => { e.preventDefault(); S.arcF = Object.fromEntries(Object.entries(formData(arcf)).filter(([, v]) => v)); render(); };
  app.querySelectorAll('tr[data-docopen]').forEach(tr => tr.onclick = ev => { if (!ev.target.closest('a')) openDoc(tr.dataset.docopen); });
  const duesf = $('#duesf'); if (duesf) duesf.onsubmit = async e => { e.preventDefault(); const d = formData(duesf); d.from = d.from + '-01';
    const ok = await uiConfirm({ title: 'إثبات استحقاق حصة الاشتراكات', msg: `سيتم إثبات استحقاق ${d.months} شهر بدءاً من ${d.from} وترحيل قيد محاسبي آلي. هل تود المتابعة؟`, tone: 'info', okText: 'إثبات وترحيل القيد' });
    if (!ok) return;
    const r = await busy(duesf.querySelector('button'), () => call('DUES_ACCRUE', d)); if (!r.success) { $('#duesErr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    toast('اتثبت الاستحقاق بقيد ✓'); render(); };
  app.querySelectorAll('[data-pol]').forEach(tr => tr.onclick = () => { const x = S.pol.find(i => i.account === tr.dataset.pol);
    openModal(policyForm(x), m => { m.querySelector('[data-close]').onclick = closeModal;
      $('#polf').onsubmit = async e => { e.preventDefault(); const f = e.target, d = formData(f); d.account = x.account;
        const r = await busy(f.querySelector('[type=submit]'), () => call('POL_SAVE', d)); if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اتحفظ البند ✓'); render(); }; }); });
  app.querySelectorAll('[data-jtpl]').forEach(b => b.onclick = () => { S.jTpl = b.dataset.jtpl; render(); });
  const jf = $('#jf'); if (jf) {
    if (!S.partyNames) call('POL_PARTIES').then(r => { S.partyNames = r.success ? r.items.filter(x => x.active).map(x => x.name) : []; const dl = $('#partyList'); if (dl) dl.innerHTML = S.partyNames.map(n => `<option value="${esc(n)}">`).join(''); });
    const bal = () => { const b = $('#jbal'); if (!b) return; const ls = journalLines(jf), d = ls.reduce((a, l) => a + (+l.debit || 0), 0), c = ls.reduce((a, l) => a + (+l.credit || 0), 0);
      b.className = 'alert ' + (Math.abs(d - c) < 0.005 && d > 0 ? 'ok' : 'warn'); b.textContent = `مدين ${d.toLocaleString('ar-EG')} — دائن ${c.toLocaleString('ar-EG')} ${Math.abs(d - c) < 0.005 && d > 0 ? '✓ متوازن' : '(غير متوازن)'}`; };
    jf.addEventListener('input', bal); bal();
    const addBtn = jf.querySelector('[data-act=jlAdd]'); if (addBtn) addBtn.onclick = () => { $('#jls').insertAdjacentHTML('beforeend', $('#jls .jl').outerHTML); $('#jls .jl:last-child').querySelectorAll('input').forEach(i => i.value = ''); };
    jf.onsubmit = async e => { e.preventDefault(); const lines = journalLines(jf);
      const ok = await uiConfirm({ title: 'ترحيل قيد يومية محاسبي', msg: 'سيتم تسجيل القيد وترحيله نهائياً بالدفاتر. القيود المرحّلة لا تُعدَّل ويتم تصحيحها بقيد عكسي فقط.', tone: 'warn', okText: 'تسجيل وترحيل' });
      if (!ok) return;
      const r = await busy(jf.querySelector('[type=submit]'), () => call('FIN_JOURNAL', { date: jf.date.value, description: jf.description.value.trim(), decision_id: jf.decision_id.value || null, lines }));
      if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
      toast('اتسجّل القيد ✓ — ارفع المستند من شاشة القيود'); jf.reset(); location.hash = '#/entries'; };
  }
  app.querySelectorAll('[data-act=partyNew],[data-party]').forEach(b => b.onclick = () => { const x = b.dataset.party ? S.parties.find(p => p.id === b.dataset.party) : null;
    openModal(partyForm(x), m => { m.querySelector('[data-close]').onclick = closeModal;
      const st = m.querySelector('[data-act=partyStmt]'); if (st) st.onclick = async () => { const r = await call('POL_PARTY_STATEMENT', { name: x.name }); if (!r.success) return toast(r.message, true);
        printDoc(partyStatementHTML(x, r.items)); };
      $('#ptf').onsubmit = async e => { e.preventDefault(); const d = formData(e.target); if (x) d.id = x.id;
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('POL_PARTY_SAVE', d)); if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); S.partyNames = null; toast('اتحفظ ✓'); render(); }; }); });
  app.querySelectorAll('[data-act=voucher]').forEach(b => b.onclick = () => printDoc(voucherHTML(S.cheque)));
  app.querySelectorAll('[data-act=cardPrint]').forEach(b => b.onclick = () => { document.body.dataset.printCard = 1; window.print(); delete document.body.dataset.printCard; });
  app.querySelectorAll('[data-wff]').forEach(b => b.onclick = () => { S.inboxF = b.dataset.wff; render(); });
  app.querySelectorAll('[data-ptab]').forEach(b => b.onclick = () => { S.ptab = b.dataset.ptab; render(); });
  app.querySelectorAll('[data-act=logout]').forEach(b => b.onclick = async () => {
    const ok = await uiConfirm({ title: 'تسجيل الخروج', msg: 'هل تود إنهاء الجلسة الحالية وتسجيل الخروج من المنظومة؟', tone: 'info', okText: 'تسجيل الخروج' });
    if (ok) logout();
  });
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
  on('reject', async b => {
    const note = await uiPrompt({ title: 'رفض طلب تعديل البيانات', msg: 'أدخل سبب رفض الطلب ليظهر للعضو في ملفه:', label: 'سبب الرفض (إجباري)', tone: 'bad', okText: 'تأكيد الرفض' });
    if (!note) return;
    const r = await busy(b, () => call('DECIDE_CHANGE_REQUEST', { id: b.dataset.id, approve: false, note }));
    toast(r.success ? 'اترفض' : r.message, !r.success); render(); });

  const lk = $('#lk'); if (lk) lk.onchange = () => { S.listKey = lk.value; render(); };
  const la = $('#la');
  if (la) la.onsubmit = async e => { e.preventDefault();
    const r = await call('SAVE_LIST_ITEM', { listKey: S.listKey || 'workplace', value: formData(la).value });
    if (!r.success) return toast(r.message, true); await loadLists(); render(); };
  on('hideItem', async b => {
    const ok = await uiConfirm({ title: 'إخفاء عنصر من القائمة', msg: `هل تريد إخفاء «${b.dataset.v}» من خيارات الإدخال الجديدة؟`, tone: 'warn', okText: 'إخفاء العنصر' });
    if (!ok) return;
    const r = await call('SAVE_LIST_ITEM', { listKey: S.listKey || 'workplace', value: b.dataset.v, active: false });
    if (!r.success) return toast(r.message, true); await loadLists(); render(); });

  // ── المجلس ──
  app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { S.finAll = false; S.finGrp = null; location.hash = b.dataset.go; });
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
  const bindAttBox = (root, statEl) => {
    if (!root) return;
    const seats = +(root.dataset.seats || 0);
    const upd = () => {
      const pres = [...root.querySelectorAll('[data-att]')].filter(i => i.value === 'حاضر').length;
      const q = seats ? pres >= Math.floor(seats / 2) + 1 : false;
      if (statEl) statEl.innerHTML = `👥 الحضور: <b>${numAr(pres)}</b> من <b>${numAr(seats)}</b> — ${q ? '<span style="color:var(--ok)">نصاب مكتمل ✓</span>' : '<span style="color:var(--bad)">أقل من النصاب</span>'}`;
    };
    root.querySelectorAll('.att-seg button').forEach(b => b.onclick = () => {
      const r = b.closest('[data-attrow]'); r.querySelector('[data-att]').value = b.dataset.v;
      r.querySelectorAll('.att-seg button').forEach(x => x.classList.toggle('on', x === b)); upd();
    });
    const allBtn = root.querySelector('[data-act=attAllPresent]');
    if (allBtn) allBtn.onclick = () => {
      root.querySelectorAll('[data-attrow]').forEach(r => {
        r.querySelector('[data-att]').value = 'حاضر';
        r.querySelectorAll('.att-seg button').forEach(x => x.classList.toggle('on', x.dataset.v === 'حاضر'));
      }); upd();
    };
    upd();
  };
  bindAttBox($('#qattBox'), $('#qattStat'));
  on('toggleQuickAtt', () => { S.quickAttOpen = !S.quickAttOpen; render(); });
  on('saveQuickAtt', async b => {
    const box = $('#qattBox'); if (!box) return;
    const attendance = [...box.querySelectorAll('[data-att]')].map(i => ({ person_id: i.dataset.att, status: i.value }));
    const r = await busy(b, () => call('GOV_SAVE_ATTENDANCE', { meetingId: S.meeting.id, attendance }));
    if (!r.success) return toast(r.message, true);
    S.meeting = r.meeting; S.meetings = null; S.quickAttOpen = false; toast('اتحفظ كشف الحضور واتحسب البدل ✓'); render();
  });
  on('alwRateSet', async () => {
    const cur = S.govRate || (S.gov && S.gov.allowanceRate) || 75;
    const v = await uiPrompt({ title: 'تحديد فئة بدل حضور الجلسات', msg: 'أدخل قيمة بدل حضور جلسة مجلس الإدارة للعضو الحاضر (بالجنيه):', label: 'فئة بدل الجلسة (ج.م)', kind: 'amount', value: String(cur), okText: 'حفظ الفئة' });
    if (!v) return;
    const r = await call('GOV_SET_ALLOWANCE_RATE', { rate: v });
    if (!r.success) return toast(r.message, true);
    S.govRate = r.rate; S.meetings = null; S.meeting = null; toast('اتحدثت فئة البدل ✓'); render();
  });
  app.querySelectorAll('[data-mfchip]').forEach(b => b.onclick = () => { S.meetF = b.dataset.mfchip; render(); });
  on('prtMinutes', () => S.meeting && printDoc(meetingMinutesHTML(S.meeting)));
  on('prtAttend', () => S.meeting && printDoc(attendanceSheetHTML(S.meeting, false)));
  on('prtAttendBlank', () => S.meeting && printDoc(attendanceSheetHTML(S.meeting, true)));
  on('prtAllow', () => S.meeting && printDoc(allowanceSheetHTML(S.meeting)));
  on('decExecRep', () => printDoc(decisionsExecReportHTML()));

  const meetBuild = (f, id) => ({ termId: S.gov.term.id, meeting: { ...formData(f), id,
    agenda: f.agenda.value.split('\n').map(x => x.trim()).filter(Boolean),
    attendance: [...f.querySelectorAll('[data-att]')].map(s => ({ person_id: s.dataset.att, status: s.value })),
    decisions: [...f.querySelectorAll('[data-dec]')].map(d => ({ text: d.querySelector('[name=d_text]').value.trim(),
      category: d.querySelector('[name=d_category]').value, amount: d.querySelector('[name=d_amount]').value.trim(),
      votes_for: d.querySelector('[name=d_for]').value.trim(), votes_against: d.querySelector('[name=d_against]').value.trim(),
      votes_abstain: d.querySelector('[name=d_abstain]').value.trim(), status: d.querySelector('[name=d_status]').value,
      exec_status: d.querySelector('[name=d_exec]').value, assignee_name: d.querySelector('[name=d_assignee]').value.trim(),
      due_date: d.querySelector('[name=d_due]').value })).filter(d => d.text) } });
  const meetAfter = r => { S.meeting = r.meeting; S.meetings = null; S.decisions = null; S.gov = null; closeModal(); toast('اتحفظ ✓');
    location.hash = '#/meeting/' + r.meeting.id; render(); };
  const bindMeetModal = () => {
    bindAttBox($('#mtf [data-seats]'), $('#mtfQuorum'));
    const b = $('#modal [data-act=decAdd]'); if (b) b.onclick = () => {
      const box = $('#decs'), n = box.querySelectorAll('[data-dec]').length, tmp = document.createElement('div');
      tmp.innerHTML = decRow({}, n); box.appendChild(tmp.firstElementChild); enhanceUI(box); };
  };
  on('meetNew', () => { govForm(meetingForm(null), '#mtf', f => meetBuild(f), 'GOV_SAVE_MEETING', meetAfter); bindMeetModal(); });
  on('meetEdit', () => { govForm(meetingForm(S.meeting), '#mtf', f => meetBuild(f, S.meeting.id), 'GOV_SAVE_MEETING', meetAfter); bindMeetModal(); });

  const reloadDecs = async () => {
    const r = await call('GOV_LIST_DECISIONS', S.decF || {});
    if (r.success) { S.decisions = r.items; S.decSummary = r.summary || {}; }
  };
  const df = $('#df');
  if (df) df.onsubmit = async e => { e.preventDefault(); S.decF = { ...(S.decF || {}), ...formData(df) };
    await busy(df.querySelector('button'), reloadDecs); render(); };
  app.querySelectorAll('[data-dfchip]').forEach(b => b.onclick = async () => {
    const k = b.dataset.dfchip, base = { q: (S.decF || {}).q || '', category: (S.decF || {}).category || '' };
    if (k.startsWith('ex:')) base.exec_status = k.slice(3);
    else if (k.startsWith('al:')) base.alert = k.slice(3);
    S.decF = base; await reloadDecs(); render();
  });
  app.querySelectorAll('[data-decprt]').forEach(b => b.onclick = async ev => {
    ev.stopPropagation();
    const r = await busy(b, () => call('GOV_GET_DECISION', { id: b.dataset.decprt }));
    if (!r.success) return toast(r.message, true);
    printDoc(decisionExtractHTML(r.decision));
  });
  app.querySelectorAll('[data-decopen]').forEach(el => el.onclick = async () => {
    const r = await call('GOV_GET_DECISION', { id: el.dataset.decopen });
    if (!r.success) return toast(r.message, true);
    const d = r.decision;
    openModal(decisionModalHTML(d, r.canManage), m => {
      m.querySelectorAll('[data-close]').forEach(x => (x.onclick = closeModal));
      const prt = m.querySelector('[data-act=decModalPrint]');
      if (prt) prt.onclick = () => printDoc(decisionExtractHTML(d));
      m.querySelectorAll('[data-step]').forEach(sb => sb.onclick = () => {
        m.querySelector('[name=exec_status]').value = sb.dataset.step;
        m.querySelectorAll('[data-step]').forEach(x => x.classList.toggle('on', x === sb));
      });
      const dcf = m.querySelector('#dcf');
      if (dcf) dcf.onsubmit = async e => {
        e.preventDefault();
        const s = await busy(dcf.querySelector('[type=submit]'), () => call('GOV_SAVE_DECISION', { id: d.id, ...formData(dcf) }));
        if (!s.success) { m.querySelector('#ferr').innerHTML = `<div class="alert bad">${esc(s.message)}</div>`; return; }
        S.decisions = null; if (S.meeting && S.meeting.id === d.meeting_id) S.meeting = null;
        closeModal(); toast('اتحفظت متابعة القرار ✓'); render();
      };
      loadDocBoxes();
    });
  });

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
  on('myCancel', async b => {
    const ok = await uiConfirm({ title: 'إلغاء حجز النشاط', msg: 'هل أنت متأكد من رغبتك في إلغاء حجزك في هذا النشاط وفق لائحة الاسترداد المعلنة؟', tone: 'bad', okText: 'تأكيد إلغاء الحجز' });
    if (!ok) return;
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
  on('actRepFull', () => printDoc(tripManifestReportHTML(S.trip, S.actBk, S.actSum, 'full')));
  on('actRepBus', () => printDoc(tripManifestReportHTML(S.trip, S.actBk, S.actSum, 'bus')));
  on('actRepUnpaid', () => printDoc(tripManifestReportHTML(S.trip, S.actBk, S.actSum, 'unpaid')));
  const actDo = async (b, action, extra, msg) => { const r = await busy(b, () => call(action, { activityId: S.trip.id, ...extra }));
    if (!r.success) return toast(r.message, true); toast(msg(r)); render(); };
  on('actStatus', b => actDo(b, 'ACT_SET_STATUS', { status: b.dataset.s }, () => 'اتغيرت الحالة ✓'));
  on('actSeats', b => actDo(b, 'ACT_ASSIGN_SEATS', {}, r => `اتوزعت ${r.seats} كرسي بالأسبقية ✓`));
  on('actClose', async b => {
    const ok = await uiConfirm({ title: 'إقفال النشاط وترحيل المزايا', msg: 'سيتم إقفال النشاط وتسجيل دعم النقابة للحاضرين وإعفاءات المشرفين في سجل المزايا. هل تود المتابعة؟', tone: 'warn', okText: 'إقفال النشاط' });
    if (ok) actDo(b, 'ACT_CLOSE', {}, r => `اتقفل ✓ — ${r.result.benefits} ميزة دعم و${r.result.supervisors} إعفاء مشرف`);
  });
  on('actCancelAll', async b => {
    const ok = await uiConfirm({ title: 'إلغاء النشاط بالكامل', msg: 'سيتم إلغاء النشاط ورد كامل المبالغ المسدّدة لجميع الحاجزين. هل أنت متأكد؟', tone: 'bad', okText: 'إلغاء النشاط ورد المدفوع' });
    if (ok) actDo(b, 'ACT_SET_STATUS', { status: 'ملغى' }, () => 'اتلغى النشاط واترد المدفوع');
  });
  on('actSup', () => {
    openModal(`<h3>👤 إضافة مشرف للرحلة / النشاط</h3><form id="supf">
      <div class="grid2">
        <label class="f"><span>الرقم الوظيفي للمشرف</span><input class="input" name="jobId" inputmode="numeric" dir="ltr" required placeholder="مثال: 97117"></label>
        <label class="f"><span>نسبة إعفائه من الاشتراك (%)</span><input class="input" name="pct" type="number" min="0" max="100" value="100"></label>
      </div>
      <label class="f"><span>المهمة المكلّف بها</span><input class="input" name="task" value="مشرف رحلة"></label>
      <div id="ferr"></div>
      <div class="acts"><button class="btn" type="submit">إضافة المشرف</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`, m => {
      m.querySelector('[data-close]').onclick = closeModal;
      m.querySelector('#supf').onsubmit = async e => {
        e.preventDefault();
        const d = formData(e.target);
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('ACT_SUPERVISOR', { activityId: S.trip.id, jobId: d.jobId, task: d.task || 'مشرف', self_exempt_pct: +d.pct || 0 }));
        if (!r.success) { m.querySelector('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اتضاف المشرف ✓'); render();
      };
    });
  });
  on('bkPay', async b => {
    const amt = await uiPrompt({ title: 'تحصيل اشتراك حجز رحلة', msg: 'أدخل المبلغ المحصّل من العضو لإصدار سند قبض رسمي:', label: 'المبلغ المحصّل (ج.م)', kind: 'amount', value: b.dataset.rest, okText: 'تحصيل وإصدار إيصال' });
    if (!amt) return;
    busy(b, () => call('ACT_PAY', { bookingId: b.dataset.id, amount: amt })).then(r => { if (!r.success) return toast(r.message, true); toast('اتحصّل — إيصال ' + r.receipt_no); render(); });
  });
  on('bkCancel', async b => {
    const reason = await uiPrompt({ title: 'إلغاء حجز عضو بالنشاط', msg: 'أدخل سبب إلغاء الحجز لحساب المردود وفق لائحة النشاط:', label: 'سبب الإلغاء (إجباري)', tone: 'bad', okText: 'تأكيد الإلغاء' });
    if (!reason) return;
    busy(b, () => call('ACT_CANCEL', { bookingId: b.dataset.id, reason })).then(r => { if (!r.success) return toast(r.message, true); toast(+r.refund ? 'اتلغى — مردود ' + r.refund : 'اتلغى'); render(); });
  });

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
  on('sumWithdraw', async b => {
    const ok = await uiConfirm({ title: 'سحب طلب المصيف', msg: 'هل تريد سحب طلبك من موسم المصيف قبل إجراء التخصيص؟', tone: 'warn', okText: 'سحب الطلب' });
    if (ok) sumCall(b, 'SUM_WITHDRAW', { applicationId: b.dataset.id }, () => 'اتسحب الطلب');
  });
  on('sumApolMy', async b => {
    const reason = await uiPrompt({ title: 'الاعتذار عن تخصيص المصيف', msg: 'أدخل سبب الاعتذار (اختياري) وسيُحسب الاسترداد حسب اللائحة:', label: 'سبب الاعتذار', required: false, tone: 'warn', okText: 'تسجيل الاعتذار' });
    if (reason === null) return;
    sumCall(b, 'SUM_APOLOGIZE_MY', { applicationId: b.dataset.id, reason }, r => +r.refund ? `اتسجل الاعتذار — هيترد لك ${r.refund} ج` : 'اتسجل الاعتذار');
  });
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
  on('sumRepPrint', () => printDoc(summerManifestReportHTML()));
  const sid = () => ({ seasonId: S.season.id });
  on('sumStatus', b => sumCall(b, 'SUM_SET_STATUS', { ...sid(), status: b.dataset.s }, () => 'اتغيرت الحالة ✓'));
  on('sumAlloc', async b => { let seed = '';
    if (S.season.method !== 'أسبقية') {
      seed = await uiPrompt({ title: 'إجراء القرعة العلنية وتوزيع الوحدات', msg: 'أدخل البذرة المعلنة للقرعة (تُنشر مع النتيجة ليتحقق منها أي عضو). يُجرى التوزيع مرة واحدة ولا يُعاد.', label: 'البذرة المعلنة للقرعة', value: S.season.lottery_seed || '', tone: 'warn', okText: 'تنفيذ القرعة والتوزيع' });
      if (!seed) return;
    } else {
      const ok = await uiConfirm({ title: 'توزيع وحدات المصيف بالأسبقية', msg: 'التوزيع يُجرى مرة واحدة ولا يُعاد. هل أنت متأكد من المتابعة؟', tone: 'warn', okText: 'تنفيذ التوزيع' });
      if (!ok) return;
    }
    sumCall(b, 'SUM_ALLOCATE', { ...sid(), seed }, r => `اتوزّع ✓ ${r.result.accepted} مقبول و${r.result.reserve} احتياطي`); });
  on('sumClose', async b => {
    const ok = await uiConfirm({ title: 'إقفال موسم المصيف', msg: 'سيتم تسجيل دعم النقابة في سجل المزايا وقيد مستحقات ملاك الوحدات محاسبياً. هل تود المتابعة؟', tone: 'warn', okText: 'إقفال الموسم' });
    if (ok) sumCall(b, 'SUM_CLOSE', sid(), r => `اتقفل ✓ — ${r.result.benefits} ميزة دعم و${r.result.owner_entries} قيد استحقاق`);
  });
  on('sumCancelAll', async b => {
    const ok = await uiConfirm({ title: 'إلغاء موسم المصيف بالكامل', msg: 'سيتم إلغاء الموسم ورد كافة المبالغ المحصّلة بالكامل. هل أنت متأكد؟', tone: 'bad', okText: 'إلغاء الموسم' });
    if (ok) sumCall(b, 'SUM_SET_STATUS', { ...sid(), status: 'ملغى' }, () => 'اتلغى الموسم');
  });
  on('sumPay', async b => {
    const amt = await uiPrompt({ title: 'تحصيل اشتراك المصيف', msg: 'أدخل المبلغ المحصّل لإصدار سند قبض رسمي:', label: 'المبلغ المحصّل (ج.م)', kind: 'amount', value: b.dataset.rest, okText: 'تحصيل وإصدار إيصال' });
    if (!amt) return;
    sumCall(b, 'SUM_PAY', { applicationId: b.dataset.id, amount: amt }, r => 'اتحصّل — إيصال ' + r.receipt_no);
  });
  on('sumApol', async b => {
    const reason = await uiPrompt({ title: 'تسجيل اعتذار عضو عن المصيف', msg: 'أدخل سبب الاعتذار لحساب المردود وتصعيد الاحتياطي:', label: 'سبب الاعتذار (إجباري)', tone: 'warn', okText: 'تسجيل الاعتذار' });
    if (!reason) return;
    sumCall(b, 'SUM_APOLOGIZE', { applicationId: b.dataset.id, reason }, r => +r.refund ? 'اتسجل — مردود ' + r.refund : 'اتسجل الاعتذار');
  });
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
    const sync = () => {
      const t = (S.grtTypes || []).find(x => x.code === gaf.type.value);
      $('#gother').hidden = gaf.who.value !== 'other';
      const rel = gaf.who.value === 'other' ? gaf.subject_relation.value : (gaf.who.selectedOptions[0]?.dataset.rel || 'العضو');
      const calc = calcGrantRate(t, rel, !!S.grtIsBoard);
      const ab = $('#grtAmtBox');
      if (ab) ab.innerHTML = calc ? `<div class="alert ok" style="margin:0">💰 <b>المبلغ المقرر لهذه الحالة: ${money(calc.amount)} ج.م</b> <small>(${esc(calc.label)})</small></div>` : '';
      $('#gdocs').textContent = t && t.docs.length ? 'المستندات المطلوبة: ' + t.docs.join('، ') + (t.deadline_days ? ` — خلال ${t.deadline_days} يوم من الواقعة` : '') : '';
    };
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
  on('grtRepPrint', () => printDoc(grantsRegisterReportHTML(S.grtList)));
  const grtDo = async (b, action, extra, msg) => { const r = await busy(b, () => call(action, extra)); if (!r.success) return toast(r.message, true); toast(msg); render(); };
  on('grtCancel', async b => {
    const ok = await uiConfirm({ title: 'إلغاء طلب المنحة', msg: 'هل تود إلغاء طلب المنحة المقدّم؟', tone: 'bad', okText: 'إلغاء الطلب' });
    if (ok) grtDo(b, 'GRT_CANCEL_MY', { requestId: b.dataset.id }, 'اتلغى الطلب');
  });
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
  on('grtReject', async b => {
    const reason = await uiPrompt({ title: 'رفض طلب المنحة الاجتماعية', msg: 'أدخل سبب رفض الطلب ليُثبت في سجل العضو:', label: 'سبب الرفض (إجباري)', tone: 'bad', okText: 'تأكيد الرفض' });
    if (!reason) return;
    grtDo(b, 'GRT_DECIDE', { requestId: b.dataset.id, approve: false, reason }, 'اترفض');
  });
  const openGrantChequeModal = async gid => {
    const g = [...(S.grtList || []), ...((S.payReqs && S.payReqs.approvedGrants) || [])].find(x => x.id === gid);
    if (!g) return;
    let nextNo = S.payReqs && S.payReqs.nextChequeNo;
    if (!nextNo) { const nx = await call('FIN_NEXT_CHEQUE'); if (nx.success) nextNo = nx.next_no; }
    openModal(issueChequeModalHTML({
      refNo: g.req_no, payee: g.person?.full_name || g.subject_name || '—', amount: g.amount,
      debitLabel: `${g.expense_account || '5200'} — ${g.type_name}`, nextNo, allowDecision: false
    }), m => {
      m.querySelector('[data-close]').onclick = closeModal;
      m.querySelector('#ichqf').onsubmit = async e => {
        e.preventDefault();
        const d = formData(e.target);
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('GRT_PAY', { requestId: g.id, cheque_no: d.cheque_no, date: d.date }));
        if (!r.success) { m.querySelector('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal();
        const cid = r.request && r.request.cheque && r.request.cheque.id;
        toast('اتستخرج الشيك واترحّل القيد واتسجّل في المزايا ✓');
        if (cid) location.hash = '#/cheque/' + cid; else render();
      };
    });
  };
  on('grtPay', b => openGrantChequeModal(b.dataset.id));
  app.querySelectorAll('[data-grtissue]').forEach(b => b.onclick = () => openGrantChequeModal(b.dataset.grtissue));

  const openStaffGrantModal = async () => {
    if (!S.grtTypes) { const r = await call('GRT_TYPES'); if (r.success) S.grtTypes = r.items; }
    await loadDecs();
    openModal(staffGrantForm(), m => {
      m.querySelector('[data-close]').onclick = closeModal;
      const f = m.querySelector('#sgf'), qIn = m.querySelector('#sgMemQ'), lst = m.querySelector('#sgMemList');
      const pidIn = m.querySelector('#sgPid'), jobIn = m.querySelector('#sgJob'), picked = m.querySelector('#sgPicked');
      const whoSel = m.querySelector('#sgWho'), otherBox = m.querySelector('#sgOther');
      const typeSel = m.querySelector('#sgType'), docsBoxEl = m.querySelector('#sgDocsBox'), rateHint = m.querySelector('#sgRateHint');
      let curMem = null, tmr = null;
      const renderMemCard = mem => {
        curMem = mem;
        if (!mem) { pidIn.value = ''; jobIn.value = ''; picked.innerHTML = ''; return; }
        pidIn.value = mem.id; jobIn.value = mem.job_id || '';
        picked.innerHTML = `<div class="mpicked">
          <div><b>👤 ${esc(mem.full_name)}</b> <small class="muted">(${esc(mem.job_id || 'بدون رقم وظيفي')})</small>
            <div class="muted">${esc(mem.workplace || '—')} · ${esc(mem.union_org || '—')} · ${esc(mem.member_state || '—')}</div></div>
          <span class="pill ${mem.eligible ? 'ok' : 'bad'}">${mem.eligible ? '✓ مستحق للمنح' : '⚠️ غير مستحق حالياً'}</span>
        </div>`;
        const famOpts = (mem.family || []).map(fm => `<option value="${fm.id}" data-rel="${esc(fm.relation)}">${esc(fm.full_name)} (${esc(fm.relation)})</option>`).join('');
        whoSel.innerHTML = `<option value="self">العضو نفسه / وفاة العضو (${esc(mem.full_name)})</option>${famOpts}<option value="other">فرد أسرة آخر (إدخال يدوي)</option>`;
        syncGrantUI();
      };
      const syncGrantUI = () => {
        const t = (S.grtTypes || []).find(x => x.code === typeSel.value);
        otherBox.hidden = whoSel.value !== 'other';
        let rel = 'العضو';
        if (whoSel.value === 'other') rel = f.subject_relation.value;
        else if (whoSel.value !== 'self') rel = whoSel.selectedOptions[0]?.dataset.rel || '';
        let amt = t ? t.amount : null;
        if (t && Array.isArray(t.rates) && t.rates.length) {
          const rMatch = t.rates.find(rt => rt.relation === rel) || t.rates.find(rt => !rt.relation);
          if (rMatch) amt = rMatch.amount;
        }
        rateHint.textContent = amt ? `الفئة المقررة: ${Number(amt).toLocaleString('ar-EG')} ج.م` : 'يحدده المجلس';
        const docs = (t && t.docs) || [];
        docsBoxEl.innerHTML = docs.length
          ? `<div class="muted" style="font-size:12px;margin-bottom:4px">المستندات اللائحية المطلوبة${t.deadline_days ? ` (خلال ${numAr(t.deadline_days)} يوماً من الواقعة)` : ''}:</div>`
            + docs.map((dn, i) => `<label class="row" style="gap:8px;padding:4px 0;cursor:pointer"><input type="checkbox" data-sgdoc="${esc(dn)}" checked> <span>${esc(dn)}</span></label>`).join('')
          : '<div class="muted">لا توجد مستندات إلزامية محددة باللائحة لهذا النوع.</div>';
      };
      qIn.oninput = () => {
        clearTimeout(tmr);
        const q = qIn.value.trim();
        if (q.length < 2) { lst.hidden = true; return; }
        tmr = setTimeout(async () => {
          const r = await call('FIN_MEMBER_LOOKUP', { q, date: f.event_date.value });
          const items = (r.success && r.items) || [];
          if (!items.length) { lst.innerHTML = '<div class="mlookup-item"><small>لا يوجد عضو مطابق</small></div>'; lst.hidden = false; return; }
          lst.innerHTML = items.map((x, idx) => `<div class="mlookup-item" data-midx="${idx}">
            <b>${esc(x.full_name)}</b> <span class="pill ${x.eligible ? 'ok' : 'warn'}" style="float:left">${x.eligible ? 'مستحق' : esc(x.union_org || 'غير مستحق')}</span>
            <small>رقم وظيفي: ${esc(x.job_id || '—')} · ${esc(x.workplace || '—')} · أسرة مسجّلة: ${numAr((x.family || []).length)}</small>
          </div>`).join('');
          lst.hidden = false;
          lst.querySelectorAll('[data-midx]').forEach(el => el.onclick = () => {
            const pickedMem = items[+el.dataset.midx];
            qIn.value = pickedMem.full_name;
            lst.hidden = true;
            renderMemCard(pickedMem);
          });
        }, 220);
      };
      f.event_date.addEventListener('change', async () => {
        if (curMem && curMem.job_id) {
          const r = await call('FIN_MEMBER_LOOKUP', { q: curMem.job_id, date: f.event_date.value });
          const hit = (r.items || []).find(x => x.id === curMem.id);
          if (hit) renderMemCard(hit);
        }
      });
      typeSel.onchange = syncGrantUI;
      whoSel.onchange = syncGrantUI;
      f.subject_relation.onchange = syncGrantUI;
      syncGrantUI();
      f.onsubmit = async e => {
        e.preventDefault();
        if (!pidIn.value && !qIn.value.trim()) {
          m.querySelector('#ferr').innerHTML = '<div class="alert bad">اختر العضو أولاً من مربع البحث بالاسم أو الرقم الوظيفي.</div>';
          return;
        }
        const d = formData(f);
        const docs = [...f.querySelectorAll('[data-sgdoc]')].map(ch => ({ name: ch.dataset.sgdoc, received: ch.checked }));
        const payload = {
          personId: pidIn.value || undefined,
          jobId: !pidIn.value ? qIn.value.trim() : undefined,
          type: d.type,
          event_date: d.event_date,
          decision_id: d.decision_id || undefined,
          notes: d.notes || undefined,
          staff_verified: f.staff_verified.checked,
          docs
        };
        if (d.who === 'self') payload.subject_relation = 'العضو';
        else if (d.who === 'other') { payload.subject_name = d.subject_name; payload.subject_relation = d.subject_relation; }
        else payload.family_member_id = d.who;
        const r = await busy(f.querySelector('[type=submit]'), () => call('GRT_APPLY', payload));
        if (!r.success) { m.querySelector('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal();
        toast(`اتسجّل طلب المنحة ${r.request.req_no} (${r.request.status}) ✓`);
        if (location.hash.startsWith('#/grantsadmin') || location.hash.startsWith('#/payreqs')) render();
        else location.hash = '#/grantsadmin';
      };
    }, 'lg');
  };
  on('grtStaffNew', openStaffGrantModal);
  on('grtProxy', openStaffGrantModal);
  on('grtRate', async b => { await loadDecs();
    const today = new Date().toISOString().slice(0, 10);
    openModal(`<h3>⚙️ إضافة / تعديل فئة ومبلغ منحة</h3><form id="grf">
      <div class="grid2">
        <label class="f"><span>نوع المنحة</span><select class="input" name="type">${(S.grtTypes || []).map(t => `<option value="${t.code}">${esc(t.name)}</option>`).join('')}</select></label>
        <label class="f"><span>المبلغ (ج.م)</span><input class="input" name="amount" inputmode="decimal" required placeholder="مثال: 500 أو 1000"></label>
      </div>
      <div class="grid2">
        <label class="f"><span>الفئة / صلة القرابة</span><select class="input" name="relation"><option value="">الكل (الدرجة الأولى / الافتراضي)</option>${options(['العضو', 'زوج', 'زوجة', 'أب', 'أم', 'ابن', 'ابنة', 'عضو مجلس إدارة'], '', false)}</select></label>
        <label class="f"><span>يسري من تاريخ</span><input class="input" type="date" name="valid_from" value="${today}"></label>
      </div>
      <div class="grid2">
        <label class="f"><span>قرار المجلس (اختياري)</span><select class="input" name="decision_id"><option value="">— لائحي —</option>${(S.decOpts || []).map(d => `<option value="${d.id}">${esc(d.decision_no)}</option>`).join('')}</select></label>
        <label class="f"><span>ملاحظات / سند اللائحة</span><input class="input" name="notes" placeholder="مثال: لائحة الدورة الحالية"></label>
      </div>
      <div id="ferr"></div><div class="acts"><button class="btn gold" type="submit">💾 حفظ الفئة</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`, () => {
      $('#modal [data-close]').onclick = closeModal;
      $('#grf').onsubmit = async e => { e.preventDefault();
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('GRT_SET_RATE', formData(e.target)));
        if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('تم حفظ فئة المنحة ✓'); render(); }; }); });
  app.querySelectorAll('[data-grtdel]').forEach(b => b.onclick = async () => {
    const ok = await uiConfirm({ title: 'حذف فئة منحة', msg: 'هل تريد حذف هذه الفئة من جدول اللائحة؟ (لا يؤثر على المنح المصروفة سابقاً).', tone: 'bad', okText: 'حذف الفئة' });
    if (!ok) return;
    const r = await busy(b, () => call('GRT_DEL_RATE', { id: b.dataset.grtdel }));
    if (!r.success) return toast(r.message, true);
    toast('تم حذف الفئة ✓'); render();
  });

  // ── الأجهزة ──
  const devDo = async (b, action, extra, msg) => { const r = await busy(b, () => call(action, extra)); if (!r.success) return toast(r.message, true); toast(msg); render(); };
  app.querySelectorAll('form[data-devorder]').forEach(f => f.onsubmit = e => { e.preventDefault();
    devDo(f.querySelector('button'), 'DEV_ORDER', { itemId: f.dataset.devorder, ...formData(f) }, 'اتسجل الحجز ✓ — المسئول هيأكد معاك'); });
  on('devCancel', async b => {
    const ok = await uiConfirm({ title: 'إلغاء حجز العرض / الجهاز', msg: 'هل تود إلغاء حجزك من هذا العرض؟', tone: 'bad', okText: 'إلغاء الحجز' });
    if (ok) devDo(b, 'DEV_CANCEL_MY', { orderId: b.dataset.id }, 'اتلغى');
  });
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
    if (b.dataset.s === 'مرفوض') {
      reason = await uiPrompt({ title: 'رفض طلب حجز جهاز / عرض', msg: 'أدخل سبب رفض الطلب:', label: 'سبب الرفض (إجباري)', tone: 'bad', okText: 'تأكيد الرفض' });
      if (!reason) return;
    }
    const r = await busy(b, () => call('DEV_DECIDE', { orderId: b.dataset.id, status: b.dataset.s, reason }));
    if (!r.success) return toast(r.message, true); toast('اتحدّث ✓'); await reloadOrders(); render(); });

  // ── التقارير ومركز التقارير المؤسسية ──
  const repf = $('#repf');
  if (repf) repf.onsubmit = e => { e.preventDefault(); S.repYear = repf.year.value; render(); };
  on('repPrint', () => printDoc(comprehensiveReportHTML()));

  const printSettlementById = async id => {
    const r = await call('REP_SETTLEMENT', { id });
    if (!r.success || !r.settlement) return toast(r.message || 'تعذر تحميل بيانات التسوية', true);
    printDoc(settlementReportHTML(r.settlement));
  };
  app.querySelectorAll('[data-stlprt]').forEach(b => b.onclick = ev => { ev.stopPropagation(); printSettlementById(b.dataset.stlprt); });

  on('stlRepPick', async b => {
    const r = await busy(b, () => call('REP_SETTLEMENT', {}));
    if (!r.success) return toast(r.message, true);
    const list = r.items || [];
    if (!list.length) return uiAlert({ title: 'لا توجد تسويات مسجّلة', msg: 'لم تُسجّل أي تسوية سلفة أو عهدة حتى الآن. يمكنك إنشاء تسوية جديدة من شاشة التسويات والعُهد المفتوحة.', tone: 'warn' });
    openModal(`<h3>🧾 طباعة تقرير وكشف تسوية سلفة عهدة</h3>
      <p class="muted">اختر التسوية المطلوبة (سواء كانت تسوية شيك مفرد أو تسوية سلفة مجمّعة لعدة شيكات) لعرض وطباعة الكشف الرسمي المعتمد بالبنود المسوّاة والمبالغ المتبقية:</p>
      <form id="stlrpf">
        <label class="f"><span>سجل التسويات المسجّلة (${numAr(list.length)})</span>
          <select class="input" name="id">${list.map(s => `<option value="${s.id}">${dt(s.settle_date)} — ${esc(s.payee_name || '—')} — ${s.cheques_count > 1 ? `مجمّعة (${numAr(s.cheques_count)} شيكات: ${esc(s.cheques_nos)})` : `شيك ${esc(s.cheques_nos)}`} — مصروف ${money(s.spent)} [${esc(s.status)}]</option>`).join('')}</select>
        </label>
        <div class="acts"><button class="btn gold" type="submit">🖨️ عرض وطباعة كشف التسوية (A4)</button><button class="btn sec" type="button" data-close>إلغاء</button></div>
      </form>`, m => {
      m.querySelector('[data-close]').onclick = closeModal;
      m.querySelector('#stlrpf').onsubmit = async e => {
        e.preventDefault();
        const id = e.target.id.value;
        await busy(e.target.querySelector('[type=submit]'), () => printSettlementById(id));
      };
    });
  });

  on('opsRepOpen', () => {
    const yr = (S.rep && S.rep.year) || new Date().getFullYear();
    const defFrom = (S.finP && S.finP.from) || `${yr}-01-01`;
    const defTo = (S.finP && S.finP.to) || new Date().toISOString().slice(0, 10);
    const defAcc = location.hash.startsWith('#/ledger/1101') ? '1101' : '1102';
    openModal(`<h3>🏦 استخراج كشف حساب العمليات والشيكات</h3>
      <p class="muted">يستخرج حركة الإيداعات والمسحوبات مرتبة زمنياً مع الرصيد المتحرك بعد كل عملية، وموقف الشيكات الصادرة والمنصرفة والمعلّقة:</p>
      <form id="opsrf">
        <label class="f"><span>نطاق الحساب المالي</span>
          <select class="input" name="account">
            <option value="1102" ${defAcc === '1102' ? 'selected' : ''}>1102 — البنك (الحساب الجاري للجنة النقابية)</option>
            <option value="1101" ${defAcc === '1101' ? 'selected' : ''}>1101 — خزينة اللجنة النقابية (النقدية بالصندوق)</option>
            <option value="ALL">مجمّع — البنك والخزينة معاً (1101 + 1102)</option>
          </select>
        </label>
        <div class="grid2">
          <label class="f"><span>من تاريخ</span><input class="input" type="date" name="from" value="${esc(defFrom)}" required></label>
          <label class="f"><span>إلى تاريخ</span><input class="input" type="date" name="to" value="${esc(defTo)}" required></label>
        </div>
        <div id="ferr"></div>
        <div class="acts"><button class="btn gold" type="submit">🖨️ استخراج الكشف الرسمي (A4)</button><button class="btn sec" type="button" data-close>إلغاء</button></div>
      </form>`, m => {
      m.querySelector('[data-close]').onclick = closeModal;
      m.querySelector('#opsrf').onsubmit = async e => {
        e.preventDefault();
        const d = formData(e.target);
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('REP_OPS_STATEMENT', d));
        if (!r.success) { m.querySelector('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        printDoc(operationsAndChequesReportHTML(r.report));
      };
    });
  });

  on('gaRepPrint', async () => {
    await loadLists();
    const wps = (S.lists && S.lists.workplace) || [];
    openModal(`<h3>🏛️ تقرير وكشف الجمعية العمومية (النقابة العامة)</h3>
      <p class="muted">يُصدر التقرير القانوني والإحصائي لأعضاء الجمعية العمومية المقيدين بالنقابة العامة وحساب نصاب الاجتماع الأول (٥٠٪+١) والثاني (٢٥٪) والكشف الاسمي للتوقيع:</p>
      <form id="garf">
        <div class="grid2">
          <label class="f"><span>فئة الأعضاء بالكشف</span>
            <select class="input" name="member_state">
              <option value="نشط">الأعضاء النشطون فقط (لهم حق الحضور والتصويت)</option>
              <option value="الكل">جميع المقيدين بالنقابة العامة (نشط + معاش)</option>
              <option value="معاش">الأعضاء المحالون للمعاش (نقابة عامة)</option>
            </select>
          </label>
          <label class="f"><span>تصفية بجهة العمل (اختياري)</span>
            <select class="input" name="workplace"><option value="">جميع جهات ومقار العمل</option>${wps.map(w => `<option value="${esc(w)}">${esc(w)}</option>`).join('')}</select>
          </label>
        </div>
        <div id="ferr"></div>
        <div class="acts"><button class="btn gold" type="submit">🖨️ استخراج كشف الجمعية العمومية (A4)</button><button class="btn sec" type="button" data-close>إلغاء</button></div>
      </form>`, m => {
      m.querySelector('[data-close]').onclick = closeModal;
      m.querySelector('#garf').onsubmit = async e => {
        e.preventDefault();
        const d = formData(e.target);
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('REP_GENERAL_ASSEMBLY', d));
        if (!r.success) { m.querySelector('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        printDoc(generalAssemblyReportHTML(r.report));
      };
    });
  });

  on('hubFsPrint', async b => {
    const yr = (S.rep && S.rep.year) || new Date().getFullYear();
    const [t, a] = await busy(b, () => Promise.all([
      call('FIN_TRIAL_BALANCE', { from: `${yr}-01-01`, to: S.rep && S.rep.year ? `${yr}-12-31` : new Date().toISOString().slice(0, 10) }),
      S.accts ? null : call('FIN_ACCOUNTS')
    ]));
    if (!t.success) return toast(t.message, true);
    S.trial = t; if (a && a.success) S.accts = a.items;
    printDoc(financialStatementsReportHTML(t));
  });
  on('hubTbPrint', async b => {
    const yr = (S.rep && S.rep.year) || new Date().getFullYear();
    const t = await busy(b, () => call('FIN_TRIAL_BALANCE', { from: `${yr}-01-01`, to: S.rep && S.rep.year ? `${yr}-12-31` : new Date().toISOString().slice(0, 10) }));
    if (!t.success) return toast(t.message, true);
    S.trial = t; printDoc(trialBalanceReportHTML(t));
  });
  on('hubBudPrint', async b => {
    const yr = (S.rep && S.rep.year) || new Date().getFullYear();
    const r = await busy(b, () => call('REP_BUDGET', { year: String(yr) }));
    if (!r.success) return toast(r.message, true);
    S.bud = r.report; printDoc(budgetReportHTML(r.report));
  });
  on('hubBankPrint', async b => {
    const r = await busy(b, () => call('BANK_RECON', {}));
    if (!r.success) return toast(r.message, true);
    S.recon = r.recon; printDoc(bankReconReportHTML(r.recon));
  });
  on('hubTripPick', async b => {
    const r = await busy(b, () => call('ACT_LIST', { all: true }));
    if (!r.success) return toast(r.message, true);
    const acts = r.items || [];
    if (!acts.length) return uiAlert({ title: 'لا توجد رحلات أو أنشطة مسجّلة', msg: 'لم يُسجّل أي نشاط أو رحلة بعد. يمكنك إضافة رحلة جديدة من قسم الأنشطة والرحلات.', tone: 'warn' });
    openModal(`<h3>🚌 استخراج كشوف حجز الرحلات والمشتركين والدفع</h3>
      <p class="muted">اختر الرحلة أو النشاط ونوع الكشف المطلوب طباعته:</p>
      <form id="trprpf">
        <label class="f"><span>الرحلة / النشاط (${numAr(acts.length)})</span>
          <select class="input" name="id">${acts.map(a => `<option value="${a.id}">${esc(a.title)} — ${dt(a.start_date)} (${esc(a.status)})</option>`).join('')}</select>
        </label>
        <label class="f"><span>نوع الكشف المطلوب</span>
          <select class="input" name="mode">
            <option value="full">🎫 الكشف الشامل للمشتركين والتحصيل المالي وأرقام الإيصالات</option>
            <option value="bus">🚌 كشف تسكين مقاعد الأتوبيس وتفقد المشرف (ذهاباً وعودةً)</option>
            <option value="unpaid">⚠️ كشف متابعة تحصيل المبالغ المتأخرة قبل الرحلة</option>
          </select>
        </label>
        <div id="ferr"></div>
        <div class="acts"><button class="btn gold" type="submit">🖨️ عرض وطباعة الكشف (A4)</button><button class="btn sec" type="button" data-close>إلغاء</button></div>
      </form>`, m => {
      m.querySelector('[data-close]').onclick = closeModal;
      m.querySelector('#trprpf').onsubmit = async e => {
        e.preventDefault();
        const d = formData(e.target);
        const [ga, bk] = await busy(e.target.querySelector('[type=submit]'), () => Promise.all([
          call('ACT_GET', { id: d.id }),
          call('ACT_BOOKINGS', { activityId: d.id })
        ]));
        if (!ga.success || !bk.success) { m.querySelector('#ferr').innerHTML = `<div class="alert bad">${esc((!ga.success ? ga.message : bk.message) || 'تعذر التحميل')}</div>`; return; }
        printDoc(tripManifestReportHTML(ga.activity, bk.items, bk.summary, d.mode));
      };
    });
  });
  on('hubGrtPrint', async b => {
    const r = await busy(b, () => call('GRT_LIST', {}));
    if (!r.success) return toast(r.message, true);
    S.grtList = r.items; printDoc(grantsRegisterReportHTML(r.items));
  });
  on('hubDecPrint', async b => {
    const r = await busy(b, () => call('GOV_LIST_DECISIONS', {}));
    if (!r.success) return toast(r.message, true);
    S.decisions = r.items; S.decSummary = r.summary || {}; printDoc(decisionsExecReportHTML(r.items, r.summary));
  });
  on('hubBenPrint', async b => {
    const r = await busy(b, () => call('BEN_REPORT', { year: (S.rep && S.rep.year) || undefined }));
    if (!r.success) return toast(r.message, true);
    S.benRep = r.report; printDoc(benefitsSummaryReportHTML(r.report));
  });
  on('hubAdvPrint', async b => {
    const r = await busy(b, () => call('FIN_SETTLEMENTS'));
    if (!r.success) return toast(r.message, true);
    S.openAdv = r.open; printDoc(openAdvancesReportHTML(r.open || []));
  });

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
  on('benRepPrint', () => printDoc(benefitsSummaryReportHTML()));

  // ── المالية ──
  app.querySelectorAll('[data-chq]').forEach(li => li.onclick = () => { location.hash = '#/cheque/' + li.dataset.chq; });
  app.querySelectorAll('[data-ledger]').forEach(li => li.onclick = () => { location.hash = '#/ledger/' + li.dataset.ledger; });
  app.querySelectorAll('[data-entry]').forEach(li => li.onclick = async ev => { ev.stopPropagation();
    const r = await call('FIN_ENTRY', { id: li.dataset.entry }); if (!r.success || !r.entry) return toast(r.message || 'غير موجود', true);
    openModal(entryModal(r.entry), () => { loadDocBoxes();
      $('#modal [data-close]').onclick = closeModal;
      const rv = $('#modal [data-act=revEntry]');
      if (rv) rv.onclick = async () => {
        const reason = await uiPrompt({ title: 'إنشاء قيد عكسي للقيد المحاسبي', msg: `سيتم إنشاء قيد عكسي لإلغاء أثر القيد رقم (${r.entry.entry_no}) مع حفظ القيدين في سجل التدقيق:`, label: 'سبب القيد العكسي (إجباري)', tone: 'bad', okText: 'إنشاء القيد العكسي' });
        if (!reason) return;
        const x = await busy(rv, () => call('FIN_REVERSE', { id: r.entry.id, reason }));
        if (!x.success) return toast(x.message, true); closeModal(); toast('اتعمل قيد عكسي ✓'); render(); };
    }); });
  const pf = $('#pf');
  if (pf) pf.onsubmit = e => { e.preventDefault(); S.finP = formData(pf); render(); };
  const cf = $('#cf');
  if (cf) cf.onsubmit = e => { e.preventDefault(); S.chqF = formData(cf); render(); };
  const ef = $('#ef');
  if (ef) ef.onsubmit = e => { e.preventDefault(); S.entF = formData(ef); render(); };
  const finForm = (html, id, build, action, msg, after, cls = '') => openModal(html, () => {
    $('#modal [data-close]').onclick = closeModal;
    $(id).onsubmit = async e => { e.preventDefault();
      const r = await busy(e.target.querySelector('[type=submit]'), () => call(action, build(e.target)));
      if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
      closeModal(); toast(msg); after ? after(r) : render(); };
  }, cls);
  const ensureFinMeta = async () => {
    await Promise.all([
      !S.accounts ? call('FIN_ACCOUNTS').then(r => { S.accounts = r.success ? r.items : []; }) : null,
      !S.partyNames ? call('POL_PARTIES').then(r => { S.partyNames = r.success ? r.items.filter(x => x.active).map(x => x.name) : []; }) : null,
      !S.decOpts ? call('GOV_LIST_DECISIONS').then(r => { S.decOpts = r.success ? r.items.filter(d => ['صرف', 'دعم نشاط', 'منحة', 'إعفاء'].includes(d.category)) : []; }) : null,
    ]);
  };
  on('chqNew', async () => {
    const [, nx] = await Promise.all([ensureFinMeta(), call('FIN_NEXT_CHEQUE')]);
    finForm(chequeForm(nx && nx.success ? nx.next_no : ''), '#chf', f => formData(f), 'FIN_ISSUE_CHEQUE', 'اتصرف الشيك واترحّل القيد ✓', r => { location.hash = '#/cheque/' + r.id; }, 'lg');
    const f = $('#chf'), chk = async () => {
      if (!f || !f.isConnected) return;
      const d = formData(f), pm = f.querySelector('#polMsg');
      if (!d.expense_account || !+d.amount || f.purpose.value === 'عهدة') { if (pm) pm.innerHTML = ''; return; }
      const r = await call('POL_CHECK', { account: d.expense_account, amount: +d.amount, date: d.date, hasDecision: !!d.decision_id });
      if (pm && pm.isConnected) pm.innerHTML = r.success && r.message ? `<div class="alert warn">📜 ${esc(r.message)}</div>` : '';
    };
    ['amount', 'expense_account', 'decision_id', 'date', 'purpose'].forEach(n => { if (f[n]) f[n].addEventListener('change', chk); });
    const sync = () => { if ($('#chAcc')) $('#chAcc').style.display = $('#chPurpose').value === 'عهدة' ? 'none' : ''; chkCust(); };
    const chkCust = async () => {
      if (!f || !f.isConnected) return;
      const box = f.querySelector('#chqCustAlert');
      const nm = (f.payee_name && f.payee_name.value || '').trim();
      if (!box || f.purpose.value !== 'عهدة' || nm.length < 3) { if (box) box.innerHTML = ''; return; }
      const r = await call('FIN_CUSTODIAN_ALERT', { name: nm });
      if (!box.isConnected) return;
      if (r.success && r.count > 0) {
        box.innerHTML = `<div class="alert ${r.overdue_count > 0 ? 'bad' : 'warn'}" style="margin-bottom:8px">⚠️ <b>تنبيه عُهد مفتوحة على «${esc(nm)}»:</b> يوجد لديه <b>${numAr(r.count)}</b> عهدة مفتوحة بإجمالي <b>${money(r.total)} ج</b>${r.overdue_count > 0 ? ` — منها <b>${numAr(r.overdue_count)} عهدة متأخرة (+30 يوم) بقيمة ${money(r.overdue_total)} ج</b>` : ''}. يُنصح بتسوية العهدة السابقة أو تجميعها.</div>`;
      } else box.innerHTML = '';
    };
    if (f.payee_name) f.payee_name.addEventListener('blur', chkCust);
    sync(); $('#chPurpose').onchange = sync;
  });

  // ── طلبات الصرف واستخراج الشيكات (FIN_PAY_*) ──
  app.querySelectorAll('[data-payf]').forEach(b => b.onclick = () => { S.payF = { ...(S.payF || {}), status: b.dataset.payf || undefined }; render(); });
  const prf = $('#prf');
  if (prf) prf.onsubmit = e => { e.preventDefault(); S.payF = { ...(S.payF || {}), q: formData(prf).q || undefined }; render(); };
  on('payReqNew', async () => {
    await ensureFinMeta();
    openModal(payReqForm(), m => {
      m.querySelector('[data-close]').onclick = closeModal;
      const f = m.querySelector('#prqf'), purp = m.querySelector('#prqPurpose'), stlWrap = m.querySelector('#prqSettleWrap'), stlCb = m.querySelector('#prqSettle'), accWrap = m.querySelector('#prqAcc');
      const qIn = m.querySelector('#prqMemQ'), lst = m.querySelector('#prqMemList'), pidIn = m.querySelector('#prqPid'), payeeIn = m.querySelector('#prqPayee'), picked = m.querySelector('#prqPicked');
      let tmr = null;
      const syncCustody = () => {
        stlWrap.hidden = purp.value !== 'دعم نشاط';
        if (purp.value !== 'دعم نشاط') stlCb.checked = false;
        const isCustody = purp.value === 'عهدة' || (purp.value === 'دعم نشاط' && stlCb.checked);
        accWrap.style.display = isCustody ? 'none' : '';
        chkPol();
      };
      const chkPol = async () => {
        if (!f.isConnected) return;
        const d = formData(f), pm = m.querySelector('#polMsg');
        const isCustody = purp.value === 'عهدة' || (purp.value === 'دعم نشاط' && stlCb.checked);
        if (isCustody || !d.expense_account || !+d.amount) { if (pm) pm.innerHTML = ''; return; }
        const r = await call('POL_CHECK', { account: d.expense_account, amount: +d.amount, date: d.date, hasDecision: !!d.decision_id });
        if (pm && pm.isConnected) pm.innerHTML = r.success && r.message ? `<div class="alert warn">📜 ${esc(r.message)}</div>` : '';
      };
      purp.onchange = syncCustody;
      stlCb.onchange = syncCustody;
      ['amount', 'expense_account', 'decision_id', 'date'].forEach(n => { if (f[n]) f[n].addEventListener('change', chkPol); });
      syncCustody();
      qIn.oninput = () => {
        clearTimeout(tmr);
        const q = qIn.value.trim();
        if (q.length < 2) { lst.hidden = true; return; }
        tmr = setTimeout(async () => {
          const r = await call('FIN_MEMBER_LOOKUP', { q });
          const items = (r.success && r.items) || [];
          if (!items.length) { lst.innerHTML = '<div class="mlookup-item"><small>لا يوجد عضو مطابق</small></div>'; lst.hidden = false; return; }
          lst.innerHTML = items.map((x, idx) => `<div class="mlookup-item" data-pidx="${idx}">
            <b>${esc(x.full_name)}</b><small>رقم وظيفي: ${esc(x.job_id || '—')} · ${esc(x.workplace || '—')}</small></div>`).join('');
          lst.hidden = false;
          lst.querySelectorAll('[data-pidx]').forEach(el => el.onclick = () => {
            const mem = items[+el.dataset.pidx];
            pidIn.value = mem.id;
            payeeIn.value = mem.full_name;
            qIn.value = '';
            lst.hidden = true;
            picked.innerHTML = `<div class="mpicked"><div><b>👤 ${esc(mem.full_name)}</b> <small class="muted">(${esc(mem.job_id || '—')})</small></div>
              <button type="button" class="btn sm sec" id="prqClearMem">✕ إلغاء الربط</button></div>`;
            m.querySelector('#prqClearMem').onclick = () => { pidIn.value = ''; picked.innerHTML = ''; };
          });
        }, 220);
      };
      f.onsubmit = async e => {
        e.preventDefault();
        const r = await busy(f.querySelector('[type=submit]'), () => call('FIN_PAY_CREATE', formData(f)));
        if (!r.success) { m.querySelector('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal();
        toast(`اتسجّل طلب الصرف ${r.request.req_no} بانتظار الاعتماد ✓`);
        if (location.hash.startsWith('#/payreqs')) render(); else location.hash = '#/payreqs';
      };
    }, 'lg');
  });
  const findPayReq = id => ((S.payReqs && S.payReqs.items) || []).find(x => x.id === id);
  app.querySelectorAll('[data-payprt]').forEach(b => b.onclick = () => { const r = findPayReq(b.dataset.payprt); if (r) printDoc(paymentRequestHTML(r)); });
  app.querySelectorAll('[data-paydocs]').forEach(b => b.onclick = () => {
    const box = app.querySelector(`[data-paydocbox="${b.dataset.paydocs}"]`);
    if (box.innerHTML) { box.innerHTML = ''; return; }
    box.innerHTML = docsBox('payreq', b.dataset.paydocs, '📎 الفواتير وعروض الأسعار والمستندات المؤيدة').replace('class="card docbox"', 'class="docbox inl"');
    loadDocBoxes();
  });
  app.querySelectorAll('[data-paycan]').forEach(b => b.onclick = async () => {
    const ok = await uiConfirm({ title: 'إلغاء طلب الصرف', msg: 'هل تود إلغاء طلب الصرف قبل اعتماده؟', tone: 'bad', okText: 'إلغاء الطلب' });
    if (!ok) return;
    const r = await busy(b, () => call('FIN_PAY_CANCEL', { id: b.dataset.paycan }));
    if (!r.success) return toast(r.message, true);
    toast('اتلغى طلب الصرف'); render();
  });
  app.querySelectorAll('[data-payrej]').forEach(b => b.onclick = () => {
    const req = findPayReq(b.dataset.payrej); if (!req) return;
    openModal(`<h3>✕ رفض طلب الصرف (${esc(req.req_no)})</h3>
      <form id="prjf"><label class="f"><span>سبب الرفض (إجباري — يُثبت في سجل الطلب)</span><textarea class="input" name="reason" rows="2" required placeholder="مثال: عدم استيفاء عروض الأسعار / تجاوز البند…"></textarea></label>
      <div id="ferr"></div><div class="acts"><button class="btn bad" type="submit">تأكيد الرفض</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`, m => {
      m.querySelector('[data-close]').onclick = closeModal;
      m.querySelector('#prjf').onsubmit = async e => {
        e.preventDefault();
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('FIN_PAY_DECIDE', { id: req.id, approve: false, reason: formData(e.target).reason }));
        if (!r.success) { m.querySelector('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اترفض الطلب'); render();
      };
    });
  });
  app.querySelectorAll('[data-payapp]').forEach(b => b.onclick = async () => {
    const req = findPayReq(b.dataset.payapp); if (!req) return;
    await ensureFinMeta();
    openModal(payApproveModalHTML(req), m => {
      m.querySelector('[data-close]').onclick = closeModal;
      m.querySelector('#papf').onsubmit = async e => {
        e.preventDefault();
        const d = formData(e.target);
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('FIN_PAY_DECIDE', { id: req.id, approve: true, decision_id: d.decision_id || undefined, note: d.note || undefined }));
        if (!r.success) { m.querySelector('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اتعتمد إذن الصرف ✓ — جاهز لاستخراج الشيك'); render();
      };
    });
  });
  app.querySelectorAll('[data-payissue]').forEach(b => b.onclick = async () => {
    const req = findPayReq(b.dataset.payissue); if (!req) return;
    await ensureFinMeta();
    let nextNo = S.payReqs && S.payReqs.nextChequeNo;
    if (!nextNo) { const nx = await call('FIN_NEXT_CHEQUE'); if (nx.success) nextNo = nx.next_no; }
    openModal(issueChequeModalHTML({
      refNo: req.req_no, payee: req.payee_name, amount: req.amount,
      debitLabel: req.requires_settlement ? '1103 — عُهد تحت التسوية' : `${req.expense_account || ''} — ${req.account_name || ''}`,
      nextNo, allowDecision: !req.decision_id, decision_id: req.decision_id
    }), m => {
      m.querySelector('[data-close]').onclick = closeModal;
      m.querySelector('#ichqf').onsubmit = async e => {
        e.preventDefault();
        const d = formData(e.target);
        const r = await busy(e.target.querySelector('[type=submit]'), () => call('FIN_PAY_ISSUE', { id: req.id, cheque_no: d.cheque_no, date: d.date, decision_id: d.decision_id || undefined }));
        if (!r.success) { m.querySelector('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اتستخرج الشيك واترحّل القيد المحاسبي آلياً ✓');
        location.hash = '#/cheque/' + r.cheque_id;
      };
    });
  });

  on('benAdd', async () => {
    if (!S.decAll) { const r = await call('GOV_LIST_DECISIONS'); S.decAll = r.success ? r.items : []; }
    const pid = S.person.person.id;
    finForm(benForm(), '#bnf', f => ({ ...formData(f), person_id: pid }), 'BEN_ADD', 'اتسجّلت الميزة ✓', async () => {
      const b = await call('BEN_PERSON', { personId: pid }); S.personBen = b.success ? b.benefits : S.personBen; render(); });
  });
  on('benCancel', async b => {
    const reason = await uiPrompt({ title: 'إلغاء ميزة مسجّلة يدوياً', msg: 'أدخل سبب إلغاء هذه الميزة من سجل العضو:', label: 'سبب الإلغاء (إجباري)', tone: 'bad', okText: 'إلغاء الميزة' });
    if (!reason) return;
    const r = await call('BEN_CANCEL', { ref: b.dataset.ref, reason }); if (!r.success) return toast(r.message);
    const x = await call('BEN_PERSON', { personId: S.person.person.id }); S.personBen = x.success ? x.benefits : S.personBen; toast('اتلغت ✓'); render();
  });
  on('duesRcpt', () => { finForm(receiptForm(), '#rcf', f => formData(f), 'FIN_RECEIPT', 'اتسجّل الوارد واترحّل القيد ✓', () => render());
    const k = $('#modal [name=kind]'); if (k) k.value = 'حصة الاشتراكات'; const pt = $('#modal [name=party]'); if (pt) pt.value = 'النقابة العامة'; });
  on('rcptNew', () => finForm(receiptForm(), '#rcf', f => formData(f), 'FIN_RECEIPT', 'اتسجّل واترحّل القيد ✓',
    r => { toast('رقم الإيصال: ' + r.receipt_no); location.hash = '#/receipts'; render(); }));
  const openSettle = async cid => {
    let c = S.cheque && S.cheque.id === cid ? S.cheque : null;
    if (!c) { const x = await call('FIN_CHEQUE', { id: cid }); if (!x.success) return toast(x.message, true); c = x.cheque; }
    const st = c.settlement;
    const [h, actsRes] = await Promise.all([call('FIN_SETTLE_HELP', { cheque_id: c.id }), call('FIN_SETTLE_ACTIVITIES')]);
    if (!h.success) return toast(h.message, true);
    h.activities = actsRes && actsRes.success ? actsRes.items : [];
    const dr = st && st.status === 'مسودة' ? st.draft : null;
    const build = f => ({ cheque_id: c.id, date: f.date.value, subscriptions: f.subscriptions.value, returned: f.returned.value,
      return_mode: f.return_mode.value, cheque_ids: [...f.querySelectorAll('[name=grp]:checked')].map(i => i.value),
      carried_from: f.carried_from ? f.carried_from.value : '',
      activity_id: f.activity_id ? f.activity_id.value : '',
      lines: [...f.querySelectorAll('[data-sl]')].map(r => ({ category: r.querySelector('[name=cat]').value,
        amount: r.querySelector('[name=amt]').value.trim(),
        doc_date: (r.querySelector('[name=doc_date]')?.value || '').trim() || undefined,
        notes: r.querySelector('[name=note]').value.trim(),
        meeting_ids: r.dataset.mids ? r.dataset.mids.split(',').filter(Boolean) : undefined,
        beneficiaries: parseBens(r.querySelector('[name=bens]').value) })).filter(l => +l.amount > 0) });

    openModal(settleForm(c, h, dr), m => {
      m.querySelector('[data-close]').onclick = closeModal;
      const f = m.querySelector('#stf');
      const getNums = () => {
        const spent = [...f.querySelectorAll('[name=amt]')].reduce((a, i) => a + (+i.value || 0), 0);
        const grp = [...f.querySelectorAll('[name=grp]:checked')].reduce((a, i) => a + (+i.dataset.amt || 0), 0);
        const prev = f.carried_from ? +(f.carried_from.selectedOptions[0]?.dataset.amt || 0) : 0;
        const subs = +f.subscriptions.value || 0;
        const adv = +c.amount + grp, avail = adv + prev + subs, ret = +f.returned.value || 0;
        const unspent = +(avail - spent).toFixed(2), left = +(unspent - ret).toFixed(2);
        return { adv, prev, subs, avail, spent, ret, unspent, left };
      };
      const calc = () => {
        const n = getNums();
        if ($('#stKpiAdv')) $('#stKpiAdv').innerHTML = `${money(n.adv)} ج`;
        if ($('#stKpiPrev')) $('#stKpiPrev').innerHTML = `${money(n.prev + n.subs)} ج`;
        if ($('#stKpiAvail')) $('#stKpiAvail').innerHTML = `${money(n.avail)} ج`;
        if ($('#stKpiSpent')) $('#stKpiSpent').innerHTML = `${money(n.spent)} ج`;
        const box = $('#stCalc');
        if (!box) return;
        const isCarry = f.return_mode.value === 'ترحيل' && n.unspent > 0.005;
        if (Math.abs(n.left) <= 0.005 || isCarry) {
          box.className = 'alert ok';
          box.innerHTML = isCarry
            ? `✓ <b>التسوية متوازنة مع ترحيل فائض (${money(n.unspent)} ج):</b> سيُرحَّل المتبقي تلقائياً للعهدة التالية لنفس صاحب العهدة.`
            : `✓ <b>التسوية متوازنة بالكامل:</b> الميزانية (${money(n.avail)} ج) = المصروفات (${money(n.spent)} ج)${n.ret > 0 ? ' + المردود (' + money(n.ret) + ' ج)' : ''}.`;
        } else if (n.left > 0.005) {
          box.className = 'alert warn';
          box.innerHTML = `💡 <b>يوجد فائض متبقي قدره (${money(n.left)} ج):</b> اختر التصرف فيه (ترحيل / توريد للبنك / رد للخزينة)، أو اضغط «اعتماد التسوية» لتظهر لك خيارات التصرف فوراً.`;
        } else {
          box.className = 'alert bad';
          box.innerHTML = `⚠️ <b>زيادة منصرف (عجز) بمبلغ (${money(Math.abs(n.left))} ج):</b> المصروفات تتجاوز ميزانية العهدة — راجع الأرقام أو أرفق اعتماداً مالياً.`;
        }
      };
      const renumber = () => {
        [...f.querySelectorAll('[data-sl]')].forEach((r, i) => {
          const el = r.querySelector('[data-slnum]'); if (el) el.textContent = numAr(i + 1);
        });
      };
      const bindRow = row => {
        const cat = row.querySelector('[name=cat]'), panel = row.querySelector('[data-alwpanel]');
        const syncCat = () => { if (panel) panel.hidden = cat.value !== 'بدل جلسات'; };
        cat.onchange = () => { syncCat(); calc(); };
        syncCat();
        row.querySelectorAll('[data-rmalw]').forEach(ch => ch.onchange = () => {
          const picked = [...row.querySelectorAll('[data-rmalw]:checked')]
            .map(x => (h.meetings || []).find(mt => mt.id === x.value)).filter(Boolean);
          if (!picked.length) { row.removeAttribute('data-mids'); calc(); return; }
          const byJob = {}; let tot = 0;
          picked.forEach(mt => {
            tot += +mt.total;
            (mt.attendees || []).forEach(a => { if (a.job_id) byJob[a.job_id] = +(+(byJob[a.job_id] || 0) + +mt.rate).toFixed(2); });
          });
          row.dataset.mids = picked.map(mt => mt.id).join(',');
          row.querySelector('[name=amt]').value = String(tot);
          if (picked.length === 1 && row.querySelector('[name=doc_date]')) row.querySelector('[name=doc_date]').value = picked[0].meeting_date || '';
          row.querySelector('[name=note]').value = 'بدل جلسات اجتماع ' + picked.map(mt => mt.meeting_no).join(' + ');
          row.querySelector('[name=bens]').value = Object.entries(byJob).map(([j, amt]) => `${j}:${amt}`).join(', ');
          calc();
        });
        const delBtn = row.querySelector('[data-sldel]');
        if (delBtn) delBtn.onclick = () => {
          if (f.querySelectorAll('[data-sl]').length <= 1) {
            row.removeAttribute('data-mids');
            row.querySelectorAll('input').forEach(i => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; });
          } else { row.remove(); renumber(); }
          calc();
        };
      };
      f.querySelectorAll('[data-sl]').forEach(bindRow);

      m.querySelector('[data-act=slAdd]').onclick = () => {
        const box = $('#sls'), t = document.createElement('div');
        t.innerHTML = settleRowHTML({}, box.children.length + 1, h.meetings || []);
        const nr = t.firstElementChild;
        box.appendChild(nr); bindRow(nr); renumber(); calc();
      };

      const actSel = $('#stlActSel');
      if (actSel) {
        const syncAct = () => {
          const opt = actSel.selectedOptions[0], box = $('#stlActInfo');
          if (!box) return;
          const pd = +(opt && opt.dataset.paid || 0), cnt = +(opt && opt.dataset.cnt || 0);
          box.innerHTML = actSel.value
            ? `<div class="alert ${pd > 0 ? 'warn' : ''}" style="margin-top:6px;font-size:12.5px">🚌 <b>معلومة مطابقة للنشاط:</b> يوجد <b>${numAr(cnt)}</b> حجز مسجّل بإجمالي اشتراكات مثبّتة مسبقاً بإيصالات = <b>${money(pd)} ج</b> (في حـ/ 4201). <b>لا تُعد إدخال هذا المبلغ</b> في خانة الاشتراكات بالأسفل منعاً للازدواج؛ اكتب فقط أي مبالغ نقدية إضافية بيد صاحب العهدة لم يُصدر لها إيصال.</div>`
            : '';
        };
        actSel.onchange = syncAct; syncAct();
      }

      m.querySelector('[data-act=stlDraft]').onclick = async e => {
        const r = await busy(e.target, () => call('FIN_SETTLE', { ...build(f), draft: true }));
        if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اتحفظت المسودة ✓'); render();
      };

      const pickSurplusAction = amt => new Promise(resolve => {
        const dlg = $('#dlg');
        dlg.innerHTML = `<div class="dlg-box warn">
          <div class="dlg-hd"><span class="dlg-ic">💡</span><h4>يوجد مبلغ متبقي لم يُحدَّد التصرف فيه (${money(amt)} ج.م)</h4></div>
          <div class="dlg-bd">
            <p><b>التفقيط:</b> ${esc(tafqeet(amt))}</p>
            <p class="muted" style="font-size:13px">كيف تم التصرف في هذا الفائض بالدفاتر؟ اختر الإجراء لإتمام اعتماد التسوية فوراً:</p>
            <div class="stl-surplus-opts">
              <button type="button" class="stl-surplus-btn" data-spact="ترحيل"><i>🔄</i><div><b>ترحيل المتبقي (${money(amt)} ج) للعهدة التالية</b><small>يظهر تلقائياً في التسوية القادمة لنفس صاحب العهدة</small></div></button>
              <button type="button" class="stl-surplus-btn" data-spact="توريد للبنك"><i>🏦</i><div><b>إيداع / توريد المتبقي (${money(amt)} ج) في البنك</b><small>يُقفل العهدة ويُثبت الإيداع في حـ/ 1102 البنك</small></div></button>
              <button type="button" class="stl-surplus-btn" data-spact="رد للخزينة"><i>💵</i><div><b>رد المتبقي (${money(amt)} ج) نقداً للخزينة</b><small>يُقفل العهدة ويُثبت الرد النقدي في حـ/ 1101 الخزينة</small></div></button>
            </div>
          </div>
          <div class="dlg-ft"><button type="button" class="btn sec" id="spCancel">العودة لتعديل الفواتير</button></div>
        </div>`;
        dlg.hidden = false;
        dlg.querySelector('#spCancel').onclick = () => { dlg.hidden = true; resolve(null); };
        dlg.querySelectorAll('[data-spact]').forEach(b => b.onclick = () => { dlg.hidden = true; resolve(b.dataset.spact); });
      });

      f.onsubmit = async e => {
        e.preventDefault();
        const n = getNums();
        if (n.left > 0.005 && f.return_mode.value === 'لا يوجد' && n.ret === 0) {
          const mode = await pickSurplusAction(n.left);
          if (!mode) return;
          f.return_mode.value = mode;
          f.returned.value = mode === 'ترحيل' ? '0' : String(n.left);
          calc();
        }
        const r = await busy(f.querySelector('[type=submit]'), () => call('FIN_SETTLE', build(f)));
        if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
        closeModal(); toast('اتسوّت العهدة واترحّل القيد ✓'); S.meetings = null; S.meeting = null; render();
      };

      f.addEventListener('input', calc); f.addEventListener('change', calc); calc();
    }, 'lg');
  };
  const delDraft = async id => {
    const ok = await uiConfirm({ title: 'حذف مسودة التسوية', msg: 'سيتم حذف المسودة المحفوظة نهائياً مع بقاء الشيكات مفتوحة للتسوية لاحقاً. هل تود المتابعة؟', tone: 'bad', okText: 'حذف المسودة' });
    if (!ok) return;
    const r = await call('FIN_SETTLE_DRAFT_DELETE', { id });
    if (!r.success) return toast(r.message, true); toast('اتمسحت المسودة ✓'); render();
  };
  const revSettle = async id => {
    const reason = await uiPrompt({ title: 'استرجاع التسوية بقيد محاسبي عكسي', msg: 'سيتم إنشاء قيد عكسي آلي وإلغاء المزايا المرتبطة وإعادة الشيكات لحالة «صادر» مفتوحة للتسوية من جديد:', label: 'سبب الاسترجاع (إجباري للتدقيق)', tone: 'bad', okText: 'استرجاع التسوية بقيد عكسي' });
    if (!reason) return;
    const r = await call('FIN_SETTLE_REVERSE', { id, reason });
    if (!r.success) return toast(r.message, true); toast('اتسترجعت التسوية بقيد عكسي ✓'); render();
  };
  on('settleNew', () => openSettle(S.cheque.id));
  on('stlPick', () => {
    const opts = (S.openAdv || []).filter(c => c.status === 'صادر');
    if (opts.length === 1) return openSettle(opts[0].id);
    openModal(`<h3>اختر شيك العهدة الأساسي</h3><p class="muted">بعد الاختيار هتقدر تضيف معاه باقي شيكات نفس صاحب العهدة (تسوية مجمّعة) أو تجلب رصيد مرحّل سابق أو تحفظ مسودة.</p>
      <form id="stpk"><label class="f"><span>شيك العهدة</span><select class="input" name="cid">${opts.map(c => `<option value="${c.id}">شيك ${esc(c.cheque_no || 'بدون رقم')} — ${esc(c.payee_name)} — ${money(c.amount)}${c.notes ? ' (' + esc(c.notes).slice(0, 40) + ')' : ''}</option>`).join('')}</select></label>
      <div class="acts"><button class="btn" type="submit">متابعة للتسوية</button><button class="btn sec" type="button" data-close>إلغاء</button></div></form>`, () => {
      $('#modal [data-close]').onclick = closeModal;
      $('#stpk').onsubmit = e => { e.preventDefault(); const cid = e.target.cid.value; closeModal(); openSettle(cid); };
    });
  });
  app.querySelectorAll('[data-stopen]').forEach(b => b.onclick = ev => { ev.stopPropagation(); openSettle(b.dataset.stopen); });
  app.querySelectorAll('[data-stddel]').forEach(b => b.onclick = ev => { ev.stopPropagation(); delDraft(b.dataset.stddel); });
  app.querySelectorAll('[data-strev]').forEach(b => b.onclick = ev => { ev.stopPropagation(); revSettle(b.dataset.strev); });
  on('stlDraftDel', () => delDraft(S.cheque.settlement.id));
  on('stlReverse', () => revSettle(S.cheque.settlement.id));

  // ── المرحلتان 35 و 36: إقفال الفترات، مستندات بوابة العضو، الشكاوى، وطلبات التفعيل ──
  on('prtMemberCert', () => { if (S.me && S.me.profile) printDoc(memberCertHTML(S.me.profile)); });
  on('prtMemberBen', async () => {
    const r = await call('BEN_MY');
    if (!r.success) return toast(r.message, true);
    printDoc(memberBenefitsPrintHTML(S.me.profile, r.benefits));
  });
  const tktf = $('#tktf');
  if (tktf) tktf.onsubmit = async e => {
    e.preventDefault();
    const r = await busy(tktf.querySelector('[type=submit]'), () => call('TKT_CREATE', formData(tktf)));
    if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    toast(`تم إرسال رسالتك برقم ${r.ticket_no} ✓`); render();
  };
  app.querySelectorAll('[data-tktrpl]').forEach(b => b.onclick = async () => {
    const reply = await uiPrompt({ title: 'الرد على رسالة العضو', msg: 'سيتم حفظ الرد وإرسال إشعار فوري في بوابة العضو:', label: 'نص الرد الرسمي', okText: 'إرسال الرد' });
    if (!reply) return;
    const r = await busy(b, () => call('TKT_REPLY', { id: b.dataset.tktrpl, reply, status: 'تم الرد' }));
    if (!r.success) return toast(r.message, true);
    toast('تم إرسال الرد وإشعار العضو ✓'); render();
  });
  app.querySelectorAll('[data-actvok]').forEach(b => b.onclick = async () => {
    const ok = await uiConfirm({ title: 'اعتماد تفعيل حساب العضو', msg: 'سيتم تحديث الرقم القومي والموبايل في ملف العضو وتفعيل دخوله الفوري لبوابة العضو. هل تود المتابعة؟', tone: 'ok', okText: 'اعتماد وتفعيل' });
    if (!ok) return;
    const r = await busy(b, () => call('ACTV_DECIDE', { id: b.dataset.actvok, approve: true }));
    if (!r.success) return toast(r.message, true);
    toast('تم تفعيل حساب العضو ✓'); render();
  });
  app.querySelectorAll('[data-actvno]').forEach(b => b.onclick = async () => {
    const notes = await uiPrompt({ title: 'رفض طلب التفعيل', msg: 'اذكر سبب الرفض للتدقيق:', label: 'سبب الرفض', tone: 'bad', okText: 'رفض الطلب' });
    if (!notes) return;
    const r = await busy(b, () => call('ACTV_DECIDE', { id: b.dataset.actvno, approve: false, notes }));
    if (!r.success) return toast(r.message, true);
    toast('تم رفض الطلب ✓'); render();
  });
  app.querySelectorAll('[data-ptog]').forEach(b => b.onclick = async () => {
    const [year, month] = b.dataset.ptog.split('-').map(Number), st = b.dataset.pst;
    const ok = await uiConfirm({
      title: st === 'مقفولة' ? `إقفال شهر ${month} / ${year}` : `إعادة فتح شهر ${month} / ${year}`,
      msg: st === 'مقفولة' ? 'لن يُسمح بإدخال أو تعديل أي قيود بتاريخ داخل هذا الشهر بعد إقفاله.' : 'إعادة فتح فترة مقفولة تُسجل في سجل التدقيق. هل أنت متأكد؟',
      tone: 'warn', okText: st === 'مقفولة' ? 'إقفال الشهر' : 'إعادة الفتح'
    });
    if (!ok) return;
    const r = await busy(b, () => call('FIN_PERIOD_TOGGLE', { year, month, status: st }));
    if (!r.success) return toast(r.message, true);
    toast(st === 'مقفولة' ? 'تم إقفال الشهر ✓' : 'تم إعادة فتح الشهر ✓'); render();
  });
  app.querySelectorAll('[data-yrclose]').forEach(b => b.onclick = async () => {
    const year = +b.dataset.yrclose;
    const ok = await uiConfirm({
      title: `إقفال السنة المالية ${year}`,
      msg: `سيتم إنشاء قيد إقفال سنوي آلي بتاريخ ${year}-12-31 يُقفل كافة الإيرادات والمصروفات ويُرحّل صافي الفائض/العجز إلى حـ/ 3201، مع إقفال الأشهر الـ 12 بالكامل. هل أنت متأكد؟`,
      tone: 'warn', okText: `تأكيد إقفال سنة ${year}`
    });
    if (!ok) return;
    const r = await busy(b, () => call('FIN_YEAR_CLOSE', { year }));
    if (!r.success) return toast(r.message, true);
    toast(`تم إقفال السنة المالية ${year} بنجاح ✓`); render();
  });

  const pw = $('#pw');
  if (pw) pw.onsubmit = async e => { e.preventDefault();
    const r = await busy(pw.querySelector('button'), () => call('CHANGE_PASSWORD', formData(pw)));
    if (!r.success) { $('#ferr').innerHTML = `<div class="alert bad">${esc(r.message)}</div>`; return; }
    toast('اتغيرت كلمة المرور ✓'); S.me.mustChange = false; location.hash = '#/admin'; };
}

window.addEventListener('hashchange', () => {
  document.body.classList.remove('drawer-open');
  closeDP();
  if (dlgState) closeDlg(null);
  if (!$('#modal').hidden) closeModal();
  render();
});
boot();
window.__erp = { S, call };   // للاختبار الآلي
})();
