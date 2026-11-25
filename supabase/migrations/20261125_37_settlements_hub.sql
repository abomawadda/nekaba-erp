-- المرحلة 30 (تكملة ومراجعة كل القارئين): توحيد قارئي التسويات + شاشة التسويات المركزية (FIN_SETTLEMENTS)
-- المراجعة شملت: treasury.settle / settle_reverse · finance.policy_stl_trg · benefits.from_settlement_line
--                · api.handle_bank (إلغاء الشيك) · api.handle_finance (FIN_CHEQUE / FIN_SETTLE_HELP / FIN_SETTLEMENTS)
--                · مطابقة صاحب العهدة حتى لو شيك قديم بلا payee_person_id · حفظ شيكات المسودة في settlement_cheques

alter table treasury.settlements add column if not exists decision_id uuid references governance.decisions(id);
create index if not exists settlements_decision_idx on treasury.settlements(decision_id);

alter table treasury.settlement_cheques
  drop constraint settlement_cheques_settlement_id_fkey,
  add constraint settlement_cheques_settlement_id_fkey foreign key (settlement_id) references treasury.settlements(id) on delete cascade;

-- مطابقة صاحب العهدة (تتعامل بأمان مع الشيكات المنقولة التي قد يخلو بعضها من payee_person_id)
create or replace function treasury.same_custodian(p1 uuid, n1 text, p2 uuid, n2 text) returns boolean language sql immutable as $$
  select (p1 is not null and p2 is not null and p1 = p2)
      or ((p1 is null or p2 is null) and trim(coalesce(n1,'')) <> '' and trim(coalesce(n1,'')) = trim(coalesce(n2,'')))
$$;

-- المسودة التي تغطي شيكاً (أساسياً أو ضمن مجموعة)
create or replace function treasury.cheque_draft(p_cheque uuid) returns uuid language sql stable
set search_path to 'core','public','extensions','pg_temp' as $$
  select s.id from treasury.settlement_cheques sc join treasury.settlements s on s.id = sc.settlement_id
  where sc.cheque_id = p_cheque and s.status = 'مسودة' limit 1
$$;

-- ── التسوية (مسودة أو اعتماد — تجميع شيكات + ترحيل تلقائي) ──
create or replace function treasury.settle(p jsonb, p_actor text) returns uuid language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare c treasury.cheques; g treasury.cheques; fc treasury.cheques; v_from treasury.settlements;
        v_id uuid; v_cur_draft uuid; v_entry uuid; l jsonb; i int := 0; v_spent numeric := 0; v_x text;
        v_sub numeric := coalesce((nullif(p->>'subscriptions',''))::numeric,0);
        v_ret numeric := coalesce((nullif(p->>'returned',''))::numeric,0);
        v_prev numeric := 0; v_adv numeric; v_mode text := coalesce(nullif(p->>'return_mode',''),'لا يوجد'); v_carry numeric;
        lines jsonb := '[]'; v_acc text; v_ids uuid[]; v_nos text; v_pid uuid; v_dec uuid := (nullif(p->>'decision_id',''))::uuid;
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

  v_cur_draft := treasury.cheque_draft(c.id);
  if v_cur_draft is not null and (select cheque_id from treasury.settlements where id = v_cur_draft) <> c.id then
    p := p || jsonb_build_object('cheque_ids', coalesce(p->'cheque_ids','[]'::jsonb) || to_jsonb(c.id::text));
    select * into c from treasury.cheques where id = (select cheque_id from treasury.settlements where id = v_cur_draft) for update;
  end if;

  -- المجموعة: شيكات عهدة أخرى لنفس صاحب العهدة تُسوّى وتُقفل معاً
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

  -- الترحيل الآلي: الرصيد يُجلب من التسوية السابقة لنفس صاحب العهدة
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

  -- ── المسودة: تُحفظ مع شيكاتها بلا قيد ولا مزايا ──
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

  -- ── الاعتماد ──
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
  return v_id;
end $$;

-- ── فحص اللائحة المالية على بنود التسوية: يرى قرار التسوية أو أي شيك في المجموعة ──
create or replace function finance.policy_stl_trg() returns trigger language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare m text; v_enf text; s treasury.settlements; v_has_dec boolean;
begin
  select * into s from treasury.settlements where id = new.settlement_id;
  if s.legacy_ref is not null then return new; end if;
  v_has_dec := s.decision_id is not null or exists (
    select 1 from treasury.settlement_cheques sc join treasury.cheques x on x.id = sc.cheque_id
    where sc.settlement_id = s.id and x.decision_id is not null);
  m := finance.policy_check(new.account, new.amount, s.settle_date, v_has_dec);
  select enforce into v_enf from finance.policy where account = new.account;
  if m is not null and v_enf = 'منع' then raise exception '%', m using errcode = 'check_violation'; end if;
  return new;
end $$;

-- ── تغذية سجل المزايا من بنود التسوية: يسجّل أرقام كل شيكات المجموعة وقرارها ──
create or replace function benefits.from_settlement_line() returns trigger language plpgsql
set search_path to 'core','public','extensions','pg_temp' as $$
declare b jsonb; n int; i int := 0; share numeric; v_pid uuid; s treasury.settlements; v_kind text;
        n_amt int; v_sum numeric; v_nos text; v_cnt int; v_dec uuid;
begin
  if (case when jsonb_typeof(new.beneficiaries) = 'array' then jsonb_array_length(new.beneficiaries) else 0 end) = 0 then return new; end if;
  select * into s from treasury.settlements where id = new.settlement_id;
  select count(*), string_agg(coalesce(x.cheque_no,'بدون رقم'), ' + ' order by x.issue_date, x.cheque_no),
         coalesce(s.decision_id, (array_agg(x.decision_id) filter (where x.decision_id is not null))[1])
    into v_cnt, v_nos, v_dec
  from treasury.settlement_cheques sc join treasury.cheques x on x.id = sc.cheque_id where sc.settlement_id = s.id;
  n := jsonb_array_length(new.beneficiaries);
  select count(*) filter (where coalesce((nullif(x->>'amount',''))::numeric,0) > 0), coalesce(sum((nullif(x->>'amount',''))::numeric),0)
    into n_amt, v_sum from jsonb_array_elements(new.beneficiaries) x;
  if n_amt > 0 and (n_amt <> n or round(v_sum,2) <> round(new.amount,2)) then
    raise exception 'أنصبة المستفيدين في بند «%» لازم تتحدد كلها ومجموعها (%) = قيمة البند (%).', new.category, v_sum, new.amount;
  end if;
  share := round(new.amount / n, 2);
  v_kind := case when new.category like 'بدل%' then 'بدل' when new.category like '%جوائز%' or new.category like '%جائزة%' then 'جائزة' else 'ميزة عينية' end;
  for b in select * from jsonb_array_elements(new.beneficiaries) loop
    i := i + 1;
    v_pid := coalesce((nullif(b->>'person_id',''))::uuid, api.pid_by_job(b->>'job_id'));
    if v_pid is null then raise exception 'مستفيد غير معروف في بند «%»: %', new.category, coalesce(b->>'job_id', b->>'person_id'); end if;
    perform benefits.record(v_pid, coalesce(new.doc_date, s.settle_date), v_kind, new.category,
      case when n_amt > 0 then (b->>'amount')::numeric when i = n then new.amount - share * (n - 1) else share end,
      'الخزينة', 'STL:' || new.settlement_id || ':' || new.line_no,
      'تسوية ' || case when v_cnt > 1 then 'شيكات ' else 'شيك ' end || coalesce(v_nos, 'بدون رقم'), v_dec, new.notes);
  end loop;
  return new;
end $$;

-- ── تحديث الواجهات القارئة: FIN_SETTLEMENTS + FIN_CHEQUE + FIN_SETTLE_HELP + BANK_CHEQUE_VOID ──
do $do$
declare d text;
  a_perm text := $a$'FIN_CHEQUE','FIN_ACCOUNTS','FIN_RECEIPTS'$a$;
  a_chq  text := $a$(select x.id from treasury.settlements x where x.cheque_id = c.id and x.status = 'مسودة')$a$;
  a_help text := $a$  elsif p_action = 'FIN_SETTLE_HELP' then$a$;
  a_rev  text := $a$  elsif p_action = 'FIN_SETTLE_REVERSE' then$a$;
begin
  d := pg_get_functiondef('api.handle_finance(text,jsonb,uuid)'::regprocedure);
  if position(a_perm in d) = 0 or position(a_chq in d) = 0 or position(a_help in d) = 0 or position(a_rev in d) = 0 then
    raise exception 'مرساة handle_finance غير موجودة'; end if;
  d := replace(d, a_perm, a_perm || $b$,'FIN_SETTLEMENTS'$b$);
  d := replace(d, a_chq, $b$treasury.cheque_draft(c.id)$b$);
  -- استبدال FIN_SETTLE_HELP وإضافة FIN_SETTLEMENTS
  d := substr(d, 1, position(a_help in d) - 1) || $b$  elsif p_action = 'FIN_SETTLEMENTS' then
    return api.ok(jsonb_build_object(
      'open', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'cheque_no', c.cheque_no, 'issue_date', c.issue_date, 'amount', c.amount,
          'payee_name', c.payee_name, 'purpose', c.purpose, 'status', c.status, 'notes', c.notes,
          'draft_id', treasury.cheque_draft(c.id)) order by c.issue_date)
        from treasury.cheques c where c.requires_settlement and c.status in ('صادر','مرحّل الرصيد')), '[]'),
      'drafts', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'cheque_id', s.cheque_id, 'settle_date', s.settle_date,
          'payee_name', c.payee_name, 'advance', s.advance, 'prev_balance', s.prev_balance, 'spent', s.spent, 'updated_at', s.created_at,
          'cheques', (select jsonb_agg(jsonb_build_object('id', x.id, 'cheque_no', x.cheque_no, 'amount', sc.amount) order by x.issue_date)
            from treasury.settlement_cheques sc join treasury.cheques x on x.id = sc.cheque_id where sc.settlement_id = s.id)) order by s.created_at desc)
        from treasury.settlements s join treasury.cheques c on c.id = s.cheque_id where s.status = 'مسودة'), '[]'),
      'carries', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'cheque_id', c.id, 'cheque_no', c.cheque_no, 'payee_name', c.payee_name,
          'settle_date', s.settle_date, 'amount', treasury.settlement_carry(s)) order by s.settle_date)
        from treasury.settlements s join treasury.cheques c on c.id = s.cheque_id
        where s.status = 'معتمدة' and s.return_mode = 'ترحيل' and c.status = 'مرحّل الرصيد' and treasury.settlement_carry(s) > 0.005
          and not exists (select 1 from treasury.settlements n where n.carried_from = s.id and n.status = 'معتمدة')), '[]'),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'cheque_id', s.cheque_id, 'settle_date', s.settle_date,
          'payee_name', c.payee_name, 'advance', s.advance, 'prev_balance', s.prev_balance, 'subscriptions', s.subscriptions,
          'spent', s.spent, 'returned', s.returned, 'return_mode', s.return_mode, 'status', s.status,
          'entry_id', s.entry_id, 'reverse_entry_id', s.reverse_entry_id, 'reverse_reason', s.reverse_reason,
          'carried_from_no', (select fc.cheque_no from treasury.settlements f join treasury.cheques fc on fc.id = f.cheque_id where f.id = s.carried_from),
          'cheques', (select jsonb_agg(jsonb_build_object('id', x.id, 'cheque_no', x.cheque_no, 'amount', sc.amount) order by x.issue_date)
            from treasury.settlement_cheques sc join treasury.cheques x on x.id = sc.cheque_id where sc.settlement_id = s.id))
          order by s.settle_date desc, s.created_at desc)
        from treasury.settlements s join treasury.cheques c on c.id = s.cheque_id where s.status in ('معتمدة','مسترجعة')), '[]')));
  elsif p_action = 'FIN_SETTLE_HELP' then
    if not core.can(uid,'finance.view') then return api.err('غير مسموح.'); end if;
    return api.ok((select jsonb_build_object(
      'group', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'cheque_no', g.cheque_no, 'issue_date', g.issue_date, 'amount', g.amount, 'notes', g.notes)
          order by g.issue_date) from treasury.cheques g
        where g.id <> c.id and g.requires_settlement and g.status = 'صادر' and treasury.cheque_settlement(g.id) is null
          and (treasury.cheque_draft(g.id) is null or treasury.cheque_draft(g.id) = treasury.cheque_draft(c.id))
          and treasury.same_custodian(g.payee_person_id, g.payee_name, c.payee_person_id, c.payee_name)), '[]'),
      'carry', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'settle_date', s.settle_date, 'cheque_no', fc.cheque_no,
            'amount', treasury.settlement_carry(s)) order by s.settle_date) from treasury.settlements s join treasury.cheques fc on fc.id = s.cheque_id
        where s.status = 'معتمدة' and s.return_mode = 'ترحيل' and fc.status = 'مرحّل الرصيد' and treasury.settlement_carry(s) > 0.005
          and not exists (select 1 from treasury.settlements n where n.carried_from = s.id and n.status = 'معتمدة')
          and treasury.same_custodian(fc.payee_person_id, fc.payee_name, c.payee_person_id, c.payee_name)), '[]'))
      from treasury.cheques c where c.id = (p->>'cheque_id')::uuid));
$b$ || substr(d, position(a_rev in d));
  execute d;

  d := pg_get_functiondef('api.handle_bank(text,jsonb,uuid)'::regprocedure);
  if position('treasury.cheque_settlement(c.id) is not null' in d) = 0 then raise exception 'مرساة handle_bank غير موجودة'; end if;
  d := replace(d,
    $$if treasury.cheque_settlement(c.id) is not null then return api.err('الشيك عليه تسوية.'); end if;$$,
    $$if treasury.cheque_settlement(c.id) is not null or treasury.cheque_draft(c.id) is not null then return api.err('الشيك عليه تسوية أو مسودة تسوية.'); end if;$$);
  execute d;
end $do$;

revoke all on all functions in schema treasury from public, anon, authenticated;
revoke all on all functions in schema finance from public, anon, authenticated;
revoke all on all functions in schema benefits from public, anon, authenticated;
revoke all on all functions in schema api from public, anon, authenticated;
