-- المرحلة 28: سجل الأطراف الخارجية + تطبيق اللائحة على القيد اليدوي.
create table if not exists finance.parties (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  kind        text not null default 'مورد' check (kind in ('مورد','شركة نقل','شركة سياحة','فندق/مصيف','جهة حكومية','بنك','فرد غير عضو','أخرى')),
  phone       text,
  tax_id      text,
  address     text,
  notes       text,
  active      boolean not null default true,
  created_by  text,
  created_at  timestamptz not null default now()
);
alter table finance.parties enable row level security;
revoke all on finance.parties from public, anon, authenticated;
drop trigger if exists parties_audit on finance.parties;
create trigger parties_audit after insert or update or delete on finance.parties for each row execute function audit.track();

-- اللائحة على القيد اليدوي: أي سطر مدين لحساب مصروف في قيد «يدوي» يخضع لنفس الفحص
create or replace function finance.policy_manual_trg() returns trigger language plpgsql as $$
declare e finance.entries; m text; v_enf text;
begin
  if new.debit <= 0 then return new; end if;
  select * into e from finance.entries where id = new.entry_id;
  if e.source <> 'يدوي' or e.legacy_ref is not null then return new; end if;
  if not exists (select 1 from finance.accounts where code = new.account and type = 'مصروفات') then return new; end if;
  m := finance.policy_check(new.account, new.debit, e.entry_date, e.decision_id is not null);
  select enforce into v_enf from finance.policy where account = new.account;
  if m is not null and v_enf = 'منع' then raise exception '%', m using errcode = 'check_violation'; end if;
  return new;
end $$;
drop trigger if exists lines_policy_manual on finance.lines;
create trigger lines_policy_manual before insert on finance.lines for each row execute function finance.policy_manual_trg();

do $$ declare d text := pg_get_functiondef('api.handle_finpol(text,jsonb,uuid)'::regprocedure); a text := $a$  elsif p_action = 'DUES_STATUS' then$a$; begin
  if position('POL_PARTIES' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'مرساة handle_finpol غير موجودة'; end if;
  d := replace(d, a, $b$  elsif p_action = 'POL_PARTIES' then
    return api.ok(jsonb_build_object('canEdit', core.can(uid,'treasury.cheque.issue') or core.can(uid,'finance.journal'), 'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pt.id, 'name', pt.name, 'kind', pt.kind, 'phone', pt.phone, 'tax_id', pt.tax_id, 'address', pt.address, 'notes', pt.notes, 'active', pt.active,
        'cheques', (select count(*) from treasury.cheques c where c.payee_name = pt.name and c.status <> 'ملغى'),
        'paid', (select coalesce(sum(amount),0) from treasury.cheques c where c.payee_name = pt.name and c.status <> 'ملغى'),
        'last', (select max(issue_date) from treasury.cheques c where c.payee_name = pt.name)) order by pt.name) from finance.parties pt), '[]')));
  elsif p_action = 'POL_PARTY_SAVE' then
    if not (core.can(uid,'treasury.cheque.issue') or core.can(uid,'finance.journal')) then return api.err('غير مسموح.'); end if;
    if api.t(p,'name') is null then return api.err('الاسم مطلوب.'); end if;
    if api.t(p,'id') is null then
      insert into finance.parties(name, kind, phone, tax_id, address, notes, created_by)
      values (api.t(p,'name'), coalesce(api.t(p,'kind'),'مورد'), api.t(p,'phone'), api.t(p,'tax_id'), api.t(p,'address'), api.t(p,'notes'), v_user);
    else
      update finance.parties set name = api.t(p,'name'), kind = coalesce(api.t(p,'kind'), kind), phone = api.t(p,'phone'), tax_id = api.t(p,'tax_id'),
        address = api.t(p,'address'), notes = api.t(p,'notes'), active = coalesce((p->>'active')::boolean, active) where id = (api.t(p,'id'))::uuid;
    end if;
    return api.ok();
  elsif p_action = 'POL_PARTY_STATEMENT' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(x order by x.date) from (
      select c.issue_date date, 'شيك ' || coalesce(c.cheque_no,'') doc, c.notes, c.amount, c.status, c.id cheque_id from treasury.cheques c where c.payee_name = api.t(p,'name')) x), '[]')));
$b$ || a);
  execute d;
end $$;
revoke all on all functions in schema core, api, finance, treasury from public, anon, authenticated;
