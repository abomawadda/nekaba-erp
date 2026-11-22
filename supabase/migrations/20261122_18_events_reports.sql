-- المرحلة 8 (الجزء الأول) — الإفطار والفعاليات على محرّك الأنشطة + التقارير الشاملة
-- (1) نشاط مجاني (إجمالي الحجز صفر، مثل إفطار أو فعالية بلا اشتراك) ⇒ الحجز يتأكد فوراً بالأسبقية بدل انتظار سداد لا يأتي.
do $$ declare d text := pg_get_functiondef('activities.book(uuid,jsonb,text)'::regprocedure);
  a text := $a$  update activities.bookings set total = tot, subsidy = sub, status = v_status,$a$;
begin
  if position(a in d) = 0 then raise exception 'anchor missing'; end if;
  d := replace(d, a, $b$  if v_status = 'بانتظار السداد' and tot = 0 then v_status := 'مؤكد'; end if;   -- مجاني ⇒ مؤكد فوراً
  update activities.bookings set total = tot, subsidy = sub, status = v_status,
    priority_at = case when v_status = 'مؤكد' then clock_timestamp() end,$b$);
  execute d;
end $$;
-- التصعيد من الانتظار لحجز مجاني يتأكد مباشرة أيضاً
do $$ declare d text := pg_get_functiondef('activities.housekeep(uuid)'::regprocedure);
  a text := $a$update activities.bookings set status = 'بانتظار السداد', hold_until = now() + make_interval(hours => a.hold_hours) where id = w.id;$a$;
begin
  if position(a in d) = 0 then raise exception 'anchor missing (housekeep)'; end if;
  execute replace(d, a, $b$update activities.bookings set status = case when total = 0 then 'مؤكد' else 'بانتظار السداد' end,
        priority_at = case when total = 0 then clock_timestamp() end,
        hold_until = case when total = 0 then null else now() + make_interval(hours => a.hold_hours) end where id = w.id;$b$);
end $$;

-- (2) التقارير الشاملة لسنة (أو كل السنوات)
insert into core.permissions(code, module, name) values ('reports.view','reports','التقارير الشاملة') on conflict do nothing;
insert into core.role_permissions(role, permission) values ('BOARD','reports.view'), ('TREASURER','reports.view'), ('AUDITOR','reports.view') on conflict do nothing;

create or replace function api.report_overview(p_year int) returns jsonb language sql stable as $$
  with yr as (select coalesce(make_date(p_year,1,1), '1900-01-01'::date) d1, coalesce(make_date(p_year,12,31), '2999-12-31'::date) d2)
  select jsonb_build_object(
    'year', p_year,
    'members', jsonb_build_object(
      'total', (select count(*) from core.person_current),
      'byOrg', (select jsonb_object_agg(coalesce(union_org,'غير محدد'), n) from (select union_org, count(*) n from core.person_current group by 1) q),
      'byState', (select jsonb_object_agg(coalesce(member_state,'غير محدد'), n) from (select member_state, count(*) n from core.person_current group by 1) q)),
    'benefits', jsonb_build_object(
      'total', (select coalesce(sum(amount),0) from benefits.ledger, yr where status = 'فعّالة' and benefit_date between d1 and d2),
      'people', (select count(distinct person_id) from benefits.ledger, yr where status = 'فعّالة' and benefit_date between d1 and d2),
      'byCategory', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'total', t, 'people', n) order by t desc)
        from (select category, sum(amount) t, count(distinct person_id) n from benefits.ledger, yr where status = 'فعّالة' and benefit_date between d1 and d2 group by 1) q), '[]')),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'title', a.title, 'kind', a.kind, 'date', a.start_date, 'status', a.status,
        'people', (select count(*) from activities.booking_people bp join activities.bookings b on b.id = bp.booking_id where b.activity_id = a.id and b.status in ('مؤكد','منتهٍ')),
        'collected', (activities.summary(a.id)->>'collected')::numeric, 'subsidy', (activities.summary(a.id)->>'subsidy')::numeric,
        'expenses', (activities.summary(a.id)->>'expenses')::numeric) order by a.start_date desc)
      from activities.activities a, yr where a.start_date between d1 and d2 and a.status <> 'ملغى'), '[]'),
    'summer', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'title', s.title, 'status', s.status) || activities.sum_summary(s.id) order by s.year desc)
      from activities.summer_seasons s where p_year is null or s.year = p_year), '[]'),
    'grants', jsonb_build_object(
      'byType', coalesce((select jsonb_agg(jsonb_build_object('type', t.name, 'paid', q.paid, 'amount', q.amt, 'open', q.open) order by t.sort)
        from grants.types t join (select type_code, count(*) filter (where status = 'مصروف') paid, coalesce(sum(amount) filter (where status = 'مصروف'),0) amt,
               count(*) filter (where status in ('مقدَّم','ناقص مستندات','مستوفى','معتمد')) open
             from grants.requests, yr where event_date between d1 and d2 group by 1) q on q.type_code = t.code), '[]')),
    'devices', jsonb_build_object('offers', (select count(*) from activities.dev_offers, yr where created_at::date between d1 and d2),
      'bookings', (select count(*) from activities.dev_orders, yr where created_at::date between d1 and d2 and status not in ('ملغى','مرفوض')),
      'delivered', (select count(*) from activities.dev_orders, yr where created_at::date between d1 and d2 and status = 'مسلّم')),
    'finance', jsonb_build_object(
      'revenue', (select coalesce(sum(l.credit - l.debit),0) from finance.lines l join finance.entries e on e.id = l.entry_id join finance.accounts ac on ac.code = l.account, yr
                  where ac.type = 'إيرادات' and e.entry_date between d1 and d2),
      'expense', (select coalesce(sum(l.debit - l.credit),0) from finance.lines l join finance.entries e on e.id = l.entry_id join finance.accounts ac on ac.code = l.account, yr
                  where ac.type = 'مصروفات' and e.entry_date between d1 and d2),
      'byAccount', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'type', type, 'amount', amt) order by type, abs(amt) desc)
        from (select ac.code, ac.name, ac.type, sum(case when ac.type = 'إيرادات' then l.credit - l.debit else l.debit - l.credit end) amt
              from finance.lines l join finance.entries e on e.id = l.entry_id join finance.accounts ac on ac.code = l.account, yr
              where ac.type in ('إيرادات','مصروفات') and e.entry_date between d1 and d2 group by 1,2,3 having sum(l.debit - l.credit) <> 0) q), '[]'),
      'bank', (select coalesce(sum(debit - credit),0) from finance.lines where account = '1102'),
      'cash', (select coalesce(sum(debit - credit),0) from finance.lines where account = '1101'),
      'custody', (select coalesce(sum(debit - credit),0) from finance.lines where account = '1103')),
    'years', (select jsonb_agg(y order by y desc) from (select distinct extract(year from entry_date)::int y from finance.entries
              union select distinct extract(year from benefit_date)::int from benefits.ledger) q))
$$;

create or replace function api.handle_reports(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql as $$
begin
  if not (core.can(uid,'reports.view') or core.can(uid,'finance.view')) then return api.err('غير مسموح.'); end if;
  if p_action = 'REP_OVERVIEW' then
    return api.ok(jsonb_build_object('report', api.report_overview((nullif(p->>'year',''))::int)));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- الموجّه (كل الفروع)
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  if p_action like 'IMPORT\_%' or p_action like 'GOV\_%' or p_action like 'FIN\_%' or p_action like 'BEN\_%' or p_action like 'ACT\_%'
     or p_action like 'SUM\_%' or p_action like 'GRT\_%' or p_action like 'DEV\_%' or p_action like 'REP\_%' then
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
    elsif p_action like 'DEV\_%' then return api.handle_devices(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'REP\_%' then return api.handle_reports(p_action, p, uid);
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
revoke all on all functions in schema api, activities from public, anon, authenticated;
