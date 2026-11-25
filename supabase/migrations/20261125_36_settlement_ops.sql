-- المرحلة 30: التسوية المجمّعة + الترحيل الآلي + المسودة + الاسترجاع بقيد عكسي
-- المبادئ: العهدة = مجموع شيكات المجموعة (لا إدخال يدوي) · الرصيد المرحّل يُجلب من التسوية السابقة ويُستخدم مرة واحدة
--          · المسودة بلا قيد ولا مزايا · الاسترجاع بقيد عكسي وسبب ويُلغي المزايا ويعيد الشيكات «صادر»

-- ── الجداول ──
alter table treasury.settlements
  add column status           text not null default 'معتمدة' check (status in ('مسودة','معتمدة','مسترجعة')),
  add column draft            jsonb,
  add column carried_from     uuid references treasury.settlements(id),
  add column reverse_entry_id uuid references finance.entries(id),
  add column reverse_reason   text,
  add column reversed_at      timestamptz,
  add column reversed_by      text,
  add column created_by       text,
  add column created_at       timestamptz not null default now();

alter table treasury.settlements drop constraint settlements_cheque_id_key;
-- تسوية واحدة غير مسترجعة لكل شيك أساسي (مسودة أو معتمدة)
create unique index settlements_cheque_active on treasury.settlements(cheque_id) where status <> 'مسترجعة';
-- الرصيد المرحّل يُستخدم مرة واحدة فقط
create unique index settlements_carried_once on treasury.settlements(carried_from) where status = 'معتمدة';
create index settlements_carried_from_idx on treasury.settlements(carried_from);
create index settlements_reverse_entry_idx on treasury.settlements(reverse_entry_id);

-- شيكات التسوية (الأساسي + شيكات المجموعة)
create table treasury.settlement_cheques (
  settlement_id uuid not null references treasury.settlements(id),
  cheque_id     uuid not null references treasury.cheques(id),
  amount        numeric(14,2) not null check (amount > 0),
  primary key (settlement_id, cheque_id)
);
create index settlement_cheques_cheque_idx on treasury.settlement_cheques(cheque_id);
alter table treasury.settlement_cheques enable row level security;
create trigger settlement_cheques_audit after insert or update or delete on treasury.settlement_cheques
  for each row execute function audit.track();

insert into treasury.settlement_cheques(settlement_id, cheque_id, amount)
select s.id, s.cheque_id, c.amount from treasury.settlements s join treasury.cheques c on c.id = s.cheque_id;

-- ربط الترحيل التاريخي الوحيد المنقول من MyNekaba (1,202.60 من شيك 63267477 إلى تسوية شيك 63267436) حتى لا يُقترح مرتين
update treasury.settlements dst set carried_from = src.id
from treasury.settlements src
where dst.legacy_ref is not null and src.legacy_ref is not null and src.return_mode = 'ترحيل'
  and dst.prev_balance > 0 and dst.carried_from is null
  and round(src.advance + src.prev_balance + src.subscriptions - src.spent - src.returned, 2) = dst.prev_balance;

-- التسوية المعتمدة التي تغطي شيكاً (أساسياً أو ضمن مجموعة)
create or replace function treasury.cheque_settlement(p_cheque uuid) returns uuid language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select s.id from treasury.settlement_cheques sc join treasury.settlements s on s.id = sc.settlement_id
  where sc.cheque_id = p_cheque and s.status = 'معتمدة' limit 1
$$;

-- الرصيد المتبقي (المرحّل) لتسوية
create or replace function treasury.settlement_carry(s treasury.settlements) returns numeric language sql immutable as $$
  select round(s.advance + s.prev_balance + s.subscriptions - s.spent - s.returned, 2)
$$;

-- ── التسوية (مسودة أو اعتماد) ──
create or replace function treasury.settle(p jsonb, p_actor text) returns uuid language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare c treasury.cheques; g treasury.cheques; fc treasury.cheques; v_from treasury.settlements;
        v_id uuid; v_entry uuid; l jsonb; i int := 0; v_spent numeric := 0; v_x text;
        v_sub numeric := coalesce((nullif(p->>'subscriptions',''))::numeric,0);
        v_ret numeric := coalesce((nullif(p->>'returned',''))::numeric,0);
        v_prev numeric := 0; v_adv numeric; v_mode text := coalesce(nullif(p->>'return_mode',''),'لا يوجد'); v_carry numeric;
        lines jsonb := '[]'; v_acc text; v_ids uuid[]; v_nos text;
        v_legacy boolean := coalesce((p->>'legacy')::boolean,false); v_draft boolean := coalesce((p->>'draft')::boolean,false);
        v_date date := coalesce((nullif(p->>'date',''))::date, case when coalesce((p->>'draft')::boolean,false) then current_date end);
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

  -- المجموعة: شيكات عهدة أخرى لنفس صاحب العهدة تُسوّى وتُقفل معاً
  v_ids := array[c.id];
  for v_x in select distinct x from jsonb_array_elements_text(coalesce(p->'cheque_ids','[]')) x where x <> '' and x <> c.id::text loop
    select * into g from treasury.cheques where id = v_x::uuid for update;
    if g.id is null then raise exception 'شيك غير موجود في المجموعة' using errcode = 'check_violation'; end if;
    if not g.requires_settlement then raise exception 'الشيك % ليس عهدة', coalesce(g.cheque_no,'بدون رقم') using errcode = 'check_violation'; end if;
    if g.status <> 'صادر' then raise exception 'الشيك % حالته «%» — لا يدخل المجموعة', coalesce(g.cheque_no,'بدون رقم'), g.status using errcode = 'check_violation'; end if;
    if treasury.cheque_settlement(g.id) is not null then raise exception 'الشيك % مسوّى من قبل', coalesce(g.cheque_no,'بدون رقم') using errcode = 'check_violation'; end if;
    if coalesce(g.payee_person_id::text, g.payee_name) <> coalesce(c.payee_person_id::text, c.payee_name) then
      raise exception 'شيكات المجموعة لازم تكون لنفس صاحب العهدة (الشيك % باسم %)', coalesce(g.cheque_no,'بدون رقم'), g.payee_name using errcode = 'check_violation'; end if;
    v_ids := v_ids || g.id;
  end loop;
  select sum(amount), string_agg(coalesce(cheque_no,'بدون رقم'), ' + ' order by issue_date, cheque_no) into v_adv, v_nos
    from treasury.cheques where id = any(v_ids);
  if v_legacy then
    v_adv := coalesce((nullif(p->>'advance',''))::numeric, v_adv);
    v_prev := coalesce((nullif(p->>'prev_balance',''))::numeric, 0);
  end if;

  -- الترحيل الآلي: الرصيد يُجلب من التسوية السابقة لنفس صاحب العهدة
  if nullif(p->>'carried_from','') is not null then
    select * into v_from from treasury.settlements where id = (p->>'carried_from')::uuid for update;
    if v_from.id is null or v_from.status <> 'معتمدة' then raise exception 'التسوية المرحّل منها غير موجودة أو غير معتمدة' using errcode = 'check_violation'; end if;
    select * into fc from treasury.cheques where id = v_from.cheque_id;
    if v_from.return_mode <> 'ترحيل' or fc.status <> 'مرحّل الرصيد' then raise exception 'رصيد التسوية دي مش مرحّل (أو اترحّل قبل كده)' using errcode = 'check_violation'; end if;
    if exists (select 1 from treasury.settlements where carried_from = v_from.id and status = 'معتمدة') then
      raise exception 'الرصيد ده اترحّل لتسوية تانية قبل كده' using errcode = 'check_violation'; end if;
    if coalesce(fc.payee_person_id::text, fc.payee_name) <> coalesce(c.payee_person_id::text, c.payee_name) then
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

  -- ── المسودة: تُحفظ بلا قيد ولا مزايا ──
  if v_draft then
    if v_mode not in ('لا يوجد','رد للخزينة','توريد للبنك','ترحيل') then v_mode := 'لا يوجد'; end if;
    select id into v_id from treasury.settlements where cheque_id = c.id and status = 'مسودة' for update;
    if v_id is null then
      insert into treasury.settlements(cheque_id, settle_date, advance, prev_balance, subscriptions, spent, returned, return_mode, notes,
        status, draft, carried_from, created_by)
      values (c.id, v_date, v_adv, v_prev, v_sub, v_spent, v_ret, v_mode, p->>'notes', 'مسودة', p - 'draft', v_from.id, p_actor)
      returning id into v_id;
    else
      update treasury.settlements set settle_date = v_date, advance = v_adv, prev_balance = v_prev, subscriptions = v_sub, spent = v_spent,
        returned = v_ret, return_mode = v_mode, notes = p->>'notes', draft = p - 'draft', carried_from = v_from.id, created_by = p_actor
      where id = v_id;
    end if;
    return v_id;
  end if;

  -- ── الاعتماد ──
  v_carry := v_adv + v_prev + v_sub - v_spent - v_ret;
  if v_ret > 0 and v_mode not in ('رد للخزينة','توريد للبنك') then raise exception 'حدد طريقة رد المتبقي' using errcode = 'check_violation'; end if;
  if v_carry > 0.005 and v_mode <> 'ترحيل' and not v_legacy then
    raise exception 'متبقي % بلا تصرف — رد للخزينة أو توريد للبنك أو ترحيل', round(v_carry,2) using errcode = 'check_violation'; end if;
  if v_carry < -0.005 and p->>'decision_id' is null and not v_legacy then
    raise exception 'المصروف أكبر من المتاح بـ % — يلزم قرار مجلس بتغطية العجز', round(-v_carry,2) using errcode = 'check_violation'; end if;

  delete from treasury.settlements where cheque_id = any(v_ids) and status = 'مسودة';
  insert into treasury.settlements(cheque_id, settle_date, advance, prev_balance, subscriptions, spent, returned, return_mode, notes, legacy_ref,
    status, carried_from, created_by)
  values (c.id, v_date, v_adv, v_prev, v_sub, v_spent, v_ret, v_mode, p->>'notes', p->>'legacy_ref', 'معتمدة', v_from.id, p_actor)
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
  end loop;

  -- القيد: المصروفات مدين، العهدة دائن بالمصروف؛ الاشتراكات تدخل العهدة؛ المرتجع يخرج منها
  -- (الرصيد المرحّل باقٍ أصلاً في 1103 على نفس الشخص، فلا قيد له)
  if v_spent > 0 then lines := lines || jsonb_build_object('account','1103','credit', v_spent, 'cost_center', c.cost_center,
       'person_id', c.payee_person_id, 'party', c.payee_name); end if;
  if v_sub > 0 then lines := lines || jsonb_build_array(
       jsonb_build_object('account','1103','debit', v_sub, 'cost_center', c.cost_center, 'person_id', c.payee_person_id, 'party', c.payee_name,
         'memo','اشتراكات المشاركين'),
       jsonb_build_object('account','4201','credit', v_sub, 'cost_center', c.cost_center)); end if;
  if v_ret > 0 then lines := lines || jsonb_build_array(
       jsonb_build_object('account', case v_mode when 'رد للخزينة' then '1101' else '1102' end, 'debit', v_ret, 'cost_center', c.cost_center,
         'memo', v_mode),
       jsonb_build_object('account','1103','credit', v_ret, 'cost_center', c.cost_center, 'person_id', c.payee_person_id, 'party', c.payee_name)); end if;
  if jsonb_array_length(lines) >= 2 then
    v_entry := finance.post(jsonb_build_object('date', v_date, 'source', 'تسوية', 'source_ref', v_id, 'decision_id', coalesce(p->>'decision_id', c.decision_id::text),
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
  return v_id;
end $$;

-- ── الاسترجاع: قيد عكسي + إلغاء المزايا + الشيكات ترجع «صادر» ──
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

-- ── الواجهة: FIN_SETTLE (مسودة/مجموعة/ترحيل) + FIN_SETTLE_HELP + FIN_SETTLE_REVERSE + FIN_SETTLE_DRAFT_DELETE + FIN_CHEQUE ──
do $do$
declare d text; a_branch text := $a$  elsif p_action = 'FIN_RECEIPT' then$a$;
        a_stl text := $a$ from treasury.settlement_lines sl where sl.settlement_id = s.id)$a$;
        a_sel text := $a$from treasury.settlements s where s.cheque_id = c.id))$a$;
begin
  d := pg_get_functiondef('api.handle_finance(text,jsonb,uuid)'::regprocedure);
  if position(a_branch in d) = 0 or position(a_stl in d) = 0 or position(a_sel in d) = 0 then raise exception 'مرساة handle_finance غير موجودة'; end if;
  d := replace(d, a_branch, $b$  elsif p_action = 'FIN_SETTLE_HELP' then
    if not core.can(uid,'finance.view') then return api.err('غير مسموح.'); end if;
    return api.ok((select jsonb_build_object(
      'group', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'cheque_no', g.cheque_no, 'issue_date', g.issue_date, 'amount', g.amount, 'notes', g.notes)
          order by g.issue_date) from treasury.cheques g
        where g.id <> c.id and g.requires_settlement and g.status = 'صادر' and treasury.cheque_settlement(g.id) is null
          and coalesce(g.payee_person_id::text, g.payee_name) = coalesce(c.payee_person_id::text, c.payee_name)), '[]'),
      'carry', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'settle_date', s.settle_date, 'cheque_no', fc.cheque_no,
            'amount', treasury.settlement_carry(s)) order by s.settle_date) from treasury.settlements s join treasury.cheques fc on fc.id = s.cheque_id
        where s.status = 'معتمدة' and s.return_mode = 'ترحيل' and fc.status = 'مرحّل الرصيد' and treasury.settlement_carry(s) > 0.005
          and not exists (select 1 from treasury.settlements n where n.carried_from = s.id and n.status = 'معتمدة')
          and coalesce(fc.payee_person_id::text, fc.payee_name) = coalesce(c.payee_person_id::text, c.payee_name)), '[]'))
      from treasury.cheques c where c.id = (p->>'cheque_id')::uuid));
  elsif p_action = 'FIN_SETTLE_REVERSE' then
    if not core.can(uid,'finance.journal') then return api.err('غير مسموح — الاسترجاع يحتاج صلاحية القيود.'); end if;
    if api.t(p,'reason') is null then return api.err('سبب الاسترجاع مطلوب.'); end if;
    v_id := treasury.settle_reverse((p->>'id')::uuid, coalesce((api.t(p,'date'))::date, current_date), api.t(p,'reason'), a);
    return api.ok(jsonb_build_object('id', v_id));
  elsif p_action = 'FIN_SETTLE_DRAFT_DELETE' then
    if not core.can(uid,'treasury.settlement') then return api.err('غير مسموح.'); end if;
    delete from treasury.settlements where id = (p->>'id')::uuid and status = 'مسودة';
    if not found then return api.err('المسودة غير موجودة.'); end if;
    return api.ok();
$b$ || a_branch);
  d := replace(d, a_stl, a_stl || $b$, 'cheques', (select jsonb_agg(jsonb_build_object('id', x.id, 'cheque_no', x.cheque_no, 'issue_date', x.issue_date, 'amount', sc.amount) order by x.issue_date)
        from treasury.settlement_cheques sc join treasury.cheques x on x.id = sc.cheque_id where sc.settlement_id = s.id),
      'carried_from_no', (select fc.cheque_no from treasury.settlements f join treasury.cheques fc on fc.id = f.cheque_id where f.id = s.carried_from)$b$);
  d := replace(d, a_sel, $b$from treasury.settlements s where s.id = coalesce(treasury.cheque_settlement(c.id),
                       (select x.id from treasury.settlements x where x.cheque_id = c.id and x.status = 'مسودة'))),
      'reversed', (select jsonb_agg(jsonb_build_object('id', r.id, 'settle_date', r.settle_date, 'spent', r.spent, 'reason', r.reverse_reason,
          'reversed_at', r.reversed_at, 'reverse_entry_id', r.reverse_entry_id) order by r.reversed_at)
        from treasury.settlements r join treasury.settlement_cheques rc on rc.settlement_id = r.id where rc.cheque_id = c.id and r.status = 'مسترجعة'))$b$);
  execute d;

  d := pg_get_functiondef('api.handle_bank(text,jsonb,uuid)'::regprocedure);
  if position('exists (select 1 from treasury.settlements where cheque_id = c.id)' in d) = 0 then raise exception 'مرساة handle_bank غير موجودة'; end if;
  d := replace(d, 'exists (select 1 from treasury.settlements where cheque_id = c.id)', 'treasury.cheque_settlement(c.id) is not null');
  execute d;
end $do$;

revoke all on all functions in schema treasury from public, anon, authenticated;
revoke all on all functions in schema api from public, anon, authenticated;
