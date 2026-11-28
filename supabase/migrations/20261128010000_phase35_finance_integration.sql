-- Phase 35: Financial Integration, Custodian Overdue Alerts, Activity-Settlement Linkage & Fiscal Year Closing

alter table treasury.settlements
  add column if not exists activity_id uuid references activities.activities(id);

-- 1) Custodian open & overdue advances summary (for issuing warnings before new advances)
create or replace function treasury.custodian_open_summary(p_person_id uuid, p_name text)
returns jsonb
language plpgsql
stable
set search_path to 'core', 'public', 'extensions', 'pg_temp'
as $$
declare
  v_items jsonb;
  v_cnt int := 0;
  v_tot numeric := 0;
  v_ov_cnt int := 0;
  v_ov_tot numeric := 0;
begin
  select
    count(*),
    coalesce(sum(c.amount), 0),
    count(*) filter (where (current_date - c.issue_date) > 30),
    coalesce(sum(c.amount) filter (where (current_date - c.issue_date) > 30), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'cheque_no', c.cheque_no,
      'issue_date', c.issue_date,
      'amount', c.amount,
      'age_days', (current_date - c.issue_date),
      'notes', c.notes
    ) order by c.issue_date), '[]'::jsonb)
  into v_cnt, v_tot, v_ov_cnt, v_ov_tot, v_items
  from treasury.cheques c
  where c.requires_settlement
    and c.status = 'صادر'
    and treasury.cheque_settlement(c.id) is null
    and treasury.same_custodian(c.payee_person_id, c.payee_name, p_person_id, p_name);

  return jsonb_build_object(
    'count', v_cnt,
    'total', v_tot,
    'overdue_count', v_ov_cnt,
    'overdue_total', v_ov_tot,
    'items', v_items
  );
end $$;

-- 2) Fiscal Year Closing (posts balanced closing entry 4xxx/5xxx -> 3201 and locks all 12 months)
create or replace function finance.close_fiscal_year(p_year int, p_actor text)
returns jsonb
language plpgsql
set search_path to 'core', 'public', 'extensions', 'pg_temp'
as $$
declare
  v_drafts int;
  v_existing uuid;
  v_lines jsonb := '[]'::jsonb;
  v_net numeric := 0;
  v_entry_id uuid := null;
  v_rec record;
  v_m int;
begin
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'سنة مالية غير صحيحة' using errcode = 'check_violation';
  end if;

  select count(*) into v_drafts
  from treasury.settlements
  where status = 'مسودة' and extract(year from settle_date) = p_year;
  if v_drafts > 0 then
    raise exception 'لا يمكن إقفال سنة % لوجود % مسودة تسوية غير معتمدة — اعتمدها أو احذفها أولاً', p_year, v_drafts using errcode = 'check_violation';
  end if;

  select id into v_existing
  from finance.entries
  where source = 'إقفال سنوي'
    and status = 'مرحّل'
    and extract(year from entry_date) = p_year
  limit 1;
  if v_existing is not null then
    raise exception 'السنة المالية % مقفولة بالفعل بقيد إقفال سابق', p_year using errcode = 'check_violation';
  end if;

  -- Unlock Dec temporarily if user manually closed Dec before year-end closing entry
  delete from finance.periods where year = p_year and month = 12 and status = 'مقفولة';

  for v_rec in
    select l.account,
           sum(l.debit) - sum(l.credit) as net_dr
    from finance.lines l
    join finance.entries e on e.id = l.entry_id
    where e.status = 'مرحّل'
      and extract(year from e.entry_date) = p_year
      and (l.account like '4%' or l.account like '5%')
    group by l.account
    having abs(sum(l.debit) - sum(l.credit)) > 0.005
    order by l.account
  loop
    if v_rec.net_dr > 0 then
      -- Expense/debit-net account -> credit to close
      v_lines := v_lines || jsonb_build_object('account', v_rec.account, 'credit', round(v_rec.net_dr, 2));
      v_net := v_net - round(v_rec.net_dr, 2);
    else
      -- Revenue/credit-net account -> debit to close
      v_lines := v_lines || jsonb_build_object('account', v_rec.account, 'debit', round(abs(v_rec.net_dr), 2));
      v_net := v_net + round(abs(v_rec.net_dr), 2);
    end if;
  end loop;

  if jsonb_array_length(v_lines) > 0 then
    if v_net > 0.005 then
      -- Net Surplus -> Credit 3201 (فائض/عجز سنوات سابقة)
      v_lines := v_lines || jsonb_build_object('account', '3201', 'credit', round(v_net, 2));
    elsif v_net < -0.005 then
      -- Net Deficit -> Debit 3201
      v_lines := v_lines || jsonb_build_object('account', '3201', 'debit', round(abs(v_net), 2));
    end if;

    v_entry_id := finance.post(jsonb_build_object(
      'date', make_date(p_year, 12, 31),
      'source', 'إقفال سنوي',
      'description', 'قيد الإقفال السنوي وترحيل صافي فائض/عجز عام ' || p_year || ' إلى حـ/ 3201',
      'lines', v_lines
    ), p_actor);
  end if;

  for v_m in 1..12 loop
    insert into finance.periods(year, month, status, closed_by, closed_at)
    values (p_year, v_m, 'مقفولة', p_actor, now())
    on conflict (year, month) do update
      set status = 'مقفولة', closed_by = p_actor, closed_at = now();
  end loop;

  return jsonb_build_object(
    'year', p_year,
    'entry_id', v_entry_id,
    'net_surplus', round(v_net, 2)
  );
end $$;

-- 3) Phase 35 API Handler
create or replace function api.handle_phase35(p_action text, p jsonb, uid uuid)
returns jsonb
language plpgsql
set search_path to 'core', 'public', 'extensions', 'pg_temp'
as $$
declare
  a text := uid::text;
  v_yr int;
  v_mo int;
  v_st text;
  v_res jsonb;
begin
  if p_action = 'FIN_PERIODS_LIST' then
    if not core.can(uid, 'finance.view') then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object(
      'canClose', core.can(uid, 'finance.period.close'),
      'isAdmin', core.is_admin(uid),
      'years', coalesce((
        with yrs as (
          select distinct extract(year from entry_date)::int as y from finance.entries
          union
          select distinct year as y from finance.periods
          union
          select extract(year from current_date)::int as y
        )
        select jsonb_agg(jsonb_build_object(
          'year', yrs.y,
          'entries_count', (select count(*) from finance.entries e where extract(year from e.entry_date) = yrs.y and e.status = 'مرحّل'),
          'draft_settlements', (select count(*) from treasury.settlements s where s.status = 'مسودة' and extract(year from s.settle_date) = yrs.y),
          'closing_entry_id', (select e.id from finance.entries e where e.source = 'إقفال سنوي' and e.status = 'مرحّل' and extract(year from e.entry_date) = yrs.y limit 1),
          'closing_entry_no', (select e.entry_no from finance.entries e where e.source = 'إقفال سنوي' and e.status = 'مرحّل' and extract(year from e.entry_date) = yrs.y limit 1),
          'revenues', coalesce((select sum(l.credit - l.debit) from finance.lines l join finance.entries e on e.id = l.entry_id where e.status = 'مرحّل' and e.source <> 'إقفال سنوي' and extract(year from e.entry_date) = yrs.y and l.account like '4%'), 0),
          'expenses', coalesce((select sum(l.debit - l.credit) from finance.lines l join finance.entries e on e.id = l.entry_id where e.status = 'مرحّل' and e.source <> 'إقفال سنوي' and extract(year from e.entry_date) = yrs.y and l.account like '5%'), 0),
          'closed_months', (select count(*) from finance.periods fp where fp.year = yrs.y and fp.status = 'مقفولة'),
          'months', (
            select jsonb_agg(jsonb_build_object(
              'month', m,
              'status', coalesce((select fp.status from finance.periods fp where fp.year = yrs.y and fp.month = m), 'مفتوحة'),
              'closed_at', (select fp.closed_at from finance.periods fp where fp.year = yrs.y and fp.month = m)
            ) order by m)
            from generate_series(1, 12) as m
          )
        ) order by yrs.y desc)
        from yrs
      ), '[]'::jsonb)
    ));

  elsif p_action = 'FIN_PERIOD_TOGGLE' then
    v_yr := (p->>'year')::int;
    v_mo := (p->>'month')::int;
    v_st := coalesce(api.t(p, 'status'), 'مقفولة');
    if v_st = 'مقفولة' then
      if not core.can(uid, 'finance.period.close') then return api.err('غير مسموح بإقفال الفترات.'); end if;
      insert into finance.periods(year, month, status, closed_by, closed_at)
      values (v_yr, v_mo, 'مقفولة', a, now())
      on conflict (year, month) do update set status = 'مقفولة', closed_by = a, closed_at = now();
    else
      if not core.is_admin(uid) then return api.err('إعادة فتح فترة مقفولة متاحة لمدير النظام فقط.'); end if;
      update finance.periods set status = 'مفتوحة', closed_by = a, closed_at = now() where year = v_yr and month = v_mo;
    end if;
    return api.ok();

  elsif p_action = 'FIN_YEAR_CLOSE' then
    if not core.can(uid, 'finance.period.close') then return api.err('غير مسموح بإقفال السنة المالية.'); end if;
    v_res := finance.close_fiscal_year((p->>'year')::int, a);
    return api.ok(v_res);

  elsif p_action = 'FIN_CUSTODIAN_ALERT' then
    if not (core.can(uid, 'finance.view') or core.can(uid, 'treasury.cheque.issue') or core.can(uid, 'treasury.payment.request')) then
      return api.err('غير مسموح.');
    end if;
    return api.ok(treasury.custodian_open_summary((nullif(p->>'person_id',''))::uuid, api.t(p, 'name')));

  elsif p_action = 'FIN_SETTLE_ACTIVITIES' then
    if not core.can(uid, 'finance.view') then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', act.id,
          'code', act.code,
          'title', act.title,
          'kind', act.kind,
          'start_date', act.start_date,
          'paid_bookings', coalesce((select sum(b.paid) from activities.bookings b where b.activity_id = act.id and b.status <> 'ملغى'), 0),
          'bookings_count', (select count(*) from activities.bookings b where b.activity_id = act.id and b.status <> 'ملغى')
        ) order by act.start_date desc)
        from activities.activities act
      ), '[]'::jsonb)
    ));
  end if;

  return api.err('عملية غير معروفة: ' || p_action);
exception
  when check_violation then return api.err(coalesce(nullif(sqlerrm,''), 'قيمة غير صحيحة.'));
end $$;
