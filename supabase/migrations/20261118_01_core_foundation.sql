-- المرحلة 1 — النواة: الأشخاص والأسر والحركات والصلاحيات والإعدادات والترقيم والتدقيق
-- schemas جديدة فقط — لا تمس books ولا public.

create schema if not exists core;
create schema if not exists audit;
create schema if not exists legacy;

revoke all on schema core, audit, legacy from public, anon, authenticated;

-- ───────────────────────── التدقيق (لا يُمسح) ─────────────────────────
create table audit.log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       text,                     -- معرّف المستخدم أو SYSTEM
  action      text not null,            -- INSERT / UPDATE / DELETE / أو اسم عملية
  entity      text not null,            -- schema.table
  entity_id   text,
  before      jsonb,
  after       jsonb,
  reason      text
);
create index on audit.log (entity, entity_id);
create index on audit.log (at);

create or replace function audit.block_change() returns trigger language plpgsql as $$
begin raise exception 'سجل التدقيق لا يُعدَّل ولا يُحذف'; end $$;
create trigger audit_log_immutable before update or delete on audit.log
  for each row execute function audit.block_change();

-- مُشغّل عام: يسجّل أي تغيير في الجداول المحمية
create or replace function audit.track() returns trigger language plpgsql security definer as $$
declare v_actor text := coalesce(current_setting('erp.actor', true), 'SYSTEM');
        v_reason text := nullif(current_setting('erp.reason', true), '');
        v_id text;
begin
  v_id := coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', '');
  insert into audit.log(actor, action, entity, entity_id, before, after, reason)
  values (v_actor, tg_op, tg_table_schema || '.' || tg_table_name, v_id,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end, v_reason);
  return coalesce(new, old);
end $$;

create or replace function core.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ───────────────────────── القوائم المرجعية ─────────────────────────
-- جهات العمل، الوظائف، الدرجات، المؤهلات، ... (تديرها الإدارة)
create table core.ref_lists (
  list_key  text not null,
  value     text not null,
  parent    text,                     -- لقوائم متتابعة (مثلاً إدارة تحت جهة)
  sort      int  not null default 0,
  active    boolean not null default true,
  primary key (list_key, value)
);

-- ───────────────────────── الأشخاص ─────────────────────────
create table core.persons (
  id               uuid primary key default gen_random_uuid(),
  job_id           text unique,                       -- الرقم الوظيفي (مفتاح الربط)
  national_id      text unique check (national_id ~ '^[23][0-9]{13}$'),
  full_name        text not null check (length(trim(full_name)) >= 3),
  gender           text check (gender in ('ذكر','أنثى')),
  birth_date       date,
  phone            text check (phone ~ '^01[0-9]{9}$'),
  phone2           text check (phone2 ~ '^01[0-9]{9}$'),
  email            text,
  address          text,
  qualification    text,
  specialization   text,
  marital_status   text check (marital_status in ('أعزب','متزوج','مطلق','أرمل')),
  blood_type       text,
  special_needs    text,
  emergency        jsonb,                             -- {name, relation, phone}
  insurance_no     text,
  hire_date        date,
  retirement_date  date,
  monthly_dues     numeric(10,2) check (monthly_dues >= 0),  -- الاستقطاع الشهري للنقابة العامة
  person_type      text not null default 'موظف'
                   check (person_type in ('موظف','معاش','تعهيد','زائر')),
  legacy_ref       text,                              -- معرّف MyNekaba للتتبع
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger persons_touch before update on core.persons for each row execute function core.touch();
create trigger persons_audit after insert or update or delete on core.persons for each row execute function audit.track();

-- النوع وتاريخ الميلاد من الرقم القومي تلقائياً
create or replace function core.fill_from_nid() returns trigger language plpgsql as $$
begin
  if new.national_id ~ '^[23][0-9]{13}$' then   -- القومي غير الصحيح يرفضه CHECK برسالة واضحة
    new.gender := coalesce(new.gender,
      case when substr(new.national_id,13,1)::int % 2 = 1 then 'ذكر' else 'أنثى' end);
    begin
      new.birth_date := coalesce(new.birth_date, make_date(
        (case substr(new.national_id,1,1) when '2' then 1900 else 2000 end) + substr(new.national_id,2,2)::int,
        substr(new.national_id,4,2)::int, substr(new.national_id,6,2)::int));
    exception when others then null; end;
  end if;
  return new;
end $$;
create trigger persons_nid before insert or update of national_id on core.persons
  for each row execute function core.fill_from_nid();

-- ───────────────────────── الحركات (سجل زمني) ─────────────────────────
-- field = البُعد الذي تغيّره الحركة؛ الوضع الحالي وأي وضع في تاريخ سابق مشتق منها.
create table core.person_movements (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid not null references core.persons(id) on delete restrict,
  kind             text not null,                     -- ترقية / نقل جهة عمل / انتقال إلى نقابة مستقلة / إحالة للمعاش ...
  field            text not null check (field in
                     ('job_title','grade','workplace','union_org','member_state')),
  from_value       text,
  to_value         text not null,
  effective_date   date not null,
  expected_return  date,
  decision_ref     text,
  decision_date    date,
  notes            text,
  created_by       text,
  created_at       timestamptz not null default now(),
  check (expected_return is null or expected_return >= effective_date),
  check (field <> 'union_org' or to_value in ('النقابة العامة','نقابة مستقلة','غير منضم')),
  check (field <> 'member_state' or to_value in
         ('نشط','موقوف','إجازة بدون أجر','نقل','معاش','استقالة','وفاة'))
);
create index on core.person_movements (person_id, field, effective_date desc);
create trigger movements_audit after insert or update or delete on core.person_movements
  for each row execute function audit.track();

-- الوضع في تاريخ معيّن (للاستحقاق: «كان في النقابة العامة يوم الرحلة؟»)
create or replace function core.state_at(p_person uuid, p_field text, p_date date default current_date)
returns text language sql stable as $$
  select to_value from core.person_movements
  where person_id = p_person and field = p_field and effective_date <= p_date
  order by effective_date desc, created_at desc limit 1
$$;

-- الوضع الحالي لكل شخص
create or replace view core.person_current as
select p.*,
  core.state_at(p.id,'union_org')    as union_org,
  core.state_at(p.id,'member_state') as member_state,
  core.state_at(p.id,'workplace')    as workplace,
  core.state_at(p.id,'job_title')    as job_title,
  core.state_at(p.id,'grade')        as grade
from core.persons p;

-- مدد البقاء: كل فترة من الحركة للتالية
create or replace view core.person_periods as
select person_id, field, to_value as value, effective_date as from_date,
  lead(effective_date) over w as to_date,
  (coalesce(lead(effective_date) over w, current_date) - effective_date) as days
from core.person_movements
window w as (partition by person_id, field order by effective_date, created_at);

-- مستحق دعم النقابة العامة في تاريخ معيّن
create or replace function core.is_union_beneficiary(p_person uuid, p_date date default current_date)
returns boolean language plpgsql stable as $$
begin
  return coalesce(core.state_at(p_person,'union_org',p_date) = 'النقابة العامة', false)
     and coalesce(core.state_at(p_person,'member_state',p_date), 'نشط')
         in (select jsonb_array_elements_text(coalesce(
               core.setting('BENEFIT_ELIGIBLE_STATES', extract(year from p_date)::int),
               '["نشط"]'::jsonb)));
end $$;

-- ───────────────────────── الأسرة ─────────────────────────
create table core.family_members (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid not null references core.persons(id) on delete restrict,
  full_name        text not null check (length(trim(full_name)) >= 2),
  relation         text not null check (relation in
                     ('زوج','زوجة','ابن','ابنة','أب','أم','أخ','أخت','حفيد','حفيدة','أخرى')),
  relation_note    text,
  gender           text check (gender in ('ذكر','أنثى')),
  birth_date       date,
  national_id      text check (national_id ~ '^[23][0-9]{13}$'),
  edu_stage        text,
  edu_grade        text,
  school_type      text,
  edu_track        text,
  linked_person_id uuid references core.persons(id),   -- الزوج/الزوجة موظف بالشركة
  special_needs    boolean not null default false,
  notes            text,
  active           boolean not null default true,      -- الحذف = تعطيل (التاريخ يبقى)
  books_key        text,                               -- مفتاح الربط مع Kids_JSON في الكتب
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (person_id, full_name, relation)
);
create index on core.family_members (person_id) where active;
create trigger family_touch before update on core.family_members for each row execute function core.touch();
create trigger family_audit after insert or update or delete on core.family_members
  for each row execute function audit.track();

-- طلبات تعديل البيانات الإدارية (الموظف يطلب — المسؤول يعتمد)
create table core.change_requests (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references core.persons(id),
  field        text not null,
  old_value    text,
  new_value    text not null,
  reason       text,
  status       text not null default 'معلّق' check (status in ('معلّق','معتمد','مرفوض')),
  decided_by   text,
  decided_at   timestamptz,
  decision_note text,
  created_at   timestamptz not null default now()
);
create trigger change_requests_audit after insert or update or delete on core.change_requests
  for each row execute function audit.track();

-- ───────────────────────── المستخدمون والصلاحيات ─────────────────────────
create table core.roles (
  code  text primary key,
  name  text not null,
  kind  text not null check (kind in ('member','staff','admin'))
);

create table core.permissions (
  code    text primary key,          -- مثال: treasury.cheque.approve
  module  text not null,
  name    text not null
);

create table core.role_permissions (
  role        text references core.roles(code) on delete cascade,
  permission  text references core.permissions(code) on delete cascade,
  max_amount  numeric(14,2),          -- حد مالي (null = بلا حد)
  primary key (role, permission)
);

create table core.users (
  id               uuid primary key default gen_random_uuid(),
  person_id        uuid references core.persons(id),
  username         text unique,         -- للإدارة؛ الأعضاء يدخلون بالرقم الوظيفي
  password_hash    text,
  password_salt    text,
  active           boolean not null default true,
  must_change      boolean not null default true,
  last_login       timestamptz,
  created_at       timestamptz not null default now(),
  check (person_id is not null or username is not null)
);
create unique index on core.users (person_id) where person_id is not null;
create trigger users_audit after insert or update or delete on core.users
  for each row execute function audit.track();

create table core.user_roles (
  user_id  uuid references core.users(id) on delete cascade,
  role     text references core.roles(code),
  scope    jsonb,                        -- تقييد اختياري (مثلاً أنشطة بعينها)
  granted_by text,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
create trigger user_roles_audit after insert or update or delete on core.user_roles
  for each row execute function audit.track();

create or replace function core.can(p_user uuid, p_perm text, p_amount numeric default null)
returns boolean language sql stable as $$
  select exists (
    select 1 from core.user_roles ur
    join core.users u on u.id = ur.user_id and u.active
    join core.role_permissions rp on rp.role = ur.role and rp.permission = p_perm
    where ur.user_id = p_user
      and (p_amount is null or rp.max_amount is null or p_amount <= rp.max_amount))
$$;

-- ───────────────────────── الإعدادات (عامة أو سنوية) ─────────────────────────
create table core.settings (
  key         text not null,
  year        int  not null default 0,     -- 0 = عام لكل السنوات
  value       jsonb not null,
  description text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (key, year)
);
create trigger settings_audit after insert or update or delete on core.settings
  for each row execute function audit.track();

create or replace function core.setting(p_key text, p_year int default extract(year from current_date)::int)
returns jsonb language sql stable as $$
  select value from core.settings where key = p_key and year in (p_year, 0)
  order by year desc limit 1
$$;

-- ───────────────────────── الترقيم بلا فجوات ─────────────────────────
create table core.doc_counters (
  doc_type   text not null,
  year       int  not null,
  prefix     text not null,
  last_value int  not null default 0,
  primary key (doc_type, year)
);

-- يُستدعى داخل نفس transaction العملية: لو فشلت العملية يرجع الرقم (لا فجوات)
create or replace function core.next_doc_no(p_type text, p_prefix text,
                                             p_year int default extract(year from current_date)::int)
returns text language plpgsql as $$
declare v int;
begin
  insert into core.doc_counters(doc_type, year, prefix, last_value) values (p_type, p_year, p_prefix, 1)
  on conflict (doc_type, year) do update set last_value = core.doc_counters.last_value + 1
  returning last_value into v;
  return p_prefix || '-' || p_year || '-' || lpad(v::text, 5, '0');
end $$;

-- ───────────────────────── لقطة MyNekaba الخام ─────────────────────────
create table legacy.raw (
  collection  text not null,
  doc_id      text not null,
  data        jsonb not null,
  imported_at timestamptz not null default now(),
  primary key (collection, doc_id)
);

-- ───────────────────────── الأمان ─────────────────────────
-- RLS مفعّل بلا سياسات = لا وصول إلا عبر الخادم (service role) — نفس نهج books
do $$ declare r record; begin
  for r in select schemaname, tablename from pg_tables where schemaname in ('core','audit','legacy') loop
    execute format('alter table %I.%I enable row level security', r.schemaname, r.tablename);
    execute format('revoke all on %I.%I from anon, authenticated', r.schemaname, r.tablename);
  end loop;
end $$;
