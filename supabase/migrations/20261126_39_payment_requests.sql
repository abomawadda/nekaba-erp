-- المرحلة 32: دورة طلبات الصرف واستخراج الشيكات والمنح (الرقابة الداخلية + فصل المهام + اختيارية قرار المجلس)
-- المبادئ المحاسبية والإدارية المعتمدة:
--   1) طلب الصرف (إذن الصرف) التزام إداري رقابي يمر بـ (تقديم ⇐ اعتماد مع فصل المهام وحد الصلاحية ⇐ استخراج الشيك).
--   2) لا يُثبت قيد محاسبي في الدفاتر إلا عند الإصدار الفعلي للشيك البنكي (مدين: المصروف أو 1103 العهدة / دائن: 1102 البنك).
--   3) قرار مجلس الإدارة اختياري عند طلب/إصدار الشيك (للصرف اللائحي والدوري والعهد)، ولا يُلزم به إلا لبنود اللائحة المقيدة صراحةً أو لتجاوز حد الصلاحية المالي.
--   4) إلغاء الشيك (BANK_VOID) يُعيد طلب الصرف (أو طلب المنحة) آلياً لحالة «معتمد» لإتاحة استخراج شيك بديل دون تكرار الطلب.

-- ── 1) الصلاحيات واللائحة والمنح ──
insert into core.role_permissions(role, permission, max_amount) values
  ('BOARD', 'treasury.payment.request', null),
  ('BOARD', 'treasury.payment.approve', null),
  ('TREASURER', 'treasury.payment.request', null)
on conflict do nothing;

-- جعل اشتراط قرار المجلس في اللائحة المالية اختيارياً افتراضياً (false) ما لم يُحدَّد صراحةً للبند
alter table finance.policy alter column requires_decision set default false;

-- تصحيح صلات منحة الوفاة لتشمل وفاة «العضو» نفسه عند تقديم الطلب نيابةً عن أسرته
update grants.types
set relations = array['العضو','أب','أم','ابن','ابنة','زوج','زوجة']
where code = 'DEATH' and not ('العضو' = any(coalesce(relations, '{}')));

-- ── 2) جدول طلبات الصرف واستخراج الشيكات ──
create table if not exists treasury.payment_requests (
  id                  uuid primary key default gen_random_uuid(),
  req_no              text not null unique,
  req_date            date not null default current_date,
  purpose             text not null check (purpose in ('عهدة','دعم نشاط','مصروف','أخرى')),
  requires_settlement boolean not null default false,
  payee_person_id     uuid references core.persons(id),
  payee_name          text not null,
  amount              numeric(14,2) not null check (amount > 0),
  expense_account     text references finance.accounts(code),
  cost_center         text not null default 'ADM' references finance.cost_centers(code),
  decision_id         uuid references governance.decisions(id),
  auth_basis          text not null default 'لائحي' check (auth_basis in ('لائحي','قرار مجلس','عهدة تحت التسوية')),
  supporting_docs     text,
  description         text not null,
  status              text not null default 'مقدَّم' check (status in ('مقدَّم','معتمد','مصروف','مرفوض','ملغى')),
  requested_by        text not null,
  approved_by         text,
  approved_at         timestamptz,
  approval_note       text,
  reject_reason       text,
  cheque_id           uuid references treasury.cheques(id),
  paid_by             text,
  paid_at             timestamptz,
  created_at          timestamptz not null default now(),
  check ((requires_settlement and purpose in ('عهدة','دعم نشاط')) or (not requires_settlement and expense_account is not null))
);
create index if not exists payment_requests_status_idx on treasury.payment_requests(status, created_at desc);
create index if not exists payment_requests_cheque_idx on treasury.payment_requests(cheque_id) where cheque_id is not null;
create index if not exists payment_requests_decision_idx on treasury.payment_requests(decision_id) where decision_id is not null;

alter table treasury.payment_requests enable row level security;
revoke all on treasury.payment_requests from public, anon, authenticated;
drop trigger if exists payment_requests_audit on treasury.payment_requests;
create trigger payment_requests_audit after insert or update or delete on treasury.payment_requests
  for each row execute function audit.track();

-- ── 3) دعم أرشفة مرفقات طلبات الصرف (payreq) ──
alter table core.documents drop constraint if exists documents_entity_type_check;
alter table core.documents add constraint documents_entity_type_check
  check (entity_type in ('cheque','receipt','entry','grant','meeting','decision','person','activity','general','payreq'));

create or replace function api.doc_can(uid uuid, pid uuid, p_type text, p_id text, p_write boolean) returns boolean language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select core.is_admin(uid) or case p_type
    when 'cheque'   then core.can(uid, case when p_write then 'treasury.cheque.issue' else 'finance.view' end) or (p_write and core.can(uid,'treasury.settlement'))
    when 'payreq'   then core.can(uid, 'treasury.payment.request') or core.can(uid, 'treasury.payment.approve') or core.can(uid, 'treasury.cheque.issue') or (not p_write and core.can(uid,'finance.view'))
    when 'receipt'  then core.can(uid, case when p_write then 'treasury.receipt' else 'finance.view' end)
    when 'entry'    then core.can(uid, case when p_write then 'finance.journal' else 'finance.view' end)
    when 'grant'    then core.can(uid, 'grants.review') or (not p_write and (core.can(uid,'grants.approve') or core.can(uid,'treasury.cheque.issue')))
                         or (pid is not null and exists (select 1 from grants.requests r where r.id::text = p_id and r.person_id = pid
                                                         and (not p_write or r.status in ('مقدَّم','ناقص مستندات'))))
    when 'meeting'  then core.can(uid, case when p_write then 'governance.manage' else 'governance.view' end) or core.can(uid,'governance.manage')
    when 'decision' then core.can(uid, case when p_write then 'governance.manage' else 'governance.view' end) or core.can(uid,'governance.manage')
    when 'person'   then core.can(uid, case when p_write then 'profile.edit' else 'profile.view' end) or (pid is not null and p_id = pid::text)
    when 'activity' then core.can(uid,'activities.manage')
    when 'general'  then core.can(uid, case when p_write then 'finance.journal' else 'audit.view' end) or core.can(uid,'finance.view')
    else false end
$$;

-- ── 4) الرقم التالي المتاح من دفتر الشيكات النشط + تحديث إصدار الشيك (اختيارية القرار ومتابعة التنفيذ) ──
create or replace function treasury.next_cheque_no(p_acc text default '1102') returns text language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select (select min(g)::text from generate_series(b.first_no, b.last_no) g
          where not exists (select 1 from treasury.cheques c where c.bank_account = b.bank_account and c.cheque_no = g::text)
            and not exists (select 1 from treasury.cheque_spoiled s where s.cheque_no = g::text))
  from treasury.cheque_books b
  where b.bank_account = coalesce(p_acc, '1102') and b.status = 'نشط'
  order by b.first_no
  limit 1
$$;

create or replace function treasury.issue_cheque(p jsonb, p_actor text) returns uuid language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare v_id uuid; v_entry uuid; v_custody boolean; v_acc text; v_cc text; v_party text := treasury.party_of(p);
        v_dec uuid := (nullif(p->>'decision_id',''))::uuid; v_date date := coalesce((nullif(p->>'date',''))::date, current_date);
begin
  if nullif(p->>'person_id','') is null and nullif(p->>'person_job','') is not null then
    p := p || jsonb_build_object('person_id', api.pid_by_job(p->>'person_job'));
  end if;
  if p->>'legacy_ref' is not null then
    select id into v_id from treasury.cheques where legacy_ref = p->>'legacy_ref';
    if v_id is not null then return v_id; end if;
  end if;
  v_custody := (p->>'purpose') = 'عهدة' or coalesce((p->>'requires_settlement')::boolean, false);
  v_acc := case when v_custody then '1103' else nullif(p->>'expense_account','') end;
  if v_acc is null then raise exception 'حدد حساب المصروف' using errcode = 'check_violation'; end if;
  if coalesce((nullif(p->>'amount',''))::numeric, 0) <= 0 then raise exception 'المبلغ لازم أكبر من صفر' using errcode = 'check_violation'; end if;
  v_cc := coalesce(nullif(p->>'cost_center',''), case when p->>'purpose' = 'منحة' then 'GRANTS' else 'ADM' end);
  insert into treasury.cheques(cheque_no, bank_account, issue_date, amount, payee_person_id, payee_name, purpose, expense_account,
    decision_id, cost_center, requires_settlement, status, notes, legacy_ref)
  values (nullif(trim(p->>'cheque_no'),''), coalesce(nullif(p->>'bank_account',''),'1102'), v_date, (p->>'amount')::numeric,
    (nullif(p->>'person_id',''))::uuid, v_party, p->>'purpose', case when v_custody then null else v_acc end,
    v_dec, v_cc, v_custody, 'صادر', nullif(trim(p->>'notes'),''), p->>'legacy_ref')
  returning id into v_id;
  v_entry := finance.post(jsonb_build_object('date', v_date, 'source', 'شيك', 'source_ref', v_id, 'decision_id', v_dec,
    'legacy_ref', case when p->>'legacy_ref' is not null then 'CHQ:' || (p->>'legacy_ref') end,
    'description', 'شيك ' || coalesce(nullif(trim(p->>'cheque_no'),''), 'بدون رقم') || ' — ' || (p->>'purpose') || ' — ' || v_party
                   || coalesce(' — ' || nullif(trim(p->>'notes'),''), ''),
    'lines', jsonb_build_array(
      jsonb_build_object('account', v_acc, 'debit', p->>'amount', 'cost_center', v_cc, 'person_id', p->>'person_id', 'party', v_party),
      jsonb_build_object('account', coalesce(nullif(p->>'bank_account',''),'1102'), 'credit', p->>'amount', 'cost_center', v_cc))), p_actor);
  update treasury.cheques set entry_id = v_entry where id = v_id;
  if v_dec is not null then
    update governance.decisions
    set exec_status = case when v_custody then 'قيد التنفيذ' else 'منفّذ' end,
        executed_at = case when not v_custody then coalesce(executed_at, v_date) else executed_at end
    where id = v_dec and exec_status = 'لم يبدأ';
  end if;
  return v_id;
end $$;

-- ── 5) تحسين تقديم طلبات المنح وعرضها (قرار اختياري + استلام المستندات الفوري من الموظف + بيانات جهة العمل) ──
create or replace function grants.apply(p_person uuid, p jsonb, p_actor text) returns uuid language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare t grants.types; me core.persons; fm core.family_members; v_date date; v_name text; v_rel text; v_key text;
        v_id uuid; v_amt numeric; v_n int; v_dec uuid := (nullif(p->>'decision_id',''))::uuid;
        v_docs jsonb; v_st text := 'مقدَّم'; v_rev text;
begin
  select * into t from grants.types where code = p->>'type' and active;
  if t.code is null then raise exception 'نوع المنحة غير متاح' using errcode = 'check_violation'; end if;
  v_date := (nullif(p->>'event_date',''))::date;
  if v_date is null or v_date > current_date then raise exception 'تاريخ الواقعة غير صحيح' using errcode = 'check_violation'; end if;
  if t.deadline_days is not null and current_date - v_date > t.deadline_days and v_dec is null then
    raise exception 'انتهت مهلة التقديم (% يوم من تاريخ الواقعة) — يلزم قرار مجلس للاستثناء', t.deadline_days using errcode = 'check_violation'; end if;
  if not core.is_union_beneficiary(p_person, v_date) then
    raise exception 'المنح لأعضاء النقابة العامة النشطين في تاريخ الواقعة' using errcode = 'check_violation'; end if;
  select * into me from core.persons where id = p_person;
  if nullif(p->>'family_member_id','') is not null then
    select * into fm from core.family_members where id = (p->>'family_member_id')::uuid and person_id = p_person;
    if fm.id is null then raise exception 'فرد الأسرة غير موجود في ملف العضو' using errcode = 'check_violation'; end if;
    v_name := fm.full_name; v_rel := fm.relation; v_key := 'FM:' || fm.id;
  elsif coalesce(nullif(p->>'subject_relation',''),'العضو') = 'العضو' and not t.needs_relation then
    v_name := me.full_name; v_rel := 'العضو'; v_key := 'P:' || p_person;
  elsif p->>'subject_relation' = 'العضو' then
    v_name := me.full_name; v_rel := 'العضو'; v_key := 'P:' || p_person;
  else
    v_name := nullif(trim(p->>'subject_name'),''); v_rel := nullif(trim(p->>'subject_relation'),'');
    if v_name is null or v_rel is null then raise exception 'حدد المستفيد من الأسرة (أو اكتب اسمه وصلته)' using errcode = 'check_violation'; end if;
    v_key := 'N:' || p_person || ':' || v_rel || ':' || lower(regexp_replace(v_name, '\s+', ' ', 'g'));
  end if;
  if t.relations is not null and not (v_rel = any(t.relations)) then
    raise exception '% لا تُصرف عن صلة «%»', t.name, v_rel using errcode = 'check_violation'; end if;
  if not t.once_per_subject then v_key := v_key || ':' || v_date; end if;
  if t.code = 'DEATH' and v_rel = 'العضو' then v_key := 'P:' || p_person; end if;
  if exists (select 1 from grants.requests where type_code = t.code and subject_key = v_key and status not in ('مرفوض','ملغى')) then
    raise exception 'سبق تقديم/صرف % لنفس الواقعة', t.name using errcode = 'check_violation'; end if;
  if t.max_per_year is not null then
    select count(*) into v_n from grants.requests where person_id = p_person and type_code = t.code
      and extract(year from event_date) = extract(year from v_date) and status not in ('مرفوض','ملغى');
    if v_n >= t.max_per_year then raise exception 'وصل العضو للحد السنوي لـ% (%)', t.name, t.max_per_year using errcode = 'check_violation'; end if;
  end if;
  v_amt := grants.rate(t.code, v_rel, v_date);
  if jsonb_typeof(p->'docs') = 'array' then
    v_docs := p->'docs';
  else
    v_docs := (select coalesce(jsonb_agg(jsonb_build_object('name', d, 'received', false)), '[]'::jsonb) from unnest(t.docs) d);
  end if;
  if coalesce((p->>'staff_verified')::boolean, false) and jsonb_array_length(v_docs) > 0 then
    v_st := case when exists (select 1 from jsonb_array_elements(v_docs) d where not coalesce((d->>'received')::boolean, false))
                 then 'ناقص مستندات' else 'مستوفى' end;
    v_rev := p_actor;
  end if;
  insert into grants.requests(req_no, person_id, type_code, event_date, subject_name, subject_relation, family_member_id, subject_key,
    amount, eligible, docs, decision_id, status, reviewed_by, notes, submitted_by)
  values (core.next_doc_no('GRANT', 'منحة', extract(year from current_date)::int), p_person, t.code, v_date, v_name, v_rel, fm.id, v_key,
    v_amt, true, v_docs, v_dec, v_st, v_rev, nullif(trim(p->>'notes'),''), p_actor)
  returning id into v_id;
  perform grants.log(v_id, 'تقديم', jsonb_build_object('amount', v_amt, 'status', v_st, 'decision_id', v_dec), p_actor);
  return v_id;
end $$;

create or replace function api.grant_json(p_req uuid) returns jsonb language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select to_jsonb(r) - 'subject_key' || jsonb_build_object(
    'type_name', t.name,
    'expense_account', t.account,
    'person', (select jsonb_build_object('full_name', full_name, 'job_id', job_id, 'workplace', workplace, 'union_org', union_org, 'phone', phone) from core.person_current where id = r.person_id),
    'cheque', (select jsonb_build_object('id', c.id, 'cheque_no', c.cheque_no, 'issue_date', c.issue_date, 'entry_id', c.entry_id) from treasury.cheques c where c.id = r.cheque_id),
    'decision', (select jsonb_build_object('id', d.id, 'decision_no', d.decision_no, 'text', d.text) from governance.decisions d where d.id = r.decision_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.at, 'details', e.details) order by e.id) from grants.events e where e.request_id = r.id), '[]'))
  from grants.requests r join grants.types t on t.code = r.type_code where r.id = p_req
$$;

-- ── 6) دوال عمليات طلبات الصرف واستخراج الشيكات ──
create or replace function api.actor_label(p_actor text) returns text language plpgsql stable
set search_path to 'core','public','extensions','pg_temp' as $$
declare v_uid uuid; v_nm text;
begin
  if p_actor is null then return null; end if;
  begin v_uid := p_actor::uuid; exception when others then return p_actor; end;
  select coalesce(pe.full_name, u.username) into v_nm
  from core.users u left join core.persons pe on pe.id = u.person_id where u.id = v_uid;
  return coalesce(v_nm, p_actor);
end $$;

create or replace function api.pay_request_json(p_id uuid) returns jsonb language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select to_jsonb(r) || jsonb_build_object(
    'account_name', (select name from finance.accounts where code = r.expense_account),
    'person', case when r.payee_person_id is not null then
      (select jsonb_build_object('id', id, 'full_name', full_name, 'job_id', job_id, 'workplace', workplace) from core.person_current where id = r.payee_person_id) end,
    'decision', case when r.decision_id is not null then
      (select jsonb_build_object('id', id, 'decision_no', decision_no, 'text', text) from governance.decisions where id = r.decision_id) end,
    'cheque', case when r.cheque_id is not null then
      (select jsonb_build_object('id', id, 'cheque_no', cheque_no, 'issue_date', issue_date, 'status', status, 'entry_id', entry_id) from treasury.cheques where id = r.cheque_id) end,
    'requested_by_name', api.actor_label(r.requested_by),
    'approved_by_name', api.actor_label(r.approved_by),
    'paid_by_name', api.actor_label(r.paid_by),
    'docs_count', (select count(*) from core.documents d where d.entity_type = 'payreq' and d.entity_id = r.id::text and d.deleted_at is null)
  )
  from treasury.payment_requests r where r.id = p_id
$$;

create or replace function treasury.pay_request_create(p jsonb, p_actor text) returns uuid language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare v_id uuid; v_pid uuid; v_party text; v_purpose text := coalesce(nullif(p->>'purpose',''), 'مصروف');
        v_custody boolean; v_acc text := nullif(p->>'expense_account','');
        v_amt numeric := (nullif(p->>'amount',''))::numeric;
        v_date date := coalesce((nullif(p->>'date',''))::date, current_date);
        v_dec uuid := (nullif(p->>'decision_id',''))::uuid;
        v_desc text := nullif(trim(p->>'description'),'');
        v_cc text := coalesce(nullif(p->>'cost_center',''), 'ADM');
        v_basis text; v_msg text; v_enf text;
begin
  if v_amt is null or v_amt <= 0 then raise exception 'المبلغ لازم يكون أكبر من صفر' using errcode = 'check_violation'; end if;
  if v_desc is null then raise exception 'البيان التفصيلي للصرف مطلوب' using errcode = 'check_violation'; end if;
  if v_purpose not in ('عهدة','دعم نشاط','مصروف','أخرى') then raise exception 'طبيعة الصرف غير صالحة' using errcode = 'check_violation'; end if;
  v_pid := coalesce((nullif(p->>'person_id',''))::uuid, api.pid_by_job(nullif(trim(p->>'person_job'),'')));
  v_party := coalesce(nullif(trim(p->>'payee_name'),''), (select full_name from core.persons where id = v_pid));
  if v_party is null then raise exception 'اسم المستفيد / الجهة مطلوب' using errcode = 'check_violation'; end if;

  v_custody := (v_purpose = 'عهدة') or (v_purpose = 'دعم نشاط' and coalesce((p->>'requires_settlement')::boolean, false));
  if v_custody then
    v_acc := null;
  else
    if v_acc is null or not exists (select 1 from finance.accounts where code = v_acc and type = 'مصروفات' and postable and active) then
      raise exception 'حدد حساب مصروف فرعي صحيح' using errcode = 'check_violation';
    end if;
    v_msg := finance.policy_check(v_acc, v_amt, v_date, v_dec is not null);
    select enforce into v_enf from finance.policy where account = v_acc and active;
    if v_msg is not null and v_enf = 'منع' then raise exception '%', v_msg using errcode = 'check_violation'; end if;
  end if;

  v_basis := case when v_dec is not null then 'قرار مجلس' when v_custody then 'عهدة تحت التسوية' else 'لائحي' end;
  insert into treasury.payment_requests(req_no, req_date, purpose, requires_settlement, payee_person_id, payee_name,
    amount, expense_account, cost_center, decision_id, auth_basis, supporting_docs, description, status, requested_by)
  values (core.next_doc_no('PAYREQ', 'صرف', extract(year from v_date)::int), v_date, v_purpose, v_custody, v_pid, v_party,
    v_amt, v_acc, v_cc, v_dec, v_basis, nullif(trim(p->>'supporting_docs'),''), v_desc, 'مقدَّم', p_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function treasury.pay_request_decide(p jsonb, uid uuid) returns void language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare r treasury.payment_requests; a text := uid::text; v_approve boolean := coalesce((p->>'approve')::boolean, false);
        v_dec uuid := (nullif(p->>'decision_id',''))::uuid;
begin
  select * into r from treasury.payment_requests where id = (p->>'id')::uuid for update;
  if r.id is null then raise exception 'طلب الصرف غير موجود' using errcode = 'check_violation'; end if;
  if r.status <> 'مقدَّم' then raise exception 'الطلب ليس في مرحلة الاعتماد (حالته: %)', r.status using errcode = 'check_violation'; end if;
  if r.requested_by = a and not core.is_admin(uid) then
    raise exception 'فصل المهام: لا يمكنك اعتماد طلب صرف قدّمته بنفسك' using errcode = 'check_violation';
  end if;
  if v_approve then
    v_dec := coalesce(v_dec, r.decision_id);
    if not core.can(uid, 'treasury.payment.approve', r.amount) and v_dec is null then
      raise exception 'المبلغ (%) يتجاوز حد الاعتماد المباشر لصلاحيتك — يلزم اعتماده من المستوى الأعلى أو ربطه بقرار مجلس إدارة', r.amount using errcode = 'check_violation';
    end if;
    update treasury.payment_requests
    set status = 'معتمد', approved_by = a, approved_at = now(),
        decision_id = v_dec,
        auth_basis = case when v_dec is not null then 'قرار مجلس' else auth_basis end,
        approval_note = nullif(trim(p->>'note'),'')
    where id = r.id;
  else
    if nullif(trim(p->>'reason'),'') is null then raise exception 'سبب رفض الطلب مطلوب' using errcode = 'check_violation'; end if;
    update treasury.payment_requests
    set status = 'مرفوض', approved_by = a, approved_at = now(), reject_reason = trim(p->>'reason')
    where id = r.id;
  end if;
end $$;

create or replace function treasury.pay_request_issue(p jsonb, uid uuid) returns uuid language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare r treasury.payment_requests; a text := uid::text; v_chq uuid;
        v_date date := coalesce((nullif(p->>'date',''))::date, current_date);
begin
  select * into r from treasury.payment_requests where id = (p->>'id')::uuid for update;
  if r.id is null then raise exception 'طلب الصرف غير موجود' using errcode = 'check_violation'; end if;
  if r.status <> 'معتمد' then raise exception 'استخراج الشيك للطلبات المعتمدة فقط (الحالة الحالية: %)', r.status using errcode = 'check_violation'; end if;
  if r.requested_by = a and r.approved_by = a and not core.is_admin(uid) then
    raise exception 'فصل المهام: لا يجوز الجمع بين التقديم والاعتماد والصرف لنفس الشخص' using errcode = 'check_violation';
  end if;
  v_chq := treasury.issue_cheque(jsonb_build_object(
    'date', v_date,
    'amount', r.amount,
    'cheque_no', p->>'cheque_no',
    'bank_account', coalesce(nullif(p->>'bank_account',''), '1102'),
    'person_id', r.payee_person_id,
    'payee_name', r.payee_name,
    'purpose', r.purpose,
    'requires_settlement', r.requires_settlement,
    'expense_account', r.expense_account,
    'cost_center', r.cost_center,
    'decision_id', coalesce((nullif(p->>'decision_id',''))::uuid, r.decision_id),
    'notes', r.description || ' (طلب ' || r.req_no || ')'
  ), a);
  update treasury.payment_requests set status = 'مصروف', cheque_id = v_chq, paid_by = a, paid_at = now() where id = r.id;
  return v_chq;
end $$;

-- ── 7) الواجهة البرمجية لطلبات الصرف وبحث الأعضاء ورقم الشيك التالي ──
create or replace function api.handle_pay_requests(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare a text := uid::text; v_id uuid; v_chq uuid; r treasury.payment_requests; v_q text;
begin
  if p_action = 'FIN_NEXT_CHEQUE' then
    if not (core.can(uid,'finance.view') or core.can(uid,'treasury.cheque.issue')) then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object('next_no', treasury.next_cheque_no(coalesce(api.t(p,'account'),'1102'))));

  elsif p_action = 'FIN_MEMBER_LOOKUP' then
    if not (core.can(uid,'profile.view') or core.can(uid,'grants.review') or core.can(uid,'treasury.payment.request') or core.can(uid,'treasury.cheque.issue')) then
      return api.err('غير مسموح.');
    end if;
    v_q := trim(coalesce(p->>'q',''));
    if length(v_q) < 2 then return api.ok(jsonb_build_object('items', '[]'::jsonb)); end if;
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pe.id, 'job_id', pe.job_id, 'full_name', pe.full_name, 'workplace', pe.workplace,
        'union_org', pe.union_org, 'member_state', pe.member_state, 'phone', pe.phone,
        'eligible', core.is_union_beneficiary(pe.id, coalesce((nullif(p->>'date',''))::date, current_date)),
        'family', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'full_name', f.full_name, 'relation', f.relation) order by f.created_at)
                            from core.family_members f where f.person_id = pe.id), '[]'::jsonb))
      order by pe.full_name)
      from (select * from core.person_current
            where full_name ilike '%' || v_q || '%' or job_id = v_q or phone = v_q
            order by (job_id = v_q) desc, full_name limit 15) pe), '[]'::jsonb)));

  elsif p_action = 'FIN_PAY_LIST' then
    if not (core.can(uid,'finance.view') or core.can(uid,'treasury.payment.request') or core.can(uid,'treasury.payment.approve') or core.can(uid,'treasury.cheque.issue')) then
      return api.err('غير مسموح.');
    end if;
    return api.ok(jsonb_build_object(
      'items', coalesce((select jsonb_agg(api.pay_request_json(pr.id) order by
          case pr.status when 'مقدَّم' then 1 when 'معتمد' then 2 when 'مصروف' then 3 else 4 end, pr.created_at desc)
        from treasury.payment_requests pr
        where (api.t(p,'status') is null or pr.status = api.t(p,'status'))
          and (api.t(p,'q') is null or pr.payee_name ilike '%'||api.t(p,'q')||'%' or pr.req_no ilike '%'||api.t(p,'q')||'%' or pr.description ilike '%'||api.t(p,'q')||'%')), '[]'::jsonb),
      'approvedGrants', case when core.can(uid,'treasury.cheque.issue') or core.can(uid,'finance.view') then
        coalesce((select jsonb_agg(api.grant_json(g.id) order by g.created_at) from grants.requests g where g.status = 'معتمد'), '[]'::jsonb)
        else '[]'::jsonb end,
      'nextChequeNo', treasury.next_cheque_no('1102'),
      'counts', jsonb_build_object(
        'pending', (select count(*) from treasury.payment_requests where status = 'مقدَّم'),
        'approved', (select count(*) from treasury.payment_requests where status = 'معتمد'),
        'paid', (select count(*) from treasury.payment_requests where status = 'مصروف'),
        'rejected', (select count(*) from treasury.payment_requests where status in ('مرفوض','ملغى')),
        'grantsReady', (select count(*) from grants.requests where status = 'معتمد'))
    ));

  elsif p_action = 'FIN_PAY_CREATE' then
    if not (core.can(uid,'treasury.payment.request') or core.can(uid,'treasury.cheque.issue')) then
      return api.err('غير مسموح — تحتاج صلاحية طلب صرف.');
    end if;
    v_id := treasury.pay_request_create(p, a);
    return api.ok(jsonb_build_object('id', v_id, 'request', api.pay_request_json(v_id)));

  elsif p_action = 'FIN_PAY_DECIDE' then
    if not core.can(uid,'treasury.payment.approve') then return api.err('غير مسموح — تحتاج صلاحية اعتماد الصرف.'); end if;
    perform treasury.pay_request_decide(p, uid);
    return api.ok(jsonb_build_object('request', api.pay_request_json((p->>'id')::uuid)));

  elsif p_action = 'FIN_PAY_CANCEL' then
    select * into r from treasury.payment_requests where id = (p->>'id')::uuid for update;
    if r.id is null then return api.err('الطلب غير موجود.'); end if;
    if r.status <> 'مقدَّم' then return api.err('لا يُلغى إلا طلب في حالة «مقدَّم».'); end if;
    if r.requested_by <> a and not core.is_admin(uid) then return api.err('لا يلغي الطلب إلا مقدّمه أو مدير النظام.'); end if;
    update treasury.payment_requests set status = 'ملغى', reject_reason = coalesce(api.t(p,'reason'),'إلغاء من مقدّم الطلب') where id = r.id;
    return api.ok();

  elsif p_action = 'FIN_PAY_ISSUE' then
    if not core.can(uid,'treasury.cheque.issue') then return api.err('غير مسموح — تحتاج صلاحية إصدار الشيكات.'); end if;
    v_chq := treasury.pay_request_issue(p, uid);
    return api.ok(jsonb_build_object('cheque_id', v_chq, 'request', api.pay_request_json((p->>'id')::uuid)));
  end if;

  return api.err('عملية غير معروفة: ' || p_action);
exception
  when check_violation then return api.err(coalesce(nullif(sqlerrm,''), 'قيمة غير صحيحة.'));
end $$;

-- ── 8) ربط FIN_PAY_* داخل api.handle_finance، وتحديث POL_SAVE و BANK_VOID و wf_items و staff_tasks ──
do $do$
declare d text;
  a_fin text := $a$return api.err('عملية غير معروفة: ' || p_action);$a$;
  a_void text := $v$update grants.requests set status = 'معتمد', cheque_id = null where cheque_id = c.id and status = 'مصروف';$v$;
  a_pol text := $p$coalesce((p->>'requires_decision')::boolean, true)$p$;
begin
  -- أ) api.handle_finance
  d := pg_get_functiondef('api.handle_finance(text,jsonb,uuid)'::regprocedure);
  if position('handle_pay_requests' in d) = 0 then
    if position(a_fin in d) = 0 then raise exception 'مرساة handle_finance غير موجودة'; end if;
    d := replace(d, a_fin,
      $b$if p_action in ('FIN_PAY_LIST','FIN_PAY_CREATE','FIN_PAY_DECIDE','FIN_PAY_CANCEL','FIN_PAY_ISSUE','FIN_NEXT_CHEQUE','FIN_MEMBER_LOOKUP') then
    return api.handle_pay_requests(p_action, p, uid);
  end if;
  $b$ || a_fin);
    execute d;
  end if;

  -- ب) api.handle_bank (إعادة طلب الصرف لحالة «معتمد» عند إلغاء شيكه بقيد عكسي)
  d := pg_get_functiondef('api.handle_bank(text,jsonb,uuid)'::regprocedure);
  if position('treasury.payment_requests' in d) = 0 then
    if position(a_void in d) = 0 then raise exception 'مرساة handle_bank غير موجودة'; end if;
    d := replace(d, a_void, a_void || E'\n    update treasury.payment_requests set status = ''معتمد'', cheque_id = null where cheque_id = c.id and status = ''مصروف'';');
    execute d;
  end if;

  -- ج) api.handle_finpol (جعل requires_decision اختيارية افتراضياً عند حفظ بند اللائحة)
  d := pg_get_functiondef('api.handle_finpol(text,jsonb,uuid)'::regprocedure);
  if position(a_pol in d) > 0 then
    d := replace(d, a_pol, $p2$coalesce((p->>'requires_decision')::boolean, false)$p2$);
    execute d;
  end if;
end $do$;

-- د) إدراج طلبات الصرف في صندوق الاعتمادات الموحّد (wf_items) والتنبيهات الذكية (staff_tasks)
create or replace function api.wf_items(only_pid uuid) returns table(item jsonb, perm text, open boolean)
language sql stable set search_path to 'core','public','extensions','pg_temp' as $$
  with g as (
    select r.*, p.full_name, t.name tname,
      case r.status when 'مقدَّم' then 1 when 'ناقص مستندات' then 1 when 'مستوفى' then 2 when 'معتمد' then 3 when 'مصروف' then 4 else -1 end idx
    from grants.requests r join core.persons p on p.id = r.person_id left join grants.types t on t.code = r.type_code
    where only_pid is null or r.person_id = only_pid),
  pr as (
    select r.*,
      case r.status when 'مقدَّم' then 1 when 'معتمد' then 2 when 'مصروف' then 3 else -1 end idx
    from treasury.payment_requests r
    where only_pid is null or r.payee_person_id = only_pid),
  c as (
    select r.*, p.full_name, case r.status when 'معلّق' then 1 when 'معتمد' then 2 else -1 end idx
    from core.change_requests r join core.persons p on p.id = r.person_id where only_pid is null or r.person_id = only_pid),
  d as (
    select o.*, p.full_name, f.title otitle, f.category,
      case o.status when 'مطلوب' then 1 when 'مؤكد' then 2 when 'مسلّم' then 3 else -1 end idx
    from activities.dev_orders o join core.persons p on p.id = o.person_id join activities.dev_offers f on f.id = o.offer_id
    where only_pid is null or o.person_id = only_pid),
  b as (
    select k.*, p.full_name, a.title atitle, a.start_date,
      case k.status when 'قائمة انتظار' then 0 when 'بانتظار السداد' then 1 when 'مؤكد' then 2 when 'منتهٍ' then 3 else -1 end idx
    from activities.bookings k join core.persons p on p.id = k.person_id join activities.activities a on a.id = k.activity_id
    where only_pid is null or k.person_id = only_pid)
  select jsonb_build_object('module','منحة','icon','🎁','ref',req_no,'title',coalesce(tname,type_code) || coalesce(' — ' || subject_name,''),
      'person',full_name,'person_id',person_id,'at',created_at,'status',status,'amount',amount,'idx',idx,
      'stages',jsonb_build_array('تقديم الطلب','مراجعة المستندات','اعتماد المنحة','استخراج الشيك','تم الصرف'),
      'actor',case idx when 1 then 'مراجع المنح' when 2 then 'معتمِد المنح' when 3 then 'الخزينة (إصدار الشيك)' end,
      'note',case when status='ناقص مستندات' then 'ناقص مستندات' when status='مرفوض' then reject_reason end,'link',case when idx=3 then '#/payreqs' else '#/grantsadmin' end,'mylink','#/grants'),
    case idx when 1 then 'grants.review' when 2 then 'grants.approve' when 3 then 'treasury.cheque.issue' end, idx between 1 and 3
  from g
  union all
  select jsonb_build_object('module','طلب صرف','icon','📝','ref',req_no,'title',purpose || ' — ' || description,
      'person',payee_name,'person_id',payee_person_id,'at',created_at,'status',status,'amount',amount,'idx',idx,
      'stages',jsonb_build_array('تقديم الطلب','اعتماد الصرف','استخراج الشيك','تم الصرف'),
      'actor',case idx when 1 then 'معتمِد الصرف' when 2 then 'الخزينة (إصدار الشيك)' end,
      'note',coalesce(reject_reason, approval_note),'link','#/payreqs','mylink','#/home'),
    case idx when 1 then 'treasury.payment.approve' when 2 then 'treasury.cheque.issue' end, idx between 1 and 2
  from pr
  union all
  select jsonb_build_object('module','تعديل بيانات','icon','📝','ref',null,'title',field || ': ' || coalesce(old_value,'—') || ' ← ' || new_value,
      'person',full_name,'person_id',person_id,'at',created_at,'status',status,'idx',idx,
      'stages',jsonb_build_array('تقديم الطلب','اعتماد مسؤول البيانات','تحديث الملف'),
      'actor',case idx when 1 then 'مسؤول البيانات' end,'note',decision_note,'link','#/requests','mylink','#/profile'),
    'profile.change.approve', idx = 1
  from c
  union all
  select jsonb_build_object('module',coalesce(category,'جهاز'),'icon',case when category in ('عمرة','حج') then '🕋' else '📱' end,'ref',order_no,'title',otitle,
      'person',full_name,'person_id',person_id,'at',created_at,'status',status,'amount',offer_price,'idx',idx,
      'stages',jsonb_build_array('الحجز','تأكيد الإدارة','التسليم','تم'),
      'actor',case idx when 1 then 'مسؤول العروض' when 2 then 'مسؤول العروض / المورد' end,'note',reject_reason,'link','#/devadmin','mylink','#/devices'),
    'devices.manage', idx between 1 and 2
  from d
  union all
  select jsonb_build_object('module','حجز نشاط','icon','🚌','ref',booking_no,'title',atitle,
      'person',full_name,'person_id',person_id,'at',created_at,'status',status,'amount',total - coalesce(paid,0),'idx',greatest(idx,1),
      'stages',jsonb_build_array('الحجز','السداد','مؤكد','انتهى'),
      'actor',case idx when 0 then 'بانتظار مقعد' when 1 then 'الخزينة (التحصيل)' end,
      'note',case when idx = 0 then 'قائمة انتظار' when idx = 1 and hold_until is not null then 'مهلة السداد حتى ' || to_char(hold_until,'YYYY-MM-DD HH24:MI') else cancel_reason end,
      'link','#/trips','mylink','#/mytrips'),
    'treasury.receipt', idx = 1
  from b
$$;

create or replace function api.staff_tasks(uid uuid) returns jsonb language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select coalesce(jsonb_agg(t) filter (where (t->>'count')::int > 0), '[]') from (
    select jsonb_build_object('title','طلبات صرف بانتظار الاعتماد','count',(select count(*) from treasury.payment_requests where status = 'مقدَّم'),'link','#/payreqs') t where core.can(uid,'treasury.payment.approve')
    union all select jsonb_build_object('title','أوامر صرف ومنح جاهزة لاستخراج شيك','count',(select (select count(*) from treasury.payment_requests where status = 'معتمد') + (select count(*) from grants.requests where status = 'معتمد')),'link','#/payreqs') where core.can(uid,'treasury.cheque.issue')
    union all select jsonb_build_object('title','طلبات تعديل بيانات','count',(select count(*) from core.change_requests where status = 'معلّق'),'link','#/requests') where core.can(uid,'profile.change.approve')
    union all select jsonb_build_object('title','منح تحتاج مراجعة مستندات','count',(select count(*) from grants.requests where status in ('مقدَّم','ناقص مستندات')),'link','#/grantsadmin') where core.can(uid,'grants.review')
    union all select jsonb_build_object('title','منح جاهزة للاعتماد','count',(select count(*) from grants.requests where status = 'مستوفى'),'link','#/grantsadmin') where core.can(uid,'grants.approve')
    union all select jsonb_build_object('title','حجوزات أجهزة/عمرة جديدة','count',(select count(*) from activities.dev_orders where status = 'مطلوب'),'link','#/devadmin') where core.can(uid,'devices.manage')
    union all select jsonb_build_object('title','طلبات تبديل مصايف','count',(select count(*) from activities.summer_swaps where status in ('مطلوب','وافق الطرف الآخر')),'link','#/summer') where core.can(uid,'summer.manage')
    union all select jsonb_build_object('title','حجوزات رحلات بانتظار التحصيل','count',(select count(*) from activities.bookings where status = 'بانتظار السداد'),'link','#/trips') where core.can(uid,'treasury.receipt')
    union all select jsonb_build_object('title','⚖️ قرارات مجلس متأخرة عن موعد التنفيذ','count',(select count(*) from governance.decisions where status = 'معتمد' and exec_status in ('لم يبدأ','قيد التنفيذ') and due_date < current_date),'link','#/decisions','level','warn')
      where core.can(uid,'governance.view') or core.can(uid,'governance.manage')
    union all select jsonb_build_object('title','⚠️ عُهد وسلف متأخرة التسوية (+30 يوماً)','count',(select count(*) from treasury.cheques where requires_settlement and status in ('صادر','مرحّل الرصيد') and issue_date < current_date - 30),'link','#/settlements','level','warn')
      where core.can(uid,'treasury.settlement') or core.can(uid,'treasury.cheque.issue')
    union all select jsonb_build_object('title','⚠️ شيكات لم تُصرف منذ أكثر من 6 شهور','count',(select count(*) from treasury.cheques where status <> 'ملغى' and cleared_date is null and issue_date < current_date - 180
        and exists (select 1 from treasury.cheques x where x.cleared_date is not null)),'link','#/bank','level','warn')
      where core.can(uid,'treasury.cheque.issue')
    union all select jsonb_build_object('title','🏦 مطابقة البنك لم تُعمل هذا الشهر','count',case when exists (select 1 from treasury.bank_reconciliations where stmt_date >= date_trunc('month', current_date) - interval '1 month') then 0 else 1 end,'link','#/bank','level','warn')
      where core.can(uid,'treasury.cheque.issue')
    union all select jsonb_build_object('title','🚨 قيود غير متوازنة — راجع فوراً','count',(select count(*) from (select entry_id from finance.lines group by entry_id having abs(sum(debit) - sum(credit)) >= 0.005) u),'link','#/entries','level','bad')
      where core.can(uid,'finance.view')
  ) q
$$;

revoke all on all functions in schema treasury from public, anon, authenticated;
revoke all on all functions in schema grants from public, anon, authenticated;
revoke all on all functions in schema api from public, anon, authenticated;
