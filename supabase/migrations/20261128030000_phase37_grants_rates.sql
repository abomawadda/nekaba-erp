-- Phase 37: Flexible Grants Rates (500 EGP for Member/Spouse Death, 300 EGP 1st-degree/Marriage, 1000 EGP Board Member Tier & Flexible Admin Rate Editor)

-- 1) Ensure exact current electoral term rates exist cleanly
do $$
begin
  -- وفاة العضو نفسه = 500 ج
  if not exists (select 1 from grants.rates where type_code = 'DEATH' and relation = 'العضو' and valid_from = '2022-01-01') then
    insert into grants.rates(type_code, relation, amount, valid_from, notes)
    values ('DEATH', 'العضو', 500.00, '2022-01-01', 'لائحة الدورة الحالية — وفاة العضو نفسه');
  end if;

  -- عضو مجلس الإدارة (وفاة / زواج) = 1000 ج (أو بمبلغ يُحدد بموجب موافقة/قرار)
  if not exists (select 1 from grants.rates where type_code = 'DEATH' and relation = 'عضو مجلس إدارة' and valid_from = '2022-01-01') then
    insert into grants.rates(type_code, relation, amount, valid_from, notes)
    values ('DEATH', 'عضو مجلس إدارة', 1000.00, '2022-01-01', 'لائحة الدورة الحالية — عضو مجلس إدارة (أو مبلغ يُحدد بموافقة)');
  end if;

  if not exists (select 1 from grants.rates where type_code = 'MARRIAGE' and relation = 'عضو مجلس إدارة' and valid_from = '2022-01-01') then
    insert into grants.rates(type_code, relation, amount, valid_from, notes)
    values ('MARRIAGE', 'عضو مجلس إدارة', 1000.00, '2022-01-01', 'لائحة الدورة الحالية — عضو مجلس إدارة (أو مبلغ يُحدد بموافقة)');
  end if;
end $$;

-- 2) Helper: check if person is an active board member on a given date
create or replace function grants.is_board_member(p_person uuid, p_date date default current_date)
returns boolean
language sql
stable
set search_path to 'core', 'public', 'extensions', 'pg_temp'
as $$
  select exists (
    select 1 from governance.board_seats bs
    where bs.person_id = p_person
      and bs.from_date <= coalesce(p_date, current_date)
      and (bs.to_date is null or bs.to_date >= coalesce(p_date, current_date))
  )
$$;

-- 3) Update grants.apply to automatically apply board-member rate when applicant is on the board
create or replace function grants.apply(p_person uuid, p jsonb, p_actor text)
returns uuid
language plpgsql
set search_path to 'core', 'public', 'extensions', 'pg_temp'
as $$
declare t grants.types; me core.persons; fm core.family_members; v_date date; v_name text; v_rel text; v_key text;
        v_id uuid; v_amt numeric; v_n int; v_dec uuid := (nullif(p->>'decision_id',''))::uuid;
        v_docs jsonb; v_st text := 'مقدَّم'; v_rev text; v_is_board boolean := false;
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

  v_is_board := grants.is_board_member(p_person, v_date);
  if v_is_board then
    v_amt := coalesce(grants.rate(t.code, 'عضو مجلس إدارة', v_date), grants.rate(t.code, v_rel, v_date));
  else
    v_amt := grants.rate(t.code, v_rel, v_date);
  end if;

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
  perform grants.log(v_id, 'تقديم', jsonb_build_object('amount', v_amt, 'status', v_st, 'decision_id', v_dec, 'board_member', v_is_board), p_actor);
  return v_id;
end $$;

-- 4) Update api.handle_grants to return isBoardMember in GRT_TYPES, fix NULL relation upsert in GRT_SET_RATE, and support GRT_DEL_RATE
create or replace function api.handle_grants(p_action text, p jsonb, uid uuid, pid uuid)
returns jsonb
language plpgsql
set search_path to 'core', 'public', 'extensions', 'pg_temp'
as $$
declare v_id uuid; v_person uuid; a text := uid::text; v_st text; v_rel text; v_vf date;
begin
  if p_action = 'GRT_TYPES' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('amount', grants.rate(t.code, null, current_date),
        'rates', coalesce((select jsonb_agg(to_jsonb(x) - 'type_code' order by (x.relation is null), x.relation, x.valid_from desc) from grants.rates x where x.type_code = t.code), '[]')) order by t.sort)
      from grants.types t where t.active or core.can(uid,'grants.approve')), '[]'),
      'eligibleToday', case when pid is not null then core.is_union_beneficiary(pid) end,
      'isBoardMember', case when pid is not null then grants.is_board_member(pid, current_date) else false end));
  elsif p_action = 'GRT_APPLY' then
    v_person := pid;
    if nullif(p->>'personId','') is not null or nullif(p->>'jobId','') is not null then
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
    v_rel := nullif(trim(coalesce(p->>'relation','')), '');
    v_vf := coalesce((nullif(p->>'valid_from',''))::date, current_date);
    update grants.rates
      set amount = (p->>'amount')::numeric,
          decision_id = (nullif(p->>'decision_id',''))::uuid,
          notes = api.t(p,'notes')
    where type_code = p->>'type'
      and valid_from = v_vf
      and relation is not distinct from v_rel;
    if not found then
      insert into grants.rates(type_code, relation, amount, valid_from, decision_id, notes)
      values (p->>'type', v_rel, (p->>'amount')::numeric, v_vf, (nullif(p->>'decision_id',''))::uuid, api.t(p,'notes'));
    end if;
    return api.ok();
  elsif p_action = 'GRT_DEL_RATE' then
    if not core.can(uid,'grants.approve') then return api.err('غير مسموح.'); end if;
    delete from grants.rates where id = (p->>'id')::uuid;
    return api.ok();
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;
