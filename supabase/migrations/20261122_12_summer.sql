-- المرحلة 6 — المصايف (داخل schema activities بجداول summer_*)
-- موسم مرن كل سنة ← مصايف ← وحدات (نوع/سعة/سعر/تأمين/تكلفة المالك) × أفواج (فترات) = الخانات.
-- التقديم في فترة ← التوزيع (أسبقية | قرعة موثّقة قابلة للتحقق | أولوية لمن لم يستفد) ← قبول بمهلة سداد / احتياطي مرتب
-- ← اعتذار بشروط مجمّدة ورد بقيد ← تصعيد تلقائي من الاحتياطي ← تبديل (فوج/وحدة/تبادل بين عضوين بموافقة الطرفين والإدارة)
-- ← محضر تسليم (تحصيل التأمين) واستلام (رد التأمين أو الخصم) ← الإقفال: الدعم ⇒ سجل المزايا + استحقاق المالك (5302 ← 2101).
-- كل حركة تُسجّل في summer_events.

insert into finance.accounts(code, name, parent, type, postable, active)
values ('2202', 'تأمينات مستردة للأعضاء', '2', 'خصوم', true, true) on conflict (code) do nothing;

create table activities.summer_seasons (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,                 -- = مركز التكلفة (SUM-2027-001)
  year            int not null,
  title           text not null,
  apply_open      timestamptz,
  apply_close     timestamptz,
  method          text not null default 'قرعة' check (method in ('أسبقية','قرعة','أولوية لمن لم يستفد')),
  lookback_years  int not null default 2 check (lookback_years >= 0),   -- «لم يستفد» خلال كم سنة
  max_prefs       int not null default 3 check (max_prefs between 1 and 10),
  hold_hours      int not null default 72 check (hold_hours > 0),
  cancel_policy   jsonb not null default '[{"days_before":14,"refund_pct":100},{"days_before":7,"refund_pct":50},{"days_before":0,"refund_pct":0}]',
  status          text not null default 'مسودة'
                  check (status in ('مسودة','التقديم مفتوح','التقديم مقفول','تم التوزيع','منتهٍ','ملغى')),
  lottery_seed    text,                                  -- البذرة المعلنة (مثلاً رقم سحب علني) — تُثبت قبل التوزيع
  lottery_hash    text,                                  -- sha256 لقائمة الترتيب الناتجة — للتحقق
  allocated_at    timestamptz,
  decision_id     uuid references governance.decisions(id),
  notes           text,
  created_by      text,
  created_at      timestamptz not null default now()
);

create table activities.summer_resorts (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references activities.summer_seasons(id) on delete cascade,
  name        text not null,
  location    text,
  owner_party text,                                     -- المالك/الشركة — طرف في 2101
  notes       text,
  unique (season_id, name)
);

create table activities.summer_units (
  id           uuid primary key default gen_random_uuid(),
  resort_id    uuid not null references activities.summer_resorts(id) on delete cascade,
  code         text not null,                           -- رقم الشقة/الشاليه
  unit_type    text not null default 'شقة' check (unit_type in ('شقة','شاليه','غرفة','فيلا')),
  beds         int not null check (beds > 0),
  full_price   numeric(10,2) not null check (full_price >= 0),    -- التكلفة الكاملة للفوج
  member_price numeric(10,2) not null check (member_price >= 0),  -- ما يدفعه المستحق (الفرق = الدعم)
  deposit      numeric(10,2) not null default 0 check (deposit >= 0),
  owner_cost   numeric(10,2) not null default 0 check (owner_cost >= 0), -- المستحق للمالك عن الفوج المشغول
  active       boolean not null default true,
  unique (resort_id, code),
  check (member_price <= full_price)
);

create table activities.summer_batches (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references activities.summer_seasons(id) on delete cascade,
  name        text not null,                            -- الفوج الأول ...
  start_date  date not null,
  end_date    date not null,
  sort        int not null default 0,
  unique (season_id, name),
  check (end_date > start_date)
);

create table activities.summer_applications (
  id            uuid primary key default gen_random_uuid(),
  app_no        text not null unique,
  season_id     uuid not null references activities.summer_seasons(id),
  person_id     uuid not null references core.persons(id),
  family_size   int not null check (family_size > 0),
  prefs         jsonb not null,                           -- [{batch_id, resort_id?, unit_type?}] بالترتيب
  people        jsonb not null default '[]',              -- [{full_name, relation, age}] أسماء الأسرة
  eligible      boolean not null,                         -- مستحق الدعم يوم بداية الموسم
  prior_benefit boolean not null default false,           -- استفاد من مصيف خلال المدة
  status        text not null default 'مقدَّم' check (status in
                ('مقدَّم','بانتظار السداد','مؤكد','احتياطي','لم يُقبل','معتذر','ملغى','منتهٍ')),
  unit_id       uuid references activities.summer_units(id),
  batch_id      uuid references activities.summer_batches(id),
  draw_key      text,                                     -- مفتاح القرعة = sha256(بذرة|رقم الطلب)
  rank          int,                                      -- ترتيب التوزيع
  reserve_rank  int,                                      -- ترتيب الاحتياطي
  hold_until    timestamptz,
  total         numeric(10,2) not null default 0,
  subsidy       numeric(10,2) not null default 0,
  paid          numeric(10,2) not null default 0,
  refunded      numeric(10,2) not null default 0,
  deposit_held  numeric(10,2) not null default 0,         -- التأمين المحصّل وقت التسليم
  terms         jsonb not null,                           -- شروط الإلغاء وقت التقديم (مجمّدة)
  cancel_reason text,
  submitted_by  text,
  submitted_at  timestamptz not null default clock_timestamp(),
  unique (season_id, person_id)
);
create index on activities.summer_applications (season_id, status);
-- خانة (وحدة × فوج) لطلب واحد فقط من الطلبات الحية
create unique index summer_slot_once on activities.summer_applications (unit_id, batch_id)
  where status in ('بانتظار السداد','مؤكد','منتهٍ');

create table activities.summer_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references activities.summer_applications(id) on delete cascade,
  kind           text not null,      -- تقديم/توزيع/احتياطي/سداد/اعتذار/سقوط مهلة/تصعيد/تبديل فوج/تبديل وحدة/تبادل/تسليم/استلام/رد تأمين/خصم تأمين/إلغاء
  details        jsonb not null default '{}',
  actor          text,
  at             timestamptz not null default clock_timestamp()
);
create index on activities.summer_events (application_id);

create table activities.summer_payments (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references activities.summer_applications(id),
  kind           text not null check (kind in ('سداد','رد','تأمين','رد تأمين','خصم تأمين')),
  amount         numeric(10,2) not null check (amount > 0),
  cash_account   text references finance.accounts(code),
  entry_id       uuid references finance.entries(id),
  receipt_no     text,
  created_by     text,
  created_at     timestamptz not null default now()
);

create table activities.summer_swaps (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('تبديل فوج','تبديل وحدة','تبادل')),
  from_app      uuid not null references activities.summer_applications(id),
  to_app        uuid references activities.summer_applications(id),       -- للتبادل
  to_batch      uuid references activities.summer_batches(id),
  to_unit       uuid references activities.summer_units(id),
  status        text not null default 'مطلوب' check (status in ('مطلوب','وافق الطرف الآخر','معتمد','مرفوض','ملغى')),
  reason        text,
  requested_by  text,
  decided_by    text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);

create table activities.summer_handovers (
  application_id uuid not null references activities.summer_applications(id),
  kind           text not null check (kind in ('تسليم','استلام')),
  at             timestamptz not null default now(),
  condition      text,
  damages        numeric(10,2) not null default 0 check (damages >= 0),
  notes          text,
  by_actor       text,
  primary key (application_id, kind)
);

do $$ declare t text; begin
  foreach t in array array['summer_seasons','summer_resorts','summer_units','summer_batches','summer_applications','summer_events',
                           'summer_payments','summer_swaps','summer_handovers'] loop
    execute format('alter table activities.%I enable row level security', t);
    execute format('revoke all on activities.%I from anon, authenticated', t);
    if t <> 'summer_events' then
      execute format('create trigger %I after insert or update or delete on activities.%I for each row execute function audit.track()', t || '_audit', t);
    end if;
  end loop;
end $$;

-- مركز تكلفة لكل موسم
create or replace function activities.summer_cost_center() returns trigger language plpgsql as $$
begin
  insert into finance.cost_centers(code, name, kind, decision_id) values (new.code, new.title, 'نشاط', new.decision_id)
  on conflict (code) do update set name = excluded.name, decision_id = excluded.decision_id;
  return new;
end $$;
create trigger summer_season_cc after insert or update of title, decision_id on activities.summer_seasons
  for each row execute function activities.summer_cost_center();

-- ───────── أدوات ─────────
create or replace function activities.sum_log(p_app uuid, p_kind text, p_details jsonb, p_actor text) returns void language sql as $$
  insert into activities.summer_events(application_id, kind, details, actor) values (p_app, p_kind, coalesce(p_details,'{}'), p_actor)
$$;

create or replace function activities.sum_season_start(p_season uuid) returns date language sql stable as $$
  select min(start_date) from activities.summer_batches where season_id = p_season
$$;

-- استفاد من مصيف خلال lookback سنة قبل الموسم؟ (طلبات منتهية في مواسم سابقة أو مزايا مصيف مسجّلة/منقولة)
create or replace function activities.sum_prior_benefit(p_person uuid, p_season uuid) returns boolean language sql stable as $$
  select exists (select 1 from activities.summer_applications ap join activities.summer_seasons s on s.id = ap.season_id, activities.summer_seasons me
                 where me.id = p_season and ap.person_id = p_person and ap.season_id <> p_season and ap.status = 'منتهٍ'
                   and s.year >= me.year - me.lookback_years and s.year < me.year)
      or exists (select 1 from benefits.ledger l, activities.summer_seasons me where me.id = p_season and l.person_id = p_person
                   and l.category like '%مصيف%' and l.status = 'فعّالة'
                   and extract(year from l.benefit_date) >= me.year - me.lookback_years and extract(year from l.benefit_date) < me.year)
$$;

create or replace function activities.sum_refund_pct(p_terms jsonb, p_start date, p_on date default current_date) returns int language sql stable as $$
  select coalesce((select (x->>'refund_pct')::int from jsonb_array_elements(p_terms->'cancel_policy') x
                   where (p_start - p_on) >= (x->>'days_before')::int order by (x->>'days_before')::int desc limit 1), 0)
$$;

-- السعر حسب الاستحقاق
create or replace function activities.sum_price(p_unit uuid, p_eligible boolean) returns numeric language sql stable as $$
  select case when p_eligible then member_price else full_price end from activities.summer_units where id = p_unit
$$;

-- هل الخانة متاحة؟
create or replace function activities.sum_slot_free(p_unit uuid, p_batch uuid, p_except uuid default null) returns boolean language sql stable as $$
  select not exists (select 1 from activities.summer_applications where unit_id = p_unit and batch_id = p_batch
                     and status in ('بانتظار السداد','مؤكد','منتهٍ') and id is distinct from p_except)
$$;

-- أنسب وحدة فاضية لتفضيل: نفس الفوج، المصيف/النوع لو محدد، تكفي الأسرة، الأصغر سعة ثم الأرخص
create or replace function activities.sum_find_unit(p_season uuid, p_pref jsonb, p_size int, p_except uuid default null) returns uuid
language sql stable as $$
  select u.id from activities.summer_units u join activities.summer_resorts r on r.id = u.resort_id
  where r.season_id = p_season and u.active and u.beds >= p_size
    and (nullif(p_pref->>'resort_id','') is null or r.id = (p_pref->>'resort_id')::uuid)
    and (nullif(p_pref->>'unit_type','') is null or u.unit_type = p_pref->>'unit_type')
    and (nullif(p_pref->>'unit_id','') is null or u.id = (p_pref->>'unit_id')::uuid)
    and activities.sum_slot_free(u.id, (p_pref->>'batch_id')::uuid, p_except)
  order by u.beds, u.member_price, r.name, u.code limit 1
$$;

-- يضع الطلب في خانة ويحسب المطلوب والدعم (السداد يبدأ من الصفر — الطلب لم يُسدَّد بعد)
create or replace function activities.sum_place(p_app uuid, p_unit uuid, p_batch uuid, p_hours int) returns void language plpgsql as $$
declare ap activities.summer_applications; u activities.summer_units;
begin
  select * into ap from activities.summer_applications where id = p_app;
  select * into u from activities.summer_units where id = p_unit;
  update activities.summer_applications set unit_id = p_unit, batch_id = p_batch, status = 'بانتظار السداد', reserve_rank = null,
    total = case when ap.eligible then u.member_price else u.full_price end,
    subsidy = case when ap.eligible then u.full_price - u.member_price else 0 end,
    hold_until = now() + make_interval(hours => p_hours)
  where id = p_app;
end $$;

-- التصعيد من الاحتياطي لأي خانات فاضية + سقوط المهلات (بعد التوزيع فقط)
create or replace function activities.sum_housekeep(p_season uuid) returns int language plpgsql as $$
declare s activities.summer_seasons; x record; pr jsonb; v_unit uuid; n int := 0;
begin
  select * into s from activities.summer_seasons where id = p_season for update;
  if s.status <> 'تم التوزيع' then return 0; end if;
  for x in select id from activities.summer_applications where season_id = p_season and status = 'بانتظار السداد' and hold_until < now() and paid = 0 loop
    update activities.summer_applications set status = 'ملغى', cancel_reason = 'انتهت مهلة السداد', unit_id = null, batch_id = null where id = x.id;
    perform activities.sum_log(x.id, 'سقوط مهلة', '{}', 'النظام');
  end loop;
  -- الاحتياطي بترتيبه؛ كل واحد ياخد أول تفضيل له فيه خانة فاضية (والفوج لم يبدأ)
  for x in select * from activities.summer_applications where season_id = p_season and status = 'احتياطي' order by reserve_rank loop
    for pr in select * from jsonb_array_elements(x.prefs) loop
      if (select start_date from activities.summer_batches where id = (pr->>'batch_id')::uuid) <= current_date then continue; end if;
      v_unit := activities.sum_find_unit(p_season, pr, x.family_size);
      if v_unit is not null then
        perform activities.sum_place(x.id, v_unit, (pr->>'batch_id')::uuid, s.hold_hours);
        perform activities.sum_log(x.id, 'تصعيد', jsonb_build_object('unit_id', v_unit, 'batch_id', pr->>'batch_id', 'from_reserve_rank', x.reserve_rank), 'النظام');
        n := n + 1; exit;
      end if;
    end loop;
  end loop;
  -- إعادة ترقيم الاحتياطي
  update activities.summer_applications a set reserve_rank = q.rn
  from (select id, row_number() over (order by reserve_rank) rn from activities.summer_applications where season_id = p_season and status = 'احتياطي') q
  where a.id = q.id;
  return n;
end $$;

-- ───────── التقديم ─────────
-- p: {seasonId, prefs:[{batch_id, resort_id?, unit_type?}], people:[{full_name, relation, age}] | family_member_ids:[...]}
create or replace function activities.sum_apply(p_person uuid, p jsonb, p_actor text) returns uuid language plpgsql as $$
declare s activities.summer_seasons; v_id uuid; pr jsonb; v_people jsonb; me core.persons; n int; v_start date;
begin
  select * into s from activities.summer_seasons where id = (p->>'seasonId')::uuid for update;
  if s.id is null then raise exception 'الموسم غير موجود' using errcode = 'check_violation'; end if;
  if s.status <> 'التقديم مفتوح' or (s.apply_close is not null and now() > s.apply_close) or (s.apply_open is not null and now() < s.apply_open) then
    raise exception 'التقديم غير متاح الآن' using errcode = 'check_violation'; end if;
  if exists (select 1 from activities.summer_applications where season_id = s.id and person_id = p_person and status not in ('ملغى','معتذر')) then
    raise exception 'لك طلب قائم في هذا الموسم — عدّله بسحبه وتقديم جديد' using errcode = 'check_violation'; end if;
  delete from activities.summer_applications a where season_id = s.id and person_id = p_person and status in ('ملغى','معتذر')
    and not exists (select 1 from activities.summer_payments where application_id = a.id);
  if exists (select 1 from activities.summer_applications where season_id = s.id and person_id = p_person) then
    raise exception 'سبق لك طلب في هذا الموسم عليه حركات مالية — راجع الإدارة' using errcode = 'check_violation'; end if;
  n := jsonb_array_length(coalesce(p->'prefs','[]'));
  if n = 0 or n > s.max_prefs then raise exception 'اختر من 1 إلى % تفضيلات', s.max_prefs using errcode = 'check_violation'; end if;
  for pr in select * from jsonb_array_elements(p->'prefs') loop
    if not exists (select 1 from activities.summer_batches where id = (pr->>'batch_id')::uuid and season_id = s.id) then
      raise exception 'فوج غير صحيح في التفضيلات' using errcode = 'check_violation'; end if;
  end loop;
  select * into me from core.persons where id = p_person;
  v_start := activities.sum_season_start(s.id);
  -- الأسرة: العضو + أفراد من ملفه أو أسماء مكتوبة
  v_people := jsonb_build_array(jsonb_build_object('full_name', me.full_name, 'relation', 'العضو'))
    || coalesce((select jsonb_agg(jsonb_build_object('full_name', fm.full_name, 'relation', fm.relation, 'family_member_id', fm.id,
                  'age', activities.age_on(fm.birth_date, v_start)))
                 from core.family_members fm where fm.person_id = p_person and fm.active
                   and fm.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p->'family_member_ids','[]')) x)), '[]')
    || coalesce((select jsonb_agg(jsonb_build_object('full_name', trim(x->>'full_name'), 'relation', coalesce(nullif(x->>'relation',''),'مرافق'),
                  'age', nullif(x->>'age','')::int)) from jsonb_array_elements(coalesce(p->'people','[]')) x where nullif(trim(x->>'full_name'),'') is not null), '[]');
  if not exists (select 1 from activities.summer_units u join activities.summer_resorts r on r.id = u.resort_id
                 where r.season_id = s.id and u.active and u.beds >= jsonb_array_length(v_people)) then
    raise exception 'لا توجد وحدة تسع % أفراد', jsonb_array_length(v_people) using errcode = 'check_violation'; end if;
  insert into activities.summer_applications(app_no, season_id, person_id, family_size, prefs, people, eligible, prior_benefit, terms, submitted_by)
  values (core.next_doc_no('SUMMER_APP', 'مصيف', s.year), s.id, p_person, jsonb_array_length(v_people), p->'prefs', v_people,
          core.is_union_beneficiary(p_person, v_start), activities.sum_prior_benefit(p_person, s.id),
          jsonb_build_object('cancel_policy', s.cancel_policy, 'hold_hours', s.hold_hours, 'method', s.method), p_actor)
  returning id into v_id;
  perform activities.sum_log(v_id, 'تقديم', jsonb_build_object('prefs', p->'prefs', 'family_size', jsonb_array_length(v_people)), p_actor);
  return v_id;
end $$;

-- سحب الطلب قبل التوزيع
create or replace function activities.sum_withdraw(p_app uuid, p_actor text) returns void language plpgsql as $$
begin
  update activities.summer_applications set status = 'ملغى', cancel_reason = 'سحب الطلب قبل التوزيع' where id = p_app and status = 'مقدَّم';
  if not found then raise exception 'الطلب لا يُسحب في حالته الحالية — استخدم الاعتذار' using errcode = 'check_violation'; end if;
  perform activities.sum_log(p_app, 'سحب', '{}', p_actor);
end $$;

-- ───────── التوزيع ─────────
-- القرعة: مفتاح كل طلب = sha256(البذرة | رقم الطلب) — أي أحد يعيد الحساب من البذرة المعلنة وأرقام الطلبات.
-- lottery_hash = sha256 لأرقام الطلبات بالترتيب الناتج (مفصولة بفاصلة) — يُنشر مع النتيجة.
create or replace function activities.sum_allocate(p_season uuid, p_seed text, p_actor text) returns jsonb language plpgsql as $$
declare s activities.summer_seasons; x record; pr jsonb; v_unit uuid; i int := 0; nr int := 0; na int := 0; v_seed text; v_order text;
begin
  select * into s from activities.summer_seasons where id = p_season for update;
  if s.status <> 'التقديم مقفول' then raise exception 'اقفل التقديم أولاً — التوزيع مرة واحدة' using errcode = 'check_violation'; end if;
  v_seed := coalesce(nullif(trim(p_seed),''), s.lottery_seed);
  if s.method <> 'أسبقية' and v_seed is null then raise exception 'القرعة تحتاج بذرة معلنة (رقم السحب العلني)' using errcode = 'check_violation'; end if;
  update activities.summer_applications set draw_key = case when v_seed is not null then encode(sha256(convert_to(v_seed || '|' || app_no, 'UTF8')), 'hex') end
  where season_id = p_season and status = 'مقدَّم';
  for x in select * from activities.summer_applications where season_id = p_season and status = 'مقدَّم'
           order by case when s.method = 'أولوية لمن لم يستفد' and prior_benefit then 1 else 0 end,
                    case when s.method = 'أسبقية' then null else draw_key end, submitted_at, app_no loop
    i := i + 1; v_unit := null;
    update activities.summer_applications set rank = i where id = x.id;
    for pr in select * from jsonb_array_elements(x.prefs) loop
      v_unit := activities.sum_find_unit(p_season, pr, x.family_size);
      if v_unit is not null then
        perform activities.sum_place(x.id, v_unit, (pr->>'batch_id')::uuid, s.hold_hours);
        perform activities.sum_log(x.id, 'توزيع', jsonb_build_object('rank', i, 'unit_id', v_unit, 'batch_id', pr->>'batch_id'), p_actor);
        na := na + 1; exit;
      end if;
    end loop;
    if v_unit is null then
      nr := nr + 1;
      update activities.summer_applications set status = 'احتياطي', reserve_rank = nr where id = x.id;
      perform activities.sum_log(x.id, 'احتياطي', jsonb_build_object('rank', i, 'reserve_rank', nr), p_actor);
    end if;
  end loop;
  select string_agg(app_no, ',' order by rank) into v_order from activities.summer_applications where season_id = p_season and rank is not null;
  update activities.summer_seasons set status = 'تم التوزيع', lottery_seed = v_seed, allocated_at = now(),
    lottery_hash = encode(sha256(convert_to(coalesce(v_order,''), 'UTF8')), 'hex') where id = p_season;
  return jsonb_build_object('ranked', i, 'accepted', na, 'reserve', nr, 'seed', v_seed,
                            'hash', encode(sha256(convert_to(coalesce(v_order,''), 'UTF8')), 'hex'));
end $$;

-- ───────── السداد ─────────
create or replace function activities.sum_pay(p_app uuid, p_amount numeric, p_cash text, p_actor text) returns uuid language plpgsql as $$
declare ap activities.summer_applications; s activities.summer_seasons; v_entry uuid; v_id uuid; v_no text;
begin
  select * into ap from activities.summer_applications where id = p_app for update;
  if ap.id is null then raise exception 'الطلب غير موجود' using errcode = 'check_violation'; end if;
  select * into s from activities.summer_seasons where id = ap.season_id;
  if ap.status not in ('بانتظار السداد','مؤكد') then raise exception 'لا يمكن السداد لطلب حالته «%»', ap.status using errcode = 'check_violation'; end if;
  if coalesce(p_amount,0) <= 0 or ap.paid + p_amount > ap.total then
    raise exception 'المبلغ غير صحيح — المتبقي %', ap.total - ap.paid using errcode = 'check_violation'; end if;
  v_no := core.next_doc_no('RCPT', 'قبض', extract(year from current_date)::int);
  v_entry := finance.post(jsonb_build_object('date', current_date, 'source', 'إيصال', 'source_ref', ap.id,
    'description', 'سداد ' || s.title || ' — طلب ' || ap.app_no || ' — إيصال ' || v_no,
    'lines', jsonb_build_array(
      jsonb_build_object('account', p_cash, 'debit', p_amount, 'cost_center', s.code),
      jsonb_build_object('account', '4201', 'credit', p_amount, 'cost_center', s.code, 'person_id', ap.person_id))), p_actor);
  insert into activities.summer_payments(application_id, kind, amount, cash_account, entry_id, receipt_no, created_by)
  values (ap.id, 'سداد', p_amount, p_cash, v_entry, v_no, p_actor) returning id into v_id;
  update activities.summer_applications set paid = paid + p_amount,
    status = case when paid + p_amount >= total then 'مؤكد' else status end,
    hold_until = case when paid + p_amount >= total then null else hold_until end
  where id = ap.id;
  perform activities.sum_log(ap.id, 'سداد', jsonb_build_object('amount', p_amount, 'receipt_no', v_no), p_actor);
  return v_id;
end $$;

-- رد مبلغ للعضو بقيد
create or replace function activities.sum_refund(p_app uuid, p_amount numeric, p_cash text, p_memo text, p_actor text) returns void language plpgsql as $$
declare ap activities.summer_applications; s activities.summer_seasons; v_entry uuid;
begin
  if coalesce(p_amount,0) <= 0 then return; end if;
  select * into ap from activities.summer_applications where id = p_app;
  select * into s from activities.summer_seasons where id = ap.season_id;
  v_entry := finance.post(jsonb_build_object('date', current_date, 'source', 'رد اشتراك', 'source_ref', ap.id,
    'description', 'رد ' || s.title || ' — طلب ' || ap.app_no || ' — ' || p_memo,
    'lines', jsonb_build_array(
      jsonb_build_object('account', '4201', 'debit', p_amount, 'cost_center', s.code, 'person_id', ap.person_id),
      jsonb_build_object('account', coalesce(p_cash,'1101'), 'credit', p_amount, 'cost_center', s.code))), p_actor);
  insert into activities.summer_payments(application_id, kind, amount, cash_account, entry_id, created_by)
  values (ap.id, 'رد', p_amount, coalesce(p_cash,'1101'), v_entry, p_actor);
  update activities.summer_applications set paid = paid - p_amount, refunded = refunded + p_amount where id = ap.id;
end $$;

-- ───────── الاعتذار (بالشروط المجمّدة) + تصعيد تلقائي ─────────
create or replace function activities.sum_apologize(p_app uuid, p_reason text, p_by_admin boolean, p_cash text, p_actor text) returns numeric
language plpgsql as $$
declare ap activities.summer_applications; s activities.summer_seasons; pct int; v_ref numeric := 0; v_start date;
begin
  select * into ap from activities.summer_applications where id = p_app for update;
  if ap.id is null or ap.status not in ('بانتظار السداد','مؤكد','احتياطي') then
    raise exception 'الطلب غير قابل للاعتذار في حالته' using errcode = 'check_violation'; end if;
  if exists (select 1 from activities.summer_handovers where application_id = p_app and kind = 'تسليم') then
    raise exception 'الوحدة اتسلّمت — لا اعتذار بعد التسليم' using errcode = 'check_violation'; end if;
  select * into s from activities.summer_seasons where id = ap.season_id;
  v_start := coalesce((select start_date from activities.summer_batches where id = ap.batch_id), activities.sum_season_start(s.id));
  pct := case when s.status = 'ملغى' then 100 else activities.sum_refund_pct(ap.terms, v_start) end;
  v_ref := round(ap.paid * pct / 100.0, 2);
  perform activities.sum_refund(p_app, v_ref, p_cash, 'اعتذار (' || pct || '%)', p_actor);
  update activities.summer_applications set status = 'معتذر', reserve_rank = null,
    cancel_reason = coalesce(nullif(trim(p_reason),''), case when p_by_admin then 'اعتذار مسجّل من الإدارة' else 'اعتذار العضو' end)
  where id = p_app;
  perform activities.sum_log(p_app, 'اعتذار', jsonb_build_object('refund', v_ref, 'pct', pct, 'unit_id', ap.unit_id, 'batch_id', ap.batch_id,
                             'reason', p_reason), p_actor);
  perform activities.sum_housekeep(s.id);   -- الخانة الفاضية تصعد لأول احتياطي يناسبها
  return v_ref;
end $$;

-- ───────── التبديل ─────────
-- يعيد حساب المطلوب بعد تغيير الوحدة؛ الزيادة تُطلب، والنقص يُرد بقيد
create or replace function activities.sum_reprice(p_app uuid, p_cash text, p_actor text) returns void language plpgsql as $$
declare ap activities.summer_applications; u activities.summer_units; v_total numeric; s activities.summer_seasons;
begin
  select * into ap from activities.summer_applications where id = p_app;
  select * into u from activities.summer_units where id = ap.unit_id;
  select * into s from activities.summer_seasons where id = ap.season_id;
  v_total := case when ap.eligible then u.member_price else u.full_price end;
  update activities.summer_applications set total = v_total, subsidy = case when ap.eligible then u.full_price - u.member_price else 0 end where id = p_app;
  if ap.paid > v_total then perform activities.sum_refund(p_app, ap.paid - v_total, p_cash, 'فرق سعر بعد التبديل', p_actor); end if;
  update activities.summer_applications set
    status = case when paid >= total then 'مؤكد' else 'بانتظار السداد' end,
    hold_until = case when paid >= total then null else now() + make_interval(hours => s.hold_hours) end
  where id = p_app and status in ('مؤكد','بانتظار السداد');
end $$;

-- طلب تبديل: فوج/وحدة (خانة فاضية) أو تبادل مع عضو آخر (يلزم موافقته ثم اعتماد الإدارة)
create or replace function activities.sum_swap_request(p jsonb, p_person uuid, p_actor text) returns uuid language plpgsql as $$
declare ap activities.summer_applications; other activities.summer_applications; v_id uuid; v_kind text := p->>'kind';
begin
  select * into ap from activities.summer_applications where id = (p->>'applicationId')::uuid;
  if ap.id is null or (p_person is not null and ap.person_id <> p_person) then raise exception 'الطلب غير موجود' using errcode = 'check_violation'; end if;
  if ap.status not in ('بانتظار السداد','مؤكد') then raise exception 'التبديل للطلبات المقبولة فقط' using errcode = 'check_violation'; end if;
  if exists (select 1 from activities.summer_swaps where from_app = ap.id and status in ('مطلوب','وافق الطرف الآخر')) then
    raise exception 'لك طلب تبديل قيد المراجعة' using errcode = 'check_violation'; end if;
  if v_kind = 'تبادل' then
    select * into other from activities.summer_applications where id = (p->>'withApplicationId')::uuid
      or (app_no = p->>'withAppNo' and season_id = ap.season_id);
    if other.id is null or other.season_id <> ap.season_id or other.id = ap.id or other.status not in ('بانتظار السداد','مؤكد') then
      raise exception 'الطلب الآخر غير صالح للتبادل' using errcode = 'check_violation'; end if;
    insert into activities.summer_swaps(kind, from_app, to_app, reason, requested_by) values ('تبادل', ap.id, other.id, p->>'reason', p_actor) returning id into v_id;
  elsif v_kind in ('تبديل فوج','تبديل وحدة') then
    insert into activities.summer_swaps(kind, from_app, to_batch, to_unit, reason, requested_by)
    values (v_kind, ap.id, coalesce((nullif(p->>'batch_id',''))::uuid, ap.batch_id), (nullif(p->>'unit_id',''))::uuid, p->>'reason', p_actor) returning id into v_id;
  else raise exception 'نوع تبديل غير معروف' using errcode = 'check_violation'; end if;
  perform activities.sum_log(ap.id, 'طلب ' || v_kind, jsonb_build_object('swap_id', v_id), p_actor);
  return v_id;
end $$;

-- موافقة الطرف الآخر في التبادل
create or replace function activities.sum_swap_accept(p_swap uuid, p_person uuid, p_accept boolean, p_actor text) returns void language plpgsql as $$
declare sw activities.summer_swaps;
begin
  select * into sw from activities.summer_swaps where id = p_swap for update;
  if sw.id is null or sw.kind <> 'تبادل' or sw.status <> 'مطلوب'
     or (select person_id from activities.summer_applications where id = sw.to_app) <> p_person then
    raise exception 'طلب التبادل غير موجه لك' using errcode = 'check_violation'; end if;
  update activities.summer_swaps set status = case when p_accept then 'وافق الطرف الآخر' else 'مرفوض' end,
    decided_by = case when p_accept then null else p_actor end, decided_at = case when p_accept then null else now() end where id = p_swap;
  perform activities.sum_log(sw.to_app, case when p_accept then 'موافقة على تبادل' else 'رفض تبادل' end, jsonb_build_object('swap_id', p_swap), p_actor);
end $$;

-- اعتماد الإدارة وتنفيذ التبديل
create or replace function activities.sum_swap_decide(p_swap uuid, p_approve boolean, p_cash text, p_actor text) returns void language plpgsql as $$
declare sw activities.summer_swaps; a1 activities.summer_applications; a2 activities.summer_applications; v_unit uuid; u activities.summer_units;
begin
  select * into sw from activities.summer_swaps where id = p_swap for update;
  if sw.id is null or sw.status not in ('مطلوب','وافق الطرف الآخر') then raise exception 'طلب التبديل غير قائم' using errcode = 'check_violation'; end if;
  if not p_approve then
    update activities.summer_swaps set status = 'مرفوض', decided_by = p_actor, decided_at = now() where id = p_swap;
    perform activities.sum_log(sw.from_app, 'رفض ' || sw.kind, jsonb_build_object('swap_id', p_swap), p_actor); return;
  end if;
  select * into a1 from activities.summer_applications where id = sw.from_app for update;
  if a1.status not in ('بانتظار السداد','مؤكد') then raise exception 'الطلب لم يعد مقبولاً' using errcode = 'check_violation'; end if;
  if sw.kind = 'تبادل' then
    if sw.status <> 'وافق الطرف الآخر' then raise exception 'لازم موافقة العضو الآخر أولاً' using errcode = 'check_violation'; end if;
    select * into a2 from activities.summer_applications where id = sw.to_app for update;
    if a2.status not in ('بانتظار السداد','مؤكد') then raise exception 'الطلب الآخر لم يعد مقبولاً' using errcode = 'check_violation'; end if;
    if (select beds from activities.summer_units where id = a2.unit_id) < a1.family_size
       or (select beds from activities.summer_units where id = a1.unit_id) < a2.family_size then
      raise exception 'سعة الوحدتين لا تناسب الأسرتين' using errcode = 'check_violation'; end if;
    -- فك الخانتين ثم التبديل (الفهرس الفريد يمنع التكرار)
    update activities.summer_applications set unit_id = null, batch_id = null where id in (a1.id, a2.id);
    update activities.summer_applications set unit_id = a2.unit_id, batch_id = a2.batch_id where id = a1.id;
    update activities.summer_applications set unit_id = a1.unit_id, batch_id = a1.batch_id where id = a2.id;
    perform activities.sum_reprice(a1.id, p_cash, p_actor); perform activities.sum_reprice(a2.id, p_cash, p_actor);
    perform activities.sum_log(a1.id, 'تبادل', jsonb_build_object('swap_id', p_swap, 'with', a2.app_no, 'to_unit', a2.unit_id, 'to_batch', a2.batch_id), p_actor);
    perform activities.sum_log(a2.id, 'تبادل', jsonb_build_object('swap_id', p_swap, 'with', a1.app_no, 'to_unit', a1.unit_id, 'to_batch', a1.batch_id), p_actor);
  else
    if exists (select 1 from activities.summer_handovers where application_id = a1.id) then
      raise exception 'لا تبديل بعد تسليم الوحدة' using errcode = 'check_violation'; end if;
    v_unit := coalesce(sw.to_unit, activities.sum_find_unit(a1.season_id, jsonb_build_object('batch_id', sw.to_batch,
                 'unit_type', (select unit_type from activities.summer_units where id = a1.unit_id)), a1.family_size, a1.id));
    select * into u from activities.summer_units where id = v_unit;
    if v_unit is null or not activities.sum_slot_free(v_unit, sw.to_batch, a1.id) or u.beds < a1.family_size then
      raise exception 'لا توجد خانة فاضية مناسبة في المطلوب' using errcode = 'check_violation'; end if;
    update activities.summer_applications set unit_id = v_unit, batch_id = sw.to_batch where id = a1.id;
    perform activities.sum_reprice(a1.id, p_cash, p_actor);
    perform activities.sum_log(a1.id, sw.kind, jsonb_build_object('swap_id', p_swap, 'from_unit', a1.unit_id, 'from_batch', a1.batch_id,
                               'to_unit', v_unit, 'to_batch', sw.to_batch), p_actor);
    perform activities.sum_housekeep(a1.season_id);   -- الخانة القديمة قد تصعد لاحتياطي
  end if;
  update activities.summer_swaps set status = 'معتمد', decided_by = p_actor, decided_at = now() where id = p_swap;
end $$;

-- ───────── محضر التسليم والاستلام والتأمين ─────────
create or replace function activities.sum_handover(p jsonb, p_actor text) returns jsonb language plpgsql as $$
declare ap activities.summer_applications; s activities.summer_seasons; u activities.summer_units; v_kind text := p->>'kind';
        v_dmg numeric := coalesce((nullif(p->>'damages',''))::numeric, 0); v_ded numeric; v_ret numeric; v_entry uuid; v_cash text := coalesce(nullif(p->>'cash_account',''),'1101'); v_no text;
begin
  select * into ap from activities.summer_applications where id = (p->>'applicationId')::uuid for update;
  if ap.id is null then raise exception 'الطلب غير موجود' using errcode = 'check_violation'; end if;
  select * into s from activities.summer_seasons where id = ap.season_id;
  select * into u from activities.summer_units where id = ap.unit_id;
  if v_kind = 'تسليم' then
    if ap.status <> 'مؤكد' then raise exception 'التسليم بعد السداد الكامل فقط' using errcode = 'check_violation'; end if;
    insert into activities.summer_handovers(application_id, kind, condition, notes, by_actor) values (ap.id, 'تسليم', p->>'condition', p->>'notes', p_actor);
    if u.deposit > 0 then
      v_no := core.next_doc_no('RCPT', 'قبض', extract(year from current_date)::int);
      v_entry := finance.post(jsonb_build_object('date', current_date, 'source', 'إيصال', 'source_ref', ap.id,
        'description', 'تأمين وحدة ' || u.code || ' — ' || s.title || ' — طلب ' || ap.app_no || ' — إيصال ' || v_no,
        'lines', jsonb_build_array(jsonb_build_object('account', v_cash, 'debit', u.deposit, 'cost_center', s.code),
                                   jsonb_build_object('account', '2202', 'credit', u.deposit, 'cost_center', s.code, 'person_id', ap.person_id))), p_actor);
      insert into activities.summer_payments(application_id, kind, amount, cash_account, entry_id, receipt_no, created_by)
      values (ap.id, 'تأمين', u.deposit, v_cash, v_entry, v_no, p_actor);
      update activities.summer_applications set deposit_held = u.deposit where id = ap.id;
    end if;
    perform activities.sum_log(ap.id, 'تسليم', jsonb_build_object('unit', u.code, 'deposit', u.deposit, 'condition', p->>'condition'), p_actor);
    return jsonb_build_object('deposit', u.deposit, 'receipt_no', v_no);
  elsif v_kind = 'استلام' then
    if not exists (select 1 from activities.summer_handovers where application_id = ap.id and kind = 'تسليم') then
      raise exception 'لم يُسجَّل تسليم للوحدة' using errcode = 'check_violation'; end if;
    insert into activities.summer_handovers(application_id, kind, condition, damages, notes, by_actor) values (ap.id, 'استلام', p->>'condition', v_dmg, p->>'notes', p_actor);
    v_ded := least(v_dmg, ap.deposit_held); v_ret := ap.deposit_held - v_ded;
    if v_ded > 0 then
      v_entry := finance.post(jsonb_build_object('date', current_date, 'source', 'خصم تأمين', 'source_ref', ap.id,
        'description', 'خصم من تأمين وحدة ' || u.code || ' — طلب ' || ap.app_no || ' — ' || coalesce(p->>'notes','تلفيات'),
        'lines', jsonb_build_array(jsonb_build_object('account', '2202', 'debit', v_ded, 'cost_center', s.code, 'person_id', ap.person_id),
                                   jsonb_build_object('account', '4901', 'credit', v_ded, 'cost_center', s.code))), p_actor);
      insert into activities.summer_payments(application_id, kind, amount, entry_id, created_by) values (ap.id, 'خصم تأمين', v_ded, v_entry, p_actor);
    end if;
    if v_ret > 0 then
      v_entry := finance.post(jsonb_build_object('date', current_date, 'source', 'رد تأمين', 'source_ref', ap.id,
        'description', 'رد تأمين وحدة ' || u.code || ' — طلب ' || ap.app_no,
        'lines', jsonb_build_array(jsonb_build_object('account', '2202', 'debit', v_ret, 'cost_center', s.code, 'person_id', ap.person_id),
                                   jsonb_build_object('account', v_cash, 'credit', v_ret, 'cost_center', s.code))), p_actor);
      insert into activities.summer_payments(application_id, kind, amount, cash_account, entry_id, created_by) values (ap.id, 'رد تأمين', v_ret, v_cash, v_entry, p_actor);
    end if;
    update activities.summer_applications set deposit_held = 0, status = 'منتهٍ' where id = ap.id;
    perform activities.sum_log(ap.id, 'استلام', jsonb_build_object('damages', v_dmg, 'deducted', v_ded, 'returned', v_ret,
      'uncovered', v_dmg - v_ded, 'condition', p->>'condition'), p_actor);
    return jsonb_build_object('deducted', v_ded, 'returned', v_ret, 'uncovered', v_dmg - v_ded);
  end if;
  raise exception 'نوع المحضر: تسليم أو استلام' using errcode = 'check_violation';
end $$;

-- ───────── الإقفال: الدعم ⇒ المزايا، والمستحق للملاك ⇒ 5302/2101 ─────────
create or replace function activities.sum_close(p_season uuid, p_actor text) returns jsonb language plpgsql as $$
declare s activities.summer_seasons; r record; nb int := 0; nown int := 0; v_end date; v_entry uuid;
begin
  select * into s from activities.summer_seasons where id = p_season for update;
  if s.status <> 'تم التوزيع' then raise exception 'الموسم لازم يكون موزّعاً' using errcode = 'check_violation'; end if;
  v_end := (select max(end_date) from activities.summer_batches where season_id = p_season);
  if v_end > current_date then raise exception 'لا يُقفل الموسم قبل نهاية آخر فوج' using errcode = 'check_violation'; end if;
  if exists (select 1 from activities.summer_applications where season_id = p_season and deposit_held > 0) then
    raise exception 'فيه تأمينات لم تُسوَّ — سجّل محاضر الاستلام' using errcode = 'check_violation'; end if;
  -- المستفيد = من استلم الوحدة (منتهٍ) أو المؤكد بلا محضر (يُعتبر حاضراً)
  for r in select ap.*, b.start_date bstart, u.code ucode, rs.name rname from activities.summer_applications ap
           join activities.summer_batches b on b.id = ap.batch_id join activities.summer_units u on u.id = ap.unit_id
           join activities.summer_resorts rs on rs.id = u.resort_id
           where ap.season_id = p_season and ap.status in ('منتهٍ','مؤكد') and ap.eligible and ap.subsidy > 0 loop
    if benefits.record(r.person_id, r.bstart, 'دعم', 'دعم مصيف', r.subsidy, 'الأنشطة', 'SUM:' || p_season || ':' || r.id,
         s.title || ' — ' || r.rname || ' ' || r.ucode || ' — طلب ' || r.app_no, s.decision_id, null) is not null then nb := nb + 1; end if;
  end loop;
  -- استحقاق الملاك: تكلفة الخانات المشغولة لكل مصيف
  for r in select rs.name, coalesce(rs.owner_party, rs.name) party, sum(u.owner_cost) amt from activities.summer_applications ap
           join activities.summer_units u on u.id = ap.unit_id join activities.summer_resorts rs on rs.id = u.resort_id
           where ap.season_id = p_season and ap.status in ('منتهٍ','مؤكد') group by rs.name, rs.owner_party having sum(u.owner_cost) > 0 loop
    v_entry := finance.post(jsonb_build_object('date', current_date, 'source', 'استحقاق مصيف', 'decision_id', s.decision_id,
      'description', 'استحقاق ' || r.party || ' — ' || s.title || ' — ' || r.name,
      'lines', jsonb_build_array(jsonb_build_object('account', '5302', 'debit', r.amt, 'cost_center', s.code),
                                 jsonb_build_object('account', '2101', 'credit', r.amt, 'cost_center', s.code, 'party', r.party))), p_actor);
    nown := nown + 1;
  end loop;
  update activities.summer_applications set status = 'منتهٍ' where season_id = p_season and status = 'مؤكد';
  update activities.summer_applications set status = 'لم يُقبل' where season_id = p_season and status = 'احتياطي';
  update activities.summer_applications set status = 'ملغى', cancel_reason = 'لم يُستكمل السداد' where season_id = p_season and status = 'بانتظار السداد';
  update activities.summer_seasons set status = 'منتهٍ' where id = p_season;
  return jsonb_build_object('benefits', nb, 'owner_entries', nown);
end $$;

create or replace function activities.sum_summary(p_season uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'slots', (select count(*) from activities.summer_units u join activities.summer_resorts r on r.id = u.resort_id where r.season_id = s.id and u.active)
             * (select count(*) from activities.summer_batches where season_id = s.id),
    'applied', (select count(*) from activities.summer_applications where season_id = s.id and status not in ('ملغى')),
    'byStatus', (select jsonb_object_agg(status, n) from (select status, count(*) n from activities.summer_applications where season_id = s.id group by status) q),
    'collected', (select coalesce(sum(case kind when 'سداد' then amount when 'رد' then -amount else 0 end),0)
                  from activities.summer_payments p join activities.summer_applications a on a.id = p.application_id where a.season_id = s.id),
    'depositsHeld', (select coalesce(sum(deposit_held),0) from activities.summer_applications where season_id = s.id),
    'subsidy', (select coalesce(sum(subsidy),0) from activities.summer_applications where season_id = s.id and status in ('مؤكد','منتهٍ')),
    'expenses', (select coalesce(sum(l.debit - l.credit),0) from finance.lines l join finance.accounts ac on ac.code = l.account
                 where l.cost_center = s.code and ac.type = 'مصروفات'),
    'pendingSwaps', (select count(*) from activities.summer_swaps w join activities.summer_applications a on a.id = w.from_app
                     where a.season_id = s.id and w.status in ('مطلوب','وافق الطرف الآخر')))
  from activities.summer_seasons s where s.id = p_season
$$;

insert into core.permissions(code, module, name) values ('summer.manage','activities','إدارة المصايف') on conflict do nothing;
insert into core.role_permissions(role, permission) values ('SYS_ADMIN','summer.manage'), ('TRIPS_OFFICER','summer.manage') on conflict do nothing;
revoke all on all functions in schema activities from public, anon, authenticated;
