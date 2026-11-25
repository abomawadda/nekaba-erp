-- المرحلة 31: بدل الجلسات من الحضور + طباعات المجلس الرسمية + متابعة تنفيذ القرارات وربطها المالي والمستندي

-- ── 1) إعداد بدل الجلسة وجدول تتبع صرف بدلات الاجتماعات ──
insert into core.settings(key, year, value, description)
values ('SESSION_ALLOWANCE_RATE', 0, '{"rate": 75}'::jsonb, 'قيمة بدل حضور جلسة المجلس للعضو الحاضر (جنيه)')
on conflict (key, year) do nothing;

create table governance.meeting_allowances (
  meeting_id      uuid primary key references governance.meetings(id) on delete cascade,
  settlement_id   uuid not null references treasury.settlements(id) on delete cascade,
  line_no         int,
  rate            numeric(14,2) not null check (rate > 0),
  attendees_count int not null check (attendees_count > 0),
  total_amount    numeric(14,2) not null check (total_amount > 0),
  created_at      timestamptz not null default now()
);
create index meeting_allowances_settlement_idx on governance.meeting_allowances(settlement_id);
alter table governance.meeting_allowances enable row level security;
create trigger meeting_allowances_audit after insert or update or delete on governance.meeting_allowances
  for each row execute function audit.track();

-- ربط الـ 31 اجتماعاً التاريخية التي صُرفت بدلاتها فعلاً ضمن التسويات المنقولة من MyNekaba
insert into governance.meeting_allowances(meeting_id, settlement_id, line_no, rate, attendees_count, total_amount)
select distinct on (m.id) m.id, sl.settlement_id, sl.line_no, 75,
  greatest(round(sl.amount / 75.0)::int, 1), sl.amount
from treasury.settlement_lines sl
join treasury.settlements s on s.id = sl.settlement_id and s.status = 'معتمدة'
join governance.meetings m on m.meeting_no = (regexp_match(sl.notes, 'اجتماع\s*(\d+)'))[1]::int
where sl.category = 'بدل جلسات' and sl.notes ~ 'اجتماع\s*\d+'
order by m.id, s.settle_date desc
on conflict (meeting_id) do nothing;

-- ── 2) حقول متابعة تنفيذ القرارات ──
alter table governance.decisions
  add column exec_status   text not null default 'لم يبدأ' check (exec_status in ('لم يبدأ','قيد التنفيذ','منفّذ','لا يتطلب تنفيذ')),
  add column assignee_id   uuid references core.persons(id),
  add column assignee_name text,
  add column due_date      date,
  add column executed_at   date;

create index decisions_assignee_idx on governance.decisions(assignee_id);
create index decisions_exec_status_idx on governance.decisions(exec_status, due_date);

-- تهيئة ذكية للقرارات القائمة: ما صُرف عليه شيك أو أُنشئ له نشاط = منفّذ؛ وقرارات اعتماد جدول الأعمال = لا يتطلب تنفيذ
update governance.decisions d
set exec_status = 'منفّذ',
    executed_at = coalesce(
      (select min(c.issue_date) from treasury.cheques c where c.decision_id = d.id and c.status <> 'ملغى'),
      (select min(a.start_date) from activities.activities a where a.decision_id = d.id))
where exists (select 1 from treasury.cheques c where c.decision_id = d.id and c.status <> 'ملغى')
   or exists (select 1 from activities.activities a where a.decision_id = d.id and a.status <> 'ملغى');

update governance.decisions d
set exec_status = 'لا يتطلب تنفيذ'
where d.exec_status = 'لم يبدأ' and d.category = 'إداري' and d.amount is null
  and (d.text ilike '%جدول الأعمال%' or trim(d.text) = 'الموافقة');

-- ── 3) دوال مساعدة للحوكمة (فئة البدل · الموقّعون الرسميون · المنصرف الفعلي على القرار) ──
create or replace function governance.allowance_rate(p_date date default current_date) returns numeric language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select coalesce(
    (core.setting('SESSION_ALLOWANCE_RATE', extract(year from p_date)::int)->>'rate')::numeric,
    (core.setting('SESSION_ALLOWANCE_RATE')->>'rate')::numeric,
    75)
$$;

-- التوقيعات المعتمدة: أمين الصندوق · الأمين العام · رئيس اللجنة النقابية (بأسمائهم الفعلية في تاريخ المستند)
create or replace function governance.signatories_at(p_date date default current_date) returns jsonb language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  with seats as (
    select b.role, p.full_name, 1 as prio
    from governance.board_at(p_date) b join core.persons p on p.id = b.person_id
    union all
    select bs.role, p.full_name, 2 as prio
    from governance.board_seats bs join core.persons p on p.id = bs.person_id
    where bs.to_date is null
  )
  select jsonb_build_object(
    'treasurer', (select full_name from seats where role = 'أمين الصندوق' order by prio limit 1),
    'secretary', (select full_name from seats where role = 'الأمين العام' order by prio limit 1),
    'chair',     (select full_name from seats where role = 'رئيس المجلس' order by prio limit 1))
$$;

-- صافي المنصرف الفعلي المربوط بقرار مجلس (شيكات غير ملغاة ناقص أي مرتجع تسوية معتمدة + قيود مباشرة على القرار)
create or replace function governance.decision_spent(p_dec uuid) returns numeric language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select round(
    coalesce((select sum(c.amount) from treasury.cheques c where c.decision_id = p_dec and c.status <> 'ملغى'), 0)
    - coalesce((select sum(s.returned) from treasury.settlements s
                where s.status = 'معتمدة' and s.returned > 0
                  and exists (select 1 from treasury.settlement_cheques sc join treasury.cheques c on c.id = sc.cheque_id
                              where sc.settlement_id = s.id and c.decision_id = p_dec)), 0)
    + coalesce((select sum(l.debit - l.credit) from finance.lines l
                join finance.entries e on e.id = l.entry_id
                join finance.accounts ac on ac.code = l.account
                where e.decision_id = p_dec and e.status = 'مرحّل' and e.source not in ('شيك','تسوية','عكس') and ac.type = 'مصروفات'), 0), 2)
$$;

-- ── 4) ربط تسوية العهدة والاسترجاع ببدلات الجلسات ──
create or replace function treasury.settle(p jsonb, p_actor text) returns uuid language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare c treasury.cheques; g treasury.cheques; fc treasury.cheques; v_from treasury.settlements;
        v_id uuid; v_cur_draft uuid; v_entry uuid; l jsonb; i int := 0; v_spent numeric := 0; v_x text; v_m uuid;
        v_sub numeric := coalesce((nullif(p->>'subscriptions',''))::numeric,0);
        v_ret numeric := coalesce((nullif(p->>'returned',''))::numeric,0);
        v_prev numeric := 0; v_adv numeric; v_mode text := coalesce(nullif(p->>'return_mode',''),'لا يوجد'); v_carry numeric;
        lines jsonb := '[]'; v_acc text; v_ids uuid[]; v_nos text; v_pid uuid; v_dec uuid := (nullif(p->>'decision_id',''))::uuid;
        v_legacy boolean := coalesce((p->>'legacy')::boolean,false); v_draft boolean := coalesce((p->>'draft')::boolean,false);
        v_date date := coalesce((nullif(p->>'date',''))::date, case when coalesce((p->>'draft')::boolean,false) then current_date end);
        v_m_present int; v_m_no int; v_m_cnt int;
begin
  select * into c from treasury.cheques where id = coalesce((nullif(p->>'cheque_id',''))::uuid,
    (select id from treasury.cheques where legacy_ref = p->>'cheque_legacy')) for update;
  if c.id is null then raise exception 'الشيك غير موجود' using errcode = 'check_violation'; end if;
  if p->>'legacy_ref' is not null then
    select id into v_id from treasury.settlements where legacy_ref = p->>'legacy_ref';
    if v_id is not null then return v_id; end if;
  end if;
  if v_date is null then raise exception 'تاريخ التسوية مطلوب' using errcode = 'check_violation'; end if;
  if not c.requires_settlement then raise exception 'هذا الشيك ليس عهدة' using errcode = 'check_violation'; end if;
  if c.status = 'ملغى' then raise exception 'الشيك ملغى' using errcode = 'check_violation'; end if;
  if treasury.cheque_settlement(c.id) is not null then raise exception 'الشيك مسوّى من قبل' using errcode = 'check_violation'; end if;

  v_cur_draft := treasury.cheque_draft(c.id);
  if v_cur_draft is not null and (select cheque_id from treasury.settlements where id = v_cur_draft) <> c.id then
    p := p || jsonb_build_object('cheque_ids', coalesce(p->'cheque_ids','[]'::jsonb) || to_jsonb(c.id::text));
    select * into c from treasury.cheques where id = (select cheque_id from treasury.settlements where id = v_cur_draft) for update;
  end if;

  v_ids := array[c.id];
  for v_x in select distinct x from jsonb_array_elements_text(coalesce(p->'cheque_ids','[]')) x where x <> '' and x <> c.id::text loop
    select * into g from treasury.cheques where id = v_x::uuid for update;
    if g.id is null then raise exception 'شيك غير موجود في المجموعة' using errcode = 'check_violation'; end if;
    if not g.requires_settlement then raise exception 'الشيك % ليس عهدة', coalesce(g.cheque_no,'بدون رقم') using errcode = 'check_violation'; end if;
    if g.status <> 'صادر' then raise exception 'الشيك % حالته «%» — لا يدخل المجموعة', coalesce(g.cheque_no,'بدون رقم'), g.status using errcode = 'check_violation'; end if;
    if treasury.cheque_settlement(g.id) is not null then raise exception 'الشيك % مسوّى من قبل', coalesce(g.cheque_no,'بدون رقم') using errcode = 'check_violation'; end if;
    if treasury.cheque_draft(g.id) is not null and treasury.cheque_draft(g.id) is distinct from v_cur_draft then
      raise exception 'الشيك % محفوظ داخل مسودة تسوية تانية', coalesce(g.cheque_no,'بدون رقم') using errcode = 'check_violation'; end if;
    if not treasury.same_custodian(g.payee_person_id, g.payee_name, c.payee_person_id, c.payee_name) then
      raise exception 'شيكات المجموعة لازم تكون لنفس صاحب العهدة (الشيك % باسم %)', coalesce(g.cheque_no,'بدون رقم'), g.payee_name using errcode = 'check_violation'; end if;
    v_ids := v_ids || g.id;
  end loop;
  select sum(amount), string_agg(coalesce(cheque_no,'بدون رقم'), ' + ' order by issue_date, cheque_no) into v_adv, v_nos
    from treasury.cheques where id = any(v_ids);
  v_pid := coalesce(c.payee_person_id, (select payee_person_id from treasury.cheques where id = any(v_ids) and payee_person_id is not null limit 1));
  v_dec := coalesce(v_dec, c.decision_id, (select decision_id from treasury.cheques where id = any(v_ids) and decision_id is not null limit 1));
  if v_legacy then
    v_adv := coalesce((nullif(p->>'advance',''))::numeric, v_adv);
    v_prev := coalesce((nullif(p->>'prev_balance',''))::numeric, 0);
  end if;

  if nullif(p->>'carried_from','') is not null then
    select * into v_from from treasury.settlements where id = (p->>'carried_from')::uuid for update;
    if v_from.id is null or v_from.status <> 'معتمدة' then raise exception 'التسوية المرحّل منها غير موجودة أو غير معتمدة' using errcode = 'check_violation'; end if;
    select * into fc from treasury.cheques where id = v_from.cheque_id;
    if v_from.return_mode <> 'ترحيل' or fc.status <> 'مرحّل الرصيد' then raise exception 'رصيد التسوية دي مش مرحّل (أو اترحّل قبل كده)' using errcode = 'check_violation'; end if;
    if exists (select 1 from treasury.settlements where carried_from = v_from.id and status = 'معتمدة') then
      raise exception 'الرصيد ده اترحّل لتسوية تانية قبل كده' using errcode = 'check_violation'; end if;
    if not treasury.same_custodian(fc.payee_person_id, fc.payee_name, v_pid, c.payee_name) then
      raise exception 'الرصيد المرحّل لازم يكون لنفس صاحب العهدة' using errcode = 'check_violation'; end if;
    v_prev := treasury.settlement_carry(v_from);
    if v_prev <= 0.005 then raise exception 'التسوية دي مفيهاش رصيد مرحّل' using errcode = 'check_violation'; end if;
  end if;

  for l in select * from jsonb_array_elements(coalesce(p->'lines','[]')) loop
    if coalesce((nullif(l->>'amount',''))::numeric,0) <= 0 then continue; end if;
    v_acc := coalesce(nullif(l->>'account',''), (select account from finance.category_map where category = l->>'category'), '5501');
    v_spent := v_spent + (l->>'amount')::numeric;
    lines := lines || jsonb_build_object('account', v_acc, 'debit', l->>'amount', 'cost_center', c.cost_center,
      'memo', coalesce(l->>'category','') || coalesce(' — ' || nullif(l->>'notes',''), ''));
  end loop;

  if v_draft then
    if v_mode not in ('لا يوجد','رد للخزينة','توريد للبنك','ترحيل') then v_mode := 'لا يوجد'; end if;
    if v_cur_draft is null then
      insert into treasury.settlements(cheque_id, settle_date, advance, prev_balance, subscriptions, spent, returned, return_mode, notes,
        status, draft, carried_from, decision_id, created_by)
      values (c.id, v_date, v_adv, v_prev, v_sub, v_spent, v_ret, v_mode, p->>'notes', 'مسودة',
        (p - 'draft') || jsonb_build_object('cheque_ids', to_jsonb(array_remove(v_ids, c.id))), v_from.id, v_dec, p_actor)
      returning id into v_id;
    else
      v_id := v_cur_draft;
      update treasury.settlements set settle_date = v_date, advance = v_adv, prev_balance = v_prev, subscriptions = v_sub, spent = v_spent,
        returned = v_ret, return_mode = v_mode, notes = p->>'notes',
        draft = (p - 'draft') || jsonb_build_object('cheque_ids', to_jsonb(array_remove(v_ids, c.id))),
        carried_from = v_from.id, decision_id = v_dec, created_by = p_actor
      where id = v_id;
      delete from treasury.settlement_cheques where settlement_id = v_id;
    end if;
    insert into treasury.settlement_cheques(settlement_id, cheque_id, amount)
    select v_id, id, amount from treasury.cheques where id = any(v_ids);
    return v_id;
  end if;

  v_carry := v_adv + v_prev + v_sub - v_spent - v_ret;
  if v_ret > 0 and v_mode not in ('رد للخزينة','توريد للبنك') then raise exception 'حدد طريقة رد المتبقي' using errcode = 'check_violation'; end if;
  if v_carry > 0.005 and v_mode <> 'ترحيل' and not v_legacy then
    raise exception 'متبقي % بلا تصرف — رد للخزينة أو توريد للبنك أو ترحيل', round(v_carry,2) using errcode = 'check_violation'; end if;
  if v_carry < -0.005 and p->>'decision_id' is null and not v_legacy then
    raise exception 'المصروف أكبر من المتاح بـ % — يلزم قرار مجلس بتغطية العجز', round(-v_carry,2) using errcode = 'check_violation'; end if;

  delete from treasury.settlements where id in (select settlement_id from treasury.settlement_cheques where cheque_id = any(v_ids)) and status = 'مسودة';
  insert into treasury.settlements(cheque_id, settle_date, advance, prev_balance, subscriptions, spent, returned, return_mode, notes, legacy_ref,
    status, carried_from, decision_id, created_by)
  values (c.id, v_date, v_adv, v_prev, v_sub, v_spent, v_ret, v_mode, p->>'notes', p->>'legacy_ref', 'معتمدة', v_from.id, v_dec, p_actor)
  returning id into v_id;
  insert into treasury.settlement_cheques(settlement_id, cheque_id, amount)
  select v_id, id, amount from treasury.cheques where id = any(v_ids);

  for l in select * from jsonb_array_elements(coalesce(p->'lines','[]')) loop
    if coalesce((nullif(l->>'amount',''))::numeric,0) <= 0 then continue; end if;
    i := i + 1;
    insert into treasury.settlement_lines(settlement_id, line_no, category, account, amount, doc_date, notes, beneficiaries)
    values (v_id, i, coalesce(nullif(l->>'category',''),'أخرى'),
      coalesce(nullif(l->>'account',''), (select account from finance.category_map where category = l->>'category'), '5501'),
      (l->>'amount')::numeric, (nullif(l->>'doc_date',''))::date, l->>'notes', l->'beneficiaries');
    -- ربط الاجتماعات التي صُرفت بدلاتها في هذا البند (ومنع صرف بدل اجتماع مرتين)
    if jsonb_typeof(l->'meeting_ids') = 'array' and jsonb_array_length(l->'meeting_ids') > 0 then
      v_m_cnt := jsonb_array_length(l->'meeting_ids');
      for v_x in select distinct x from jsonb_array_elements_text(l->'meeting_ids') x where x <> '' loop
        v_m := v_x::uuid;
        select meeting_no, present into v_m_no, v_m_present from governance.meeting_summary where id = v_m;
        if v_m_no is null then raise exception 'اجتماع غير موجود في بند البدلات' using errcode = 'check_violation'; end if;
        if v_m_present <= 0 then raise exception 'الاجتماع رقم % ليس به حضور مسجّل', v_m_no using errcode = 'check_violation'; end if;
        if exists (select 1 from governance.meeting_allowances where meeting_id = v_m) then
          raise exception 'بدل الاجتماع رقم % صُرف من قبل', v_m_no using errcode = 'check_violation'; end if;
        insert into governance.meeting_allowances(meeting_id, settlement_id, line_no, rate, attendees_count, total_amount)
        values (v_m, v_id, i,
          coalesce((nullif(l->>'rate',''))::numeric, governance.allowance_rate(v_date)),
          v_m_present,
          case when v_m_cnt = 1 then (l->>'amount')::numeric
               else v_m_present * coalesce((nullif(l->>'rate',''))::numeric, governance.allowance_rate(v_date)) end);
      end loop;
    end if;
  end loop;

  if v_spent > 0 then lines := lines || jsonb_build_object('account','1103','credit', v_spent, 'cost_center', c.cost_center,
       'person_id', v_pid, 'party', c.payee_name); end if;
  if v_sub > 0 then lines := lines || jsonb_build_array(
       jsonb_build_object('account','1103','debit', v_sub, 'cost_center', c.cost_center, 'person_id', v_pid, 'party', c.payee_name,
         'memo','اشتراكات المشاركين'),
       jsonb_build_object('account','4201','credit', v_sub, 'cost_center', c.cost_center)); end if;
  if v_ret > 0 then lines := lines || jsonb_build_array(
       jsonb_build_object('account', case v_mode when 'رد للخزينة' then '1101' else '1102' end, 'debit', v_ret, 'cost_center', c.cost_center,
         'memo', v_mode),
       jsonb_build_object('account','1103','credit', v_ret, 'cost_center', c.cost_center, 'person_id', v_pid, 'party', c.payee_name)); end if;
  if jsonb_array_length(lines) >= 2 then
    v_entry := finance.post(jsonb_build_object('date', v_date, 'source', 'تسوية', 'source_ref', v_id, 'decision_id', v_dec,
      'legacy_ref', case when p->>'legacy_ref' is not null then 'STL:' || (p->>'legacy_ref') end,
      'description', 'تسوية عهدة ' || case when cardinality(v_ids) > 1 then 'شيكات ' else 'شيك ' end || v_nos || ' — ' || c.payee_name
        || ' (مصروف ' || v_spent
        || case when v_prev > 0.005 then '، رصيد مرحّل سابق ' || round(v_prev,2) else '' end
        || case when v_ret > 0 then '، ' || v_mode || ' ' || v_ret else '' end
        || case when v_carry > 0.005 then '، مرحّل ' || round(v_carry,2) else '' end || ')',
      'lines', lines), p_actor);
    update treasury.settlements set entry_id = v_entry where id = v_id;
  end if;
  update treasury.cheques set status = case when v_carry > 0.005 then 'مرحّل الرصيد' else 'مسوّى' end where id = any(v_ids);
  if v_from.id is not null then
    update treasury.cheques set status = 'مسوّى'
    where id in (select cheque_id from treasury.settlement_cheques where settlement_id = v_from.id) and status = 'مرحّل الرصيد';
  end if;
  -- لو التسوية مربوطة بقرار لم يُعلَّم منفّذاً بعد، حدّث حالته تلقائياً إلى قيد التنفيذ/منفّذ
  if v_dec is not null then
    update governance.decisions set exec_status = 'منفّذ', executed_at = coalesce(executed_at, v_date)
    where id = v_dec and exec_status in ('لم يبدأ','قيد التنفيذ');
  end if;
  return v_id;
end $$;

create or replace function treasury.settle_reverse(p_id uuid, p_date date, p_reason text, p_actor text) returns uuid language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare s treasury.settlements; v_rev uuid;
begin
  select * into s from treasury.settlements where id = p_id for update;
  if s.id is null or s.status <> 'معتمدة' then raise exception 'التسوية غير موجودة أو مش معتمدة' using errcode = 'check_violation'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'سبب الاسترجاع مطلوب' using errcode = 'check_violation'; end if;
  if exists (select 1 from treasury.settlements where carried_from = s.id and status = 'معتمدة') then
    raise exception 'رصيد التسوية دي اترحّل لتسوية تانية — استرجع التسوية التانية الأول' using errcode = 'check_violation'; end if;
  if s.entry_id is not null then
    v_rev := finance.reverse(s.entry_id, coalesce(p_date, current_date), 'استرجاع تسوية: ' || p_reason, p_actor);
  end if;
  update benefits.ledger set status = 'ملغاة', notes = concat_ws(' — ', notes, 'استرجاع التسوية: ' || p_reason)
  where source_module = 'الخزينة' and source_ref like 'STL:' || s.id || ':%' and status = 'فعّالة';
  delete from governance.meeting_allowances where settlement_id = s.id;
  update treasury.cheques set status = 'صادر'
  where id in (select cheque_id from treasury.settlement_cheques where settlement_id = s.id) and status <> 'ملغى';
  if s.carried_from is not null then
    update treasury.cheques set status = 'مرحّل الرصيد'
    where id in (select cheque_id from treasury.settlement_cheques where settlement_id = s.carried_from) and status = 'مسوّى';
  end if;
  update treasury.settlements set status = 'مسترجعة', reverse_entry_id = v_rev, reverse_reason = p_reason,
    reversed_at = now(), reversed_by = p_actor where id = s.id;
  return v_rev;
end $$;

-- ── 5) تفاصيل الاجتماع (الحضور + البدلات + التوقيعات + موقف كل قرار) ──
create or replace function api.meeting_json(m_id uuid) returns jsonb language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select to_jsonb(m) - 'legacy_ref' || jsonb_build_object(
    'signatories', governance.signatories_at(m.meeting_date),
    'allowance', (
      with ma as (
        select ma.*, s.settle_date, s.cheque_id, c.cheque_no
        from governance.meeting_allowances ma
        join treasury.settlements s on s.id = ma.settlement_id
        join treasury.cheques c on c.id = s.cheque_id
        where ma.meeting_id = m.id
      )
      select jsonb_build_object(
        'rate', coalesce((select rate from ma), governance.allowance_rate(m.meeting_date)),
        'present', m.present,
        'total', coalesce((select total_amount from ma), m.present * governance.allowance_rate(m.meeting_date)),
        'paid', exists (select 1 from ma),
        'settlement_id', (select settlement_id from ma),
        'settle_date', (select settle_date from ma),
        'cheque_id', (select cheque_id from ma),
        'cheque_no', (select cheque_no from ma))
    ),
    'attendance', coalesce((select jsonb_agg(jsonb_build_object('person_id', a.person_id, 'full_name', p.full_name,
        'job_id', p.job_id, 'status', a.status, 'role', coalesce(governance.board_role_at(a.person_id, m.meeting_date), 'عضو مجلس إدارة'), 'notes', a.notes)
      order by case governance.board_role_at(a.person_id, m.meeting_date)
               when 'رئيس المجلس' then 1 when 'نائب الرئيس' then 2 when 'الأمين العام' then 3 when 'أمين الصندوق' then 4 else 5 end, p.full_name)
      from governance.attendance a join core.persons p on p.id = a.person_id where a.meeting_id = m.id), '[]'),
    'decisions', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object(
        'assignee_display', coalesce(ap.full_name, d.assignee_name),
        'spent', governance.decision_spent(d.id),
        'cheques_count', (select count(*) from treasury.cheques c where c.decision_id = d.id and c.status <> 'ملغى'))
      order by d.seq)
      from governance.decisions d left join core.persons ap on ap.id = d.assignee_id where d.meeting_id = m.id), '[]'),
    'board', coalesce((select jsonb_agg(jsonb_build_object('person_id', b.person_id, 'job_id', p.job_id, 'role', b.role, 'full_name', p.full_name)
      order by case b.role when 'رئيس المجلس' then 1 when 'نائب الرئيس' then 2 when 'الأمين العام' then 3 when 'أمين الصندوق' then 4 else 5 end, p.full_name)
      from governance.board_at(m.meeting_date) b join core.persons p on p.id = b.person_id),
      -- احتياطي لو تاريخ الجلسة يسبق بداية المقعد بيوم (مثل الجلسة الإجرائية الأولى)
      (select jsonb_agg(jsonb_build_object('person_id', bs.person_id, 'job_id', p.job_id, 'role', bs.role, 'full_name', p.full_name))
       from governance.board_seats bs join core.persons p on p.id = bs.person_id where bs.term_id = m.term_id and bs.to_date is null), '[]'))
  from governance.meeting_summary m where m.id = m_id
$$;

-- ── 6) ملف القرار الشامل (GOV_GET_DECISION) ──
create or replace function api.decision_json(d_id uuid) returns jsonb language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select to_jsonb(d) || jsonb_build_object(
    'meeting_no', m.meeting_no, 'meeting_title', m.title, 'meeting_date', m.meeting_date, 'meeting_kind', m.kind, 'venue', m.venue,
    'term_title', t.title,
    'signatories', governance.signatories_at(m.meeting_date),
    'assignee_job', ap.job_id, 'assignee_display', coalesce(ap.full_name, d.assignee_name),
    'spent', governance.decision_spent(d.id),
    'cheques', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'cheque_no', c.cheque_no, 'issue_date', c.issue_date,
        'payee_name', c.payee_name, 'purpose', c.purpose, 'amount', c.amount, 'status', c.status, 'notes', c.notes) order by c.issue_date desc)
      from treasury.cheques c where c.decision_id = d.id), '[]'),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'entry_no', e.entry_no, 'entry_date', e.entry_date,
        'source', e.source, 'description', e.description, 'status', e.status,
        'total', (select sum(debit) from finance.lines where entry_id = e.id)) order by e.entry_date desc)
      from finance.entries e where e.decision_id = d.id), '[]'),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'title', a.title, 'kind', a.kind,
        'start_date', a.start_date, 'status', a.status) order by a.start_date desc)
      from activities.activities a where a.decision_id = d.id), '[]'))
  from governance.decisions d
  join governance.meetings m on m.id = d.meeting_id
  join governance.terms t on t.id = m.term_id
  left join core.persons ap on ap.id = d.assignee_id
  where d.id = d_id
$$;

-- ── 7) واجهة الحوكمة الكاملة ──
create or replace function api.handle_governance(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare v_id uuid; v_term uuid; r jsonb; i int; v_old governance.board_seats; v_no int; v_pid uuid; v_rate numeric;
begin
  if not core.can(uid,'governance.view') and not core.can(uid,'governance.manage') then return api.err('غير مسموح.'); end if;
  v_term := coalesce((api.t(p,'termId'))::uuid, (select id from governance.terms where status = 'جارية' limit 1));

  if p_action = 'GOV_OVERVIEW' then
    return api.ok(jsonb_build_object('term', api.term_json(v_term),
      'allowanceRate', governance.allowance_rate(),
      'signatories', governance.signatories_at(),
      'terms', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status) order by start_date desc) from governance.terms), '[]'),
      'canManage', core.can(uid,'governance.manage')));

  elsif p_action = 'GOV_LIST_MEETINGS' then
    return api.ok(jsonb_build_object(
      'allowanceRate', governance.allowance_rate(),
      'canManage', core.can(uid,'governance.manage'),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'meeting_no', m.meeting_no,
        'title', m.title, 'kind', m.kind, 'meeting_date', m.meeting_date, 'venue', m.venue, 'status', m.status,
        'present', m.present, 'seats', m.seats, 'decisions_count', m.decisions_count,
        'allowance_paid', (ma.meeting_id is not null),
        'allowance_amount', coalesce(ma.total_amount, m.present * governance.allowance_rate(m.meeting_date)))
        order by m.meeting_date desc, m.meeting_no desc)
        from governance.meeting_summary m left join governance.meeting_allowances ma on ma.meeting_id = m.id
        where m.term_id = v_term), '[]')));

  elsif p_action = 'GOV_GET_MEETING' then
    r := api.meeting_json((p->>'id')::uuid);
    if r is null then return api.err('غير موجود.'); end if;
    return api.ok(jsonb_build_object('meeting', r, 'canManage', core.can(uid,'governance.manage')));

  elsif p_action = 'GOV_GET_DECISION' then
    r := api.decision_json((p->>'id')::uuid);
    if r is null then return api.err('القرار غير موجود.'); end if;
    return api.ok(jsonb_build_object('decision', r, 'canManage', core.can(uid,'governance.manage')));

  elsif p_action = 'GOV_LIST_DECISIONS' then
    return api.ok(jsonb_build_object(
      'canManage', core.can(uid,'governance.manage'),
      'summary', (
        with base as (
          select d.*, governance.decision_spent(d.id) spent
          from governance.decisions d join governance.meetings m on m.id = d.meeting_id
          where m.term_id = v_term and d.status <> 'ملغى'
        )
        select jsonb_build_object(
          'total', count(*),
          'executed', count(*) filter (where exec_status = 'منفّذ'),
          'in_progress', count(*) filter (where exec_status = 'قيد التنفيذ'),
          'not_started', count(*) filter (where exec_status = 'لم يبدأ'),
          'no_exec', count(*) filter (where exec_status = 'لا يتطلب تنفيذ'),
          'overdue', count(*) filter (where due_date < current_date and exec_status in ('لم يبدأ','قيد التنفيذ')),
          'exceeded', count(*) filter (where amount is not null and amount > 0 and spent > amount + 0.005),
          'total_ceiling', coalesce(sum(amount) filter (where amount > 0), 0),
          'total_spent', coalesce(sum(spent), 0))
        from base
      ),
      'items', coalesce((select jsonb_agg(x order by x.meeting_date desc, x.seq) from (
        select d.id, d.decision_no, d.seq, d.text, d.category, d.amount, d.status, d.exec_status,
          d.due_date, d.executed_at, d.follow_up, coalesce(ap.full_name, d.assignee_name) assignee,
          d.meeting_id, m.meeting_no, m.title meeting_title, m.meeting_date,
          d.votes_for, d.votes_against, d.votes_abstain,
          governance.decision_spent(d.id) spent,
          (select count(*) from treasury.cheques c where c.decision_id = d.id and c.status <> 'ملغى') cheques_count
        from governance.decisions d
        join governance.meetings m on m.id = d.meeting_id
        left join core.persons ap on ap.id = d.assignee_id
        where m.term_id = v_term
          and (api.t(p,'category') is null or d.category = api.t(p,'category'))
          and (api.t(p,'exec_status') is null or d.exec_status = api.t(p,'exec_status'))
          and (api.t(p,'alert') is null
               or (api.t(p,'alert') = 'overdue' and d.due_date < current_date and d.exec_status in ('لم يبدأ','قيد التنفيذ'))
               or (api.t(p,'alert') = 'exceeded' and d.amount is not null and d.amount > 0 and governance.decision_spent(d.id) > d.amount + 0.005))
          and (api.t(p,'q') is null or d.text ilike '%' || api.t(p,'q') || '%' or d.decision_no = api.t(p,'q')
               or coalesce(ap.full_name, d.assignee_name, '') ilike '%' || api.t(p,'q') || '%')
      ) x), '[]')));
  end if;

  -- عمليات الإدارة
  if not core.can(uid,'governance.manage') then return api.err('غير مسموح.'); end if;

  if p_action = 'GOV_SAVE_TERM' then
    r := p->'term';
    if (r->>'id') is null then
      insert into governance.terms(term_no, title, election_date, start_date, end_date, approval_ref, approval_date, target_seats, opening_balance, status, notes)
      values ((api.t(r,'term_no'))::int, api.t(r,'title'), (api.t(r,'election_date'))::date, (api.t(r,'start_date'))::date,
        (api.t(r,'end_date'))::date, api.t(r,'approval_ref'), (api.t(r,'approval_date'))::date, (api.t(r,'target_seats'))::int,
        (api.t(r,'opening_balance'))::numeric, coalesce(api.t(r,'status'),'مخططة'), api.t(r,'notes')) returning id into v_id;
    else
      update governance.terms set term_no = (api.t(r,'term_no'))::int, title = api.t(r,'title'), election_date = (api.t(r,'election_date'))::date,
        start_date = (api.t(r,'start_date'))::date, end_date = (api.t(r,'end_date'))::date, approval_ref = api.t(r,'approval_ref'),
        approval_date = (api.t(r,'approval_date'))::date, target_seats = (api.t(r,'target_seats'))::int,
        opening_balance = (api.t(r,'opening_balance'))::numeric, status = coalesce(api.t(r,'status'), status), notes = api.t(r,'notes')
      where id = (r->>'id')::uuid returning id into v_id;
    end if;
    return api.ok(jsonb_build_object('term', api.term_json(v_id)));

  elsif p_action = 'GOV_ADD_SEAT' then
    v_id := coalesce((api.t(p,'personId'))::uuid, api.pid_by_job(api.t(p,'jobId')));
    if v_id is null then return api.err('العضو غير موجود.'); end if;
    if not core.is_union_beneficiary(v_id, coalesce((api.t(p,'fromDate'))::date, current_date)) then
      return api.err('عضوية المجلس لأعضاء النقابة العامة النشطين فقط.'); end if;
    insert into governance.board_seats(term_id, person_id, role, from_date, join_method, replaces_seat_id, decision_ref, election_votes)
    values (v_term, v_id, api.t(p,'role'), (api.t(p,'fromDate'))::date, coalesce(api.t(p,'joinMethod'),'انتخاب'),
            (api.t(p,'replacesSeatId'))::uuid, api.t(p,'decisionRef'), (api.t(p,'votes'))::int);
    perform governance.sync_board_roles();
    return api.ok(jsonb_build_object('term', api.term_json(v_term)));

  elsif p_action = 'GOV_END_SEAT' then
    if api.t(p,'reason') is null or api.t(p,'toDate') is null then return api.err('تاريخ الانتهاء والسبب مطلوبان.'); end if;
    update governance.board_seats set to_date = (api.t(p,'toDate'))::date, end_reason = api.t(p,'reason'),
      decision_ref = coalesce(api.t(p,'decisionRef'), decision_ref) where id = (p->>'seatId')::uuid and to_date is null
    returning * into v_old;
    if v_old.id is null then return api.err('المقعد غير موجود أو منتهي.'); end if;
    if api.t(p,'newRole') is not null then
      insert into governance.board_seats(term_id, person_id, role, from_date, join_method, decision_ref)
      values (v_old.term_id, v_old.person_id, api.t(p,'newRole'), v_old.to_date + 1, 'توزيع مناصب', api.t(p,'decisionRef'));
    end if;
    perform governance.sync_board_roles();
    return api.ok(jsonb_build_object('term', api.term_json(v_old.term_id)));

  elsif p_action = 'GOV_SAVE_MEETING' then
    r := p->'meeting';
    if api.t(r,'title') is null or api.t(r,'meeting_date') is null then return api.err('العنوان والتاريخ مطلوبان.'); end if;
    if (r->>'id') is null then
      v_no := coalesce((api.t(r,'meeting_no'))::int, (select coalesce(max(meeting_no),0) + 1 from governance.meetings where term_id = v_term));
      insert into governance.meetings(term_id, meeting_no, title, kind, meeting_date, meeting_time, venue, agenda, status, minutes_ref, notes)
      values (v_term, v_no, api.t(r,'title'), coalesce(api.t(r,'kind'),'عادي'), (api.t(r,'meeting_date'))::date, api.t(r,'meeting_time'),
        api.t(r,'venue'), coalesce(r->'agenda','[]'), coalesce(api.t(r,'status'),'منعقد'), api.t(r,'minutes_ref'), api.t(r,'notes'))
      returning id, meeting_no into v_id, v_no;
    else
      update governance.meetings set title = api.t(r,'title'), kind = coalesce(api.t(r,'kind'), kind), meeting_date = (api.t(r,'meeting_date'))::date,
        meeting_time = api.t(r,'meeting_time'), venue = api.t(r,'venue'), agenda = coalesce(r->'agenda', agenda),
        status = coalesce(api.t(r,'status'), status), minutes_ref = api.t(r,'minutes_ref'), notes = api.t(r,'notes')
      where id = (r->>'id')::uuid returning id, meeting_no into v_id, v_no;
      if v_id is null then return api.err('الاجتماع غير موجود.'); end if;
    end if;
    if r ? 'attendance' then
      delete from governance.attendance where meeting_id = v_id;
      insert into governance.attendance(meeting_id, person_id, status, notes)
      select v_id, (a->>'person_id')::uuid, a->>'status', api.t(a,'notes') from jsonb_array_elements(r->'attendance') a;
    end if;
    if r ? 'decisions' then
      i := 0;
      for r in select * from jsonb_array_elements(p->'meeting'->'decisions') loop
        i := i + 1;
        insert into governance.decisions(meeting_id, decision_no, seq, text, category, amount, votes_for, votes_against, votes_abstain,
          status, exec_status, assignee_name, due_date, follow_up)
        values (v_id, v_no || '/' || i, i, api.t(r,'text'), coalesce(api.t(r,'category'),'إداري'), (api.t(r,'amount'))::numeric,
          (api.t(r,'votes_for'))::int, (api.t(r,'votes_against'))::int, (api.t(r,'votes_abstain'))::int,
          coalesce(api.t(r,'status'),'معتمد'), coalesce(api.t(r,'exec_status'),'لم يبدأ'),
          api.t(r,'assignee_name'), (api.t(r,'due_date'))::date, api.t(r,'follow_up'))
        on conflict (meeting_id, seq) do update set text = excluded.text, category = excluded.category, amount = excluded.amount,
          votes_for = excluded.votes_for, votes_against = excluded.votes_against, votes_abstain = excluded.votes_abstain,
          status = excluded.status,
          exec_status = coalesce(api.t(r,'exec_status'), governance.decisions.exec_status),
          assignee_name = coalesce(api.t(r,'assignee_name'), governance.decisions.assignee_name),
          due_date = coalesce((api.t(r,'due_date'))::date, governance.decisions.due_date),
          follow_up = coalesce(api.t(r,'follow_up'), governance.decisions.follow_up);
      end loop;
      if exists (select 1 from governance.decisions where meeting_id = v_id and seq > i and status <> 'ملغى') then
        return api.err('لا يُحذف قرار مسجّل — غيّر حالته إلى «ملغى».');
      end if;
    end if;
    return api.ok(jsonb_build_object('meeting', api.meeting_json(v_id)));

  elsif p_action = 'GOV_SAVE_ATTENDANCE' then
    v_id := (p->>'meetingId')::uuid;
    if not exists (select 1 from governance.meetings where id = v_id) then return api.err('الاجتماع غير موجود.'); end if;
    delete from governance.attendance where meeting_id = v_id;
    insert into governance.attendance(meeting_id, person_id, status, notes)
    select v_id, (a->>'person_id')::uuid, coalesce(api.t(a,'status'),'حاضر'), api.t(a,'notes')
    from jsonb_array_elements(coalesce(p->'attendance','[]')) a;
    return api.ok(jsonb_build_object('meeting', api.meeting_json(v_id)));

  elsif p_action = 'GOV_SAVE_DECISION' then
    v_id := (p->>'id')::uuid;
    v_pid := coalesce((api.t(p,'assignee_id'))::uuid, api.pid_by_job(api.t(p,'assignee_job')));
    update governance.decisions set
      category      = coalesce(api.t(p,'category'), category),
      amount        = case when p ? 'amount' then (api.t(p,'amount'))::numeric else amount end,
      status        = coalesce(api.t(p,'status'), status),
      exec_status   = coalesce(api.t(p,'exec_status'), exec_status),
      assignee_id   = case when p ? 'assignee_job' or p ? 'assignee_id' then v_pid else assignee_id end,
      assignee_name = case when p ? 'assignee_name' then api.t(p,'assignee_name') else assignee_name end,
      due_date      = case when p ? 'due_date' then (api.t(p,'due_date'))::date else due_date end,
      executed_at   = case when api.t(p,'exec_status') = 'منفّذ' and (api.t(p,'executed_at'))::date is null
                           then coalesce(executed_at, current_date)
                           when p ? 'executed_at' then (api.t(p,'executed_at'))::date else executed_at end,
      follow_up     = case when p ? 'follow_up' then api.t(p,'follow_up') else follow_up end
    where id = v_id;
    if not found then return api.err('القرار غير موجود.'); end if;
    return api.ok(jsonb_build_object('decision', api.decision_json(v_id)));

  elsif p_action = 'GOV_SET_ALLOWANCE_RATE' then
    v_rate := (api.t(p,'rate'))::numeric;
    if v_rate is null or v_rate <= 0 then return api.err('قيمة البدل لازم تكون أكبر من صفر.'); end if;
    insert into core.settings(key, year, value, description, updated_by, updated_at)
    values ('SESSION_ALLOWANCE_RATE', 0, jsonb_build_object('rate', v_rate), 'قيمة بدل حضور جلسة المجلس للعضو الحاضر (جنيه)', uid::text, now())
    on conflict (key, year) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
    return api.ok(jsonb_build_object('rate', v_rate));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- ── 8) إضافة الاجتماعات غير المصروف بدلها إلى FIN_SETTLE_HELP + تنبيه القرارات المتأخرة في staff_tasks ──
do $do$
declare d text;
  a_carry text := $a$'carry', coalesce($a$;
begin
  d := pg_get_functiondef('api.handle_finance(text,jsonb,uuid)'::regprocedure);
  if position(a_carry in d) = 0 then raise exception 'مرساة handle_finance غير موجودة'; end if;
  d := replace(d, a_carry, $b$'meetings', coalesce((select jsonb_agg(jsonb_build_object(
          'id', m.id, 'meeting_no', m.meeting_no, 'title', m.title, 'meeting_date', m.meeting_date,
          'present', m.present, 'rate', governance.allowance_rate(m.meeting_date),
          'total', m.present * governance.allowance_rate(m.meeting_date),
          'attendees', coalesce((select jsonb_agg(jsonb_build_object('person_id', a2.person_id, 'job_id', p2.job_id, 'full_name', p2.full_name))
            from governance.attendance a2 join core.persons p2 on p2.id = a2.person_id
            where a2.meeting_id = m.id and a2.status = 'حاضر'), '[]'))
        order by m.meeting_date, m.meeting_no)
        from governance.meeting_summary m
        where m.status = 'منعقد' and m.present > 0
          and not exists (select 1 from governance.meeting_allowances ma where ma.meeting_id = m.id)), '[]'),
      $b$ || a_carry);
  execute d;
end $do$;

create or replace function api.staff_tasks(uid uuid) returns jsonb language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select coalesce(jsonb_agg(t) filter (where (t->>'count')::int > 0), '[]') from (
    select jsonb_build_object('title','طلبات تعديل بيانات','count',(select count(*) from core.change_requests where status = 'معلّق'),'link','#/requests') t where core.can(uid,'profile.change.approve')
    union all select jsonb_build_object('title','منح تحتاج مراجعة مستندات','count',(select count(*) from grants.requests where status in ('مقدَّم','ناقص مستندات')),'link','#/grantsadmin') where core.can(uid,'grants.review')
    union all select jsonb_build_object('title','منح جاهزة للاعتماد','count',(select count(*) from grants.requests where status = 'مستوفى'),'link','#/grantsadmin') where core.can(uid,'grants.approve')
    union all select jsonb_build_object('title','منح معتمدة للصرف','count',(select count(*) from grants.requests where status = 'معتمد'),'link','#/grantsadmin') where core.can(uid,'treasury.cheque.issue')
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

revoke all on all functions in schema governance from public, anon, authenticated;
revoke all on all functions in schema treasury from public, anon, authenticated;
revoke all on all functions in schema api from public, anon, authenticated;
