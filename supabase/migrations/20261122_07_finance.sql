-- المرحلة 3 — المالية والخزينة: دليل الحسابات، القيد المزدوج، الفترات، مراكز التكلفة، الشيكات، التسويات، المقبوضات
create schema if not exists finance;
create schema if not exists treasury;
revoke all on schema finance, treasury from public, anon, authenticated;

-- ───────── دليل الحسابات (المعتمد 18 نوفمبر) ─────────
create table finance.accounts (
  code     text primary key,
  name     text not null,
  parent   text references finance.accounts(code),
  type     text not null check (type in ('أصول','خصوم','أرصدة','إيرادات','مصروفات')),
  postable boolean not null default true,       -- الحسابات الرئيسية لا يُرحَّل عليها
  active   boolean not null default true
);
insert into finance.accounts(code, name, parent, type, postable) values
 ('1','الأصول',null,'أصول',false),('11','النقدية','1','أصول',false),
 ('1101','الخزينة الرئيسية','11','أصول',true),('1102','البنك — الحساب الجاري','11','أصول',true),('1103','عُهد وسلف تحت التسوية','11','أصول',true),
 ('12','المدينون','1','أصول',false),('1201','أقساط أعضاء — مبادرات','12','أصول',true),('1202','أقساط أعضاء — رحلات وعمرة','12','أصول',true),
 ('1203','استقطاعات رواتب تحت التحصيل','12','أصول',true),('13','المخزون','1','أصول',false),('1301','مخزون المبادرات','13','أصول',true),
 ('2','الخصوم',null,'خصوم',false),('2101','موردون ومقدمو خدمات','2','خصوم',true),('2201','مقبوضات مقدماً من الأعضاء','2','خصوم',true),
 ('2301','أرصدة مستحقة الرد للأعضاء','2','خصوم',true),
 ('3','الأرصدة والصناديق',null,'أرصدة',false),('3101','رصيد الدورة الافتتاحي','3','أرصدة',true),('3201','فائض/عجز سنوات سابقة','3','أرصدة',true),
 ('4','الإيرادات',null,'إيرادات',false),('4101','تحويلات ومخصصات النقابة العامة','4','إيرادات',true),
 ('4201','اشتراكات الأعضاء في الأنشطة','4','إيرادات',true),('4301','إيرادات مبادرات الشراء','4','إيرادات',true),
 ('4401','فوائد وإيرادات بنكية','4','إيرادات',true),('4901','إيرادات أخرى','4','إيرادات',true),
 ('5','المصروفات',null,'مصروفات',false),
 ('51','المنح الاجتماعية','5','مصروفات',false),('5101','منحة وفاة','51','مصروفات',true),('5102','منحة زواج','51','مصروفات',true),
 ('5103','منحة مولود','51','مصروفات',true),('5104','منحة تفوق','51','مصروفات',true),('5105','منحة علاج','51','مصروفات',true),('5199','منح أخرى','51','مصروفات',true),
 ('52','دعم الأنشطة','5','مصروفات',false),('5201','دعم رحلات','52','مصروفات',true),('5202','دعم مصايف','52','مصروفات',true),
 ('5203','دعم إفطار','52','مصروفات',true),('5204','دعم فعاليات ومسابقات','52','مصروفات',true),('5205','جوائز وهدايا','52','مصروفات',true),
 ('53','تكاليف الأنشطة المباشرة','5','مصروفات',false),('5301','نقل','53','مصروفات',true),('5302','إقامة','53','مصروفات',true),
 ('5303','وجبات ومشروبات','53','مصروفات',true),('5304','تذاكر','53','مصروفات',true),
 ('5401','إعفاءات المشرفين','5','مصروفات',true),
 ('55','المصروفات الإدارية','5','مصروفات',false),('5501','مصروفات إدارية','55','مصروفات',true),('5502','مصاريف بنكية','55','مصروفات',true),
 ('5503','مخصصات لجان','55','مصروفات',true),('5504','بدلات جلسات المجلس','55','مصروفات',true),('5505','ضيافة','55','مصروفات',true),
 ('5506','انتقالات','55','مصروفات',true),('5507','مطبوعات ولافتات','55','مصروفات',true),
 ('5601','تكلفة مبادرات الشراء المباعة','5','مصروفات',true);

-- ───────── مراكز التكلفة والفترات ─────────
create table finance.cost_centers (
  code    text primary key,
  name    text not null,
  kind    text not null default 'نشاط' check (kind in ('نشاط','مبادرة','إداري','منح')),
  decision_id uuid references governance.decisions(id),
  active  boolean not null default true
);
insert into finance.cost_centers(code, name, kind) values ('ADM','إداري عام','إداري'),('GRANTS','المنح الاجتماعية','منح'),('BOOKS','مبادرة الكتب','مبادرة');

create table finance.periods (
  year int not null, month int not null check (month between 1 and 12),
  status text not null default 'مفتوحة' check (status in ('مفتوحة','مقفولة')),
  closed_by text, closed_at timestamptz,
  primary key (year, month)
);

-- ───────── القيود ─────────
create table finance.entries (
  id          uuid primary key default gen_random_uuid(),
  entry_no    text not null unique,
  entry_date  date not null,
  description text not null,
  source      text not null default 'يدوي',     -- شيك / تسوية / إيصال / رسوم بنكية / افتتاحي / عكس / يدوي
  source_ref  uuid,
  decision_id uuid references governance.decisions(id),
  status      text not null default 'مرحّل' check (status in ('مرحّل','معكوس')),
  reversal_of uuid references finance.entries(id),
  created_by  text,
  created_at  timestamptz not null default now(),
  legacy_ref  text unique
);
create index on finance.entries (entry_date);
create table finance.lines (
  id          bigserial primary key,
  entry_id    uuid not null references finance.entries(id),
  account     text not null references finance.accounts(code),
  debit       numeric(14,2) not null default 0 check (debit >= 0),
  credit      numeric(14,2) not null default 0 check (credit >= 0),
  cost_center text references finance.cost_centers(code),
  person_id   uuid references core.persons(id),
  party       text,                                   -- طرف خارجي بالاسم
  memo        text,
  check ((debit = 0) <> (credit = 0))                 -- طرف واحد فقط في كل سطر
);
create index on finance.lines (account); create index on finance.lines (entry_id); create index on finance.lines (person_id);

-- الحساب قابل للترحيل
create or replace function finance.check_line() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from finance.accounts where code = new.account and postable and active) then
    raise exception 'الحساب % غير قابل للترحيل', new.account using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger lines_check before insert on finance.lines for each row execute function finance.check_line();

-- القيد متوازن (يُفحص عند نهاية الـ transaction)
create or replace function finance.check_balanced() returns trigger language plpgsql as $$
declare d numeric; c numeric; n int;
  eid uuid := coalesce((to_jsonb(new)->>'entry_id')::uuid, (to_jsonb(new)->>'id')::uuid);
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) into d, c, n from finance.lines where entry_id = eid;
  if n < 2 or d <> c or d = 0 then
    raise exception 'القيد غير متوازن (مدين % / دائن % / سطور %)', d, c, n using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger lines_balanced after insert on finance.lines deferrable initially deferred
  for each row execute function finance.check_balanced();
create constraint trigger entries_balanced after insert on finance.entries deferrable initially deferred
  for each row execute function finance.check_balanced();

-- الفترة المقفولة لا يُرحَّل فيها
create or replace function finance.check_period() returns trigger language plpgsql as $$
begin
  if exists (select 1 from finance.periods where year = extract(year from new.entry_date) and month = extract(month from new.entry_date)
             and status = 'مقفولة') then
    raise exception 'الفترة %/% مقفولة — التصحيح بقيد عكسي في فترة مفتوحة', extract(month from new.entry_date), extract(year from new.entry_date)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger entries_period before insert on finance.entries for each row execute function finance.check_period();

-- القيود والسطور لا تُعدَّل ولا تُحذف (عدا تعليم القيد «معكوس»)
create or replace function finance.immutable() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'entries' and tg_op = 'UPDATE' then   -- شرط منفصل: سطور القيود ليس لها حقل status
    if (to_jsonb(new)->>'status') = 'معكوس' and (to_jsonb(old)->>'status') = 'مرحّل'
       and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then return new; end if;
  end if;
  raise exception 'القيود المرحّلة لا تُعدَّل ولا تُحذف — استخدم القيد العكسي' using errcode = 'check_violation';
end $$;
create trigger entries_immutable before update or delete on finance.entries for each row execute function finance.immutable();
create trigger lines_immutable before update or delete on finance.lines for each row execute function finance.immutable();

-- ترحيل قيد: {date, description, source, source_ref, decision_id, legacy_ref, lines:[{account, debit|credit, cost_center, person_id, party, memo}]}
create or replace function finance.post(p jsonb, p_actor text default null) returns uuid language plpgsql as $$
declare v_id uuid; v_date date := (p->>'date')::date; l jsonb;
begin
  if p->>'legacy_ref' is not null then
    select id into v_id from finance.entries where legacy_ref = p->>'legacy_ref';
    if v_id is not null then return v_id; end if;   -- إعادة الاستيراد لا تكرر
  end if;
  insert into finance.entries(entry_no, entry_date, description, source, source_ref, decision_id, created_by, legacy_ref)
  values (core.next_doc_no('JE', 'قيد', extract(year from v_date)::int), v_date, p->>'description', coalesce(p->>'source','يدوي'),
          (p->>'source_ref')::uuid, (p->>'decision_id')::uuid, coalesce(p_actor, current_setting('erp.actor', true)), p->>'legacy_ref')
  returning id into v_id;
  for l in select * from jsonb_array_elements(p->'lines') loop
    if coalesce((l->>'debit')::numeric, 0) = 0 and coalesce((l->>'credit')::numeric, 0) = 0 then continue; end if;
    insert into finance.lines(entry_id, account, debit, credit, cost_center, person_id, party, memo)
    values (v_id, l->>'account', round(coalesce((l->>'debit')::numeric,0), 2), round(coalesce((l->>'credit')::numeric,0), 2),
            nullif(l->>'cost_center',''), (nullif(l->>'person_id',''))::uuid, nullif(l->>'party',''), nullif(l->>'memo',''));
  end loop;
  return v_id;
end $$;

-- قيد عكسي
create or replace function finance.reverse(p_entry uuid, p_date date, p_reason text, p_actor text default null) returns uuid
language plpgsql as $$
declare e finance.entries; v_id uuid;
begin
  select * into e from finance.entries where id = p_entry for update;
  if e.id is null or e.status <> 'مرحّل' then raise exception 'القيد غير موجود أو معكوس' using errcode = 'check_violation'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'سبب العكس مطلوب' using errcode = 'check_violation'; end if;
  v_id := finance.post(jsonb_build_object('date', p_date, 'description', 'عكس ' || e.entry_no || ': ' || p_reason, 'source', 'عكس',
    'source_ref', e.id, 'lines', (select jsonb_agg(jsonb_build_object('account', account, 'debit', credit, 'credit', debit,
      'cost_center', cost_center, 'person_id', person_id, 'party', party, 'memo', memo)) from finance.lines where entry_id = e.id)), p_actor);
  update finance.entries set status = 'معكوس' where id = e.id;
  return v_id;
end $$;

-- ميزان المراجعة لفترة
create or replace function finance.trial_balance(p_from date, p_to date)
returns table (code text, name text, type text, opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable as $$
  with mv as (
    select l.account, sum(case when e.entry_date < p_from then l.debit - l.credit else 0 end) ob,
           sum(case when e.entry_date between p_from and p_to then l.debit else 0 end) dr,
           sum(case when e.entry_date between p_from and p_to then l.credit else 0 end) cr
    from finance.lines l join finance.entries e on e.id = l.entry_id where e.entry_date <= p_to group by l.account)
  select a.code, a.name, a.type, coalesce(mv.ob,0), coalesce(mv.dr,0), coalesce(mv.cr,0), coalesce(mv.ob,0) + coalesce(mv.dr,0) - coalesce(mv.cr,0)
  from finance.accounts a join mv on mv.account = a.code order by a.code
$$;

-- ───────── الخزينة ─────────
create table treasury.cheques (
  id                  uuid primary key default gen_random_uuid(),
  cheque_no           text,
  bank_account        text not null default '1102' references finance.accounts(code),
  issue_date          date not null,
  amount              numeric(14,2) not null check (amount > 0),
  payee_person_id     uuid references core.persons(id),
  payee_name          text not null,
  purpose             text not null check (purpose in ('منحة','عهدة','دعم نشاط','مصروف','أخرى')),
  expense_account     text references finance.accounts(code),   -- للصرف المباشر
  decision_id         uuid references governance.decisions(id),
  cost_center         text references finance.cost_centers(code),
  requires_settlement boolean not null default false,
  status              text not null default 'صادر' check (status in ('صادر','مسوّى','مرحّل الرصيد','ملغى')),
  entry_id            uuid references finance.entries(id),
  notes               text,
  legacy_ref          text unique,
  created_at          timestamptz not null default now()
);
create unique index on treasury.cheques (bank_account, cheque_no) where cheque_no is not null and legacy_ref is null;

create table treasury.settlements (
  id             uuid primary key default gen_random_uuid(),
  cheque_id      uuid not null unique references treasury.cheques(id),
  settle_date    date not null,
  advance        numeric(14,2) not null,          -- قيمة العهدة (قد تشمل شيكات مجمّعة)
  prev_balance   numeric(14,2) not null default 0, -- رصيد مرحّل من عهدة سابقة
  subscriptions  numeric(14,2) not null default 0, -- اشتراكات حُصّلت من المشاركين
  spent          numeric(14,2) not null,
  returned       numeric(14,2) not null default 0,
  return_mode    text not null check (return_mode in ('لا يوجد','رد للخزينة','توريد للبنك','ترحيل')),
  entry_id       uuid references finance.entries(id),
  notes          text,
  legacy_ref     text unique
);
create table treasury.settlement_lines (
  settlement_id uuid not null references treasury.settlements(id),
  line_no       int not null,
  category      text not null,
  account       text not null references finance.accounts(code),
  amount        numeric(14,2) not null check (amount > 0),
  doc_date      date,
  notes         text,
  beneficiaries jsonb,          -- مثلاً أعضاء المجلس في بدل الجلسات (لسجل المزايا)
  primary key (settlement_id, line_no)
);

create table treasury.receipts (
  id           uuid primary key default gen_random_uuid(),
  receipt_no   text not null unique,
  receipt_date date not null,
  amount       numeric(14,2) not null check (amount > 0),
  kind         text not null check (kind in ('تحويل النقابة العامة','اشتراكات','رد عهدة','إيرادات أخرى','رسوم بنكية')),
  party        text,
  person_id    uuid references core.persons(id),
  account      text not null references finance.accounts(code),    -- الطرف الدائن (أو المدين للرسوم)
  cash_account text not null default '1102' references finance.accounts(code),
  decision_id  uuid references governance.decisions(id),
  cost_center  text references finance.cost_centers(code),
  entry_id     uuid references finance.entries(id),
  notes        text,
  legacy_ref   text unique,
  created_at   timestamptz not null default now()
);

-- تصنيف بند التسوية ← حساب
create table finance.category_map (category text primary key, account text not null references finance.accounts(code));
insert into finance.category_map values
 ('بدل جلسات','5504'),('بدل ضيافة','5505'),('بدل انتقال','5506'),('هدايا','5205'),('جوائز نقدية','5205'),
 ('مشروبات ومأكولات','5303'),('مطبوعات ولافتات','5507'),('إيجار سيارة','5301'),('انتقالات بالباص','5301'),
 ('حجز تذاكر','5304'),('رسوم','5501'),('إقامة بالفندق','5302'),('أدوات مكتبية','5501'),('مصروفات بريد','5501'),('مشتريات أخرى','5501');

-- أرصدة العُهد لكل شخص
create or replace view treasury.custody_balances as
select l.person_id, l.party, sum(l.debit - l.credit) balance
from finance.lines l where l.account = '1103' group by l.person_id, l.party having sum(l.debit - l.credit) <> 0;

do $$ declare r record; begin
  for r in select schemaname, tablename from pg_tables where schemaname in ('finance','treasury') loop
    execute format('alter table %I.%I enable row level security', r.schemaname, r.tablename);
    execute format('revoke all on %I.%I from anon, authenticated', r.schemaname, r.tablename);
    if r.tablename in ('entries','cheques','settlements','receipts','accounts','cost_centers','periods') then
      execute format('create trigger %I after insert or update or delete on %I.%I for each row execute function audit.track()',
        r.tablename || '_audit', r.schemaname, r.tablename);
    end if;
  end loop;
end $$;
revoke all on all functions in schema finance, treasury from public, anon, authenticated;
