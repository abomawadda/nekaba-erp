-- المرحلة 4 — سجل المزايا الموحّد: كل ميزة نقدية أو عينية لأي شخص من أي وحدة = حركة واحدة بسندها وصفته وقتها
create schema if not exists benefits;
revoke all on schema benefits from public, anon, authenticated;

create table benefits.ledger (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references core.persons(id),
  benefit_date  date not null,
  kind          text not null check (kind in ('منحة','دعم','إعفاء','خصم','بدل','جائزة','ميزة عينية')),
  category      text not null,                 -- منحة وفاة، بدل جلسات، دعم رحلة، إعفاء مشرف، ...
  amount        numeric(14,2) not null check (amount > 0),
  source_module text not null check (source_module in ('الخزينة','MyNekaba','الكتب','الأنشطة','يدوي')),
  source_ref    text not null,                 -- مرجع المصدر (سطر تسوية، شيك، سجل قديم...)
  basis         text,                          -- السند: قرار/شيك/تسوية
  decision_id   uuid references governance.decisions(id),
  union_org     text,                          -- صفته وقتها (لقطة)
  board_role    text,                          -- منصبه في المجلس وقتها (لقطة)
  status        text not null default 'فعّالة' check (status in ('فعّالة','ملغاة')),
  notes         text,
  created_at    timestamptz not null default now(),
  unique (source_module, source_ref, person_id)
);
create index on benefits.ledger (person_id, benefit_date);
create trigger ledger_audit after insert or update or delete on benefits.ledger for each row execute function audit.track();
alter table benefits.ledger enable row level security;
revoke all on benefits.ledger from anon, authenticated;

-- إضافة ميزة بلقطة الصفة (لا تكرار بنفس المرجع)
create or replace function benefits.record(p_person uuid, p_date date, p_kind text, p_category text, p_amount numeric,
  p_source text, p_ref text, p_basis text default null, p_decision uuid default null, p_notes text default null)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  if p_person is null or coalesce(p_amount,0) <= 0 then return null; end if;
  insert into benefits.ledger(person_id, benefit_date, kind, category, amount, source_module, source_ref, basis, decision_id, union_org, board_role, notes)
  values (p_person, p_date, p_kind, p_category, round(p_amount, 2), p_source, p_ref, p_basis, p_decision,
          core.state_at(p_person, 'union_org', p_date), governance.board_role_at(p_person, p_date), p_notes)
  on conflict (source_module, source_ref, person_id) do nothing returning id into v_id;
  return v_id;
end $$;

-- ── التغذية التلقائية من الخزينة ──
-- (1) شيك منحة لعضو ⇒ ميزة «منحة»
create or replace function benefits.from_cheque() returns trigger language plpgsql as $$
begin
  if new.purpose = 'منحة' and new.payee_person_id is not null then
    perform benefits.record(new.payee_person_id, new.issue_date, 'منحة',
      coalesce((select name from finance.accounts where code = new.expense_account), 'منحة'), new.amount,
      'الخزينة', 'CHQ:' || new.id, 'شيك ' || coalesce(new.cheque_no, 'بدون رقم'), new.decision_id, new.notes);
  end if;
  return new;
end $$;
create trigger cheque_benefit after insert on treasury.cheques for each row execute function benefits.from_cheque();

-- (2) بند تسوية له مستفيدون (بدل جلسات/ضيافة/انتقال، جوائز...) ⇒ ميزة لكل مستفيد بنصيبه
create or replace function benefits.from_settlement_line() returns trigger language plpgsql as $$
declare b jsonb; n int; i int := 0; share numeric; v_pid uuid; s treasury.settlements; c treasury.cheques; v_kind text;
begin
  if (case when jsonb_typeof(new.beneficiaries) = 'array' then jsonb_array_length(new.beneficiaries) else 0 end) = 0 then return new; end if;
  select * into s from treasury.settlements where id = new.settlement_id;
  select * into c from treasury.cheques where id = s.cheque_id;
  n := jsonb_array_length(new.beneficiaries);
  share := round(new.amount / n, 2);
  v_kind := case when new.category like 'بدل%' then 'بدل' when new.category like '%جوائز%' or new.category like '%جائزة%' then 'جائزة' else 'ميزة عينية' end;
  for b in select * from jsonb_array_elements(new.beneficiaries) loop
    i := i + 1;
    v_pid := coalesce((nullif(b->>'person_id',''))::uuid, api.pid_by_job(b->>'job_id'));
    -- آخر نصيب يأخذ فرق القروش ⇒ مجموع الأنصبة = قيمة البند بالضبط
    perform benefits.record(v_pid, coalesce(new.doc_date, s.settle_date), v_kind, new.category,
      case when i = n then new.amount - share * (n - 1) else share end,
      'الخزينة', 'STL:' || new.settlement_id || ':' || new.line_no, 'تسوية شيك ' || coalesce(c.cheque_no, 'بدون رقم'), c.decision_id, new.notes);
  end loop;
  return new;
end $$;
create trigger settlement_line_benefit after insert on treasury.settlement_lines for each row execute function benefits.from_settlement_line();

-- ── منظومة الكتب (قراءة فقط، حيّة بلا نسخ): التوفير في كل فاتورة موظف ──
create or replace view benefits.books_savings as
select p.id as person_id, (i.data->>'Issue_Date')::date as benefit_date, 'خصم'::text as kind, 'توفير مبادرة الكتب'::text as category,
       (i.data->>'Total_Savings')::numeric as amount, 'الكتب'::text as source_module, 'BOOKS:' || (i.data->>'Emp_Inv_ID') as source_ref,
       'فاتورة ' || (i.data->>'Emp_Inv_ID') as basis
from books.records i join core.persons p on p.job_id = i.emp_id
where i.tbl = '15_Employee_Invoices' and coalesce((i.data->>'Total_Savings')::numeric, 0) > 0
  and coalesce(i.data->>'Invoice_Status','') not in ('Cancelled','Voided') and (i.data->>'Issue_Date') ~ '^\d{4}-\d{2}-\d{2}';

-- كل المزايا (السجل + الكتب)
create or replace view benefits.all_benefits as
select person_id, benefit_date, kind, category, amount, source_module, source_ref, basis, union_org, board_role, status, notes from benefits.ledger
union all
select b.person_id, b.benefit_date, b.kind, b.category, b.amount, b.source_module, b.source_ref, b.basis,
       core.state_at(b.person_id,'union_org',b.benefit_date), governance.board_role_at(b.person_id,b.benefit_date), 'فعّالة', null
from benefits.books_savings b;

-- ── تعبئة ما سبق نقله (الشيكات والتسويات المنقولة قبل وجود المُشغّلات) ──
do $$ declare c treasury.cheques; l treasury.settlement_lines; begin
  for c in select * from treasury.cheques where purpose = 'منحة' and payee_person_id is not null loop
    perform benefits.record(c.payee_person_id, c.issue_date, 'منحة', coalesce((select name from finance.accounts where code = c.expense_account), 'منحة'),
      c.amount, 'الخزينة', 'CHQ:' || c.id, 'شيك ' || coalesce(c.cheque_no,'بدون رقم'), c.decision_id, c.notes);
  end loop;
end $$;
do $$ declare l record; b jsonb; n int; s treasury.settlements; c treasury.cheques; v_kind text; begin
  for l in select * from treasury.settlement_lines where (case when jsonb_typeof(beneficiaries) = 'array' then jsonb_array_length(beneficiaries) else 0 end) > 0 loop
    select * into s from treasury.settlements where id = l.settlement_id;
    select * into c from treasury.cheques where id = s.cheque_id;
    n := jsonb_array_length(l.beneficiaries);
    v_kind := case when l.category like 'بدل%' then 'بدل' when l.category like '%جوائز%' then 'جائزة' else 'ميزة عينية' end;
    for b in select * from jsonb_array_elements(l.beneficiaries) loop
      perform benefits.record(coalesce((nullif(b->>'person_id',''))::uuid, api.pid_by_job(b->>'job_id')), coalesce(l.doc_date, s.settle_date),
        v_kind, l.category, l.amount / n, 'الخزينة', 'STL:' || l.settlement_id || ':' || l.line_no,
        'تسوية شيك ' || coalesce(c.cheque_no,'بدون رقم'), c.decision_id, l.notes);
    end loop;
  end loop;
end $$;

-- ── واجهة BEN_* ──
create or replace function api.benefits_of(p_person uuid, p_year int default null) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total', coalesce(sum(amount), 0),
    'byKind', coalesce((select jsonb_object_agg(kind, t) from (select kind, sum(amount) t from benefits.all_benefits
        where person_id = p_person and status = 'فعّالة' and (p_year is null or extract(year from benefit_date) = p_year) group by kind) k), '{}'),
    'byYear', coalesce((select jsonb_agg(jsonb_build_object('year', y, 'total', t) order by y desc) from (select extract(year from benefit_date)::int y, sum(amount) t
        from benefits.all_benefits where person_id = p_person and status = 'فعّالة' group by 1) yy), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('date', benefit_date, 'kind', kind, 'category', category, 'amount', amount,
        'source', source_module, 'basis', basis, 'board_role', board_role, 'union_org', union_org, 'notes', notes) order by benefit_date desc)
      from benefits.all_benefits where person_id = p_person and status = 'فعّالة' and (p_year is null or extract(year from benefit_date) = p_year)), '[]'))
  from benefits.all_benefits where person_id = p_person and status = 'فعّالة' and (p_year is null or extract(year from benefit_date) = p_year)
$$;

create or replace function api.handle_benefits(p_action text, p jsonb, uid uuid, pid uuid) returns jsonb language plpgsql as $$
declare v_year int := (nullif(p->>'year',''))::int;
begin
  if p_action = 'BEN_MY' then
    if pid is null then return api.err('الحساب غير مربوط بملف عضو.'); end if;
    return api.ok(jsonb_build_object('benefits', api.benefits_of(pid, v_year)));
  end if;
  if not core.can(uid,'benefits.view') then return api.err('غير مسموح.'); end if;
  if p_action = 'BEN_PERSON' then
    return api.ok(jsonb_build_object('benefits', api.benefits_of((p->>'personId')::uuid, v_year)));
  elsif p_action = 'BEN_REPORT' then
    return api.ok(jsonb_build_object(
      'year', v_year,
      'total', (select coalesce(sum(amount),0) from benefits.all_benefits where status='فعّالة' and (v_year is null or extract(year from benefit_date)=v_year)),
      'beneficiaries', (select count(distinct person_id) from benefits.all_benefits where status='فعّالة' and (v_year is null or extract(year from benefit_date)=v_year)),
      'byCategory', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'category', category, 'total', t, 'people', n) order by t desc) from (
          select kind, category, sum(amount) t, count(distinct person_id) n from benefits.all_benefits
          where status='فعّالة' and (v_year is null or extract(year from benefit_date)=v_year) group by 1,2) c), '[]'),
      'byYear', coalesce((select jsonb_agg(jsonb_build_object('year', y, 'total', t, 'people', n) order by y desc) from (
          select extract(year from benefit_date)::int y, sum(amount) t, count(distinct person_id) n from benefits.all_benefits where status='فعّالة' group by 1) yy), '[]'),
      -- تقرير مزايا أعضاء المجلس: كل ما استفاد به من كان عضو مجلس وقت الاستفادة
      'board', coalesce((select jsonb_agg(jsonb_build_object('person_id', person_id, 'full_name', full_name, 'job_id', job_id, 'role', role,
          'total', t, 'byKind', bk) order by t desc) from (
          select b.person_id, pe.full_name, pe.job_id, governance.board_role_at(b.person_id) role, sum(b.amount) t,
            (select jsonb_object_agg(kind, s) from (select kind, sum(amount) s from benefits.all_benefits x where x.person_id = b.person_id and x.status='فعّالة'
               and x.board_role is not null and (v_year is null or extract(year from x.benefit_date)=v_year) group by kind) q) bk
          from benefits.all_benefits b join core.persons pe on pe.id = b.person_id
          where b.status='فعّالة' and b.board_role is not null and (v_year is null or extract(year from b.benefit_date)=v_year)
          group by b.person_id, pe.full_name, pe.job_id) bb), '[]'),
      'top', coalesce((select jsonb_agg(jsonb_build_object('person_id', person_id, 'full_name', full_name, 'job_id', job_id, 'total', t) order by t desc) from (
          select b.person_id, pe.full_name, pe.job_id, sum(b.amount) t from benefits.all_benefits b join core.persons pe on pe.id = b.person_id
          where b.status='فعّالة' and (v_year is null or extract(year from b.benefit_date)=v_year) group by 1,2,3 order by t desc limit 20) tt), '[]')));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- نقل مزايا MyNekaba القديمة (الفعّالة فقط)
create or replace function api.import_benefits(p jsonb) returns jsonb language plpgsql as $$
declare r jsonb; ok int := 0; miss jsonb := '[]'; v_pid uuid;
begin
  for r in select * from jsonb_array_elements(p->'rows') loop
    v_pid := api.pid_by_job(r->>'job_id');
    if v_pid is null then miss := miss || jsonb_build_object('ref', r->>'ref', 'job_id', r->>'job_id'); continue; end if;
    if benefits.record(v_pid, (r->>'date')::date, r->>'kind', r->>'category', (r->>'amount')::numeric, 'MyNekaba', r->>'ref',
         r->>'basis', null, r->>'notes') is not null then ok := ok + 1; end if;
  end loop;
  return api.ok(jsonb_build_object('imported', ok, 'missing', miss));
end $$;

-- الموجّه (كل الفروع)
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  if p_action like 'IMPORT\_%' or p_action like 'GOV\_%' or p_action like 'FIN\_%' or p_action like 'BEN\_%' then
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
insert into core.role_permissions(role, permission) values ('SYS_ADMIN','benefits.view') on conflict do nothing;
revoke all on all functions in schema api, benefits from public, anon, authenticated;

-- (طُبّق بعد النقل) تصحيح قروش الأنصبة المنقولة: الفرق على آخر نصيب لكل بند — المجاميع = البنود بالضبط

-- (22 نوفمبر) إغلاق تسرّب كشفه اختبار المتصفح: صلاحية benefits.view تعني «كل المزايا»؛ العضو يرى استفاداته فقط عبر BEN_MY بلا صلاحية
delete from core.role_permissions where role in ('MEMBER','NON_MEMBER') and permission = 'benefits.view';
