-- المرحلة 3 — عمليات الخزينة (نفس الدوال للتشغيل وللنقل من MyNekaba) + واجهة FIN_*
insert into core.permissions(code, module, name) values ('finance.cost_centers','finance','إدارة مراكز التكلفة') on conflict do nothing;
insert into core.role_permissions(role, permission) values ('TREASURER','finance.cost_centers'),('TREASURER','finance.period.close'),('SYS_ADMIN','finance.view') on conflict do nothing;

create or replace function treasury.party_of(p jsonb) returns text language sql immutable as
$$ select coalesce(nullif(trim(p->>'payee_name'),''), nullif(trim(p->>'party'),''), 'غير محدد') $$;

-- ── إصدار شيك: عهدة ⇒ مدين 1103 (باسم المستلم)، غير ذلك ⇒ مدين حساب المصروف؛ دائن البنك ──
create or replace function treasury.issue_cheque(p jsonb, p_actor text) returns uuid language plpgsql as $$
declare v_id uuid; v_entry uuid; v_custody boolean; v_acc text; v_cc text; v_party text := treasury.party_of(p);
begin
  if nullif(p->>'person_id','') is null and nullif(p->>'person_job','') is not null then   -- ربط المستفيد بالعضو برقمه الوظيفي
    p := p || jsonb_build_object('person_id', api.pid_by_job(p->>'person_job'));
  end if;
  if p->>'legacy_ref' is not null then
    select id into v_id from treasury.cheques where legacy_ref = p->>'legacy_ref';
    if v_id is not null then return v_id; end if;
  end if;
  v_custody := (p->>'purpose') = 'عهدة' or coalesce((p->>'requires_settlement')::boolean, false);
  v_acc := case when v_custody then '1103' else p->>'expense_account' end;
  if v_acc is null then raise exception 'حدد حساب المصروف' using errcode = 'check_violation'; end if;
  if (p->>'amount')::numeric <= 0 then raise exception 'المبلغ لازم أكبر من صفر' using errcode = 'check_violation'; end if;
  v_cc := coalesce(nullif(p->>'cost_center',''), case when p->>'purpose' = 'منحة' then 'GRANTS' else 'ADM' end);
  insert into treasury.cheques(cheque_no, bank_account, issue_date, amount, payee_person_id, payee_name, purpose, expense_account,
    decision_id, cost_center, requires_settlement, status, notes, legacy_ref)
  values (nullif(trim(p->>'cheque_no'),''), coalesce(p->>'bank_account','1102'), (p->>'date')::date, (p->>'amount')::numeric,
    (nullif(p->>'person_id',''))::uuid, v_party, p->>'purpose', case when v_custody then null else v_acc end,
    (nullif(p->>'decision_id',''))::uuid, v_cc, v_custody, 'صادر', p->>'notes', p->>'legacy_ref')
  returning id into v_id;
  v_entry := finance.post(jsonb_build_object('date', p->>'date', 'source', 'شيك', 'source_ref', v_id, 'decision_id', p->>'decision_id',
    'legacy_ref', case when p->>'legacy_ref' is not null then 'CHQ:' || (p->>'legacy_ref') end,
    'description', 'شيك ' || coalesce(nullif(p->>'cheque_no',''), 'بدون رقم') || ' — ' || p->>'purpose' || ' — ' || v_party
                   || coalesce(' — ' || nullif(p->>'notes',''), ''),
    'lines', jsonb_build_array(
      jsonb_build_object('account', v_acc, 'debit', p->>'amount', 'cost_center', v_cc, 'person_id', p->>'person_id', 'party', v_party),
      jsonb_build_object('account', coalesce(p->>'bank_account','1102'), 'credit', p->>'amount', 'cost_center', v_cc))), p_actor);
  update treasury.cheques set entry_id = v_entry where id = v_id;
  return v_id;
end $$;

-- ── تسوية عهدة: {cheque_id|cheque_legacy, date, lines[{category, amount, doc_date, notes, beneficiaries}],
--     subscriptions, prev_balance, returned, return_mode, decision_id, allow_deficit} ──
create or replace function treasury.settle(p jsonb, p_actor text) returns uuid language plpgsql as $$
declare c treasury.cheques; v_id uuid; v_entry uuid; l jsonb; i int := 0; v_spent numeric := 0; v_sub numeric := coalesce((p->>'subscriptions')::numeric,0);
        v_ret numeric := coalesce((p->>'returned')::numeric,0); v_prev numeric := coalesce((p->>'prev_balance')::numeric,0);
        v_adv numeric; v_mode text := coalesce(p->>'return_mode','لا يوجد'); v_carry numeric; lines jsonb := '[]'; v_acc text;
begin
  select * into c from treasury.cheques where id = coalesce((nullif(p->>'cheque_id',''))::uuid,
    (select id from treasury.cheques where legacy_ref = p->>'cheque_legacy')) for update;
  if c.id is null then raise exception 'الشيك غير موجود' using errcode = 'check_violation'; end if;
  if p->>'legacy_ref' is not null then
    select id into v_id from treasury.settlements where legacy_ref = p->>'legacy_ref';
    if v_id is not null then return v_id; end if;
  end if;
  if not c.requires_settlement then raise exception 'هذا الشيك ليس عهدة' using errcode = 'check_violation'; end if;
  if exists (select 1 from treasury.settlements where cheque_id = c.id) then raise exception 'الشيك مسوّى من قبل' using errcode = 'check_violation'; end if;
  v_adv := coalesce((p->>'advance')::numeric, c.amount);
  for l in select * from jsonb_array_elements(coalesce(p->'lines','[]')) loop
    if coalesce((l->>'amount')::numeric,0) <= 0 then continue; end if;
    v_acc := coalesce(nullif(l->>'account',''), (select account from finance.category_map where category = l->>'category'), '5501');
    v_spent := v_spent + (l->>'amount')::numeric;
    lines := lines || jsonb_build_object('account', v_acc, 'debit', l->>'amount', 'cost_center', c.cost_center,
      'memo', coalesce(l->>'category','') || coalesce(' — ' || nullif(l->>'notes',''), ''));
  end loop;
  v_carry := v_adv + v_prev + v_sub - v_spent - v_ret;
  if v_ret > 0 and v_mode not in ('رد للخزينة','توريد للبنك') then raise exception 'حدد طريقة رد المتبقي' using errcode = 'check_violation'; end if;
  if v_carry > 0.005 and v_mode <> 'ترحيل' and not coalesce((p->>'legacy')::boolean,false) then
    raise exception 'متبقي % بلا تصرف — رد للخزينة أو توريد للبنك أو ترحيل', round(v_carry,2) using errcode = 'check_violation'; end if;
  if v_carry < -0.005 and p->>'decision_id' is null and not coalesce((p->>'legacy')::boolean,false) then
    raise exception 'المصروف أكبر من المتاح بـ % — يلزم قرار مجلس بتغطية العجز', round(-v_carry,2) using errcode = 'check_violation'; end if;
  insert into treasury.settlements(cheque_id, settle_date, advance, prev_balance, subscriptions, spent, returned, return_mode, notes, legacy_ref)
  values (c.id, (p->>'date')::date, v_adv, v_prev, v_sub, v_spent, v_ret, v_mode, p->>'notes', p->>'legacy_ref') returning id into v_id;
  for l in select * from jsonb_array_elements(coalesce(p->'lines','[]')) loop
    if coalesce((l->>'amount')::numeric,0) <= 0 then continue; end if;
    i := i + 1;
    insert into treasury.settlement_lines(settlement_id, line_no, category, account, amount, doc_date, notes, beneficiaries)
    values (v_id, i, coalesce(nullif(l->>'category',''),'أخرى'),
      coalesce(nullif(l->>'account',''), (select account from finance.category_map where category = l->>'category'), '5501'),
      (l->>'amount')::numeric, (nullif(l->>'doc_date',''))::date, l->>'notes', l->'beneficiaries');
  end loop;
  -- القيد: المصروفات مدين، العهدة دائن بالمصروف؛ الاشتراكات تدخل العهدة؛ المرتجع يخرج منها
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
    v_entry := finance.post(jsonb_build_object('date', p->>'date', 'source', 'تسوية', 'source_ref', v_id, 'decision_id', coalesce(p->>'decision_id', c.decision_id::text),
      'legacy_ref', case when p->>'legacy_ref' is not null then 'STL:' || (p->>'legacy_ref') end,
      'description', 'تسوية عهدة شيك ' || coalesce(c.cheque_no,'بدون رقم') || ' — ' || c.payee_name
        || ' (مصروف ' || v_spent || case when v_ret > 0 then '، ' || v_mode || ' ' || v_ret else '' end
        || case when v_carry > 0.005 then '، مرحّل ' || round(v_carry,2) else '' end || ')',
      'lines', lines), p_actor);
    update treasury.settlements set entry_id = v_entry where id = v_id;
  end if;
  update treasury.cheques set status = case when v_carry > 0.005 then 'مرحّل الرصيد' else 'مسوّى' end where id = c.id;
  return v_id;
end $$;

-- ── مقبوض/إيداع/رسوم بنكية ──
create or replace function treasury.receive(p jsonb, p_actor text) returns uuid language plpgsql as $$
declare v_id uuid; v_entry uuid; v_kind text := p->>'kind'; v_acc text; v_cash text := coalesce(p->>'cash_account','1102'); v_cc text;
begin
  if p->>'legacy_ref' is not null then
    select id into v_id from treasury.receipts where legacy_ref = p->>'legacy_ref';
    if v_id is not null then return v_id; end if;
  end if;
  v_acc := coalesce(nullif(p->>'account',''), case v_kind when 'تحويل النقابة العامة' then '4101' when 'اشتراكات' then '4201'
             when 'رد عهدة' then '1103' when 'رسوم بنكية' then '5502' else '4901' end);
  v_cc := coalesce(nullif(p->>'cost_center',''), 'ADM');
  insert into treasury.receipts(receipt_no, receipt_date, amount, kind, party, person_id, account, cash_account, decision_id, cost_center, notes, legacy_ref)
  values (core.next_doc_no(case when v_kind = 'رسوم بنكية' then 'BANKFEE' else 'RCPT' end, case when v_kind = 'رسوم بنكية' then 'رسوم' else 'قبض' end,
          extract(year from (p->>'date')::date)::int),
          (p->>'date')::date, (p->>'amount')::numeric, v_kind, nullif(p->>'party',''), (nullif(p->>'person_id',''))::uuid, v_acc, v_cash,
          (nullif(p->>'decision_id',''))::uuid, v_cc, p->>'notes', p->>'legacy_ref') returning id into v_id;
  v_entry := finance.post(jsonb_build_object('date', p->>'date', 'source', case when v_kind = 'رسوم بنكية' then 'رسوم بنكية' else 'إيصال' end,
    'source_ref', v_id, 'decision_id', p->>'decision_id',
    'legacy_ref', case when p->>'legacy_ref' is not null then 'RCV:' || (p->>'legacy_ref') end,
    'description', v_kind || coalesce(' — ' || nullif(p->>'party',''), '') || coalesce(' — ' || nullif(p->>'notes',''), ''),
    'lines', case when v_kind = 'رسوم بنكية' then jsonb_build_array(
        jsonb_build_object('account', v_acc, 'debit', p->>'amount', 'cost_center', v_cc),
        jsonb_build_object('account', v_cash, 'credit', p->>'amount', 'cost_center', v_cc))
      else jsonb_build_array(
        jsonb_build_object('account', v_cash, 'debit', p->>'amount', 'cost_center', v_cc),
        jsonb_build_object('account', v_acc, 'credit', p->>'amount', 'cost_center', v_cc, 'person_id', p->>'person_id', 'party', p->>'party')) end), p_actor);
  update treasury.receipts set entry_id = v_entry where id = v_id;
  return v_id;
end $$;

-- ── واجهة FIN_* ──
create or replace function api.handle_finance(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql as $$
declare v_id uuid; v_from date := coalesce((api.t(p,'from'))::date, date_trunc('year', current_date)::date);
        v_to date := coalesce((api.t(p,'to'))::date, current_date); a text := uid::text;
begin
  if p_action in ('FIN_SUMMARY','FIN_TRIAL_BALANCE','FIN_LEDGER','FIN_ENTRIES','FIN_ENTRY','FIN_CHEQUES','FIN_CHEQUE','FIN_ACCOUNTS','FIN_RECEIPTS') then
    if not core.can(uid,'finance.view') then return api.err('غير مسموح.'); end if;
  end if;
  if p_action = 'FIN_SUMMARY' then
    return api.ok(jsonb_build_object(
      'cash', (select coalesce(sum(debit-credit),0) from finance.lines where account = '1101'),
      'bank', (select coalesce(sum(debit-credit),0) from finance.lines where account = '1102'),
      'custody', (select coalesce(sum(debit-credit),0) from finance.lines where account = '1103'),
      'openCustody', coalesce((select jsonb_agg(jsonb_build_object('party', coalesce(p2.full_name, cb.party), 'balance', cb.balance) order by cb.balance desc)
         from treasury.custody_balances cb left join core.persons p2 on p2.id = cb.person_id), '[]'),
      'unsettled', (select count(*) from treasury.cheques where requires_settlement and status = 'صادر'),
      'year', jsonb_build_object(
        'revenue', (select coalesce(sum(l.credit-l.debit),0) from finance.lines l join finance.entries e on e.id=l.entry_id join finance.accounts ac on ac.code=l.account
                    where ac.type='إيرادات' and e.entry_date between v_from and v_to),
        'expense', (select coalesce(sum(l.debit-l.credit),0) from finance.lines l join finance.entries e on e.id=l.entry_id join finance.accounts ac on ac.code=l.account
                    where ac.type='مصروفات' and e.entry_date between v_from and v_to)),
      'byGroup', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name, 'amount', g.amt) order by g.code) from (
          select ac2.code, ac2.name, sum(l.debit-l.credit) amt from finance.lines l join finance.entries e on e.id=l.entry_id
          join finance.accounts ac on ac.code=l.account join finance.accounts ac2 on ac2.code = coalesce(ac.parent, ac.code)
          where ac.type='مصروفات' and e.entry_date between v_from and v_to group by 1,2) g), '[]'),
      'from', v_from, 'to', v_to));
  elsif p_action = 'FIN_ACCOUNTS' then
    return api.ok(jsonb_build_object('items', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'parent', parent, 'type', type,
      'postable', postable, 'balance', (select coalesce(sum(debit-credit),0) from finance.lines where account = a2.code)) order by code) from finance.accounts a2 where active)));
  elsif p_action = 'FIN_TRIAL_BALANCE' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(t)) from finance.trial_balance(v_from, v_to) t), '[]'), 'from', v_from, 'to', v_to));
  elsif p_action = 'FIN_LEDGER' then
    return api.ok(jsonb_build_object('account', (select to_jsonb(x) from finance.accounts x where code = api.t(p,'account')),
      'opening', (select coalesce(sum(l.debit-l.credit),0) from finance.lines l join finance.entries e on e.id=l.entry_id
                  where l.account = api.t(p,'account') and e.entry_date < v_from),
      'items', coalesce((select jsonb_agg(jsonb_build_object('entry_id', e.id, 'entry_no', e.entry_no, 'date', e.entry_date, 'description', e.description,
          'debit', l.debit, 'credit', l.credit, 'party', coalesce(pp.full_name, l.party), 'memo', l.memo, 'status', e.status) order by e.entry_date, e.entry_no)
        from finance.lines l join finance.entries e on e.id=l.entry_id left join core.persons pp on pp.id = l.person_id
        where l.account = api.t(p,'account') and e.entry_date between v_from and v_to), '[]'), 'from', v_from, 'to', v_to));
  elsif p_action = 'FIN_ENTRIES' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(x order by x.entry_date desc, x.entry_no desc) from (
      select e.id, e.entry_no, e.entry_date, e.description, e.source, e.status, (select sum(debit) from finance.lines where entry_id = e.id) total
      from finance.entries e where e.entry_date between v_from and v_to
        and (api.t(p,'q') is null or e.description ilike '%' || api.t(p,'q') || '%' or e.entry_no = api.t(p,'q'))
      order by e.entry_date desc, e.entry_no desc limit least(coalesce((p->>'limit')::int, 200), 500)) x), '[]')));
  elsif p_action = 'FIN_ENTRY' then
    return api.ok(jsonb_build_object('entry', (select to_jsonb(e) || jsonb_build_object(
      'decision', (select jsonb_build_object('decision_no', d.decision_no, 'text', d.text) from governance.decisions d where d.id = e.decision_id),
      'lines', (select jsonb_agg(jsonb_build_object('account', l.account, 'name', ac.name, 'debit', l.debit, 'credit', l.credit,
         'party', coalesce(pp.full_name, l.party), 'memo', l.memo, 'cost_center', l.cost_center) order by l.id)
       from finance.lines l join finance.accounts ac on ac.code = l.account left join core.persons pp on pp.id = l.person_id where l.entry_id = e.id))
      from finance.entries e where e.id = (p->>'id')::uuid)));
  elsif p_action = 'FIN_CHEQUES' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(x order by x.issue_date desc) from (
      select c.id, c.cheque_no, c.issue_date, c.amount, c.payee_name, c.purpose, c.status, c.requires_settlement,
        (select decision_no from governance.decisions where id = c.decision_id) decision_no, c.notes
      from treasury.cheques c where c.issue_date between v_from and v_to
        and (api.t(p,'status') is null or c.status = api.t(p,'status')) and (api.t(p,'purpose') is null or c.purpose = api.t(p,'purpose'))
        and (api.t(p,'q') is null or c.payee_name ilike '%' || api.t(p,'q') || '%' or c.cheque_no = api.t(p,'q') or c.notes ilike '%' || api.t(p,'q') || '%')
      order by c.issue_date desc limit 500) x), '[]')));
  elsif p_action = 'FIN_CHEQUE' then
    return api.ok(jsonb_build_object('cheque', (select to_jsonb(c) || jsonb_build_object(
      'decision', (select jsonb_build_object('decision_no', d.decision_no, 'text', d.text) from governance.decisions d where d.id = c.decision_id),
      'settlement', (select to_jsonb(s) || jsonb_build_object('lines', (select jsonb_agg(to_jsonb(sl) order by sl.line_no) from treasury.settlement_lines sl where sl.settlement_id = s.id))
                     from treasury.settlements s where s.cheque_id = c.id)) from treasury.cheques c where c.id = (p->>'id')::uuid)));
  elsif p_action = 'FIN_RECEIPTS' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(r) - 'legacy_ref' order by r.receipt_date desc)
      from treasury.receipts r where r.receipt_date between v_from and v_to and (api.t(p,'kind') is null or r.kind = api.t(p,'kind'))), '[]')));

  -- ── كتابة ──
  elsif p_action = 'FIN_ISSUE_CHEQUE' then
    if not core.can(uid,'treasury.cheque.issue', (p->>'amount')::numeric) then return api.err('غير مسموح أو المبلغ يتجاوز حد اعتمادك.'); end if;
    if coalesce((core.setting('FIN_REQUIRE_DECISION'))::text,'true') = 'true' and api.t(p,'decision_id') is null and p->>'purpose' <> 'منحة' then
      return api.err('الصرف لازم يكون بقرار مجلس — اختر القرار.'); end if;
    v_id := treasury.issue_cheque(p - 'legacy_ref', a);
    return api.ok(jsonb_build_object('id', v_id));
  elsif p_action = 'FIN_SETTLE' then
    if not core.can(uid,'treasury.settlement') then return api.err('غير مسموح.'); end if;
    v_id := treasury.settle((p - 'legacy_ref') - 'legacy', a);
    return api.ok(jsonb_build_object('id', v_id));
  elsif p_action = 'FIN_RECEIPT' then
    if not core.can(uid,'treasury.receipt') then return api.err('غير مسموح.'); end if;
    v_id := treasury.receive(p - 'legacy_ref', a);
    return api.ok(jsonb_build_object('id', v_id, 'receipt_no', (select receipt_no from treasury.receipts where id = v_id)));
  elsif p_action = 'FIN_REVERSE' then
    if not core.can(uid,'finance.journal') then return api.err('غير مسموح.'); end if;
    v_id := finance.reverse((p->>'id')::uuid, coalesce((api.t(p,'date'))::date, current_date), api.t(p,'reason'), a);
    return api.ok(jsonb_build_object('id', v_id));
  elsif p_action = 'FIN_JOURNAL' then
    if not core.can(uid,'finance.journal') then return api.err('غير مسموح.'); end if;
    if api.t(p,'description') is null then return api.err('البيان مطلوب.'); end if;
    v_id := finance.post(jsonb_build_object('date', p->>'date', 'description', p->>'description', 'source', 'يدوي',
      'decision_id', p->>'decision_id', 'lines', p->'lines'), a);
    return api.ok(jsonb_build_object('id', v_id));
  elsif p_action = 'FIN_CLOSE_PERIOD' then
    if not core.can(uid,'finance.period.close') then return api.err('غير مسموح.'); end if;
    insert into finance.periods(year, month, status, closed_by, closed_at) values ((p->>'year')::int, (p->>'month')::int, 'مقفولة', a, now())
    on conflict (year, month) do update set status = 'مقفولة', closed_by = a, closed_at = now();
    return api.ok();
  elsif p_action = 'FIN_SAVE_COST_CENTER' then
    if not core.can(uid,'finance.cost_centers') and not core.can(uid,'finance.journal') then return api.err('غير مسموح.'); end if;
    insert into finance.cost_centers(code, name, kind, decision_id) values (upper(api.t(p,'code')), api.t(p,'name'), coalesce(api.t(p,'kind'),'نشاط'),
      (nullif(p->>'decision_id',''))::uuid)
    on conflict (code) do update set name = excluded.name, kind = excluded.kind, decision_id = excluded.decision_id;
    return api.ok();
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- ── نقل الماليات من MyNekaba: قائمة عمليات مرتبة {op: cheque|settle|receive|opening, ...} ──
create or replace function api.import_finance(p jsonb, uid uuid) returns jsonb language plpgsql as $$
declare o jsonb; n_ok int := 0; errs jsonb := '[]'; a text := uid::text;
begin
  perform set_config('erp.reason', 'نقل الماليات من MyNekaba', true);
  for o in select * from jsonb_array_elements(p->'ops') loop
    begin
      case o->>'op'
        when 'opening' then perform finance.post(o || jsonb_build_object('source','افتتاحي'), a);
        when 'cheque'  then perform treasury.issue_cheque(o, a);
        when 'settle'  then perform treasury.settle(o || '{"legacy":true}', a);
        when 'receive' then perform treasury.receive(o, a);
        else raise exception 'عملية غير معروفة';
      end case;
      n_ok := n_ok + 1;
    exception when others then
      errs := errs || jsonb_build_object('op', o->>'op', 'legacy_ref', o->>'legacy_ref', 'error', sqlerrm);
    end;
  end loop;
  return api.ok(jsonb_build_object('ok', n_ok, 'errors', errs));
end $$;

-- ── الموجّه (كل الفروع) ──
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  if p_action like 'IMPORT\_%' or p_action like 'GOV\_%' or p_action like 'FIN\_%' then
    uid := api.session_user(s);
    if uid is null then return api.err('انتهت الجلسة. سجّل الدخول مرة أخرى.') || '{"expired":true}'; end if;
    perform set_config('erp.reason', coalesce(p->>'reason', ''), true);
    if p_action in ('IMPORT_GOVERNANCE','IMPORT_FINANCE') then
      if not core.can(uid,'data.import') then return api.err('غير مسموح.'); end if;
      if p_action = 'IMPORT_GOVERNANCE' then return api.import_governance(p); end if;
      return api.import_finance(p, uid);
    elsif p_action like 'IMPORT\_%' then return api.handle_import(p_action, p, uid);
    elsif p_action like 'GOV\_%' then return api.handle_governance(p_action, p, uid);
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
revoke all on all functions in schema api, finance, treasury from public, anon, authenticated;
