-- المرحلة 8 — العمرة والحج: خدمة إعلان وحجز فقط (قرار المستخدم 22 نوفمبر 2026) — على نفس محرّك عروض الأجهزة
-- العرض له نوع (أجهزة/عمرة/حج)، والصنف = باقة (سعر، تقسيط حتى، مقاعد، تفاصيل)، والحجز بعدد المسافرين. لا ماليات للنقابة.
alter table activities.dev_offers add column if not exists category text not null default 'أجهزة';
alter table activities.dev_offers drop constraint if exists dev_offers_category_check;
alter table activities.dev_offers add constraint dev_offers_category_check check (category in ('أجهزة','عمرة','حج'));
alter table activities.dev_orders add column if not exists travelers int not null default 1;
alter table activities.dev_orders drop constraint if exists dev_orders_travelers_check;
alter table activities.dev_orders add constraint dev_orders_travelers_check check (travelers between 1 and 20);

-- الكمية (stock) = عدد المقاعد/الوحدات؛ الحجز يستهلك بعدد المسافرين
create or replace function activities.dev_used(p_item uuid) returns int language sql stable as $$
  select coalesce(sum(travelers), 0)::int from activities.dev_orders where item_id = p_item and status not in ('مرفوض','ملغى')
$$;

create or replace function activities.dev_order(p_person uuid, p jsonb, p_actor text) returns uuid language plpgsql as $$
declare it activities.dev_items; ofr activities.dev_offers; v_m int; v_id uuid; v_n int := coalesce((nullif(p->>'travelers',''))::int, 1);
begin
  select * into it from activities.dev_items where id = (p->>'itemId')::uuid and active;
  if it.id is null then raise exception 'الصنف غير متاح' using errcode = 'check_violation'; end if;
  select * into ofr from activities.dev_offers where id = it.offer_id for update;
  if ofr.status <> 'الطلب مفتوح' or (ofr.order_close is not null and current_date > ofr.order_close) then
    raise exception 'الحجز غير متاح الآن' using errcode = 'check_violation'; end if;
  if exists (select 1 from activities.dev_orders where item_id = it.id and person_id = p_person and status not in ('مرفوض','ملغى')) then
    raise exception 'لك حجز قائم لهذا الصنف' using errcode = 'check_violation'; end if;
  if v_n < 1 or v_n > 20 then raise exception 'عدد المسافرين غير صحيح' using errcode = 'check_violation'; end if;
  if it.stock is not null and activities.dev_used(it.id) + v_n > it.stock then
    raise exception 'المتاح % فقط', greatest(it.stock - activities.dev_used(it.id), 0) using errcode = 'check_violation'; end if;
  v_m := case when coalesce(p->>'method','تقسيط') = 'تقسيط' then coalesce((nullif(p->>'months',''))::int, it.max_months) end;
  if v_m is not null and (v_m < 1 or v_m > it.max_months) then raise exception 'عدد الشهور من 1 إلى %', it.max_months using errcode = 'check_violation'; end if;
  insert into activities.dev_orders(order_no, offer_id, item_id, person_id, months, method, offer_price, notes, travelers, requested_by)
  values (core.next_doc_no('DEVICE', 'حجز', extract(year from current_date)::int), ofr.id, it.id, p_person, v_m, coalesce(p->>'method','تقسيط'),
          it.offer_price, nullif(trim(p->>'notes'),''), v_n, p_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function api.dev_order_json(p_order uuid) returns jsonb language sql stable as $$
  select to_jsonb(o) || jsonb_build_object(
    'item', (select jsonb_build_object('name', name, 'market_price', market_price) from activities.dev_items where id = o.item_id),
    'offer', (select jsonb_build_object('id', id, 'title', title, 'supplier', supplier, 'contact', contact, 'category', category) from activities.dev_offers where id = o.offer_id),
    'person', (select jsonb_build_object('full_name', full_name, 'job_id', job_id, 'phone', phone) from core.persons where id = o.person_id))
  from activities.dev_orders o where o.id = p_order
$$;

-- الواجهة: DEV_OFFERS/DEV_SAVE بالنوع (category)؛ الباقي كما هو
do $$ declare d text := pg_get_functiondef('api.handle_devices(text,jsonb,uuid,uuid)'::regprocedure); n int := 0;
begin
  -- فلترة العروض بالنوع
  if position($a$from activities.dev_offers f where f.status in ('الطلب مفتوح','الطلب مقفول') or core.can(uid,'devices.manage')), '[]')));$a$ in d) = 0 then raise exception 'anchor 1'; end if;
  d := replace(d, $a$from activities.dev_offers f where f.status in ('الطلب مفتوح','الطلب مقفول') or core.can(uid,'devices.manage')), '[]')));$a$,
    $b$from activities.dev_offers f where (f.status in ('الطلب مفتوح','الطلب مقفول') or core.can(uid,'devices.manage'))
        and (api.t(p,'category') is null or f.category = api.t(p,'category'))), '[]')));$b$);
  -- المتبقي بعدد المسافرين
  if position($a$else i.stock - (select count(*) from activities.dev_orders where item_id = i.id and status not in ('مرفوض','ملغى')) end)$a$ in d) = 0 then raise exception 'anchor 2'; end if;
  d := replace(d, $a$else i.stock - (select count(*) from activities.dev_orders where item_id = i.id and status not in ('مرفوض','ملغى')) end)$a$,
    $b$else i.stock - activities.dev_used(i.id) end)$b$);
  -- حفظ النوع
  if position($a$insert into activities.dev_offers(code, title, supplier, contact, order_open, order_close, decision_id, notes, created_by)$a$ in d) = 0 then raise exception 'anchor 3'; end if;
  d := replace(d, $a$insert into activities.dev_offers(code, title, supplier, contact, order_open, order_close, decision_id, notes, created_by)
      values (core.next_doc_no('DEVOFFER','DEV', extract(year from current_date)::int), api.t(r,'title'), api.t(r,'supplier'), api.t(r,'contact'),$a$,
    $b$insert into activities.dev_offers(category, code, title, supplier, contact, order_open, order_close, decision_id, notes, created_by)
      values (coalesce(api.t(r,'category'),'أجهزة'), core.next_doc_no('DEVOFFER','DEV', extract(year from current_date)::int), api.t(r,'title'), api.t(r,'supplier'), api.t(r,'contact'),$b$);
  if position($a$update activities.dev_offers set title = api.t(r,'title'),$a$ in d) = 0 then raise exception 'anchor 4'; end if;
  d := replace(d, $a$update activities.dev_offers set title = api.t(r,'title'),$a$, $b$update activities.dev_offers set category = coalesce(api.t(r,'category'), category), title = api.t(r,'title'),$b$);
  execute d;
end $$;
revoke all on all functions in schema api, activities from public, anon, authenticated;
