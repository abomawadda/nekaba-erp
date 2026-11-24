-- المرحلة 27: اللائحة المالية (بنود وحدود وتحقق عند الصرف) + حصة اللجنة من اشتراك المرتب (10 = 6 لجنة / 3 نقابة عامة / 1 اتحاد).
-- ── الحسابات ──
insert into finance.accounts(code, name, parent, type, postable) values
  ('1204','مستحق من النقابة العامة — حصة الاشتراكات','12','أصول',true),
  ('4102','حصة اللجنة من اشتراكات الأعضاء (المرتب)','4','إيرادات',true)
on conflict (code) do nothing;
insert into core.permissions(code, module, name) values ('finance.policy','finance','إدارة بنود اللائحة المالية') on conflict do nothing;
insert into core.settings(key, year, value, description) values
  ('DUES_SPLIT', 0, '{"total":10,"local":6,"general":3,"federation":1}', 'توزيع اشتراك المرتب الشهري: اللجنة/النقابة العامة/الاتحاد')
on conflict do nothing;

-- ── المقبوضات: نوع «حصة الاشتراكات» ⇒ يسدّد المستحق 1204 ──
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'treasury.receipts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%';
  if c is not null then execute format('alter table treasury.receipts drop constraint %I', c); end if;
end $$;
alter table treasury.receipts add constraint receipts_kind_check check (kind in ('تحويل النقابة العامة','حصة الاشتراكات','اشتراكات','رد عهدة','إيرادات أخرى','رسوم بنكية'));
do $$ declare d text := pg_get_functiondef('treasury.receive(jsonb,text)'::regprocedure); a text := $a$when 'رد عهدة' then '1103'$a$; begin
  if position('حصة الاشتراكات' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'مرساة receive غير موجودة'; end if;
  execute replace(d, a, $b$when 'حصة الاشتراكات' then '1204' $b$ || a);
end $$;

-- ── حصة الاشتراكات: فترات الاستحقاق ──
create table if not exists finance.dues_periods (
  id            uuid primary key default gen_random_uuid(),
  period_from   date not null,
  period_to     date not null,
  months        int  not null check (months between 1 and 12),
  members_calc  int  not null,              -- المحسوب من المنظومة (النقابة العامة + نشط)
  members       int  not null check (members >= 0), -- المعتمد (من كشف الاستقطاع إن وُجد)
  rate          numeric(8,2) not null,      -- نصيب اللجنة للعضو شهرياً
  amount        numeric(14,2) not null,
  basis         text,                       -- مصدر العدد
  entry_id      uuid references finance.entries(id),
  created_by    text,
  created_at    timestamptz not null default now(),
  check (period_to >= period_from)
);
create index if not exists dues_periods_from_idx on finance.dues_periods(period_from);
alter table finance.dues_periods enable row level security;
revoke all on finance.dues_periods from public, anon, authenticated;
drop trigger if exists dues_periods_audit on finance.dues_periods;
create trigger dues_periods_audit after insert or update or delete on finance.dues_periods for each row execute function audit.track();

create or replace function finance.dues_members(p_date date) returns int language sql stable set search_path = core, public as $$
  select count(*)::int from core.persons p
  where core.state_at(p.id, 'member_state', p_date) = 'نشط' and core.state_at(p.id, 'union_org', p_date) = 'النقابة العامة'
$$;

create or replace function api.dues_status() returns jsonb language sql stable set search_path = core, public as $$
  with per as (select d.*, sum(amount) over (order by period_from, created_at) cum from finance.dues_periods d),
  rcv as (select coalesce(sum(amount),0) r from treasury.receipts where kind = 'حصة الاشتراكات')
  select jsonb_build_object(
    'split', core.setting('DUES_SPLIT'),
    'membersNow', finance.dues_members(current_date),
    'accrued', (select coalesce(sum(amount),0) from finance.dues_periods),
    'received', (select r from rcv),
    'outstanding', (select coalesce(sum(debit - credit),0) from finance.lines where account = '1204'),
    'lastTo', (select max(period_to) from finance.dues_periods),
    'periods', coalesce((select jsonb_agg(jsonb_build_object('id', per.id, 'from', period_from, 'to', period_to, 'months', months, 'members', members, 'members_calc', members_calc,
        'rate', rate, 'amount', amount, 'basis', basis, 'entry_id', entry_id,
        'paid', greatest(0, least(amount, (select r from rcv) - (cum - amount)))) order by period_from desc) from per), '[]'),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'no', r.receipt_no, 'date', r.receipt_date, 'amount', r.amount, 'notes', r.notes) order by r.receipt_date desc)
        from treasury.receipts r where r.kind = 'حصة الاشتراكات'), '[]'))
$$;

-- ── اللائحة المالية ──
create table if not exists finance.policy (
  account        text primary key references finance.accounts(code),
  max_per_txn    numeric(14,2) check (max_per_txn is null or max_per_txn > 0),
  annual_cap     numeric(14,2) check (annual_cap is null or annual_cap > 0),
  requires_decision boolean not null default true,
  approver       text,            -- جهة الاعتماد كما في اللائحة (نص)
  required_docs  text,            -- المستندات المطلوبة
  article_ref    text,            -- رقم المادة/البند في اللائحة
  enforce        text not null default 'منع' check (enforce in ('منع','تنبيه')),
  notes          text,
  active         boolean not null default true,
  updated_by     text,
  updated_at     timestamptz not null default now()
);
alter table finance.policy enable row level security;
revoke all on finance.policy from public, anon, authenticated;
drop trigger if exists policy_audit on finance.policy;
create trigger policy_audit after insert or update or delete on finance.policy for each row execute function audit.track();

-- فحص الصرف مقابل اللائحة (للشيك المباشر ولبنود التسوية؛ المنقول تاريخياً مستثنى)
create or replace function finance.policy_check(p_account text, p_amount numeric, p_date date, p_has_decision boolean) returns text language plpgsql stable set search_path = core, public as $$
declare r finance.policy; v_spent numeric;
begin
  select * into r from finance.policy where account = p_account and active;
  if r.account is null then return null; end if;
  if r.requires_decision and not p_has_decision then return 'بند ' || p_account || ': اللائحة تشترط قرار مجلس' || coalesce(' (' || r.article_ref || ')',''); end if;
  if r.max_per_txn is not null and p_amount > r.max_per_txn then
    return 'بند ' || p_account || ': المبلغ ' || p_amount || ' يتجاوز حد الصرف الواحد ' || r.max_per_txn || coalesce(' (' || r.article_ref || ')',''); end if;
  if r.annual_cap is not null then
    select coalesce(sum(l.debit - l.credit),0) into v_spent from finance.lines l join finance.entries e on e.id = l.entry_id
    where l.account = p_account and extract(year from e.entry_date) = extract(year from p_date);
    if v_spent + p_amount > r.annual_cap then
      return 'بند ' || p_account || ': يتجاوز السقف السنوي ' || r.annual_cap || ' (المصروف ' || v_spent || ')' || coalesce(' (' || r.article_ref || ')',''); end if;
  end if;
  return null;
end $$;

create or replace function finance.policy_cheque_trg() returns trigger language plpgsql as $$
declare m text; v_enf text;
begin
  if new.legacy_ref is not null or new.expense_account is null then return new; end if;
  m := finance.policy_check(new.expense_account, new.amount, new.issue_date, new.decision_id is not null);
  select enforce into v_enf from finance.policy where account = new.expense_account;
  if m is not null and v_enf = 'منع' then raise exception '%', m using errcode = 'check_violation'; end if;
  return new;
end $$;
drop trigger if exists cheque_policy on treasury.cheques;
create trigger cheque_policy before insert on treasury.cheques for each row execute function finance.policy_cheque_trg();

create or replace function finance.policy_stl_trg() returns trigger language plpgsql as $$
declare m text; v_enf text; s treasury.settlements; c treasury.cheques;
begin
  select * into s from treasury.settlements where id = new.settlement_id;
  if s.legacy_ref is not null then return new; end if;
  select * into c from treasury.cheques where id = s.cheque_id;
  m := finance.policy_check(new.account, new.amount, s.settle_date, c.decision_id is not null);
  select enforce into v_enf from finance.policy where account = new.account;
  if m is not null and v_enf = 'منع' then raise exception '%', m using errcode = 'check_violation'; end if;
  return new;
end $$;
drop trigger if exists stl_policy on treasury.settlement_lines;
create trigger stl_policy before insert on treasury.settlement_lines for each row execute function finance.policy_stl_trg();

-- ── الواجهة البرمجية: POL_ و DUES_ ──
create or replace function api.handle_finpol(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql set search_path = core, public as $$
declare v_user text := (select username from core.users where id = uid); v_from date; v_to date; v_months int; v_calc int; v_mem int; v_rate numeric; v_amt numeric; v_entry uuid; v_id uuid;
begin
  perform set_config('erp.actor', coalesce(v_user, 'SYSTEM'), true);
  if not core.can(uid,'finance.view') then return api.err('غير مسموح.'); end if;

  if p_action = 'POL_LIST' then
    return api.ok(jsonb_build_object('canEdit', core.can(uid,'finance.policy'), 'items', coalesce((select jsonb_agg(jsonb_build_object(
        'account', a.code, 'name', a.name, 'parent', a.parent, 'policy', to_jsonb(pl) - 'account',
        'spent', (select coalesce(sum(l.debit - l.credit),0) from finance.lines l join finance.entries e on e.id = l.entry_id
                  where l.account = a.code and extract(year from e.entry_date) = extract(year from current_date)),
        'budget', (select amount from finance.budgets b where b.account = a.code and b.year = extract(year from current_date)::int)) order by a.code)
      from finance.accounts a left join finance.policy pl on pl.account = a.code where a.type = 'مصروفات' and a.postable and a.active), '[]')));

  elsif p_action = 'POL_SAVE' then
    if not core.can(uid,'finance.policy') then return api.err('غير مسموح — تحتاج صلاحية اللائحة المالية.'); end if;
    if not exists (select 1 from finance.accounts where code = api.t(p,'account') and type = 'مصروفات' and postable) then return api.err('حساب غير صالح.'); end if;
    perform set_config('erp.reason', coalesce(api.t(p,'reason'), ''), true);
    insert into finance.policy(account, max_per_txn, annual_cap, requires_decision, approver, required_docs, article_ref, enforce, notes, active, updated_by)
    values (api.t(p,'account'), (nullif(p->>'max_per_txn',''))::numeric, (nullif(p->>'annual_cap',''))::numeric, coalesce((p->>'requires_decision')::boolean, true),
            api.t(p,'approver'), api.t(p,'required_docs'), api.t(p,'article_ref'), coalesce(api.t(p,'enforce'),'منع'), api.t(p,'notes'), coalesce((p->>'active')::boolean, true), v_user)
    on conflict (account) do update set max_per_txn = excluded.max_per_txn, annual_cap = excluded.annual_cap, requires_decision = excluded.requires_decision,
      approver = excluded.approver, required_docs = excluded.required_docs, article_ref = excluded.article_ref, enforce = excluded.enforce, notes = excluded.notes,
      active = excluded.active, updated_by = v_user, updated_at = now();
    return api.ok();

  elsif p_action = 'POL_CHECK' then
    return api.ok(jsonb_build_object('message', finance.policy_check(api.t(p,'account'), (p->>'amount')::numeric, coalesce((api.t(p,'date'))::date, current_date), coalesce((p->>'hasDecision')::boolean, false))));

  elsif p_action = 'DUES_STATUS' then
    return api.ok(jsonb_build_object('status', api.dues_status(), 'canEdit', core.can(uid,'finance.journal')));

  elsif p_action = 'DUES_ACCRUE' then
    if not core.can(uid,'finance.journal') then return api.err('غير مسموح — تحتاج صلاحية القيود.'); end if;
    v_from := date_trunc('month', (api.t(p,'from'))::date)::date; v_months := coalesce((p->>'months')::int, 0);
    if v_from is null or v_months not between 1 and 12 then return api.err('حدد أول شهر وعدد الشهور (1–12).'); end if;
    v_to := (v_from + make_interval(months => v_months) - interval '1 day')::date;
    if v_to > (date_trunc('month', current_date) + interval '1 month - 1 day')::date then return api.err('لا يُستحق عن شهور مستقبلية.'); end if;
    if exists (select 1 from finance.dues_periods where daterange(period_from, period_to, '[]') && daterange(v_from, v_to, '[]')) then
      return api.err('الفترة متداخلة مع فترة مستحقة من قبل.'); end if;
    v_calc := finance.dues_members(v_from + ((v_to - v_from) / 2));
    v_mem := coalesce((nullif(p->>'members',''))::int, v_calc);
    v_rate := coalesce((nullif(p->>'rate',''))::numeric, (core.setting('DUES_SPLIT')->>'local')::numeric, 6);
    v_amt := v_mem * v_rate * v_months;
    if v_amt <= 0 then return api.err('المبلغ صفر.'); end if;
    v_entry := finance.post(jsonb_build_object('date', v_to, 'source', 'استحقاق اشتراكات',
      'description', 'استحقاق حصة اللجنة من اشتراكات الأعضاء ' || to_char(v_from,'YYYY-MM') || ' ← ' || to_char(v_to,'YYYY-MM') || ' (' || v_mem || ' عضو × ' || v_rate || ' ج × ' || v_months || ' شهر)',
      'lines', jsonb_build_array(jsonb_build_object('account','1204','debit', v_amt, 'party','النقابة العامة'),
                                 jsonb_build_object('account','4102','credit', v_amt))), v_user);
    insert into finance.dues_periods(period_from, period_to, months, members_calc, members, rate, amount, basis, entry_id, created_by)
    values (v_from, v_to, v_months, v_calc, v_mem, v_rate, v_amt, coalesce(api.t(p,'basis'), case when v_mem = v_calc then 'محسوب من المنظومة' else 'كشف الاستقطاع' end), v_entry, v_user)
    returning id into v_id;
    return api.ok(jsonb_build_object('id', v_id, 'status', api.dues_status()));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

do $$ declare d text := pg_get_functiondef('api.handle(text,jsonb,jsonb)'::regprocedure); begin
  if position('POL\_%' in d) > 0 then return; end if;
  if position($a$or p_action like 'DOC\_%' then$a$ in d) = 0 or position($a$elsif p_action like 'DOC\_%' then return api.handle_docs(p_action, p, uid, (s->>'pid')::uuid);$a$ in d) = 0 then
    raise exception 'مرساة الموجّه غير موجودة'; end if;
  d := replace(d, $a$or p_action like 'DOC\_%' then$a$, $a$or p_action like 'DOC\_%' or p_action like 'POL\_%' or p_action like 'DUES\_%' then$a$);
  d := replace(d, $a$elsif p_action like 'DOC\_%' then return api.handle_docs(p_action, p, uid, (s->>'pid')::uuid);$a$,
    $a$elsif p_action like 'DOC\_%' then return api.handle_docs(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'POL\_%' or p_action like 'DUES\_%' then return api.handle_finpol(p_action, p, uid);$a$);
  execute d;
end $$;

revoke all on all functions in schema core, api, finance, treasury from public, anon, authenticated;
