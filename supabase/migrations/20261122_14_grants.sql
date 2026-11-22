-- المرحلة 7أ — منح المناسبات (schema grants)
-- طلب العضو بمستنداته ← مراجعة المستندات (grants.review) ← اعتماد (grants.approve) ← صرف شيك منحة (treasury.cheque.issue)
-- الشيك يغذّي سجل المزايا تلقائياً (benefits.from_cheque). الاستحقاق = «النقابة العامة» في تاريخ الواقعة.
-- لا تكرار لنفس الواقعة (نفس النوع + نفس المستفيد/المتوفى/المولود)، ومهلة تقديم من تاريخ الواقعة، وحد سنوي لكل نوع.
-- فصل المهام: مقدّم الطلب لا يراجعه ولا يعتمده، والمعتمِد لا يصرف.
create schema if not exists grants;
revoke all on schema grants from public, anon, authenticated;

create table grants.types (
  code          text primary key,                 -- MARRIAGE / BIRTH / DEATH / EXCELLENCE / MEDICAL ...
  name          text not null,                    -- منحة زواج ...
  account       text not null references finance.accounts(code),
  needs_relation boolean not null default false,  -- المستفيد/المتوفى من الأسرة (وفاة/مولود/تفوق)
  relations     text[],                           -- الصلات المقبولة (null = أي صلة أو العضو نفسه)
  docs          text[] not null default '{}',     -- المستندات المطلوبة
  deadline_days int,                              -- مهلة التقديم من تاريخ الواقعة (null = بلا حد)
  max_per_year  int,                              -- حد سنوي لكل عضو (null = بلا حد)
  once_per_subject boolean not null default true, -- مرة واحدة لنفس المستفيد (نفس المولود/المتوفى/الزواج)
  active        boolean not null default true,
  sort          int not null default 0
);

-- المبالغ بتاريخ سريان (تتغير بقرار)، ويمكن أن تختلف حسب الصلة
create table grants.rates (
  id          uuid primary key default gen_random_uuid(),
  type_code   text not null references grants.types(code),
  relation    text,                               -- null = الافتراضي
  amount      numeric(10,2) not null check (amount > 0),
  valid_from  date not null,
  decision_id uuid references governance.decisions(id),
  notes       text,
  unique (type_code, relation, valid_from)
);

create table grants.requests (
  id            uuid primary key default gen_random_uuid(),
  req_no        text not null unique,
  person_id     uuid not null references core.persons(id),
  type_code     text not null references grants.types(code),
  event_date    date not null,
  subject_name  text,                             -- المستفيد/المتوفى/المولود
  subject_relation text,                          -- العضو نفسه / زوجة / ابن ...
  family_member_id uuid references core.family_members(id),
  subject_key   text not null,                    -- مفتاح منع التكرار
  amount        numeric(10,2),                    -- من جدول المبالغ (أو يحدده المعتمِد إن لم يوجد)
  eligible      boolean not null,
  status        text not null default 'مقدَّم' check (status in ('مقدَّم','ناقص مستندات','مستوفى','معتمد','مرفوض','مصروف','ملغى')),
  docs          jsonb not null default '[]',      -- [{name, received:boolean, note}]
  notes         text,
  reject_reason text,
  decision_id   uuid references governance.decisions(id),
  cheque_id     uuid references treasury.cheques(id),
  submitted_by  text,                             -- uid
  reviewed_by   text, approved_by text, paid_by text,
  created_at    timestamptz not null default now(),
  check (event_date <= created_at::date + 1)
);
create index on grants.requests (person_id);
create index on grants.requests (status);
-- نفس الواقعة لا تتكرر (الملغى والمرفوض لا يمنعان)
create unique index grants_once on grants.requests (type_code, subject_key) where status not in ('مرفوض','ملغى');

create table grants.events (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references grants.requests(id) on delete cascade,
  kind        text not null,
  details     jsonb not null default '{}',
  actor       text,
  at          timestamptz not null default clock_timestamp()
);

do $$ declare t text; begin
  foreach t in array array['types','rates','requests','events'] loop
    execute format('alter table grants.%I enable row level security', t);
    execute format('revoke all on grants.%I from anon, authenticated', t);
    if t <> 'events' then
      execute format('create trigger %I after insert or update or delete on grants.%I for each row execute function audit.track()', t || '_audit', t);
    end if;
  end loop;
end $$;

-- الأنواع (المبالغ مبدئية من تاريخ MyNekaba — تُراجع بقرار)
insert into grants.types(code, name, account, needs_relation, relations, docs, deadline_days, max_per_year, sort) values
 ('MARRIAGE','منحة زواج','5102', false, array['العضو','ابن','ابنة'], array['قسيمة الزواج'], 180, null, 1),
 ('BIRTH','منحة مولود','5103', true, array['ابن','ابنة'], array['شهادة الميلاد'], 180, null, 2),
 ('DEATH','منحة وفاة','5101', true, array['العضو','زوج','زوجة','ابن','ابنة','أب','أم'], array['شهادة الوفاة'], 180, null, 3),
 ('EXCELLENCE','منحة تفوق','5104', true, array['ابن','ابنة'], array['شهادة النجاح بالمجموع'], 120, null, 4),
 ('MEDICAL','منحة علاج','5105', false, null, array['تقرير طبي','فواتير العلاج'], 90, 1, 5)
on conflict (code) do nothing;
-- منحة العلاج تتكرر لنفس الشخص بحالات مختلفة (الحد السنوي يحكمها)
update grants.types set once_per_subject = false where code = 'MEDICAL';
insert into grants.rates(type_code, relation, amount, valid_from, notes) values
 ('MARRIAGE', null, 300, '2022-01-01', 'مبدئي من تاريخ الصرف — يُراجع'),
 ('DEATH', null, 300, '2022-01-01', 'مبدئي من تاريخ الصرف (صُرف 500 أحياناً) — يُراجع')
on conflict do nothing;

-- صلاحيات: المراجعة لمجلس الإدارة (قائمة)، والاعتماد لمدير المنظومة مبدئياً حتى يحدد المجلس
insert into core.role_permissions(role, permission) values ('SYS_ADMIN','grants.review'), ('SYS_ADMIN','grants.approve') on conflict do nothing;

create or replace function grants.log(p_req uuid, p_kind text, p_details jsonb, p_actor text) returns void language sql as $$
  insert into grants.events(request_id, kind, details, actor) values (p_req, p_kind, coalesce(p_details,'{}'), p_actor)
$$;

create or replace function grants.rate(p_type text, p_relation text, p_date date) returns numeric language sql stable as $$
  select amount from grants.rates where type_code = p_type and valid_from <= p_date and (relation = p_relation or relation is null)
  order by (relation is null), valid_from desc limit 1
$$;

-- ───────── التقديم ─────────
-- p: {type, event_date, family_member_id? | subject_name+subject_relation?, notes, docs:[names معاه]}
create or replace function grants.apply(p_person uuid, p jsonb, p_actor text) returns uuid language plpgsql as $$
declare t grants.types; me core.persons; fm core.family_members; v_date date; v_name text; v_rel text; v_key text; v_id uuid; v_amt numeric; v_n int;
begin
  select * into t from grants.types where code = p->>'type' and active;
  if t.code is null then raise exception 'نوع المنحة غير متاح' using errcode = 'check_violation'; end if;
  v_date := (p->>'event_date')::date;
  if v_date is null or v_date > current_date then raise exception 'تاريخ الواقعة غير صحيح' using errcode = 'check_violation'; end if;
  if t.deadline_days is not null and current_date - v_date > t.deadline_days then
    raise exception 'انتهت مهلة التقديم (% يوم من تاريخ الواقعة)', t.deadline_days using errcode = 'check_violation'; end if;
  if not core.is_union_beneficiary(p_person, v_date) then
    raise exception 'المنح لأعضاء النقابة العامة النشطين في تاريخ الواقعة' using errcode = 'check_violation'; end if;
  select * into me from core.persons where id = p_person;
  if nullif(p->>'family_member_id','') is not null then
    select * into fm from core.family_members where id = (p->>'family_member_id')::uuid and person_id = p_person;
    if fm.id is null then raise exception 'فرد الأسرة غير موجود في ملفك' using errcode = 'check_violation'; end if;
    v_name := fm.full_name; v_rel := fm.relation; v_key := 'FM:' || fm.id;
  elsif coalesce(p->>'subject_relation','العضو') = 'العضو' and not t.needs_relation then
    v_name := me.full_name; v_rel := 'العضو'; v_key := 'P:' || p_person;
  elsif p->>'subject_relation' = 'العضو' then   -- وفاة العضو نفسه (يقدّمها ذووه نيابة عنه عبر الإدارة)
    v_name := me.full_name; v_rel := 'العضو'; v_key := 'P:' || p_person;
  else
    v_name := nullif(trim(p->>'subject_name'),''); v_rel := nullif(trim(p->>'subject_relation'),'');
    if v_name is null or v_rel is null then raise exception 'حدد المستفيد من أسرتك (أو اكتب اسمه وصلته)' using errcode = 'check_violation'; end if;
    v_key := 'N:' || p_person || ':' || v_rel || ':' || lower(regexp_replace(v_name, '\s+', ' ', 'g'));
  end if;
  if t.relations is not null and not (v_rel = any(t.relations)) then
    raise exception '% لا تُصرف عن صلة «%»', t.name, v_rel using errcode = 'check_violation'; end if;
  -- الزواج: مرة لكل شخص؛ العلاج: كل طلب حالة مستقلة
  if not t.once_per_subject then v_key := v_key || ':' || v_date; end if;
  if t.code = 'DEATH' and v_rel = 'العضو' then v_key := 'P:' || p_person; end if;
  if exists (select 1 from grants.requests where type_code = t.code and subject_key = v_key and status not in ('مرفوض','ملغى')) then
    raise exception 'سبق تقديم/صرف % لنفس الواقعة', t.name using errcode = 'check_violation'; end if;
  if t.max_per_year is not null then
    select count(*) into v_n from grants.requests where person_id = p_person and type_code = t.code
      and extract(year from event_date) = extract(year from v_date) and status not in ('مرفوض','ملغى');
    if v_n >= t.max_per_year then raise exception 'وصلت للحد السنوي لـ% (%)', t.name, t.max_per_year using errcode = 'check_violation'; end if;
  end if;
  v_amt := grants.rate(t.code, v_rel, v_date);
  insert into grants.requests(req_no, person_id, type_code, event_date, subject_name, subject_relation, family_member_id, subject_key,
    amount, eligible, docs, notes, submitted_by)
  values (core.next_doc_no('GRANT', 'منحة', extract(year from current_date)::int), p_person, t.code, v_date, v_name, v_rel, fm.id, v_key,
    v_amt, true,
    (select coalesce(jsonb_agg(jsonb_build_object('name', d, 'received', false)), '[]') from unnest(t.docs) d),
    nullif(trim(p->>'notes'),''), p_actor)
  returning id into v_id;
  perform grants.log(v_id, 'تقديم', jsonb_build_object('amount', v_amt), p_actor);
  return v_id;
end $$;

-- ───────── مراجعة المستندات ─────────
-- p: {requestId, docs:[{name, received, note}], notes}
create or replace function grants.review(p jsonb, p_actor text) returns text language plpgsql as $$
declare r grants.requests; v_docs jsonb; v_st text;
begin
  select * into r from grants.requests where id = (p->>'requestId')::uuid for update;
  if r.id is null or r.status not in ('مقدَّم','ناقص مستندات','مستوفى') then raise exception 'الطلب غير قابل للمراجعة' using errcode = 'check_violation'; end if;
  if r.submitted_by = p_actor then raise exception 'لا تراجع طلباً قدّمته بنفسك' using errcode = 'check_violation'; end if;
  v_docs := coalesce(p->'docs', r.docs);
  v_st := case when exists (select 1 from jsonb_array_elements(v_docs) d where not coalesce((d->>'received')::boolean, false)) then 'ناقص مستندات' else 'مستوفى' end;
  update grants.requests set docs = v_docs, status = v_st, reviewed_by = p_actor, notes = coalesce(nullif(trim(p->>'notes'),''), notes) where id = r.id;
  perform grants.log(r.id, 'مراجعة', jsonb_build_object('status', v_st, 'docs', v_docs), p_actor);
  return v_st;
end $$;

-- ───────── الاعتماد / الرفض ─────────
create or replace function grants.decide(p jsonb, p_actor text) returns void language plpgsql as $$
declare r grants.requests; v_amt numeric;
begin
  select * into r from grants.requests where id = (p->>'requestId')::uuid for update;
  if r.id is null then raise exception 'الطلب غير موجود' using errcode = 'check_violation'; end if;
  if r.submitted_by = p_actor then raise exception 'لا تعتمد طلباً قدّمته بنفسك' using errcode = 'check_violation'; end if;
  if coalesce((p->>'approve')::boolean, false) then
    if r.status <> 'مستوفى' then raise exception 'الاعتماد بعد استيفاء المستندات' using errcode = 'check_violation'; end if;
    v_amt := coalesce((nullif(p->>'amount',''))::numeric, r.amount);
    if v_amt is null or v_amt <= 0 then raise exception 'حدد المبلغ (لا يوجد مبلغ معتمد لهذا النوع)' using errcode = 'check_violation'; end if;
    -- مبلغ مختلف عن الجدول يلزمه قرار
    if r.amount is not null and v_amt <> r.amount and nullif(p->>'decision_id','') is null then
      raise exception 'المبلغ مختلف عن المقرر (%) — اربطه بقرار المجلس', r.amount using errcode = 'check_violation'; end if;
    if r.amount is null and nullif(p->>'decision_id','') is null then
      raise exception 'لا يوجد مبلغ مقرر لهذا النوع — اربط الاعتماد بقرار المجلس' using errcode = 'check_violation'; end if;
    update grants.requests set status = 'معتمد', amount = v_amt, approved_by = p_actor,
      decision_id = coalesce((nullif(p->>'decision_id',''))::uuid, decision_id) where id = r.id;
    perform grants.log(r.id, 'اعتماد', jsonb_build_object('amount', v_amt, 'decision_id', p->>'decision_id'), p_actor);
  else
    if r.status in ('مصروف','مرفوض','ملغى') then raise exception 'الطلب منتهٍ' using errcode = 'check_violation'; end if;
    if nullif(trim(p->>'reason'),'') is null then raise exception 'سبب الرفض مطلوب' using errcode = 'check_violation'; end if;
    update grants.requests set status = 'مرفوض', reject_reason = trim(p->>'reason'), approved_by = p_actor where id = r.id;
    perform grants.log(r.id, 'رفض', jsonb_build_object('reason', p->>'reason'), p_actor);
  end if;
end $$;

-- ───────── الصرف: شيك منحة (القيد + الميزة تلقائياً) ─────────
create or replace function grants.pay(p jsonb, p_actor text) returns uuid language plpgsql as $$
declare r grants.requests; t grants.types; v_chq uuid; pe core.persons;
begin
  select * into r from grants.requests where id = (p->>'requestId')::uuid for update;
  if r.id is null or r.status <> 'معتمد' then raise exception 'الصرف للطلبات المعتمدة فقط' using errcode = 'check_violation'; end if;
  if r.approved_by = p_actor then raise exception 'من اعتمد الطلب لا يصرفه' using errcode = 'check_violation'; end if;
  select * into t from grants.types where code = r.type_code;
  select * into pe from core.persons where id = r.person_id;
  v_chq := treasury.issue_cheque(jsonb_build_object('date', coalesce(nullif(p->>'date',''), current_date::text), 'amount', r.amount,
    'cheque_no', p->>'cheque_no', 'bank_account', coalesce(nullif(p->>'bank_account',''),'1102'), 'person_id', r.person_id,
    'payee_name', pe.full_name, 'purpose', 'منحة', 'expense_account', t.account, 'decision_id', r.decision_id, 'cost_center', 'GRANTS',
    'notes', t.name || ' — ' || coalesce(r.subject_relation,'') || ' ' || coalesce(r.subject_name,'') || ' — طلب ' || r.req_no), p_actor);
  update grants.requests set status = 'مصروف', cheque_id = v_chq, paid_by = p_actor where id = r.id;
  perform grants.log(r.id, 'صرف', jsonb_build_object('cheque_id', v_chq, 'cheque_no', p->>'cheque_no'), p_actor);
  return v_chq;
end $$;

create or replace function grants.cancel(p_req uuid, p_person uuid, p_actor text) returns void language plpgsql as $$
begin
  update grants.requests set status = 'ملغى' where id = p_req and (p_person is null or person_id = p_person)
    and status in ('مقدَّم','ناقص مستندات','مستوفى');
  if not found then raise exception 'الطلب لا يُلغى في حالته' using errcode = 'check_violation'; end if;
  perform grants.log(p_req, 'إلغاء', '{}', p_actor);
end $$;

-- ───────── واجهة GRT_* ─────────
create or replace function api.grant_json(p_req uuid) returns jsonb language sql stable as $$
  select to_jsonb(r) - 'subject_key' || jsonb_build_object(
    'type_name', t.name,
    'person', (select jsonb_build_object('full_name', full_name, 'job_id', job_id) from core.persons where id = r.person_id),
    'cheque', (select jsonb_build_object('cheque_no', c.cheque_no, 'issue_date', c.issue_date, 'entry_id', c.entry_id) from treasury.cheques c where c.id = r.cheque_id),
    'decision', (select jsonb_build_object('decision_no', d.decision_no) from governance.decisions d where d.id = r.decision_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.at, 'details', e.details) order by e.id) from grants.events e where e.request_id = r.id), '[]'))
  from grants.requests r join grants.types t on t.code = r.type_code where r.id = p_req
$$;

create or replace function api.handle_grants(p_action text, p jsonb, uid uuid, pid uuid) returns jsonb language plpgsql as $$
declare v_id uuid; v_person uuid; a text := uid::text; v_st text;
begin
  if p_action = 'GRT_TYPES' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('amount', grants.rate(t.code, null, current_date),
        'rates', coalesce((select jsonb_agg(to_jsonb(x) - 'type_code' order by x.valid_from desc) from grants.rates x where x.type_code = t.code), '[]')) order by t.sort)
      from grants.types t where t.active or core.can(uid,'grants.approve')), '[]'),
      'eligibleToday', case when pid is not null then core.is_union_beneficiary(pid) end));
  elsif p_action = 'GRT_APPLY' then
    v_person := pid;
    if nullif(p->>'personId','') is not null or nullif(p->>'jobId','') is not null then   -- تقديم نيابة (مثلاً وفاة العضو)
      if not core.can(uid,'grants.review') then return api.err('غير مسموح.'); end if;
      v_person := coalesce((nullif(p->>'personId',''))::uuid, api.pid_by_job(p->>'jobId'));
    elsif not core.can(uid,'grants.request') then return api.err('المنح لأعضاء الجمعية العمومية.'); end if;
    if v_person is null then return api.err('العضو غير موجود.'); end if;
    v_id := grants.apply(v_person, p, a);
    return api.ok(jsonb_build_object('request', api.grant_json(v_id)));
  elsif p_action = 'GRT_MY' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(api.grant_json(id) order by created_at desc) from grants.requests where person_id = pid), '[]')));
  elsif p_action = 'GRT_CANCEL_MY' then
    perform grants.cancel((p->>'requestId')::uuid, pid, a); return api.ok();
  elsif p_action = 'GRT_LIST' then
    if not (core.can(uid,'grants.review') or core.can(uid,'grants.approve') or core.can(uid,'treasury.cheque.issue')) then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(api.grant_json(r.id) order by
        case r.status when 'مقدَّم' then 1 when 'ناقص مستندات' then 2 when 'مستوفى' then 3 when 'معتمد' then 4 else 5 end, r.created_at desc)
      from grants.requests r where (api.t(p,'status') is null or r.status = api.t(p,'status'))
        and (api.t(p,'type') is null or r.type_code = api.t(p,'type'))
        and (api.t(p,'status') is not null or r.status not in ('مصروف','مرفوض','ملغى') or r.created_at > now() - interval '90 days')), '[]'),
      'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from grants.requests group by status) q)));
  elsif p_action = 'GRT_REVIEW' then
    if not core.can(uid,'grants.review') then return api.err('غير مسموح.'); end if;
    v_st := grants.review(p, a); return api.ok(jsonb_build_object('status', v_st, 'request', api.grant_json((p->>'requestId')::uuid)));
  elsif p_action = 'GRT_DECIDE' then
    if not core.can(uid,'grants.approve') then return api.err('غير مسموح.'); end if;
    perform grants.decide(p, a); return api.ok(jsonb_build_object('request', api.grant_json((p->>'requestId')::uuid)));
  elsif p_action = 'GRT_PAY' then
    if not core.can(uid,'treasury.cheque.issue') then return api.err('غير مسموح.'); end if;
    v_id := grants.pay(p, a); return api.ok(jsonb_build_object('request', api.grant_json((p->>'requestId')::uuid)));
  elsif p_action = 'GRT_SET_RATE' then
    if not core.can(uid,'grants.approve') then return api.err('غير مسموح.'); end if;
    insert into grants.rates(type_code, relation, amount, valid_from, decision_id, notes)
    values (p->>'type', nullif(p->>'relation',''), (p->>'amount')::numeric, coalesce((nullif(p->>'valid_from',''))::date, current_date),
            (nullif(p->>'decision_id',''))::uuid, api.t(p,'notes'))
    on conflict (type_code, relation, valid_from) do update set amount = excluded.amount, decision_id = excluded.decision_id, notes = excluded.notes;
    return api.ok();
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- الموجّه (كل الفروع)
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  if p_action like 'IMPORT\_%' or p_action like 'GOV\_%' or p_action like 'FIN\_%' or p_action like 'BEN\_%' or p_action like 'ACT\_%'
     or p_action like 'SUM\_%' or p_action like 'GRT\_%' then
    uid := api.session_user(s);
    if uid is null then return api.err('انتهت الجلسة. سجّل الدخول مرة أخرى.') || '{"expired":true}'; end if;
    perform set_config('erp.reason', coalesce(p->>'reason', ''), true);
    if p_action in ('IMPORT_GOVERNANCE','IMPORT_FINANCE','IMPORT_BENEFITS') then
      if not core.can(uid,'data.import') then return api.err('غير مسموح.'); end if;
      if p_action = 'IMPORT_GOVERNANCE' then return api.import_governance(p); end if;
      if p_action = 'IMPORT_BENEFITS' then return api.import_benefits(p); end if;
      return api.import_finance(p, uid);
    elsif p_action like 'IMPORT\_%' then return api.handle_import(p_action, p, uid);
    elsif p_action like 'GOV\_%' then return api.handle_governance(p_action, p, uid);
    elsif p_action like 'BEN\_%' then return api.handle_benefits(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'ACT\_%' then return api.handle_activities(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'SUM\_%' then return api.handle_summer(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'GRT\_%' then return api.handle_grants(p_action, p, uid, (s->>'pid')::uuid);
    else return api.handle_finance(p_action, p, uid);
    end if;
  end if;
  return api.handle_core(p_action, p, s);
exception
  when check_violation then return api.err(coalesce(nullif(sqlerrm,''),'قيمة غير صحيحة'));
  when unique_violation then return api.err('القيمة مسجّلة من قبل.');
  when invalid_datetime_format or datetime_field_overflow then return api.err('تاريخ غير صحيح (yyyy-mm-dd).');
  when invalid_text_representation then return api.err('قيمة غير صحيحة.');
end $$;
revoke all on all functions in schema api, grants from public, anon, authenticated;
