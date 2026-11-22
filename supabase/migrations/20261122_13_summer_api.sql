-- المرحلة 6 — واجهة المصايف SUM_*
create or replace function api.sum_app_json(p_app uuid) returns jsonb language sql stable as $$
  select to_jsonb(ap) - 'terms' - 'draw_key' || jsonb_build_object(
    'draw_key', ap.draw_key,
    'person', (select jsonb_build_object('full_name', full_name, 'job_id', job_id, 'phone', phone) from core.persons where id = ap.person_id),
    'unit', (select jsonb_build_object('code', u.code, 'unit_type', u.unit_type, 'beds', u.beds, 'deposit', u.deposit, 'resort', r.name, 'location', r.location)
             from activities.summer_units u join activities.summer_resorts r on r.id = u.resort_id where u.id = ap.unit_id),
    'batch', (select jsonb_build_object('name', name, 'start_date', start_date, 'end_date', end_date) from activities.summer_batches where id = ap.batch_id),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'receipt_no', receipt_no, 'at', created_at) order by created_at)
                 from activities.summer_payments where application_id = ap.id), '[]'),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'details', details, 'at', at) order by id)
                 from activities.summer_events where application_id = ap.id), '[]'),
    'handovers', coalesce((select jsonb_agg(to_jsonb(h) - 'application_id') from activities.summer_handovers h where h.application_id = ap.id), '[]'),
    'swaps', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'kind', w.kind, 'status', w.status, 'reason', w.reason,
                 'mine', w.from_app = ap.id, 'other_app', (select app_no from activities.summer_applications where id = case when w.from_app = ap.id then w.to_app else w.from_app end)))
                 from activities.summer_swaps w where (w.from_app = ap.id or w.to_app = ap.id) and w.status in ('مطلوب','وافق الطرف الآخر')), '[]'),
    'refundPctNow', activities.sum_refund_pct(ap.terms, coalesce((select start_date from activities.summer_batches where id = ap.batch_id),
                     activities.sum_season_start(ap.season_id))),
    'cancelPolicy', ap.terms->'cancel_policy')
  from activities.summer_applications ap where ap.id = p_app
$$;

create or replace function api.sum_season_json(p_season uuid, p_person uuid) returns jsonb language sql stable as $$
  select to_jsonb(s) || jsonb_build_object(
    'batches', coalesce((select jsonb_agg(to_jsonb(b) - 'season_id' order by b.sort, b.start_date) from activities.summer_batches b where b.season_id = s.id), '[]'),
    'resorts', coalesce((select jsonb_agg(to_jsonb(r) - 'season_id' || jsonb_build_object('units',
        coalesce((select jsonb_agg(to_jsonb(u) - 'resort_id' order by u.code) from activities.summer_units u where u.resort_id = r.id), '[]')) order by r.name)
        from activities.summer_resorts r where r.season_id = s.id), '[]'),
    'decision', (select jsonb_build_object('decision_no', d.decision_no, 'text', d.text) from governance.decisions d where d.id = s.decision_id),
    'eligible', case when p_person is not null then core.is_union_beneficiary(p_person, coalesce(activities.sum_season_start(s.id), current_date)) end,
    'myApp', (select api.sum_app_json(a.id) from activities.summer_applications a where a.season_id = s.id and a.person_id = p_person
              and a.status not in ('ملغى') order by a.submitted_at desc limit 1))
  from activities.summer_seasons s where s.id = p_season
$$;

create or replace function api.handle_summer(p_action text, p jsonb, uid uuid, pid uuid) returns jsonb language plpgsql as $$
declare v_id uuid; r jsonb; v_s uuid := (nullif(p->>'seasonId',''))::uuid; v_person uuid; a text := uid::text; v_ref numeric; x jsonb; v_rid uuid;
        v_cash text := coalesce(api.t(p,'cash_account'),'1101');
begin
  if v_s is not null then perform activities.sum_housekeep(v_s); end if;
  -- ── للأعضاء ──
  if p_action = 'SUM_LIST' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'year', s.year, 'title', s.title,
        'status', s.status, 'method', s.method, 'apply_close', s.apply_close, 'start', activities.sum_season_start(s.id),
        'myStatus', (select status from activities.summer_applications where season_id = s.id and person_id = pid and status <> 'ملغى' order by submitted_at desc limit 1))
        order by s.year desc, s.created_at desc)
      from activities.summer_seasons s where s.status <> 'مسودة' and s.status <> 'ملغى' or core.can(uid,'summer.manage')), '[]')));
  elsif p_action = 'SUM_GET' then
    r := api.sum_season_json(v_s, pid);
    if r is null or ((r->>'status') = 'مسودة' and not core.can(uid,'summer.manage')) then return api.err('الموسم غير متاح.'); end if;
    return api.ok(jsonb_build_object('season', r));
  elsif p_action = 'SUM_APPLY' then
    v_person := pid;
    if nullif(p->>'personId','') is not null or nullif(p->>'jobId','') is not null then
      if not core.can(uid,'activities.book.proxy') then return api.err('غير مسموح.'); end if;
      v_person := coalesce((nullif(p->>'personId',''))::uuid, api.pid_by_job(p->>'jobId'));
    elsif not core.can(uid,'activities.book.self') then return api.err('غير مسموح.'); end if;
    if v_person is null then return api.err('العضو غير موجود.'); end if;
    v_id := activities.sum_apply(v_person, p, a);
    return api.ok(jsonb_build_object('application', api.sum_app_json(v_id)));
  elsif p_action = 'SUM_MY' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(api.sum_app_json(ap.id) || jsonb_build_object('season',
        jsonb_build_object('id', s.id, 'title', s.title, 'status', s.status)) order by ap.submitted_at desc)
      from activities.summer_applications ap join activities.summer_seasons s on s.id = ap.season_id where ap.person_id = pid), '[]')));
  elsif p_action in ('SUM_WITHDRAW','SUM_APOLOGIZE_MY','SUM_SWAP_REQUEST_MY') then
    select id into v_id from activities.summer_applications where id = (p->>'applicationId')::uuid and person_id = pid;
    if v_id is null then return api.err('الطلب غير موجود.'); end if;
    if p_action = 'SUM_WITHDRAW' then perform activities.sum_withdraw(v_id, a); return api.ok();
    elsif p_action = 'SUM_APOLOGIZE_MY' then
      return api.ok(jsonb_build_object('refund', activities.sum_apologize(v_id, api.t(p,'reason'), false, '1101', a)));
    else return api.ok(jsonb_build_object('swapId', activities.sum_swap_request(p, pid, a))); end if;
  elsif p_action = 'SUM_SWAP_ACCEPT' then
    perform activities.sum_swap_accept((p->>'swapId')::uuid, pid, coalesce((p->>'accept')::boolean, true), a);
    return api.ok();
  end if;

  -- ── الإدارة ──
  if p_action = 'SUM_PAY' then
    if not core.can(uid,'treasury.receipt') then return api.err('غير مسموح.'); end if;
    v_id := activities.sum_pay((p->>'applicationId')::uuid, (p->>'amount')::numeric, v_cash, a);
    return api.ok(jsonb_build_object('application', api.sum_app_json((p->>'applicationId')::uuid),
      'receipt_no', (select receipt_no from activities.summer_payments where id = v_id)));
  elsif p_action = 'SUM_HANDOVER' then   -- يحرك نقدية (التأمين) ⇒ صلاحية التحصيل
    if not core.can(uid,'treasury.receipt') then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object('result', activities.sum_handover(p, a), 'application', api.sum_app_json((p->>'applicationId')::uuid)));
  end if;
  if not core.can(uid,'summer.manage') then return api.err('غير مسموح.'); end if;
  if p_action = 'SUM_SAVE' then
    r := p->'season';
    if api.t(r,'title') is null or api.t(r,'year') is null then return api.err('العنوان والسنة مطلوبان.'); end if;
    if (r->>'id') is null then
      insert into activities.summer_seasons(code, year, title, apply_open, apply_close, method, lookback_years, max_prefs, hold_hours, cancel_policy, decision_id, notes, created_by)
      values (core.next_doc_no('SUMMER', 'SUM', (api.t(r,'year'))::int), (api.t(r,'year'))::int, api.t(r,'title'),
        (api.t(r,'apply_open'))::timestamptz, (api.t(r,'apply_close'))::timestamptz, coalesce(api.t(r,'method'),'قرعة'),
        coalesce((api.t(r,'lookback_years'))::int, 2), coalesce((api.t(r,'max_prefs'))::int, 3), coalesce((api.t(r,'hold_hours'))::int, 72),
        coalesce(r->'cancel_policy', '[{"days_before":14,"refund_pct":100},{"days_before":7,"refund_pct":50},{"days_before":0,"refund_pct":0}]'),
        (nullif(r->>'decision_id',''))::uuid, api.t(r,'notes'), a) returning id into v_id;
    else
      v_id := (r->>'id')::uuid;
      if (select status from activities.summer_seasons where id = v_id) in ('تم التوزيع','منتهٍ') and r ? 'method'
         and api.t(r,'method') <> (select method from activities.summer_seasons where id = v_id) then
        return api.err('طريقة التوزيع لا تتغير بعد التوزيع.'); end if;
      update activities.summer_seasons set title = api.t(r,'title'), year = (api.t(r,'year'))::int,
        apply_open = (api.t(r,'apply_open'))::timestamptz, apply_close = (api.t(r,'apply_close'))::timestamptz,
        method = coalesce(api.t(r,'method'), method), lookback_years = coalesce((api.t(r,'lookback_years'))::int, lookback_years),
        max_prefs = coalesce((api.t(r,'max_prefs'))::int, max_prefs), hold_hours = coalesce((api.t(r,'hold_hours'))::int, hold_hours),
        cancel_policy = coalesce(r->'cancel_policy', cancel_policy), decision_id = (nullif(r->>'decision_id',''))::uuid, notes = api.t(r,'notes')
      where id = v_id;
    end if;
    -- الأفواج والمصايف والوحدات تتعدل قبل التوزيع فقط
    if (r ? 'batches' or r ? 'resorts') then
      if (select status from activities.summer_seasons where id = v_id) not in ('مسودة','التقديم مفتوح','التقديم مقفول') then
        return api.err('الأفواج والوحدات لا تتعدل بعد التوزيع.'); end if;
    end if;
    if r ? 'batches' then
      if exists (select 1 from activities.summer_applications where season_id = v_id) then
        -- مع وجود طلبات: إضافة/تعديل فقط بالـ id
        for x in select * from jsonb_array_elements(r->'batches') loop
          if nullif(x->>'id','') is null then
            insert into activities.summer_batches(season_id, name, start_date, end_date, sort) values (v_id, x->>'name', (x->>'start_date')::date, (x->>'end_date')::date, coalesce((x->>'sort')::int,0));
          else update activities.summer_batches set name = x->>'name', start_date = (x->>'start_date')::date, end_date = (x->>'end_date')::date where id = (x->>'id')::uuid and season_id = v_id; end if;
        end loop;
      else
        delete from activities.summer_batches where season_id = v_id;
        insert into activities.summer_batches(season_id, name, start_date, end_date, sort)
        select v_id, bx->>'name', (bx->>'start_date')::date, (bx->>'end_date')::date, o from jsonb_array_elements(r->'batches') with ordinality t(bx, o);
      end if;
    end if;
    if r ? 'resorts' then
      for x in select * from jsonb_array_elements(r->'resorts') loop
        if nullif(x->>'id','') is null then
          insert into activities.summer_resorts(season_id, name, location, owner_party, notes) values (v_id, x->>'name', x->>'location', x->>'owner_party', x->>'notes') returning id into v_rid;
        else
          v_rid := (x->>'id')::uuid;
          update activities.summer_resorts set name = x->>'name', location = x->>'location', owner_party = x->>'owner_party', notes = x->>'notes' where id = v_rid and season_id = v_id;
        end if;
        if x ? 'units' then
          insert into activities.summer_units(resort_id, code, unit_type, beds, full_price, member_price, deposit, owner_cost, active)
          select v_rid, u->>'code', coalesce(nullif(u->>'unit_type',''),'شقة'), (u->>'beds')::int, (u->>'full_price')::numeric,
                 coalesce((nullif(u->>'member_price',''))::numeric, (u->>'full_price')::numeric), coalesce((nullif(u->>'deposit',''))::numeric,0),
                 coalesce((nullif(u->>'owner_cost',''))::numeric,0), coalesce((u->>'active')::boolean, true)
          from jsonb_array_elements(x->'units') u
          on conflict (resort_id, code) do update set unit_type = excluded.unit_type, beds = excluded.beds, full_price = excluded.full_price,
            member_price = excluded.member_price, deposit = excluded.deposit, owner_cost = excluded.owner_cost, active = excluded.active;
        end if;
      end loop;
    end if;
    return api.ok(jsonb_build_object('season', api.sum_season_json(v_id, null)));
  elsif p_action = 'SUM_SET_STATUS' then
    if api.t(p,'status') not in ('مسودة','التقديم مفتوح','التقديم مقفول','ملغى') then return api.err('حالة غير مسموحة — التوزيع والإقفال لهما أزرار.'); end if;
    if api.t(p,'status') = 'التقديم مفتوح' then
      if not exists (select 1 from activities.summer_batches where season_id = v_s) or not exists (select 1 from activities.summer_units u join activities.summer_resorts r on r.id = u.resort_id where r.season_id = v_s) then
        return api.err('أضف الأفواج والوحدات قبل فتح التقديم.'); end if;
      if (select decision_id from activities.summer_seasons where id = v_s) is null and coalesce((core.setting('FIN_REQUIRE_DECISION'))::text,'true') = 'true' then
        return api.err('اربط الموسم بقرار المجلس قبل فتح التقديم.'); end if;
      if (select status from activities.summer_seasons where id = v_s) not in ('مسودة','التقديم مقفول') then return api.err('لا يُعاد فتح التقديم بعد التوزيع.'); end if;
    end if;
    if api.t(p,'status') = 'التقديم مقفول' and (select status from activities.summer_seasons where id = v_s) <> 'التقديم مفتوح' then
      return api.err('التقديم ليس مفتوحاً.'); end if;
    update activities.summer_seasons set status = api.t(p,'status'),
      lottery_seed = case when api.t(p,'status') = 'التقديم مقفول' then coalesce(api.t(p,'seed'), lottery_seed) else lottery_seed end where id = v_s;
    if api.t(p,'status') = 'ملغى' then
      for v_id in select id from activities.summer_applications where season_id = v_s and status in ('بانتظار السداد','مؤكد','احتياطي','مقدَّم') loop
        if (select status from activities.summer_applications where id = v_id) = 'مقدَّم' then perform activities.sum_withdraw(v_id, a);
        else perform activities.sum_apologize(v_id, 'إلغاء الموسم', true, v_cash, a); end if;
      end loop;
    end if;
    return api.ok(jsonb_build_object('season', api.sum_season_json(v_s, null)));
  elsif p_action = 'SUM_ALLOCATE' then
    return api.ok(jsonb_build_object('result', activities.sum_allocate(v_s, api.t(p,'seed'), a)));
  elsif p_action = 'SUM_APPS' then
    return api.ok(jsonb_build_object('summary', activities.sum_summary(v_s),
      'swaps', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'kind', w.kind, 'status', w.status, 'reason', w.reason,
          'from', (select app_no from activities.summer_applications where id = w.from_app), 'to', (select app_no from activities.summer_applications where id = w.to_app),
          'to_batch', (select name from activities.summer_batches where id = w.to_batch), 'to_unit', (select code from activities.summer_units where id = w.to_unit)) order by w.created_at)
        from activities.summer_swaps w join activities.summer_applications ap on ap.id = w.from_app where ap.season_id = v_s and w.status in ('مطلوب','وافق الطرف الآخر')), '[]'),
      'items', coalesce((select jsonb_agg(api.sum_app_json(ap.id)
        order by case ap.status when 'مؤكد' then 1 when 'بانتظار السداد' then 2 when 'احتياطي' then 3 when 'مقدَّم' then 4 when 'منتهٍ' then 5 else 6 end,
                 ap.rank nulls last, ap.reserve_rank, ap.submitted_at)
        from activities.summer_applications ap where ap.season_id = v_s and (api.t(p,'status') is null or ap.status = api.t(p,'status'))), '[]')));
  elsif p_action = 'SUM_APOLOGIZE' then
    if api.t(p,'reason') is null then return api.err('سبب الاعتذار مطلوب.'); end if;
    return api.ok(jsonb_build_object('refund', activities.sum_apologize((p->>'applicationId')::uuid, api.t(p,'reason'), true, v_cash, a)));
  elsif p_action = 'SUM_SWAP_REQUEST' then
    return api.ok(jsonb_build_object('swapId', activities.sum_swap_request(p, null, a)));
  elsif p_action = 'SUM_SWAP_DECIDE' then
    perform activities.sum_swap_decide((p->>'swapId')::uuid, coalesce((p->>'approve')::boolean, false), v_cash, a);
    return api.ok();
  elsif p_action = 'SUM_CLOSE' then
    return api.ok(jsonb_build_object('result', activities.sum_close(v_s, a), 'summary', activities.sum_summary(v_s)));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- الموجّه (كل الفروع)
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  if p_action like 'IMPORT\_%' or p_action like 'GOV\_%' or p_action like 'FIN\_%' or p_action like 'BEN\_%' or p_action like 'ACT\_%' or p_action like 'SUM\_%' then
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
