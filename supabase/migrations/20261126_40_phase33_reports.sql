-- المرحلة 33: تقارير تسوية السلف والعهد (المفردة والمجمّعة) وكشف حساب العمليات والشيكات وتقرير الجمعية العمومية (النقابة العامة)

-- 1) تفاصيل تسوية سلفة / عهدة (مفردة أو مجمّعة) شاملة الشيكات والبنود والحسابات والمستفيدين والأرصدة المتبقية
create or replace function api.settlement_json(p_id uuid) returns jsonb language plpgsql stable
set search_path to 'core','public','extensions','pg_temp' as $$
declare s treasury.settlements; c treasury.cheques; v_lines jsonb; v_by_acc jsonb; v_chqs jsonb;
begin
  select * into s from treasury.settlements where id = p_id;
  if s.id is null then return null; end if;
  select * into c from treasury.cheques where id = s.cheque_id;

  -- شيكات التسوية (يدعم التسوية المفردة والمجمّعة والبيانات المرحّلة قديماً)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'cheque_no', x.cheque_no, 'issue_date', x.issue_date, 'amount', coalesce(sc.amount, x.amount),
      'purpose', x.purpose, 'notes', x.notes, 'status', x.status, 'cleared_date', x.cleared_date,
      'decision_no', (select d.decision_no from governance.decisions d where d.id = x.decision_id)
    ) order by x.issue_date, x.cheque_no), '[]'::jsonb)
  into v_chqs
  from treasury.settlement_cheques sc
  join treasury.cheques x on x.id = sc.cheque_id
  where sc.settlement_id = s.id;

  if jsonb_array_length(v_chqs) = 0 and c.id is not null then
    v_chqs := jsonb_build_array(jsonb_build_object(
      'id', c.id, 'cheque_no', c.cheque_no, 'issue_date', c.issue_date, 'amount', c.amount,
      'purpose', c.purpose, 'notes', c.notes, 'status', c.status, 'cleared_date', c.cleared_date,
      'decision_no', (select d.decision_no from governance.decisions d where d.id = c.decision_id)
    ));
  end if;

  -- البنود المسوّاة (من settlement_lines، أو من draft لو كانت مسودة)
  if s.status = 'مسودة' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'line_no', ord,
        'category', coalesce(nullif(l->>'category',''), 'أخرى'),
        'account', coalesce(nullif(l->>'account',''), (select account from finance.category_map where category = l->>'category'), '5501'),
        'account_name', (select name from finance.accounts where code = coalesce(nullif(l->>'account',''), (select account from finance.category_map where category = l->>'category'), '5501')),
        'amount', coalesce((nullif(l->>'amount',''))::numeric, 0),
        'notes', l->>'notes',
        'beneficiaries_list', '[]'::jsonb
      ) order by ord), '[]'::jsonb)
    into v_lines
    from jsonb_array_elements(coalesce(s.draft->'lines', '[]'::jsonb)) with ordinality as t(l, ord)
    where coalesce((nullif(l->>'amount',''))::numeric, 0) > 0;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
        'line_no', sl.line_no,
        'category', sl.category,
        'account', sl.account,
        'account_name', coalesce(ac.name, sl.account),
        'amount', sl.amount,
        'doc_date', sl.doc_date,
        'notes', sl.notes,
        'beneficiaries_list', coalesce((
          select jsonb_agg(jsonb_build_object(
            'job_id', coalesce(pe.job_id, b->>'job_id'),
            'full_name', coalesce(pe.full_name, b->>'job_id', 'مستفيد'),
            'amount', (nullif(b->>'amount',''))::numeric
          ))
          from jsonb_array_elements(case when jsonb_typeof(sl.beneficiaries) = 'array' then sl.beneficiaries else '[]'::jsonb end) b
          left join core.persons pe on pe.id = coalesce((nullif(b->>'person_id',''))::uuid, api.pid_by_job(b->>'job_id'))
        ), '[]'::jsonb)
      ) order by sl.line_no), '[]'::jsonb)
    into v_lines
    from treasury.settlement_lines sl
    left join finance.accounts ac on ac.code = sl.account
    where sl.settlement_id = s.id;
  end if;

  -- تجميع محاسبي حسب الحساب
  select coalesce(jsonb_agg(jsonb_build_object('account', q.acc, 'account_name', q.aname, 'total', q.tot, 'lines_count', q.cnt) order by q.acc), '[]'::jsonb)
  into v_by_acc
  from (
    select x->>'account' as acc, max(x->>'account_name') as aname, sum((x->>'amount')::numeric) as tot, count(*) as cnt
    from jsonb_array_elements(v_lines) x
    group by x->>'account'
  ) q;

  return to_jsonb(s) - 'draft' || jsonb_build_object(
    'payee_name', c.payee_name,
    'custodian', case when c.payee_person_id is not null then
      (select jsonb_build_object('id', id, 'full_name', full_name, 'job_id', job_id, 'workplace', workplace, 'phone', phone)
       from core.person_current where id = c.payee_person_id) end,
    'entry_no', (select entry_no from finance.entries where id = s.entry_id),
    'reverse_entry_no', (select entry_no from finance.entries where id = s.reverse_entry_id),
    'decision', (select jsonb_build_object('decision_no', d.decision_no, 'text', d.text)
                 from governance.decisions d where d.id = coalesce(s.decision_id, c.decision_id)),
    'created_by_name', api.actor_label(s.created_by),
    'reversed_by_name', api.actor_label(s.reversed_by),
    'carried_from_info', case when s.carried_from is not null then
      (select jsonb_build_object('id', f.id, 'settle_date', f.settle_date, 'cheque_no', fc.cheque_no, 'amount', s.prev_balance)
       from treasury.settlements f join treasury.cheques fc on fc.id = f.cheque_id where f.id = s.carried_from) end,
    'carried_to_info', (select jsonb_build_object('id', nx.id, 'settle_date', nx.settle_date, 'cheque_no', nc.cheque_no)
                        from treasury.settlements nx join treasury.cheques nc on nc.id = nx.cheque_id
                        where nx.carried_from = s.id and nx.status = 'معتمدة' limit 1),
    'available_total', round(coalesce(s.advance,0) + coalesce(s.prev_balance,0) + coalesce(s.subscriptions,0), 2),
    'remaining_balance', round(coalesce(s.advance,0) + coalesce(s.prev_balance,0) + coalesce(s.subscriptions,0) - coalesce(s.spent,0) - coalesce(s.returned,0), 2),
    'is_grouped', jsonb_array_length(v_chqs) > 1,
    'cheques', v_chqs,
    'lines', v_lines,
    'by_account', v_by_acc
  );
end $$;

-- 2) كشف حساب العمليات والشيكات البنكية خلال فترة محددة
create or replace function api.ops_statement(p jsonb) returns jsonb language plpgsql stable
set search_path to 'core','public','extensions','pg_temp' as $$
declare v_from date := coalesce((nullif(p->>'from',''))::date, make_date(extract(year from current_date)::int, 1, 1));
        v_to date := coalesce((nullif(p->>'to',''))::date, current_date);
        v_acc text := coalesce(nullif(trim(p->>'account'),''), '1102');
        v_accs text[];
        v_lbl text;
        v_open numeric; v_dr numeric; v_cr numeric; v_close numeric;
        v_unc_chq_cnt int := 0; v_unc_chq_amt numeric := 0; v_unc_dep_amt numeric := 0;
begin
  if v_acc = 'ALL' then
    v_accs := array['1101','1102'];
    v_lbl := 'إجمالي النقدية بالبنك والخزينة (1101 + 1102)';
  else
    v_accs := array[v_acc];
    select code || ' — ' || name into v_lbl from finance.accounts where code = v_acc;
    v_lbl := coalesce(v_lbl, v_acc);
  end if;

  select coalesce(sum(case when e.entry_date < v_from then l.debit - l.credit else 0 end), 0),
         coalesce(sum(case when e.entry_date between v_from and v_to then l.debit else 0 end), 0),
         coalesce(sum(case when e.entry_date between v_from and v_to then l.credit else 0 end), 0)
    into v_open, v_dr, v_cr
  from finance.lines l
  join finance.entries e on e.id = l.entry_id
  where l.account = any(v_accs) and e.entry_date <= v_to;

  v_close := v_open + v_dr - v_cr;

  if '1102' = any(v_accs) then
    select count(*), coalesce(sum(amount), 0)
      into v_unc_chq_cnt, v_unc_chq_amt
    from treasury.cheques
    where bank_account = '1102' and status <> 'ملغى'
      and issue_date <= v_to and (cleared_date is null or cleared_date > v_to);

    select coalesce(sum(amount), 0) into v_unc_dep_amt
    from treasury.receipts
    where cash_account = '1102' and receipt_date <= v_to and (cleared_date is null or cleared_date > v_to);
  end if;

  return jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'account', v_acc,
    'account_label', v_lbl,
    'opening', v_open,
    'total_debit', v_dr,
    'total_credit', v_cr,
    'closing', v_close,
    'uncleared_cheques_count', v_unc_chq_cnt,
    'uncleared_cheques_total', v_unc_chq_amt,
    'uncleared_deposits_total', v_unc_dep_amt,
    'expected_bank_balance', v_close + v_unc_chq_amt - v_unc_dep_amt,
    'operations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entry_id', e.id,
        'entry_no', e.entry_no,
        'date', e.entry_date,
        'source', e.source,
        'status', e.status,
        'account', l.account,
        'account_name', ac.name,
        'description', e.description,
        'party', coalesce(pp.full_name, l.party),
        'memo', l.memo,
        'debit', l.debit,
        'credit', l.credit,
        'doc_ref', case
          when e.source = 'شيك' then (select coalesce(ch.cheque_no, 'شيك') from treasury.cheques ch where ch.id = e.source_ref)
          when e.source = 'إيصال' then (select rc.receipt_no from treasury.receipts rc where rc.id = e.source_ref)
          else null end
      ) order by e.entry_date, e.entry_no, l.id)
      from finance.lines l
      join finance.entries e on e.id = l.entry_id
      join finance.accounts ac on ac.code = l.account
      left join core.persons pp on pp.id = l.person_id
      where l.account = any(v_accs) and e.entry_date between v_from and v_to
    ), '[]'::jsonb),
    'cheques', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'cheque_no', c.cheque_no,
        'issue_date', c.issue_date,
        'payee_name', c.payee_name,
        'purpose', c.purpose,
        'expense_account', case when c.requires_settlement then '1103' else c.expense_account end,
        'account_name', case when c.requires_settlement then 'عُهد تحت التسوية' else (select name from finance.accounts where code = c.expense_account) end,
        'decision_no', (select decision_no from governance.decisions where id = c.decision_id),
        'status', c.status,
        'cleared_date', c.cleared_date,
        'amount', c.amount,
        'notes', c.notes
      ) order by c.issue_date, c.cheque_no)
      from treasury.cheques c
      where c.issue_date between v_from and v_to
    ), '[]'::jsonb),
    'cheques_summary', (
      select jsonb_build_object(
        'total_count', count(*),
        'valid_count', count(*) filter (where status <> 'ملغى'),
        'valid_amount', coalesce(sum(amount) filter (where status <> 'ملغى'), 0),
        'cleared_count', count(*) filter (where status <> 'ملغى' and cleared_date is not null),
        'cleared_amount', coalesce(sum(amount) filter (where status <> 'ملغى' and cleared_date is not null), 0),
        'uncleared_count', count(*) filter (where status <> 'ملغى' and cleared_date is null),
        'uncleared_amount', coalesce(sum(amount) filter (where status <> 'ملغى' and cleared_date is null), 0),
        'voided_count', count(*) filter (where status = 'ملغى'),
        'voided_amount', coalesce(sum(amount) filter (where status = 'ملغى'), 0)
      )
      from treasury.cheques
      where issue_date between v_from and v_to
    )
  );
end $$;

-- 3) تقرير وكشف الجمعية العمومية (النقابة العامة)
create or replace function api.general_assembly_report(p jsonb) returns jsonb language plpgsql stable
set search_path to 'core','public','extensions','pg_temp' as $$
declare v_state text := coalesce(nullif(trim(p->>'member_state'),''), 'نشط');
        v_wp text := nullif(trim(p->>'workplace'),'');
        v_active int; v_gen_all int; v_ret int; v_tot int;
begin
  select count(*),
         count(*) filter (where union_org = 'النقابة العامة'),
         count(*) filter (where union_org = 'النقابة العامة' and member_state = 'نشط'),
         count(*) filter (where union_org = 'النقابة العامة' and member_state = 'معاش')
    into v_tot, v_gen_all, v_active, v_ret
  from core.person_current;

  return jsonb_build_object(
    'as_of', current_date,
    'filter_state', v_state,
    'filter_workplace', v_wp,
    'total_registered', v_tot,
    'total_general_union', v_gen_all,
    'active_voting', v_active,
    'retired_general', v_ret,
    'quorum_first', (v_active / 2) + 1,
    'quorum_second', greatest(ceil(v_active * 0.25)::int, least(v_active, 20)),
    'completeness', (
      select jsonb_build_object(
        'with_nid', count(*) filter (where national_id is not null and trim(national_id) <> ''),
        'with_phone', count(*) filter (where phone is not null and trim(phone) <> ''),
        'with_hire', count(*) filter (where hire_date is not null)
      )
      from core.person_current
      where union_org = 'النقابة العامة' and (v_state = 'الكل' or member_state = v_state)
        and (v_wp is null or workplace = v_wp)
    ),
    'by_workplace', coalesce((
      select jsonb_agg(jsonb_build_object('workplace', coalesce(workplace, 'غير محدد'), 'count', n) order by n desc, workplace)
      from (
        select workplace, count(*) n
        from core.person_current
        where union_org = 'النقابة العامة' and (v_state = 'الكل' or member_state = v_state)
        group by workplace
      ) w
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'job_id', c.job_id,
        'full_name', c.full_name,
        'national_id', c.national_id,
        'workplace', c.workplace,
        'job_title', c.job_title,
        'grade', c.grade,
        'hire_date', c.hire_date,
        'phone', c.phone,
        'member_state', c.member_state
      ) order by coalesce(c.workplace,''), c.full_name)
      from core.person_current c
      where c.union_org = 'النقابة العامة'
        and (v_state = 'الكل' or c.member_state = v_state)
        and (v_wp is null or c.workplace = v_wp)
    ), '[]'::jsonb)
  );
end $$;

-- 4) تحديث موجّه التقارير api.handle_reports لدعم التقارير الجديدة
create or replace function api.handle_reports(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare v_sid uuid;
begin
  if p_action = 'REP_MEMBERS' then
    if not core.can(uid,'profile.view') then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object('report', api.member_list(p)));
  elsif p_action = 'REP_GENERAL_ASSEMBLY' then
    if not (core.can(uid,'profile.view') or core.can(uid,'reports.view') or core.can(uid,'governance.view')) then
      return api.err('غير مسموح.');
    end if;
    return api.ok(jsonb_build_object('report', api.general_assembly_report(p)));
  end if;

  if not (core.can(uid,'reports.view') or core.can(uid,'finance.view')) then return api.err('غير مسموح.'); end if;

  if p_action = 'REP_OVERVIEW' then
    return api.ok(jsonb_build_object('report', api.report_overview((nullif(p->>'year',''))::int)));
  elsif p_action = 'REP_BUDGET' then
    return api.ok(jsonb_build_object('report', api.budget_report(coalesce((nullif(p->>'year',''))::int, extract(year from now())::int)),
      'canEdit', core.can(uid,'finance.budget')));
  elsif p_action = 'REP_BUDGET_SAVE' then
    if not core.can(uid,'finance.budget') then return api.err('غير مسموح — تحتاج صلاحية إعداد الموازنة.'); end if;
    return api.budget_save(p, uid);
  elsif p_action = 'REP_SETTLEMENT' then
    if nullif(p->>'id','') is not null then
      v_sid := (p->>'id')::uuid;
    elsif nullif(p->>'chequeId','') is not null then
      v_sid := coalesce(treasury.cheque_settlement((p->>'chequeId')::uuid), treasury.cheque_draft((p->>'chequeId')::uuid));
    end if;
    if v_sid is not null then
      return api.ok(jsonb_build_object('settlement', api.settlement_json(v_sid)));
    end if;
    return api.ok(jsonb_build_object('items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'cheque_id', s.cheque_id, 'settle_date', s.settle_date, 'payee_name', c.payee_name,
        'advance', s.advance, 'prev_balance', s.prev_balance, 'spent', s.spent, 'returned', s.returned,
        'return_mode', s.return_mode, 'status', s.status,
        'cheques_count', greatest((select count(*) from treasury.settlement_cheques sc where sc.settlement_id = s.id), 1),
        'cheques_nos', coalesce((select string_agg(coalesce(x.cheque_no,'بدون رقم'), ' + ' order by x.issue_date)
                                 from treasury.settlement_cheques sc join treasury.cheques x on x.id = sc.cheque_id where sc.settlement_id = s.id), coalesce(c.cheque_no,'بدون رقم'))
      ) order by s.settle_date desc, s.created_at desc)
      from treasury.settlements s join treasury.cheques c on c.id = s.cheque_id
    ), '[]'::jsonb)));
  elsif p_action = 'REP_OPS_STATEMENT' then
    return api.ok(jsonb_build_object('report', api.ops_statement(p)));
  end if;

  return api.err('عملية غير معروفة: ' || p_action);
end $$;

revoke all on all functions in schema api from public, anon, authenticated;
