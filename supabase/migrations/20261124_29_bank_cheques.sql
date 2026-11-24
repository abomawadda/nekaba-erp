-- المرحلة 20: دفاتر الشيكات، حالة الصرف من البنك، إلغاء الشيك بقيد عكسي، ومطابقة كشف الحساب البنكي (وحدة BANK_).
alter table treasury.cheques  add column if not exists cleared_date date, add column if not exists voided_at timestamptz,
  add column if not exists void_reason text, add column if not exists void_entry_id uuid references finance.entries(id);
alter table treasury.receipts add column if not exists cleared_date date;

create table if not exists treasury.cheque_books (
  id            uuid primary key default gen_random_uuid(),
  bank_account  text not null default '1102' references finance.accounts(code),
  book_no       text,
  first_no      bigint not null,
  last_no       bigint not null,
  received_date date not null default current_date,
  status        text not null default 'نشط' check (status in ('نشط','منتهي','ملغى')),
  notes         text,
  created_by    text,
  created_at    timestamptz not null default now(),
  check (last_no >= first_no and last_no - first_no < 1000),
  unique (bank_account, first_no)
);
create table if not exists treasury.cheque_spoiled (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid not null references treasury.cheque_books(id),
  cheque_no   text not null unique,
  spoil_date  date not null default current_date,
  reason      text not null,
  created_by  text,
  created_at  timestamptz not null default now()
);
create table if not exists treasury.bank_reconciliations (
  id                   uuid primary key default gen_random_uuid(),
  bank_account         text not null default '1102' references finance.accounts(code),
  stmt_date            date not null,
  stmt_balance         numeric(14,2) not null,
  book_balance         numeric(14,2) not null,
  outstanding_cheques  numeric(14,2) not null,
  deposits_in_transit  numeric(14,2) not null,
  difference           numeric(14,2) not null,
  items                jsonb,
  notes                text,
  status               text not null default 'مسودة' check (status in ('مسودة','معتمدة')),
  created_by           text,
  created_at           timestamptz not null default now(),
  approved_by          text,
  approved_at          timestamptz,
  unique (bank_account, stmt_date)
);
create index if not exists cheque_spoiled_book_idx on treasury.cheque_spoiled(book_id);
alter table treasury.cheque_books enable row level security; alter table treasury.cheque_spoiled enable row level security; alter table treasury.bank_reconciliations enable row level security;
revoke all on treasury.cheque_books, treasury.cheque_spoiled, treasury.bank_reconciliations from public, anon, authenticated;
drop trigger if exists cheque_books_audit on treasury.cheque_books;
create trigger cheque_books_audit after insert or update or delete on treasury.cheque_books for each row execute function audit.track();
drop trigger if exists cheque_spoiled_audit on treasury.cheque_spoiled;
create trigger cheque_spoiled_audit after insert or update or delete on treasury.cheque_spoiled for each row execute function audit.track();
drop trigger if exists bank_recon_audit on treasury.bank_reconciliations;
create trigger bank_recon_audit after insert or update or delete on treasury.bank_reconciliations for each row execute function audit.track();

-- رقم الشيك الجديد: لو فيه دفاتر مسجلة للحساب لازم يكون داخل دفتر نشط وغير تالف
create or replace function treasury.check_cheque_no() returns trigger language plpgsql as $$
begin
  if new.cheque_no is null or new.legacy_ref is not null then return new; end if;
  if exists (select 1 from treasury.cheque_spoiled where cheque_no = new.cheque_no) then
    raise exception 'رقم الشيك % مسجّل كورقة تالفة/ملغاة', new.cheque_no using errcode = 'check_violation'; end if;
  if exists (select 1 from treasury.cheque_books where bank_account = new.bank_account and status <> 'ملغى')
     and not exists (select 1 from treasury.cheque_books b where b.bank_account = new.bank_account and b.status = 'نشط'
                     and new.cheque_no ~ '^\d{1,18}$' and new.cheque_no::bigint between b.first_no and b.last_no) then
    raise exception 'رقم الشيك % خارج دفاتر الشيكات النشطة — سجّل الدفتر أولاً', new.cheque_no using errcode = 'check_violation'; end if;
  return new;
end $$;
drop trigger if exists cheque_no_check on treasury.cheques;
create trigger cheque_no_check before insert on treasury.cheques for each row execute function treasury.check_cheque_no();

create or replace function api.bank_books(p_acc text) returns jsonb language sql stable set search_path = core, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'book_no', b.book_no, 'first_no', b.first_no::text, 'last_no', b.last_no::text,
      'received_date', b.received_date, 'status', b.status, 'notes', b.notes, 'size', b.last_no - b.first_no + 1,
      'issued', u.issued, 'voided', u.voided, 'spoiled', sp.n, 'outstanding', u.outstanding, 'outstanding_amount', u.outstanding_amount,
      'remaining', (b.last_no - b.first_no + 1) - u.issued - sp.n,
      'next_no', (select min(g)::text from generate_series(b.first_no, b.last_no) g
                  where not exists (select 1 from treasury.cheques c where c.cheque_no = g::text) and not exists (select 1 from treasury.cheque_spoiled s where s.cheque_no = g::text)),
      'gaps', (select coalesce(jsonb_agg(g::text), '[]') from (select g from generate_series(b.first_no, greatest(b.first_no, u.max_used)) g
                  where u.max_used is not null and g < u.max_used and not exists (select 1 from treasury.cheques c where c.cheque_no = g::text)
                    and not exists (select 1 from treasury.cheque_spoiled s where s.cheque_no = g::text) limit 30) q),
      'spoiled_list', (select coalesce(jsonb_agg(jsonb_build_object('cheque_no', s.cheque_no, 'date', s.spoil_date, 'reason', s.reason) order by s.cheque_no), '[]') from treasury.cheque_spoiled s where s.book_id = b.id))
    order by b.status, b.first_no desc), '[]')
  from treasury.cheque_books b
  cross join lateral (select count(*) issued, count(*) filter (where c.status = 'ملغى') voided,
      count(*) filter (where c.status <> 'ملغى' and c.cleared_date is null) outstanding,
      coalesce(sum(c.amount) filter (where c.status <> 'ملغى' and c.cleared_date is null), 0) outstanding_amount, max(c.cheque_no::bigint) max_used
    from treasury.cheques c where c.bank_account = b.bank_account and c.cheque_no ~ '^\d{1,18}$' and c.cheque_no::bigint between b.first_no and b.last_no) u
  cross join lateral (select count(*) n from treasury.cheque_spoiled s where s.book_id = b.id) sp
  where b.bank_account = p_acc
$$;

-- المطابقة: رصيد الدفاتر في التاريخ + الشيكات غير المنصرفة − الإيداعات بالطريق = الرصيد المتوقع في كشف البنك
create or replace function api.bank_recon(p_acc text, p_date date, p_stmt numeric) returns jsonb language sql stable set search_path = core, public as $$
  with oc as (
    select c.id, c.cheque_no, c.issue_date, c.payee_name, c.amount, c.purpose, (p_date - c.issue_date) age
    from treasury.cheques c where c.bank_account = p_acc and c.issue_date <= p_date and c.status <> 'ملغى'
      and (c.cleared_date is null or c.cleared_date > p_date)),
  dit as (
    select r.id, r.receipt_no, r.receipt_date, r.kind, r.party, l.debit amount
    from treasury.receipts r join finance.lines l on l.entry_id = r.entry_id and l.account = p_acc and l.debit > 0
    where r.receipt_date <= p_date and (r.cleared_date is null or r.cleared_date > p_date)),
  bk as (select coalesce(sum(l.debit - l.credit), 0) bal from finance.lines l join finance.entries e on e.id = l.entry_id
         where l.account = p_acc and e.entry_date <= p_date)
  select jsonb_build_object('account', p_acc, 'date', p_date, 'stmt_balance', p_stmt,
    'book_balance', bk.bal,
    'outstanding_cheques', (select coalesce(sum(amount), 0) from oc),
    'deposits_in_transit', (select coalesce(sum(amount), 0) from dit),
    'adjusted', bk.bal + (select coalesce(sum(amount), 0) from oc) - (select coalesce(sum(amount), 0) from dit),
    'difference', case when p_stmt is null then null else p_stmt - (bk.bal + (select coalesce(sum(amount), 0) from oc) - (select coalesce(sum(amount), 0) from dit)) end,
    'cheques', (select coalesce(jsonb_agg(to_jsonb(oc) || jsonb_build_object('stale', oc.age > 180) order by oc.issue_date), '[]') from oc),
    'deposits', (select coalesce(jsonb_agg(to_jsonb(dit) order by dit.receipt_date), '[]') from dit),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'stmt_date', stmt_date, 'stmt_balance', stmt_balance, 'difference', difference, 'status', status,
                  'created_by', created_by, 'approved_by', approved_by) order by stmt_date desc), '[]') from treasury.bank_reconciliations where bank_account = p_acc))
  from bk
$$;

create or replace function api.handle_bank(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql set search_path = core, public as $$
declare v_user text := (select username from core.users where id = uid); v_acc text := coalesce(api.t(p,'account'), '1102');
  c treasury.cheques; v_rev uuid; v_date date; n int; b treasury.cheque_books; r jsonb;
begin
  perform set_config('erp.actor', coalesce(v_user, 'SYSTEM'), true);
  if not core.can(uid,'finance.view') then return api.err('غير مسموح.'); end if;

  if p_action = 'BANK_BOOKS' then
    return api.ok(jsonb_build_object('items', api.bank_books(v_acc)));

  elsif p_action = 'BANK_RECON' then
    return api.ok(jsonb_build_object('recon', api.bank_recon(v_acc, coalesce((api.t(p,'date'))::date, current_date), (nullif(p->>'stmtBalance',''))::numeric)));
  end if;

  -- ما بعده عمليات تعديل: صلاحية إصدار الشيكات
  if not core.can(uid,'treasury.cheque.issue') then return api.err('غير مسموح — تحتاج صلاحية الشيكات.'); end if;

  if p_action = 'BANK_BOOK_SAVE' then
    if api.t(p,'firstNo') !~ '^\d{1,18}$' or api.t(p,'lastNo') !~ '^\d{1,18}$' then return api.err('أرقام بداية ونهاية الدفتر مطلوبة (أرقام فقط).'); end if;
    if (api.t(p,'lastNo'))::bigint < (api.t(p,'firstNo'))::bigint or (api.t(p,'lastNo'))::bigint - (api.t(p,'firstNo'))::bigint >= 1000 then
      return api.err('نهاية الدفتر لازم تكون بعد بدايته وبحد أقصى 1000 ورقة.'); end if;
    if exists (select 1 from treasury.cheque_books x where x.bank_account = v_acc and x.id is distinct from (api.t(p,'id'))::uuid and x.status <> 'ملغى'
               and int8range(x.first_no, x.last_no, '[]') && int8range((api.t(p,'firstNo'))::bigint, (api.t(p,'lastNo'))::bigint, '[]')) then
      return api.err('أرقام الدفتر متداخلة مع دفتر مسجّل.'); end if;
    if api.t(p,'id') is null then
      insert into treasury.cheque_books(bank_account, book_no, first_no, last_no, received_date, notes, created_by)
      values (v_acc, api.t(p,'bookNo'), (api.t(p,'firstNo'))::bigint, (api.t(p,'lastNo'))::bigint, coalesce((api.t(p,'receivedDate'))::date, current_date), api.t(p,'notes'), v_user);
    else
      update treasury.cheque_books set book_no = api.t(p,'bookNo'), first_no = (api.t(p,'firstNo'))::bigint, last_no = (api.t(p,'lastNo'))::bigint,
        received_date = coalesce((api.t(p,'receivedDate'))::date, received_date), status = coalesce(api.t(p,'status'), status), notes = api.t(p,'notes')
      where id = (api.t(p,'id'))::uuid;
    end if;
    return api.ok(jsonb_build_object('items', api.bank_books(v_acc)));

  elsif p_action = 'BANK_SPOIL' then
    select * into b from treasury.cheque_books where id = (api.t(p,'bookId'))::uuid;
    if b.id is null then return api.err('الدفتر غير موجود.'); end if;
    if api.t(p,'chequeNo') !~ '^\d{1,18}$' or (api.t(p,'chequeNo'))::bigint not between b.first_no and b.last_no then return api.err('الرقم خارج نطاق الدفتر.'); end if;
    if exists (select 1 from treasury.cheques where cheque_no = api.t(p,'chequeNo')) then return api.err('الرقم صادر به شيك — استخدم «إلغاء الشيك» بدلاً من ذلك.'); end if;
    if api.t(p,'reason') is null then return api.err('سبب الإلغاء/التلف مطلوب.'); end if;
    insert into treasury.cheque_spoiled(book_id, cheque_no, spoil_date, reason, created_by)
    values (b.id, api.t(p,'chequeNo'), coalesce((api.t(p,'date'))::date, current_date), api.t(p,'reason'), v_user);
    return api.ok(jsonb_build_object('items', api.bank_books(v_acc)));

  elsif p_action = 'BANK_VOID' then
    select * into c from treasury.cheques where id = (api.t(p,'id'))::uuid for update;
    if c.id is null then return api.err('الشيك غير موجود.'); end if;
    if c.status <> 'صادر' then return api.err('لا يُلغى إلا شيك «صادر» لم يُسوَّ.'); end if;
    if c.cleared_date is not null then return api.err('الشيك منصرف من البنك فعلاً — لا يمكن إلغاؤه.'); end if;
    if exists (select 1 from treasury.settlements where cheque_id = c.id) then return api.err('الشيك عليه تسوية.'); end if;
    if api.t(p,'reason') is null then return api.err('سبب الإلغاء مطلوب.'); end if;
    v_date := coalesce((api.t(p,'date'))::date, current_date);
    if v_date < c.issue_date then return api.err('تاريخ الإلغاء قبل تاريخ الإصدار.'); end if;
    if c.entry_id is not null then v_rev := finance.reverse(c.entry_id, v_date, 'إلغاء شيك ' || coalesce(c.cheque_no, '') || ' — ' || api.t(p,'reason'), v_user); end if;
    update treasury.cheques set status = 'ملغى', voided_at = now(), void_reason = api.t(p,'reason'), void_entry_id = v_rev where id = c.id;
    update benefits.ledger set status = 'ملغاة', notes = coalesce(notes || ' · ', '') || 'ألغي الشيك' where source_module = 'الخزينة' and source_ref = 'CHQ:' || c.id;
    update grants.requests set status = 'معتمد', cheque_id = null where cheque_id = c.id and status = 'مصروف';
    return api.ok(jsonb_build_object('reverseEntry', v_rev));

  elsif p_action = 'BANK_CLEAR' then
    -- تأكيد الصرف/الإيداع من كشف البنك (أو إلغاء التأكيد بإرسال date فارغ)
    v_date := (nullif(api.t(p,'date'),''))::date;
    if api.t(p,'kind') = 'cheque' then
      update treasury.cheques set cleared_date = v_date
      where id in (select (x)::uuid from jsonb_array_elements_text(coalesce(p->'ids','[]')) x) and status <> 'ملغى' and (v_date is null or v_date >= issue_date);
    else
      update treasury.receipts set cleared_date = v_date
      where id in (select (x)::uuid from jsonb_array_elements_text(coalesce(p->'ids','[]')) x) and (v_date is null or v_date >= receipt_date);
    end if;
    get diagnostics n = row_count;
    return api.ok(jsonb_build_object('updated', n));

  elsif p_action = 'BANK_CLEAR_UPTO' then
    -- تأكيد جماعي: كل الشيكات والإيداعات حتى تاريخ معيّن تُعتبر ظهرت في البنك (بتاريخ إصدارها) — عدا ما يُستثنى
    v_date := (api.t(p,'upto'))::date;
    if v_date is null then return api.err('حدد التاريخ.'); end if;
    update treasury.cheques set cleared_date = issue_date where bank_account = v_acc and cleared_date is null and status <> 'ملغى' and issue_date <= v_date
      and id not in (select (x)::uuid from jsonb_array_elements_text(coalesce(p->'except','[]')) x);
    get diagnostics n = row_count;
    update treasury.receipts set cleared_date = receipt_date where cleared_date is null and receipt_date <= v_date and cash_account = v_acc;
    return api.ok(jsonb_build_object('updated', n));

  elsif p_action = 'BANK_RECON_SAVE' then
    v_date := (api.t(p,'date'))::date;
    if v_date is null or (nullif(p->>'stmtBalance',''))::numeric is null then return api.err('تاريخ الكشف ورصيده مطلوبان.'); end if;
    if exists (select 1 from treasury.bank_reconciliations where bank_account = v_acc and stmt_date = v_date and status = 'معتمدة') then
      return api.err('توجد مطابقة معتمدة لهذا التاريخ.'); end if;
    r := api.bank_recon(v_acc, v_date, (p->>'stmtBalance')::numeric);
    insert into treasury.bank_reconciliations(bank_account, stmt_date, stmt_balance, book_balance, outstanding_cheques, deposits_in_transit, difference, items, notes, created_by)
    values (v_acc, v_date, (p->>'stmtBalance')::numeric, (r->>'book_balance')::numeric, (r->>'outstanding_cheques')::numeric, (r->>'deposits_in_transit')::numeric,
            (r->>'difference')::numeric, jsonb_build_object('cheques', r->'cheques', 'deposits', r->'deposits'), api.t(p,'notes'), v_user)
    on conflict (bank_account, stmt_date) do update set stmt_balance = excluded.stmt_balance, book_balance = excluded.book_balance,
      outstanding_cheques = excluded.outstanding_cheques, deposits_in_transit = excluded.deposits_in_transit, difference = excluded.difference,
      items = excluded.items, notes = excluded.notes, created_by = excluded.created_by, created_at = now();
    if coalesce((p->>'approve')::boolean, false) then
      if abs((r->>'difference')::numeric) >= 0.01 then return api.err('لا تُعتمد مطابقة بها فرق غير مفسَّر.'); end if;
      if not (core.can(uid,'finance.period.close') or core.is_admin(uid)) then return api.err('الاعتماد يحتاج صلاحية إقفال الفترات.'); end if;
      update treasury.bank_reconciliations set status = 'معتمدة', approved_by = v_user, approved_at = now() where bank_account = v_acc and stmt_date = v_date;
    end if;
    return api.ok(jsonb_build_object('recon', api.bank_recon(v_acc, v_date, (p->>'stmtBalance')::numeric)));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- إظهار حالة الصرف في قائمة الشيكات وتفصيلها (تعديل جراحي)
do $$ declare f regprocedure := (select oid::regprocedure from pg_proc where proname = 'handle_finance' and pronamespace = 'api'::regnamespace);
  d text; a text := $a$c.purpose, c.status, c.requires_settlement,$a$;
begin
  d := pg_get_functiondef(f);
  if position('c.cleared_date, c.void_reason' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'مرساة FIN_CHEQUES غير موجودة'; end if;
  d := replace(d, a, a || ' c.cleared_date, c.void_reason,');
  execute d;
end $$;

-- الموجّه: فرع BANK_
do $$ declare d text := pg_get_functiondef('api.handle(text,jsonb,jsonb)'::regprocedure); begin
  if position('BANK\_%' in d) > 0 then return; end if;
  if position($a$or p_action like 'SYS\_%' then$a$ in d) = 0 or position($a$elsif p_action like 'SYS\_%' then return api.handle_system(p_action, p, uid);$a$ in d) = 0 then
    raise exception 'مرساة الموجّه غير موجودة'; end if;
  d := replace(d, $a$or p_action like 'SYS\_%' then$a$, $a$or p_action like 'SYS\_%' or p_action like 'BANK\_%' then$a$);
  d := replace(d, $a$elsif p_action like 'SYS\_%' then return api.handle_system(p_action, p, uid);$a$,
    $a$elsif p_action like 'SYS\_%' then return api.handle_system(p_action, p, uid);
    elsif p_action like 'BANK\_%' then return api.handle_bank(p_action, p, uid);$a$);
  execute d;
end $$;

revoke all on all functions in schema core, api, treasury, finance from public, anon, authenticated;
