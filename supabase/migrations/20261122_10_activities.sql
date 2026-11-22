-- المرحلة 5 — محرّك الأنشطة + رحلة اليوم الواحد
-- نشاط = إعلان + فئات أسعار + سعة + شروط إلغاء + مشرفون. الحجز: أسبقية بوقت تأكيد الدفع، مهلة سداد، انتظار وتصعيد تلقائي،
-- الشروط تُجمَّد في الحجز، الدفع والرد قيود حقيقية بمركز تكلفة للنشاط، المزايا تُسجَّل للحاضرين عند الإقفال.
create schema if not exists activities;
revoke all on schema activities from public, anon, authenticated;

create table activities.activities (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,                    -- رمز = مركز التكلفة (مثلاً TRIP-2026-001)
  kind            text not null default 'رحلة يوم واحد' check (kind in ('رحلة يوم واحد','رحلة بإقامة','مصيف','إفطار','فعالية','عمرة/حج')),
  title           text not null,
  description     text,
  location        text,
  start_date      date not null,
  end_date        date,
  booking_open    timestamptz,
  booking_close   timestamptz,
  status          text not null default 'مسودة'
                  check (status in ('مسودة','الحجز مفتوح','الحجز مقفول','انتهى','مغلق','ملغى')),
  capacity        int not null check (capacity > 0),     -- عدد المقاعد
  max_companions  int not null default 4 check (max_companions >= 0),
  hold_hours      int not null default 48 check (hold_hours > 0),   -- مهلة السداد قبل سقوط الحجز
  cancel_policy   jsonb not null default '[{"days_before":7,"refund_pct":100},{"days_before":3,"refund_pct":50},{"days_before":0,"refund_pct":0}]',
  program         jsonb not null default '[]',           -- [{time, text}]
  meeting_points  jsonb not null default '[]',
  whatsapp_link   text,
  decision_id     uuid references governance.decisions(id),
  notes           text,
  created_by      text,
  created_at      timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

-- فئات الأسعار لكل نشاط (العضو، أسرته، المرافق، الطفل...) — السياسة تُحدد لكل نشاط
create table activities.price_categories (
  activity_id   uuid not null references activities.activities(id) on delete cascade,
  code          text not null,
  label         text not null,
  applies_to    text not null check (applies_to in ('العضو','الأسرة','المرافق')),
  min_age       int, max_age int,                       -- للأطفال (null = بلا حد)
  full_price    numeric(10,2) not null check (full_price >= 0),   -- التكلفة الكاملة للفرد
  member_price  numeric(10,2) not null check (member_price >= 0), -- ما يدفعه مستحق الدعم (الفرق = الدعم)
  takes_seat    boolean not null default true,
  sort          int not null default 0,
  primary key (activity_id, code),
  check (member_price <= full_price)
);

create table activities.supervisors (
  activity_id    uuid not null references activities.activities(id) on delete cascade,
  person_id      uuid not null references core.persons(id),
  task           text not null default 'مشرف',
  self_exempt_pct   int not null default 100 check (self_exempt_pct between 0 and 100),
  family_exempt_pct int not null default 0 check (family_exempt_pct between 0 and 100),
  decision_ref   text,
  primary key (activity_id, person_id)
);

create table activities.bookings (
  id            uuid primary key default gen_random_uuid(),
  booking_no    text not null unique,
  activity_id   uuid not null references activities.activities(id),
  person_id     uuid not null references core.persons(id),
  status        text not null check (status in ('بانتظار السداد','مؤكد','قائمة انتظار','ملغى','منتهٍ')),
  hold_until    timestamptz,
  priority_at   timestamptz,                         -- وقت تأكيد السداد = الأسبقية
  waitlist_at   timestamptz,
  eligible      boolean not null,                    -- مستحق الدعم يوم النشاط
  total         numeric(10,2) not null default 0,   -- المطلوب من العضو
  subsidy       numeric(10,2) not null default 0,   -- قيمة الدعم/الإعفاء
  paid          numeric(10,2) not null default 0,
  refunded      numeric(10,2) not null default 0,
  terms         jsonb not null,                      -- شروط الإلغاء والأسعار وقت الحجز (مجمّدة)
  cancel_reason text,
  booked_by     text,
  created_at    timestamptz not null default now(),
  unique (activity_id, person_id)
);
create index on activities.bookings (activity_id, status);

create table activities.booking_people (
  booking_id   uuid not null references activities.bookings(id) on delete cascade,
  seq          int not null,
  full_name    text not null,
  relation     text not null,                       -- العضو / زوجة / ابن / مرافق ...
  family_member_id uuid references core.family_members(id),
  category     text not null,
  age          int,
  price        numeric(10,2) not null,             -- ما يُدفع عن الفرد
  full_price   numeric(10,2) not null,
  takes_seat   boolean not null default true,
  seat_no      int,
  attended     boolean,
  primary key (booking_id, seq)
);

create table activities.payments (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references activities.bookings(id),
  kind        text not null check (kind in ('سداد','رد')),
  amount      numeric(10,2) not null check (amount > 0),
  pay_date    date not null default current_date,
  cash_account text not null default '1101' references finance.accounts(code),
  entry_id    uuid references finance.entries(id),
  receipt_no  text,
  created_by  text,
  created_at  timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['activities','price_categories','supervisors','bookings','booking_people','payments'] loop
    execute format('alter table activities.%I enable row level security', t);
    execute format('revoke all on activities.%I from anon, authenticated', t);
    if t in ('activities','bookings','payments','supervisors') then
      execute format('create trigger %I after insert or update or delete on activities.%I for each row execute function audit.track()', t || '_audit', t);
    end if;
  end loop;
end $$;

-- ───────── أدوات ─────────
create or replace function activities.seats_used(p_act uuid) returns int language sql stable as $$
  select coalesce(count(*), 0)::int from activities.booking_people bp join activities.bookings b on b.id = bp.booking_id
  where b.activity_id = p_act and b.status in ('بانتظار السداد','مؤكد','منتهٍ') and bp.takes_seat
$$;
create or replace function activities.age_on(p_birth date, p_on date) returns int language sql immutable as
$$ select case when p_birth is null then null else extract(year from age(p_on, p_birth))::int end $$;

-- نسبة الاسترداد حسب الأيام المتبقية (من الشروط المجمّدة في الحجز)
create or replace function activities.refund_pct(p_terms jsonb, p_start date, p_on date default current_date) returns int language sql stable as $$
  select coalesce((select (x->>'refund_pct')::int from jsonb_array_elements(p_terms->'cancel_policy') x
                   where (p_start - p_on) >= (x->>'days_before')::int order by (x->>'days_before')::int desc limit 1), 0)
$$;

-- سقوط الحجوزات المنتهية مهلتها + تصعيد قائمة الانتظار (يُستدعى قبل أي عملية على النشاط)
create or replace function activities.housekeep(p_act uuid) returns void language plpgsql as $$
declare a activities.activities; w record; need int;
begin
  select * into a from activities.activities where id = p_act for update;
  update activities.bookings set status = 'ملغى', cancel_reason = 'انتهت مهلة السداد'
  where activity_id = p_act and status = 'بانتظار السداد' and hold_until < now() and paid = 0;
  -- التصعيد بترتيب دخول الانتظار، ما دام فيه مقاعد تكفي الحجز كاملاً
  for w in select b.id, (select count(*) from activities.booking_people where booking_id = b.id and takes_seat) seats
           from activities.bookings b where b.activity_id = p_act and b.status = 'قائمة انتظار' order by b.waitlist_at loop
    if activities.seats_used(p_act) + w.seats <= a.capacity and a.status = 'الحجز مفتوح' then
      update activities.bookings set status = 'بانتظار السداد', hold_until = now() + make_interval(hours => a.hold_hours) where id = w.id;
    else exit; end if;
  end loop;
end $$;

-- ───────── الحجز ─────────
-- p: {activityId, people:[{family_member_id | full_name+relation+age, category?}], self:true}
create or replace function activities.book(p_person uuid, p jsonb, p_actor text) returns uuid language plpgsql as $$
declare a activities.activities; v_id uuid; v_elig boolean; f jsonb; i int := 0; cat activities.price_categories; v_age int;
        fm core.family_members; v_name text; v_rel text; v_applies text; v_price numeric; tot numeric := 0; sub numeric := 0;
        seats int := 0; comp int := 0; me core.persons; v_status text;
begin
  select * into a from activities.activities where id = (p->>'activityId')::uuid for update;
  if a.id is null then raise exception 'النشاط غير موجود' using errcode = 'check_violation'; end if;
  perform activities.housekeep(a.id);
  if a.status <> 'الحجز مفتوح' or (a.booking_close is not null and now() > a.booking_close) or (a.booking_open is not null and now() < a.booking_open) then
    raise exception 'الحجز غير متاح الآن' using errcode = 'check_violation'; end if;
  if exists (select 1 from activities.bookings where activity_id = a.id and person_id = p_person and status <> 'ملغى') then
    raise exception 'لك حجز قائم في هذا النشاط — عدّله أو ألغه' using errcode = 'check_violation'; end if;
  delete from activities.bookings where activity_id = a.id and person_id = p_person and status = 'ملغى';   -- حجز ملغى سابق لا يمنع حجزاً جديداً
  select * into me from core.persons where id = p_person;
  v_elig := core.is_union_beneficiary(p_person, a.start_date);
  insert into activities.bookings(booking_no, activity_id, person_id, status, eligible, terms, booked_by)
  -- يُنشأ بحالة لا تحجز مقاعد حتى يُحسب الإجمالي (وإلا يُحسب أفراده مرتين في فحص السعة)
  values (core.next_doc_no('BOOKING', 'حجز', extract(year from a.start_date)::int), a.id, p_person, 'قائمة انتظار', v_elig,
          jsonb_build_object('cancel_policy', a.cancel_policy, 'hold_hours', a.hold_hours,
            'prices', (select jsonb_agg(to_jsonb(pc) - 'activity_id') from activities.price_categories pc where pc.activity_id = a.id)), p_actor)
  returning id into v_id;
  -- العضو نفسه أولاً ثم من اختارهم
  for f in select * from jsonb_array_elements(jsonb_build_array(jsonb_build_object('self', true)) || coalesce(p->'people','[]')) loop
    i := i + 1;
    if (f->>'self')::boolean then
      v_name := me.full_name; v_rel := 'العضو'; v_applies := 'العضو'; v_age := activities.age_on(me.birth_date, a.start_date);
    elsif nullif(f->>'family_member_id','') is not null then
      select * into fm from core.family_members where id = (f->>'family_member_id')::uuid and person_id = p_person and active;
      if fm.id is null then raise exception 'فرد الأسرة غير موجود في ملفك' using errcode = 'check_violation'; end if;
      v_name := fm.full_name; v_rel := fm.relation; v_applies := 'الأسرة'; v_age := activities.age_on(fm.birth_date, a.start_date);
    else
      v_name := nullif(trim(f->>'full_name'),''); v_rel := coalesce(nullif(f->>'relation',''), 'مرافق'); v_applies := 'المرافق';
      v_age := (nullif(f->>'age',''))::int; comp := comp + 1;
      if v_name is null then raise exception 'اكتب اسم المرافق' using errcode = 'check_violation'; end if;
    end if;
    -- الفئة: المختارة أو أول فئة تنطبق بالسن
    select * into cat from activities.price_categories pc where pc.activity_id = a.id and pc.applies_to = v_applies
      and (nullif(f->>'category','') is null or pc.code = f->>'category')
      and (pc.min_age is null or coalesce(v_age, 99) >= pc.min_age) and (pc.max_age is null or coalesce(v_age, 99) <= pc.max_age)
    order by pc.sort limit 1;
    if cat.code is null then raise exception 'لا توجد فئة سعر مناسبة لـ % (%)', v_name, v_rel using errcode = 'check_violation'; end if;
    -- غير المستحق (نقابة مستقلة/غير نشط) يدفع السعر الكامل لكل أفراده؛ المرافق دائماً بالسعر الكامل
    v_price := case when v_elig and v_applies <> 'المرافق' then cat.member_price else cat.full_price end;
    insert into activities.booking_people(booking_id, seq, full_name, relation, family_member_id, category, age, price, full_price, takes_seat)
    values (v_id, i, v_name, v_rel, fm.id, cat.code, v_age, v_price, cat.full_price, cat.takes_seat);
    tot := tot + v_price; sub := sub + (cat.full_price - v_price);
    if cat.takes_seat then seats := seats + 1; end if;
    fm := null;
  end loop;
  if comp > a.max_companions then raise exception 'الحد الأقصى للمرافقين % فقط', a.max_companions using errcode = 'check_violation'; end if;
  -- السعة: لو المقاعد لا تكفي ⇒ قائمة انتظار
  v_status := case when activities.seats_used(a.id) + seats <= a.capacity then 'بانتظار السداد' else 'قائمة انتظار' end;
  update activities.bookings set total = tot, subsidy = sub, status = v_status,
    hold_until = case when v_status = 'بانتظار السداد' then now() + make_interval(hours => a.hold_hours) end,
    waitlist_at = case when v_status = 'قائمة انتظار' then clock_timestamp() end
  where id = v_id;
  return v_id;
end $$;

-- ───────── السداد (يؤكد الحجز ويثبت الأسبقية) ─────────
create or replace function activities.pay(p_booking uuid, p_amount numeric, p_cash text, p_actor text) returns uuid language plpgsql as $$
declare b activities.bookings; a activities.activities; v_entry uuid; v_id uuid; v_no text;
begin
  select * into b from activities.bookings where id = p_booking for update;
  if b.id is null then raise exception 'الحجز غير موجود' using errcode = 'check_violation'; end if;
  select * into a from activities.activities where id = b.activity_id;
  if b.status not in ('بانتظار السداد','مؤكد') then raise exception 'لا يمكن السداد لحجز حالته «%»', b.status using errcode = 'check_violation'; end if;
  if coalesce(p_amount,0) <= 0 or b.paid + p_amount > b.total then
    raise exception 'المبلغ غير صحيح — المتبقي %', b.total - b.paid using errcode = 'check_violation'; end if;
  v_no := core.next_doc_no('RCPT', 'قبض', extract(year from current_date)::int);
  v_entry := finance.post(jsonb_build_object('date', current_date, 'source', 'إيصال', 'source_ref', b.id,
    'description', 'سداد اشتراك ' || a.title || ' — حجز ' || b.booking_no || ' — إيصال ' || v_no,
    'lines', jsonb_build_array(
      jsonb_build_object('account', p_cash, 'debit', p_amount, 'cost_center', a.code),
      jsonb_build_object('account', '4201', 'credit', p_amount, 'cost_center', a.code, 'person_id', b.person_id))), p_actor);
  insert into activities.payments(booking_id, kind, amount, cash_account, entry_id, receipt_no, created_by)
  values (b.id, 'سداد', p_amount, p_cash, v_entry, v_no, p_actor) returning id into v_id;
  update activities.bookings set paid = paid + p_amount,
    status = case when paid + p_amount >= total then 'مؤكد' else status end,
    priority_at = case when priority_at is null and paid + p_amount >= total then clock_timestamp() else priority_at end,
    hold_until = case when paid + p_amount >= total then null else hold_until end
  where id = b.id;
  return v_id;
end $$;

-- ───────── الإلغاء والاسترداد بالشروط المجمّدة ─────────
create or replace function activities.cancel(p_booking uuid, p_reason text, p_by_admin boolean, p_cash text, p_actor text) returns numeric
language plpgsql as $$
declare b activities.bookings; a activities.activities; pct int; v_ref numeric; v_entry uuid;
begin
  select * into b from activities.bookings where id = p_booking for update;
  if b.id is null or b.status in ('ملغى','منتهٍ') then raise exception 'الحجز غير قابل للإلغاء' using errcode = 'check_violation'; end if;
  select * into a from activities.activities where id = b.activity_id;
  pct := case when a.status = 'ملغى' then 100 else activities.refund_pct(b.terms, a.start_date) end;   -- إلغاء النشاط كله = رد كامل
  v_ref := round(b.paid * pct / 100.0, 2);
  if v_ref > 0 then
    v_entry := finance.post(jsonb_build_object('date', current_date, 'source', 'رد اشتراك', 'source_ref', b.id,
      'description', 'رد اشتراك ' || a.title || ' — حجز ' || b.booking_no || ' (' || pct || '%)',
      'lines', jsonb_build_array(
        jsonb_build_object('account', '4201', 'debit', v_ref, 'cost_center', a.code, 'person_id', b.person_id),
        jsonb_build_object('account', coalesce(p_cash,'1101'), 'credit', v_ref, 'cost_center', a.code))), p_actor);
    insert into activities.payments(booking_id, kind, amount, cash_account, entry_id, created_by)
    values (b.id, 'رد', v_ref, coalesce(p_cash,'1101'), v_entry, p_actor);
  end if;
  update activities.bookings set status = 'ملغى', refunded = v_ref,
    cancel_reason = coalesce(nullif(trim(p_reason),''), case when p_by_admin then 'إلغاء من الإدارة' else 'إلغاء من العضو' end)
  where id = b.id;
  perform activities.housekeep(a.id);   -- المقعد الفاضي يصعد له أول المنتظرين
  return v_ref;
end $$;

-- ───────── المقاعد بالأسبقية (الأسرة متجاورة) ─────────
create or replace function activities.assign_seats(p_act uuid) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  update activities.booking_people bp set seat_no = null from activities.bookings b where b.id = bp.booking_id and b.activity_id = p_act;
  for r in select bp.booking_id, bp.seq from activities.booking_people bp join activities.bookings b on b.id = bp.booking_id
           where b.activity_id = p_act and b.status = 'مؤكد' and bp.takes_seat order by b.priority_at, b.created_at, bp.seq loop
    n := n + 1;
    update activities.booking_people set seat_no = n where booking_id = r.booking_id and seq = r.seq;
  end loop;
  return n;
end $$;

-- ───────── الإقفال: الحضور ⇒ المزايا (الدعم للحاضرين + إعفاءات المشرفين) ─────────
create or replace function activities.close_activity(p_act uuid, p_actor text) returns jsonb language plpgsql as $$
declare a activities.activities; r record; s record; nb int := 0; ns int := 0; v_full numeric;
begin
  select * into a from activities.activities where id = p_act for update;
  if a.status not in ('الحجز مقفول','الحجز مفتوح') then raise exception 'النشاط لازم يكون منعقداً لإقفاله' using errcode = 'check_violation'; end if;
  if a.start_date > current_date then raise exception 'لا يُقفل نشاط قبل موعده' using errcode = 'check_violation'; end if;
  -- الدعم = (السعر الكامل − المدفوع) لكل حاضر من حجز مؤكد مستحق
  for r in select b.person_id, b.id bid, sum(bp.full_price - bp.price) sub
           from activities.bookings b join activities.booking_people bp on bp.booking_id = b.id
           where b.activity_id = p_act and b.status = 'مؤكد' and b.eligible and coalesce(bp.attended, true)
           group by b.person_id, b.id having sum(bp.full_price - bp.price) > 0 loop
    if benefits.record(r.person_id, a.start_date, 'دعم', 'دعم ' || a.kind, r.sub, 'الأنشطة', 'ACT:' || p_act || ':' || r.bid,
         a.title || ' — ' || a.code, a.decision_id) is not null then nb := nb + 1; end if;
  end loop;
  -- إعفاء المشرف = السعر الكامل لفئة «العضو» × نسبة إعفائه
  v_full := (select full_price from activities.price_categories where activity_id = p_act and applies_to = 'العضو' order by sort limit 1);
  for s in select * from activities.supervisors where activity_id = p_act and self_exempt_pct > 0 loop
    if benefits.record(s.person_id, a.start_date, 'إعفاء', 'إعفاء إشراف', round(v_full * s.self_exempt_pct / 100.0, 2), 'الأنشطة',
         'SUP:' || p_act || ':' || s.person_id, a.title || ' — ' || s.task || coalesce(' — قرار ' || s.decision_ref, ''), a.decision_id) is not null then ns := ns + 1; end if;
  end loop;
  update activities.bookings set status = 'منتهٍ' where activity_id = p_act and status = 'مؤكد';
  update activities.bookings set status = 'ملغى', cancel_reason = 'لم يُستكمل السداد قبل النشاط' where activity_id = p_act and status in ('بانتظار السداد','قائمة انتظار');
  update activities.activities set status = 'انتهى' where id = p_act;
  return jsonb_build_object('benefits', nb, 'supervisors', ns);
end $$;

-- ملخص النشاط المالي: الاشتراكات المحصلة − المردود، المصروف من عهد النشاط، الدعم
create or replace function activities.summary(p_act uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'seats', a.capacity, 'used', activities.seats_used(a.id),
    'confirmed', (select count(*) from activities.bookings where activity_id = a.id and status in ('مؤكد','منتهٍ')),
    'pending', (select count(*) from activities.bookings where activity_id = a.id and status = 'بانتظار السداد'),
    'waitlist', (select count(*) from activities.bookings where activity_id = a.id and status = 'قائمة انتظار'),
    'cancelled', (select count(*) from activities.bookings where activity_id = a.id and status = 'ملغى'),
    'collected', (select coalesce(sum(case when kind = 'سداد' then amount else -amount end),0) from activities.payments p join activities.bookings b on b.id = p.booking_id where b.activity_id = a.id),
    'subsidy', (select coalesce(sum(subsidy),0) from activities.bookings where activity_id = a.id and status in ('مؤكد','منتهٍ')),
    'expenses', (select coalesce(sum(l.debit - l.credit),0) from finance.lines l join finance.accounts ac on ac.code = l.account
                 where l.cost_center = a.code and ac.type = 'مصروفات'),
    'revenue', (select coalesce(sum(l.credit - l.debit),0) from finance.lines l join finance.accounts ac on ac.code = l.account
                where l.cost_center = a.code and ac.type = 'إيرادات'))
  from activities.activities a where a.id = p_act
$$;
revoke all on all functions in schema activities from public, anon, authenticated;
