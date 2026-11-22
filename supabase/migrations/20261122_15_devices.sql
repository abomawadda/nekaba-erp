-- المرحلة 7ب — الأجهزة بالتقسيط والاستقطاع من الراتب (داخل activities بجداول dev_*)
-- عرض (مورد/معرض بحساب 2101) ← أصناف (سعر المورد، سعر العضو، سعر السوق للدعم، أقصى شهور، مقدم %)
-- ← طلب العضو (صنف، شهور، طريقة السداد: استقطاع/نقدي) — فحص سقف الاستقطاع الشهري (PAYROLL_DEDUCTION_CAP)
-- ← اعتماد ← تسليم: قيد البيع (مدين 1201 باسم العضو / دائن 4301) + التكلفة (مدين 5601 / دائن 2101 المورد) + جدول الأقساط
--   + المقدم نقداً (مدين خزينة / دائن 1201) + الدعم (سعر السوق − سعر العضو) في سجل المزايا للمستحق
-- ← كشف استقطاع شهري: اعتماد الكشف = مدين 1203 / دائن 1201 لكل عضو؛ تحصيل التحويل من جهة العمل = مدين البنك / دائن 1203
-- ← قسط نقدي: مدين خزينة / دائن 1201. الطلب «مسدد» عند سداد كل أقساطه.

create table activities.dev_offers (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,                -- مركز التكلفة
  title        text not null,
  supplier     text not null,                       -- المعرض/المورد (طرف في 2101)
  order_open   date, order_close date,
  status       text not null default 'مسودة' check (status in ('مسودة','الطلب مفتوح','الطلب مقفول','منتهٍ','ملغى')),
  first_due    date,                                -- أول شهر استقطاع (اليوم 1)
  decision_id  uuid references governance.decisions(id),
  notes        text,
  created_by   text,
  created_at   timestamptz not null default now()
);

create table activities.dev_items (
  id           uuid primary key default gen_random_uuid(),
  offer_id     uuid not null references activities.dev_offers(id) on delete cascade,
  name         text not null,
  supplier_price numeric(10,2) not null check (supplier_price >= 0),   -- ما يُدفع للمورد
  member_price numeric(10,2) not null check (member_price > 0),        -- ما يدفعه العضو بالتقسيط
  market_price numeric(10,2),                                          -- سعر السوق (الفرق = دعم للمستحق)
  max_months   int not null default 10 check (max_months between 1 and 36),
  down_pct     int not null default 0 check (down_pct between 0 and 100),
  stock        int,                                                    -- null = بلا حد
  active       boolean not null default true,
  unique (offer_id, name)
);

create table activities.dev_orders (
  id           uuid primary key default gen_random_uuid(),
  order_no     text not null unique,
  offer_id     uuid not null references activities.dev_offers(id),
  item_id      uuid not null references activities.dev_items(id),
  person_id    uuid not null references core.persons(id),
  months       int not null check (months > 0),
  method       text not null default 'استقطاع' check (method in ('استقطاع','نقدي')),
  price        numeric(10,2) not null,
  down_payment numeric(10,2) not null default 0,
  monthly      numeric(10,2) not null,
  eligible     boolean not null,
  subsidy      numeric(10,2) not null default 0,
  status       text not null default 'مطلوب' check (status in ('مطلوب','معتمد','مسلّم','مسدد','مرفوض','ملغى')),
  reject_reason text,
  delivered_at date,
  entry_id     uuid references finance.entries(id),
  requested_by text, approved_by text, delivered_by text,
  created_at   timestamptz not null default now()
);
create index on activities.dev_orders (person_id);

create table activities.dev_installments (
  order_id   uuid not null references activities.dev_orders(id) on delete cascade,
  seq        int not null,
  due_month  date not null,                     -- أول الشهر
  amount     numeric(10,2) not null check (amount > 0),
  paid       numeric(10,2) not null default 0,
  paid_via   text,                              -- استقطاع / نقدي
  run_id     uuid,
  primary key (order_id, seq)
);

create table activities.dev_runs (                 -- كشف الاستقطاع الشهري
  id          uuid primary key default gen_random_uuid(),
  month       date not null unique,              -- أول الشهر
  status      text not null default 'مسودة' check (status in ('مسودة','معتمد','محصّل')),
  total       numeric(12,2) not null default 0,
  entry_id    uuid references finance.entries(id),
  receipt_entry_id uuid references finance.entries(id),
  created_by  text, approved_by text,
  created_at  timestamptz not null default now()
);
create table activities.dev_run_lines (
  run_id    uuid not null references activities.dev_runs(id) on delete cascade,
  order_id  uuid not null references activities.dev_orders(id),
  seq       int not null,
  person_id uuid not null references core.persons(id),
  amount    numeric(10,2) not null,
  primary key (run_id, order_id, seq)
);

do $$ declare t text; begin
  foreach t in array array['dev_offers','dev_items','dev_orders','dev_installments','dev_runs','dev_run_lines'] loop
    execute format('alter table activities.%I enable row level security', t);
    execute format('revoke all on activities.%I from anon, authenticated', t);
    execute format('create trigger %I after insert or update or delete on activities.%I for each row execute function audit.track()', t || '_audit', t);
  end loop;
end $$;

create or replace function activities.dev_cost_center() returns trigger language plpgsql as $$
begin
  insert into finance.cost_centers(code, name, kind, decision_id) values (new.code, new.title, 'مبادرة', new.decision_id)
  on conflict (code) do update set name = excluded.name, decision_id = excluded.decision_id;
  return new;
end $$;
create trigger dev_offer_cc after insert or update of title, decision_id on activities.dev_offers
  for each row execute function activities.dev_cost_center();

-- الاستقطاع الشهري القائم على العضو (أقساط استقطاع غير مسددة لطلبات معتمدة/مسلّمة) في شهر معيّن
create or replace function activities.dev_monthly_load(p_person uuid, p_month date) returns numeric language sql stable as $$
  select coalesce(sum(i.amount - i.paid), 0) from activities.dev_installments i join activities.dev_orders o on o.id = i.order_id
  where o.person_id = p_person and o.method = 'استقطاع' and o.status in ('معتمد','مسلّم') and i.due_month = p_month and i.paid < i.amount
$$;
-- سقف الاستقطاع الشهري من الإعدادات (null = بلا سقف)
create or replace function activities.dev_cap() returns numeric language sql stable as $$
  select nullif(core.setting('PAYROLL_DEDUCTION_CAP')->>'monthly','')::numeric
$$;

create or replace function activities.dev_schedule(p_order uuid) returns void language plpgsql as $$
declare o activities.dev_orders; f date; rest numeric; i int;
begin
  select * into o from activities.dev_orders where id = p_order;
  delete from activities.dev_installments where order_id = p_order and paid = 0;
  f := date_trunc('month', coalesce((select first_due from activities.dev_offers where id = o.offer_id), current_date + interval '1 month'))::date;
  rest := o.price - o.down_payment;
  for i in 1..o.months loop
    insert into activities.dev_installments(order_id, seq, due_month, amount)
    values (p_order, i, (f + make_interval(months => i - 1))::date, case when i < o.months then o.monthly else rest - o.monthly * (o.months - 1) end);
  end loop;
end $$;

-- ───────── الطلب ─────────
create or replace function activities.dev_order(p_person uuid, p jsonb, p_actor text) returns uuid language plpgsql as $$
declare it activities.dev_items; ofr activities.dev_offers; v_m int; v_down numeric; v_mon numeric; v_elig boolean; v_id uuid; v_cap numeric; v_load numeric; v_used int;
begin
  select * into it from activities.dev_items where id = (p->>'itemId')::uuid and active;
  if it.id is null then raise exception 'الصنف غير متاح' using errcode = 'check_violation'; end if;
  select * into ofr from activities.dev_offers where id = it.offer_id for update;
  if ofr.status <> 'الطلب مفتوح' or (ofr.order_close is not null and current_date > ofr.order_close) then
    raise exception 'الطلب غير متاح الآن' using errcode = 'check_violation'; end if;
  if exists (select 1 from activities.dev_orders where offer_id = ofr.id and person_id = p_person and status not in ('مرفوض','ملغى')) then
    raise exception 'لك طلب قائم في هذا العرض' using errcode = 'check_violation'; end if;
  if it.stock is not null then
    select count(*) into v_used from activities.dev_orders where item_id = it.id and status not in ('مرفوض','ملغى');
    if v_used >= it.stock then raise exception 'الكمية نفدت' using errcode = 'check_violation'; end if;
  end if;
  v_m := coalesce((nullif(p->>'months',''))::int, it.max_months);
  if v_m < 1 or v_m > it.max_months then raise exception 'عدد الشهور من 1 إلى %', it.max_months using errcode = 'check_violation'; end if;
  v_down := round(it.member_price * it.down_pct / 100.0, 2);
  v_mon := ceil((it.member_price - v_down) / v_m);
  v_elig := core.is_union_beneficiary(p_person, current_date);
  if coalesce(p->>'method','استقطاع') = 'استقطاع' then
    v_cap := activities.dev_cap();
    if v_cap is not null then
      v_load := activities.dev_monthly_load(p_person, date_trunc('month', coalesce(ofr.first_due, current_date + interval '1 month'))::date);
      if v_load + v_mon > v_cap then
        raise exception 'القسط % يتجاوز سقف الاستقطاع الشهري % (القائم %)', v_mon, v_cap, v_load using errcode = 'check_violation'; end if;
    end if;
  end if;
  insert into activities.dev_orders(order_no, offer_id, item_id, person_id, months, method, price, down_payment, monthly, eligible, subsidy, requested_by)
  values (core.next_doc_no('DEVICE', 'جهاز', extract(year from current_date)::int), ofr.id, it.id, p_person, v_m, coalesce(p->>'method','استقطاع'),
          it.member_price, v_down, v_mon, v_elig, case when v_elig and it.market_price > it.member_price then it.market_price - it.member_price else 0 end, p_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function activities.dev_decide(p jsonb, p_actor text) returns void language plpgsql as $$
declare o activities.dev_orders;
begin
  select * into o from activities.dev_orders where id = (p->>'orderId')::uuid for update;
  if o.id is null or o.status <> 'مطلوب' then raise exception 'الطلب ليس بانتظار الاعتماد' using errcode = 'check_violation'; end if;
  if coalesce((p->>'approve')::boolean, false) then
    update activities.dev_orders set status = 'معتمد', approved_by = p_actor where id = o.id;
    perform activities.dev_schedule(o.id);
  else
    if nullif(trim(p->>'reason'),'') is null then raise exception 'سبب الرفض مطلوب' using errcode = 'check_violation'; end if;
    update activities.dev_orders set status = 'مرفوض', reject_reason = trim(p->>'reason'), approved_by = p_actor where id = o.id;
  end if;
end $$;

-- ───────── التسليم: البيع والتكلفة والمقدم والدعم ─────────
create or replace function activities.dev_deliver(p jsonb, p_actor text) returns uuid language plpgsql as $$
declare o activities.dev_orders; it activities.dev_items; ofr activities.dev_offers; v_entry uuid; pe core.persons; v_cash text := coalesce(nullif(p->>'cash_account',''),'1101');
begin
  select * into o from activities.dev_orders where id = (p->>'orderId')::uuid for update;
  if o.id is null or o.status <> 'معتمد' then raise exception 'التسليم للطلبات المعتمدة فقط' using errcode = 'check_violation'; end if;
  select * into it from activities.dev_items where id = o.item_id;
  select * into ofr from activities.dev_offers where id = o.offer_id;
  select * into pe from core.persons where id = o.person_id;
  v_entry := finance.post(jsonb_build_object('date', current_date, 'source', 'تسليم جهاز', 'source_ref', o.id, 'decision_id', ofr.decision_id,
    'description', 'تسليم ' || it.name || ' بالتقسيط — ' || pe.full_name || ' — طلب ' || o.order_no,
    'lines', jsonb_build_array(
      jsonb_build_object('account', '1201', 'debit', o.price, 'cost_center', ofr.code, 'person_id', o.person_id),
      jsonb_build_object('account', '4301', 'credit', o.price, 'cost_center', ofr.code),
      jsonb_build_object('account', '5601', 'debit', it.supplier_price, 'cost_center', ofr.code),
      jsonb_build_object('account', '2101', 'credit', it.supplier_price, 'cost_center', ofr.code, 'party', ofr.supplier))
      || case when o.down_payment > 0 then jsonb_build_array(
      jsonb_build_object('account', v_cash, 'debit', o.down_payment, 'cost_center', ofr.code, 'memo', 'مقدم'),
      jsonb_build_object('account', '1201', 'credit', o.down_payment, 'cost_center', ofr.code, 'person_id', o.person_id, 'memo', 'مقدم'))
      else '[]'::jsonb end), p_actor);
  update activities.dev_orders set status = 'مسلّم', delivered_at = current_date, delivered_by = p_actor, entry_id = v_entry where id = o.id;
  if o.subsidy > 0 then
    perform benefits.record(o.person_id, current_date, 'دعم', 'دعم مبادرة شراء', o.subsidy, 'الأنشطة', 'DEV:' || o.id,
      ofr.title || ' — ' || it.name || ' — طلب ' || o.order_no, ofr.decision_id, null);
  end if;
  return v_entry;
end $$;

create or replace function activities.dev_settle_check(p_order uuid) returns void language sql as $$
  update activities.dev_orders set status = 'مسدد' where id = p_order and status = 'مسلّم'
    and not exists (select 1 from activities.dev_installments where order_id = p_order and paid < amount)
$$;

-- قسط نقدي (أو سداد مبكر): يوزَّع على الأقساط الأقدم
create or replace function activities.dev_pay_cash(p_order uuid, p_amount numeric, p_cash text, p_actor text) returns text language plpgsql as $$
declare o activities.dev_orders; ofr activities.dev_offers; rest numeric := p_amount; x record; v_take numeric; v_no text; v_due numeric;
begin
  select * into o from activities.dev_orders where id = p_order for update;
  if o.id is null or o.status <> 'مسلّم' then raise exception 'السداد لطلب مسلّم فقط' using errcode = 'check_violation'; end if;
  select coalesce(sum(amount - paid),0) into v_due from activities.dev_installments where order_id = p_order;
  if coalesce(p_amount,0) <= 0 or p_amount > v_due then raise exception 'المبلغ غير صحيح — المتبقي %', v_due using errcode = 'check_violation'; end if;
  select * into ofr from activities.dev_offers where id = o.offer_id;
  v_no := core.next_doc_no('RCPT', 'قبض', extract(year from current_date)::int);
  perform finance.post(jsonb_build_object('date', current_date, 'source', 'إيصال', 'source_ref', o.id,
    'description', 'قسط ' || o.order_no || ' — إيصال ' || v_no,
    'lines', jsonb_build_array(jsonb_build_object('account', coalesce(p_cash,'1101'), 'debit', p_amount, 'cost_center', ofr.code),
                               jsonb_build_object('account', '1201', 'credit', p_amount, 'cost_center', ofr.code, 'person_id', o.person_id))), p_actor);
  for x in select * from activities.dev_installments where order_id = p_order and paid < amount and run_id is null order by seq loop
    exit when rest <= 0;
    v_take := least(rest, x.amount - x.paid);
    update activities.dev_installments set paid = paid + v_take, paid_via = 'نقدي' where order_id = p_order and seq = x.seq;
    rest := rest - v_take;
  end loop;
  if rest > 0 then raise exception 'باقي الأقساط في كشف استقطاع معتمد' using errcode = 'check_violation'; end if;
  perform activities.dev_settle_check(p_order);
  return v_no;
end $$;

-- ───────── كشف الاستقطاع الشهري ─────────
create or replace function activities.dev_run_build(p_month date, p_actor text) returns uuid language plpgsql as $$
declare v_m date := date_trunc('month', p_month)::date; v_id uuid; r activities.dev_runs;
begin
  select * into r from activities.dev_runs where month = v_m for update;
  if r.id is not null and r.status <> 'مسودة' then raise exception 'كشف هذا الشهر معتمد' using errcode = 'check_violation'; end if;
  if r.id is null then insert into activities.dev_runs(month, created_by) values (v_m, p_actor) returning id into v_id; else v_id := r.id; end if;
  delete from activities.dev_run_lines where run_id = v_id;
  -- الأقساط المستحقة حتى هذا الشهر (المتأخر يدخل) لطلبات الاستقطاع المسلّمة
  insert into activities.dev_run_lines(run_id, order_id, seq, person_id, amount)
  select v_id, i.order_id, i.seq, o.person_id, i.amount - i.paid
  from activities.dev_installments i join activities.dev_orders o on o.id = i.order_id
  where o.method = 'استقطاع' and o.status = 'مسلّم' and i.due_month <= v_m and i.paid < i.amount and i.run_id is null;
  update activities.dev_runs set total = (select coalesce(sum(amount),0) from activities.dev_run_lines where run_id = v_id) where id = v_id;
  return v_id;
end $$;

-- اعتماد الكشف (أُرسل لجهة العمل): مدين 1203 / دائن 1201 لكل عضو، والأقساط تُعتبر مسددة بالاستقطاع
create or replace function activities.dev_run_approve(p_run uuid, p_actor text) returns uuid language plpgsql as $$
declare r activities.dev_runs; v_entry uuid; v_lines jsonb;
begin
  select * into r from activities.dev_runs where id = p_run for update;
  if r.id is null or r.status <> 'مسودة' then raise exception 'الكشف ليس مسودة' using errcode = 'check_violation'; end if;
  if r.created_by = p_actor then raise exception 'من أعدّ الكشف لا يعتمده' using errcode = 'check_violation'; end if;
  if r.total <= 0 then raise exception 'الكشف فاضي' using errcode = 'check_violation'; end if;
  select jsonb_build_array(jsonb_build_object('account', '1203', 'debit', r.total, 'memo', 'كشف استقطاع ' || to_char(r.month, 'YYYY-MM')))
         || jsonb_agg(jsonb_build_object('account', '1201', 'credit', s.amt, 'person_id', s.person_id, 'cost_center', s.code))
    into v_lines
  from (select l.person_id, ofr.code, sum(l.amount) amt from activities.dev_run_lines l join activities.dev_orders o on o.id = l.order_id
        join activities.dev_offers ofr on ofr.id = o.offer_id where l.run_id = p_run group by l.person_id, ofr.code) s;
  v_entry := finance.post(jsonb_build_object('date', current_date, 'source', 'كشف استقطاع', 'source_ref', p_run,
    'description', 'كشف استقطاع أقساط شهر ' || to_char(r.month, 'YYYY-MM'), 'lines', v_lines), p_actor);
  update activities.dev_installments i set paid = i.amount, paid_via = 'استقطاع', run_id = p_run
  from activities.dev_run_lines l where l.run_id = p_run and l.order_id = i.order_id and l.seq = i.seq;
  update activities.dev_runs set status = 'معتمد', entry_id = v_entry, approved_by = p_actor where id = p_run;
  perform activities.dev_settle_check(o) from (select distinct order_id o from activities.dev_run_lines where run_id = p_run) q;
  return v_entry;
end $$;

-- تحصيل تحويل جهة العمل: مدين البنك / دائن 1203
create or replace function activities.dev_run_receive(p_run uuid, p_bank text, p_actor text) returns uuid language plpgsql as $$
declare r activities.dev_runs; v_entry uuid;
begin
  select * into r from activities.dev_runs where id = p_run for update;
  if r.id is null or r.status <> 'معتمد' then raise exception 'التحصيل لكشف معتمد' using errcode = 'check_violation'; end if;
  v_entry := finance.post(jsonb_build_object('date', current_date, 'source', 'تحصيل استقطاع', 'source_ref', p_run,
    'description', 'تحويل جهة العمل — استقطاع شهر ' || to_char(r.month, 'YYYY-MM'),
    'lines', jsonb_build_array(jsonb_build_object('account', coalesce(p_bank,'1102'), 'debit', r.total),
                               jsonb_build_object('account', '1203', 'credit', r.total))), p_actor);
  update activities.dev_runs set status = 'محصّل', receipt_entry_id = v_entry where id = p_run;
  return v_entry;
end $$;

-- ───────── واجهة DEV_* ─────────
create or replace function api.dev_order_json(p_order uuid) returns jsonb language sql stable as $$
  select to_jsonb(o) || jsonb_build_object(
    'item', (select jsonb_build_object('name', name, 'market_price', market_price) from activities.dev_items where id = o.item_id),
    'offer', (select jsonb_build_object('id', id, 'title', title, 'supplier', supplier) from activities.dev_offers where id = o.offer_id),
    'person', (select jsonb_build_object('full_name', full_name, 'job_id', job_id) from core.persons where id = o.person_id),
    'remaining', (select coalesce(sum(amount - paid), 0) from activities.dev_installments where order_id = o.id),
    'installments', coalesce((select jsonb_agg(jsonb_build_object('seq', seq, 'due_month', due_month, 'amount', amount, 'paid', paid, 'paid_via', paid_via) order by seq)
                     from activities.dev_installments where order_id = o.id), '[]'))
  from activities.dev_orders o where o.id = p_order
$$;

create or replace function api.handle_devices(p_action text, p jsonb, uid uuid, pid uuid) returns jsonb language plpgsql as $$
declare v_id uuid; v_person uuid; a text := uid::text; r jsonb; v_no text; x jsonb;
begin
  if p_action = 'DEV_OFFERS' then
    return api.ok(jsonb_build_object('cap', activities.dev_cap(), 'items', coalesce((select jsonb_agg(to_jsonb(f) || jsonb_build_object(
        'items', coalesce((select jsonb_agg(to_jsonb(i) - 'supplier_price' || case when core.can(uid,'devices.manage') then jsonb_build_object('supplier_price', i.supplier_price) else '{}' end
                   || jsonb_build_object('left', case when i.stock is null then null else i.stock - (select count(*) from activities.dev_orders where item_id = i.id and status not in ('مرفوض','ملغى')) end)
                   order by i.member_price) from activities.dev_items i where i.offer_id = f.id and (i.active or core.can(uid,'devices.manage'))), '[]'),
        'myOrder', (select api.dev_order_json(o.id) from activities.dev_orders o where o.offer_id = f.id and o.person_id = pid and o.status not in ('ملغى') order by o.created_at desc limit 1)
      ) order by f.created_at desc)
      from activities.dev_offers f where f.status in ('الطلب مفتوح','الطلب مقفول') or core.can(uid,'devices.manage')), '[]')));
  elsif p_action = 'DEV_ORDER' then
    v_person := pid;
    if nullif(p->>'jobId','') is not null then
      if not core.can(uid,'activities.book.proxy') then return api.err('غير مسموح.'); end if;
      v_person := api.pid_by_job(p->>'jobId');
    elsif not core.can(uid,'activities.book.self') then return api.err('غير مسموح.'); end if;
    if v_person is null then return api.err('العضو غير موجود.'); end if;
    v_id := activities.dev_order(v_person, p, a);
    return api.ok(jsonb_build_object('order', api.dev_order_json(v_id)));
  elsif p_action = 'DEV_MY' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(api.dev_order_json(id) order by created_at desc) from activities.dev_orders where person_id = pid), '[]')));
  elsif p_action = 'DEV_CANCEL_MY' then
    update activities.dev_orders set status = 'ملغى' where id = (p->>'orderId')::uuid and person_id = pid and status = 'مطلوب';
    if not found then return api.err('الطلب لا يُلغى بعد الاعتماد — كلّم المسئول.'); end if;
    return api.ok();
  end if;
  -- ── الخزينة ──
  if p_action in ('DEV_PAY','DEV_RUN_RECEIVE') then
    if not core.can(uid,'treasury.receipt') then return api.err('غير مسموح.'); end if;
    if p_action = 'DEV_PAY' then
      v_no := activities.dev_pay_cash((p->>'orderId')::uuid, (p->>'amount')::numeric, coalesce(api.t(p,'cash_account'),'1101'), a);
      return api.ok(jsonb_build_object('receipt_no', v_no, 'order', api.dev_order_json((p->>'orderId')::uuid)));
    end if;
    perform activities.dev_run_receive((p->>'runId')::uuid, coalesce(api.t(p,'bank_account'),'1102'), a); return api.ok();
  end if;
  if p_action = 'DEV_RUN_APPROVE' then
    if not core.can(uid,'treasury.payment.approve') and not core.can(uid,'treasury.receipt') then return api.err('غير مسموح.'); end if;
    perform activities.dev_run_approve((p->>'runId')::uuid, a); return api.ok();
  end if;
  if not core.can(uid,'devices.manage') then return api.err('غير مسموح.'); end if;
  if p_action = 'DEV_SAVE' then
    r := p->'offer';
    if api.t(r,'title') is null or api.t(r,'supplier') is null then return api.err('العنوان والمورد مطلوبان.'); end if;
    if nullif(r->>'id','') is null then
      insert into activities.dev_offers(code, title, supplier, order_open, order_close, first_due, decision_id, notes, created_by)
      values (core.next_doc_no('DEVOFFER','DEV', extract(year from current_date)::int), api.t(r,'title'), api.t(r,'supplier'),
        (api.t(r,'order_open'))::date, (api.t(r,'order_close'))::date, (api.t(r,'first_due'))::date, (nullif(r->>'decision_id',''))::uuid, api.t(r,'notes'), a)
      returning id into v_id;
    else
      v_id := (r->>'id')::uuid;
      update activities.dev_offers set title = api.t(r,'title'), supplier = api.t(r,'supplier'), order_open = (api.t(r,'order_open'))::date,
        order_close = (api.t(r,'order_close'))::date, first_due = (api.t(r,'first_due'))::date, decision_id = (nullif(r->>'decision_id',''))::uuid, notes = api.t(r,'notes')
      where id = v_id;
    end if;
    if r ? 'items' then
      for x in select * from jsonb_array_elements(r->'items') loop
        if exists (select 1 from activities.dev_orders o join activities.dev_items i on i.id = o.item_id where i.offer_id = v_id and i.name = x->>'name' and o.status <> 'ملغى')
           and exists (select 1 from activities.dev_items where offer_id = v_id and name = x->>'name'
                       and (member_price <> (x->>'member_price')::numeric or max_months <> coalesce((nullif(x->>'max_months',''))::int, 10))) then
          return api.err('لا يتغير سعر/شهور صنف عليه طلبات: ' || (x->>'name')); end if;
        insert into activities.dev_items(offer_id, name, supplier_price, member_price, market_price, max_months, down_pct, stock, active)
        values (v_id, x->>'name', (x->>'supplier_price')::numeric, (x->>'member_price')::numeric, (nullif(x->>'market_price',''))::numeric,
          coalesce((nullif(x->>'max_months',''))::int, 10), coalesce((nullif(x->>'down_pct',''))::int, 0), (nullif(x->>'stock',''))::int, coalesce((x->>'active')::boolean, true))
        on conflict (offer_id, name) do update set supplier_price = excluded.supplier_price, member_price = excluded.member_price, market_price = excluded.market_price,
          max_months = excluded.max_months, down_pct = excluded.down_pct, stock = excluded.stock, active = excluded.active;
      end loop;
    end if;
    return api.ok(jsonb_build_object('id', v_id));
  elsif p_action = 'DEV_SET_STATUS' then
    if api.t(p,'status') = 'الطلب مفتوح' and (select decision_id from activities.dev_offers where id = (p->>'offerId')::uuid) is null
       and coalesce((core.setting('FIN_REQUIRE_DECISION'))::text,'true') = 'true' then return api.err('اربط العرض بقرار المجلس قبل فتح الطلب.'); end if;
    update activities.dev_offers set status = api.t(p,'status') where id = (p->>'offerId')::uuid;
    return api.ok();
  elsif p_action = 'DEV_ORDERS' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(api.dev_order_json(o.id) order by
        case o.status when 'مطلوب' then 1 when 'معتمد' then 2 when 'مسلّم' then 3 else 4 end, o.created_at)
      from activities.dev_orders o where (nullif(p->>'offerId','') is null or o.offer_id = (p->>'offerId')::uuid)
        and (api.t(p,'status') is null or o.status = api.t(p,'status'))), '[]')));
  elsif p_action = 'DEV_DECIDE' then
    perform activities.dev_decide(p, a); return api.ok(jsonb_build_object('order', api.dev_order_json((p->>'orderId')::uuid)));
  elsif p_action = 'DEV_DELIVER' then
    perform activities.dev_deliver(p, a); return api.ok(jsonb_build_object('order', api.dev_order_json((p->>'orderId')::uuid)));
  elsif p_action = 'DEV_RUN_BUILD' then
    v_id := activities.dev_run_build(coalesce((nullif(p->>'month',''))::date, current_date), a);
    return api.ok(jsonb_build_object('runId', v_id));
  elsif p_action = 'DEV_RUNS' then
    return api.ok(jsonb_build_object('cap', activities.dev_cap(), 'items', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('lines',
        coalesce((select jsonb_agg(jsonb_build_object('full_name', pe.full_name, 'job_id', pe.job_id, 'amount', s.amt) order by pe.full_name)
                  from (select person_id, sum(amount) amt from activities.dev_run_lines where run_id = r.id group by person_id) s
                  join core.persons pe on pe.id = s.person_id), '[]')) order by r.month desc) from activities.dev_runs r), '[]')));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- الموجّه (كل الفروع)
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  if p_action like 'IMPORT\_%' or p_action like 'GOV\_%' or p_action like 'FIN\_%' or p_action like 'BEN\_%' or p_action like 'ACT\_%'
     or p_action like 'SUM\_%' or p_action like 'GRT\_%' or p_action like 'DEV\_%' then
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
    elsif p_action like 'ACT\_%' then return api.handle_activities(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'SUM\_%' then return api.handle_summer(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'GRT\_%' then return api.handle_grants(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'DEV\_%' then return api.handle_devices(p_action, p, uid, (s->>'pid')::uuid);
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
insert into core.role_permissions(role, permission) values ('SYS_ADMIN','devices.manage') on conflict do nothing;
revoke all on all functions in schema api, activities from public, anon, authenticated;
