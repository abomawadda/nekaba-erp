-- المرحلة 14: الموازنة التقديرية ومقارنتها بالفعلي.
-- بيانات تخطيط فقط (لا قيود ولا حركة نقدية)؛ الفعلي يُقرأ من القيود المرحّلة.
insert into core.permissions(code, module, name) values ('finance.budget','finance','إعداد الموازنة التقديرية') on conflict do nothing;

create table if not exists finance.budgets (
  year       int not null check (year between 2000 and 2100),
  account    text not null references finance.accounts(code),
  amount     numeric(14,2) not null default 0 check (amount >= 0),
  notes      text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (year, account)
);
create index if not exists budgets_account_idx on finance.budgets(account);
alter table finance.budgets enable row level security;
drop trigger if exists budgets_audit on finance.budgets;
create trigger budgets_audit after insert or update or delete on finance.budgets for each row execute function audit.track();

create or replace function api.budget_report(p_year int) returns jsonb language sql stable set search_path = core, public as $$
  with act as (
    select l.account, sum(l.debit) dr, sum(l.credit) cr
    from finance.lines l join finance.entries e on e.id = l.entry_id
    where extract(year from e.entry_date) = p_year group by l.account),
  rows as (
    select a.code, a.name, a.type, coalesce(a.parent, left(a.code, 2)) grp, (select name from finance.accounts g where g.code = coalesce(a.parent, left(a.code, 2))) grp_name,
      coalesce(b.amount, 0) budget, b.notes,
      case when a.type = 'إيرادات' then coalesce(act.cr,0) - coalesce(act.dr,0) else coalesce(act.dr,0) - coalesce(act.cr,0) end actual
    from finance.accounts a left join finance.budgets b on b.account = a.code and b.year = p_year left join act on act.account = a.code
    where a.postable and a.active and a.type in ('إيرادات','مصروفات'))
  select jsonb_build_object('year', p_year,
    'items', coalesce((select jsonb_agg(to_jsonb(r) order by r.code) from rows r), '[]'),
    'years', (select coalesce(jsonb_agg(distinct y order by y), '[]') from (select year y from finance.budgets union select extract(year from entry_date)::int from finance.entries union select extract(year from now())::int + 1) q))
$$;

create or replace function api.budget_save(p jsonb, uid uuid) returns jsonb language plpgsql set search_path = core, public as $$
declare v_year int := (p->>'year')::int; it jsonb; n int := 0; v_user text := (select username from core.users where id = uid);
begin
  if v_year is null then return api.err('حدد السنة.'); end if;
  perform set_config('erp.actor', coalesce(v_user, 'SYSTEM'), true);
  for it in select * from jsonb_array_elements(coalesce(p->'items','[]')) loop
    if not exists (select 1 from finance.accounts where code = it->>'account' and postable and type in ('إيرادات','مصروفات')) then
      return api.err('حساب غير صالح للموازنة: ' || coalesce(it->>'account','')); end if;
    if coalesce((it->>'amount')::numeric, 0) < 0 then return api.err('المبلغ لا يكون سالباً.'); end if;
    insert into finance.budgets(year, account, amount, notes, updated_by, updated_at)
    values (v_year, it->>'account', coalesce((it->>'amount')::numeric, 0), nullif(it->>'notes',''), v_user, now())
    on conflict (year, account) do update set amount = excluded.amount, notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now()
    where finance.budgets.amount is distinct from excluded.amount or finance.budgets.notes is distinct from excluded.notes;
    n := n + 1;
  end loop;
  return api.ok(jsonb_build_object('saved', n, 'report', api.budget_report(v_year)));
end $$;

create or replace function api.handle_reports(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql as $$
begin
  if not (core.can(uid,'reports.view') or core.can(uid,'finance.view')) then return api.err('غير مسموح.'); end if;
  if p_action = 'REP_OVERVIEW' then
    return api.ok(jsonb_build_object('report', api.report_overview((nullif(p->>'year',''))::int)));
  elsif p_action = 'REP_BUDGET' then
    return api.ok(jsonb_build_object('report', api.budget_report(coalesce((nullif(p->>'year',''))::int, extract(year from now())::int)),
      'canEdit', core.can(uid,'finance.budget')));
  elsif p_action = 'REP_BUDGET_SAVE' then
    if not core.can(uid,'finance.budget') then return api.err('غير مسموح — تحتاج صلاحية إعداد الموازنة.'); end if;
    return api.budget_save(p, uid);
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

revoke all on all functions in schema core, api, finance from public, anon, authenticated;
revoke all on finance.budgets from public, anon, authenticated;
