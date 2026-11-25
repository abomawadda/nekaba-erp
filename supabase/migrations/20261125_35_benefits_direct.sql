-- المرحلة 29 — مستفيدو التسوية بأنصبة محددة + الميزة المباشرة (يدوي بسند وقرار) + إلغاؤها بسبب
insert into core.permissions(code, module, name) values ('benefits.manage','benefits','تسجيل/إلغاء ميزة مباشرة') on conflict do nothing;
insert into core.role_permissions(role, permission) values ('TREASURER','benefits.manage'),('SYS_ADMIN','benefits.manage') on conflict do nothing;

-- بند التسوية: لو المستفيد له «amount» يؤخذ نصيبه كما هو (ولازم الأنصبة كلها محددة ومجموعها = قيمة البند)، وإلا القسمة بالتساوي
create or replace function benefits.from_settlement_line() returns trigger language plpgsql as $$
declare b jsonb; n int; i int := 0; share numeric; v_pid uuid; s treasury.settlements; c treasury.cheques; v_kind text;
        n_amt int; v_sum numeric;
begin
  if (case when jsonb_typeof(new.beneficiaries) = 'array' then jsonb_array_length(new.beneficiaries) else 0 end) = 0 then return new; end if;
  select * into s from treasury.settlements where id = new.settlement_id;
  select * into c from treasury.cheques where id = s.cheque_id;
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
      'تسوية شيك ' || coalesce(c.cheque_no, 'بدون رقم'), c.decision_id, new.notes);
  end loop;
  return new;
end $$;

-- عرض مزايا الشخص مع المرجع والمصدر (لإلغاء اليدوي)
create or replace function api.benefits_of(p_person uuid, p_year int default null) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total', coalesce(sum(amount), 0),
    'byKind', coalesce((select jsonb_object_agg(kind, t) from (select kind, sum(amount) t from benefits.all_benefits
        where person_id = p_person and status = 'فعّالة' and (p_year is null or extract(year from benefit_date) = p_year) group by kind) k), '{}'),
    'byYear', coalesce((select jsonb_agg(jsonb_build_object('year', y, 'total', t) order by y desc) from (select extract(year from benefit_date)::int y, sum(amount) t
        from benefits.all_benefits where person_id = p_person and status = 'فعّالة' group by 1) yy), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('date', benefit_date, 'kind', kind, 'category', category, 'amount', amount,
        'source', source_module, 'ref', source_ref, 'basis', basis, 'board_role', board_role, 'union_org', union_org, 'notes', notes) order by benefit_date desc)
      from benefits.all_benefits where person_id = p_person and status = 'فعّالة' and (p_year is null or extract(year from benefit_date) = p_year)), '[]'))
  from benefits.all_benefits where person_id = p_person and status = 'فعّالة' and (p_year is null or extract(year from benefit_date) = p_year)
$$;

-- BEN_ADD / BEN_CANCEL (الميزة المباشرة فقط؛ مزايا الخزينة تُلغى بعكس قيدها لا من هنا)
create or replace function api.benefit_manage(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql as $$
declare v_pid uuid; v_amt numeric := (nullif(p->>'amount',''))::numeric; v_ref text; v_id uuid; v_dec uuid := (nullif(p->>'decision_id',''))::uuid; n int;
begin
  if not core.can(uid,'benefits.manage') then return api.err('غير مسموح: يلزم صلاحية تسجيل المزايا.'); end if;
  if p_action = 'BEN_ADD' then
    v_pid := coalesce((nullif(p->>'person_id',''))::uuid, api.pid_by_job(p->>'job_id'));
    if v_pid is null then return api.err('العضو غير موجود.'); end if;
    if coalesce(v_amt,0) <= 0 then return api.err('القيمة لازم تكون أكبر من صفر.'); end if;
    if coalesce(p->>'kind','') not in ('منحة','دعم','إعفاء','خصم','بدل','جائزة','ميزة عينية') then return api.err('نوع الميزة غير صحيح.'); end if;
    if coalesce(trim(p->>'category'),'') = '' then return api.err('اكتب البند (مثلاً: خصم كتب، دعم مبادرة).'); end if;
    if coalesce(trim(p->>'basis'),'') = '' and v_dec is null then return api.err('لازم سند: رقم المستند/الكشف أو قرار المجلس.'); end if;
    if (nullif(p->>'date',''))::date is null or (p->>'date')::date > current_date then return api.err('تاريخ غير صحيح.'); end if;
    if v_dec is not null and not exists (select 1 from governance.decisions where id = v_dec) then return api.err('القرار غير موجود.'); end if;
    v_ref := 'MAN:' || gen_random_uuid();
    v_id := benefits.record(v_pid, (p->>'date')::date, p->>'kind', trim(p->>'category'), v_amt, 'يدوي', v_ref,
      nullif(trim(p->>'basis'),''), v_dec, concat_ws(' — ', nullif(trim(p->>'notes'),''), 'سجّلها: ' || coalesce((select username from core.users where id = uid), '?')));
    return api.ok(jsonb_build_object('id', v_id, 'ref', v_ref));
  elsif p_action = 'BEN_CANCEL' then
    if coalesce(trim(p->>'reason'),'') = '' then return api.err('اكتب سبب الإلغاء.'); end if;
    update benefits.ledger set status = 'ملغاة', notes = concat_ws(' — ', notes, 'ألغيت: ' || trim(p->>'reason'))
      where source_module = 'يدوي' and source_ref = p->>'ref' and status = 'فعّالة';
    get diagnostics n = row_count;
    if n = 0 then return api.err('الميزة غير موجودة أو ليست مباشرة (مزايا الخزينة تُلغى بعكس قيدها).'); end if;
    return api.ok(jsonb_build_object('cancelled', n));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- ربط BEN_ADD/BEN_CANCEL في موزّع المزايا (تعديل جراحي)
do $$ declare d text := pg_get_functiondef('api.handle_benefits(text,jsonb,uuid,uuid)'::regprocedure);
  a text := 'if not core.can(uid,''benefits.view'') then'; begin
  if position('api.benefit_manage' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'anchor'; end if;
  execute replace(d, a, 'if p_action in (''BEN_ADD'',''BEN_CANCEL'') then return api.benefit_manage(p_action, p, uid); end if;
  ' || a);
end $$;

revoke all on all functions in schema api from public, anon, authenticated;
revoke all on all functions in schema benefits from public, anon, authenticated;
