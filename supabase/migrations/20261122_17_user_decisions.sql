-- قرارات المستخدم 22 نوفمبر 2026 (بعد المرحلة 7):
-- (1) مدير المنظومة له كل الصلاحيات (كل العمليات والمراجعة والاعتماد) — بلا قيود فصل المهام عليه.
-- (2) مبالغ المنح: زواج العضو وأبنائه 300 · وفاة الدرجة الأولى (أب/أم/أبناء) 300 · وفاة الزوج/الزوجة 500.
--     الاستثناء فوق المقرر بموافقة رئيس المجلس (أو بقرار). المبالغ تتغير بتغير اللائحة ⇒ جدول المبالغ بتاريخ سريان.
-- (3) الأجهزة خدمة إعلان وحجز فقط — لا ماليات للنقابة فيها (التقسيط والتحصيل تنظمه جهة أخرى).

-- ───── (1) مدير المنظومة ─────
create or replace function core.is_admin(p_user uuid) returns boolean language sql stable as $$
  select exists (select 1 from core.user_roles ur join core.users u on u.id = ur.user_id and u.active where ur.user_id = p_user and ur.role = 'SYS_ADMIN')
$$;
create or replace function core.is_admin_actor(p_actor text) returns boolean language plpgsql stable as $$
begin return core.is_admin(p_actor::uuid); exception when others then return false; end $$;

create or replace function core.can(p_user uuid, p_perm text, p_amount numeric default null)
returns boolean language sql stable as $$
  select core.is_admin(p_user) or exists (
    select 1 from core.user_roles ur
    join core.users u on u.id = ur.user_id and u.active
    join core.role_permissions rp on rp.role = ur.role and rp.permission = p_perm
    where ur.user_id = p_user
      and (p_amount is null or rp.max_amount is null or p_amount <= rp.max_amount))
$$;
create or replace function api.perms(p_user uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(role) from core.user_roles where user_id = p_user), '[]'),
    'perms', case when core.is_admin(p_user)
      then coalesce((select jsonb_object_agg(code, null) from core.permissions), '{}')
      else coalesce((select jsonb_object_agg(rp.permission, rp.max_amount)
                     from core.user_roles ur join core.role_permissions rp on rp.role = ur.role
                     where ur.user_id = p_user), '{}') end)
$$;

-- ───── (2) المنح ─────
alter table grants.requests add column if not exists exception_note text;   -- موافقة رئيس المجلس على مبلغ استثنائي
update grants.types set relations = array['أب','أم','ابن','ابنة','زوج','زوجة'] where code = 'DEATH';
update grants.types set relations = array['العضو','ابن','ابنة'] where code = 'MARRIAGE';
-- المولود والتفوق والعلاج غير مقررة في اللائحة الحالية ⇒ موقوفة (تُفعَّل بمبلغها لو أقرّتها اللائحة)
update grants.types set active = false where code in ('BIRTH','EXCELLENCE','MEDICAL');
update grants.rates set notes = 'لائحة الدورة الحالية' where type_code in ('MARRIAGE','DEATH') and relation is null;
insert into grants.rates(type_code, relation, amount, valid_from, notes) values
  ('DEATH','زوج',500,'2022-01-01','لائحة الدورة الحالية'), ('DEATH','زوجة',500,'2022-01-01','لائحة الدورة الحالية')
on conflict (type_code, relation, valid_from) do update set amount = excluded.amount, notes = excluded.notes;

create or replace function grants.review(p jsonb, p_actor text) returns text language plpgsql as $$
declare r grants.requests; v_docs jsonb; v_st text;
begin
  select * into r from grants.requests where id = (p->>'requestId')::uuid for update;
  if r.id is null or r.status not in ('مقدَّم','ناقص مستندات','مستوفى') then raise exception 'الطلب غير قابل للمراجعة' using errcode = 'check_violation'; end if;
  if r.submitted_by = p_actor and not core.is_admin_actor(p_actor) then raise exception 'لا تراجع طلباً قدّمته بنفسك' using errcode = 'check_violation'; end if;
  v_docs := coalesce(p->'docs', r.docs);
  v_st := case when exists (select 1 from jsonb_array_elements(v_docs) d where not coalesce((d->>'received')::boolean, false)) then 'ناقص مستندات' else 'مستوفى' end;
  update grants.requests set docs = v_docs, status = v_st, reviewed_by = p_actor, notes = coalesce(nullif(trim(p->>'notes'),''), notes) where id = r.id;
  perform grants.log(r.id, 'مراجعة', jsonb_build_object('status', v_st, 'docs', v_docs), p_actor);
  return v_st;
end $$;

create or replace function grants.decide(p jsonb, p_actor text) returns void language plpgsql as $$
declare r grants.requests; v_amt numeric; v_exc text := nullif(trim(p->>'exception_note'),''); v_dec uuid := (nullif(p->>'decision_id',''))::uuid;
begin
  select * into r from grants.requests where id = (p->>'requestId')::uuid for update;
  if r.id is null then raise exception 'الطلب غير موجود' using errcode = 'check_violation'; end if;
  if r.submitted_by = p_actor and not core.is_admin_actor(p_actor) then raise exception 'لا تعتمد طلباً قدّمته بنفسك' using errcode = 'check_violation'; end if;
  if coalesce((p->>'approve')::boolean, false) then
    if r.status <> 'مستوفى' then raise exception 'الاعتماد بعد استيفاء المستندات' using errcode = 'check_violation'; end if;
    v_amt := coalesce((nullif(p->>'amount',''))::numeric, r.amount);
    if v_amt is null or v_amt <= 0 then raise exception 'حدد المبلغ' using errcode = 'check_violation'; end if;
    -- مبلغ غير المقرر (أو بلا مقرر) = استثناء: يلزمه موافقة رئيس المجلس أو قرار
    if (r.amount is null or v_amt <> r.amount) and v_exc is null and v_dec is null then
      raise exception 'المبلغ غير المقرر (%) استثناء — اكتب موافقة رئيس المجلس أو اربطه بقرار', coalesce(r.amount::text, 'لا يوجد') using errcode = 'check_violation'; end if;
    update grants.requests set status = 'معتمد', amount = v_amt, approved_by = p_actor, exception_note = coalesce(v_exc, exception_note),
      decision_id = coalesce(v_dec, decision_id) where id = r.id;
    perform grants.log(r.id, 'اعتماد', jsonb_build_object('amount', v_amt, 'decision_id', v_dec, 'exception', v_exc, 'rate', r.amount), p_actor);
  else
    if r.status in ('مصروف','مرفوض','ملغى') then raise exception 'الطلب منتهٍ' using errcode = 'check_violation'; end if;
    if nullif(trim(p->>'reason'),'') is null then raise exception 'سبب الرفض مطلوب' using errcode = 'check_violation'; end if;
    update grants.requests set status = 'مرفوض', reject_reason = trim(p->>'reason'), approved_by = p_actor where id = r.id;
    perform grants.log(r.id, 'رفض', jsonb_build_object('reason', p->>'reason'), p_actor);
  end if;
end $$;

create or replace function grants.pay(p jsonb, p_actor text) returns uuid language plpgsql as $$
declare r grants.requests; t grants.types; v_chq uuid; pe core.persons;
begin
  select * into r from grants.requests where id = (p->>'requestId')::uuid for update;
  if r.id is null or r.status <> 'معتمد' then raise exception 'الصرف للطلبات المعتمدة فقط' using errcode = 'check_violation'; end if;
  if r.approved_by = p_actor and not core.is_admin_actor(p_actor) then raise exception 'من اعتمد الطلب لا يصرفه' using errcode = 'check_violation'; end if;
  select * into t from grants.types where code = r.type_code;
  select * into pe from core.persons where id = r.person_id;
  v_chq := treasury.issue_cheque(jsonb_build_object('date', coalesce(nullif(p->>'date',''), current_date::text), 'amount', r.amount,
    'cheque_no', p->>'cheque_no', 'bank_account', coalesce(nullif(p->>'bank_account',''),'1102'), 'person_id', r.person_id,
    'payee_name', pe.full_name, 'purpose', 'منحة', 'expense_account', t.account, 'decision_id', r.decision_id, 'cost_center', 'GRANTS',
    'notes', t.name || ' — ' || coalesce(r.subject_relation,'') || ' ' || coalesce(r.subject_name,'') || ' — طلب ' || r.req_no
             || coalesce(' — استثناء: ' || r.exception_note, '')), p_actor);
  update grants.requests set status = 'مصروف', cheque_id = v_chq, paid_by = p_actor where id = r.id;
  perform grants.log(r.id, 'صرف', jsonb_build_object('cheque_id', v_chq, 'cheque_no', p->>'cheque_no'), p_actor);
  return v_chq;
end $$;

-- ───── (3) الأجهزة: إعلان وحجز فقط ─────
drop function if exists activities.dev_run_receive(uuid, text, text);
drop function if exists activities.dev_run_approve(uuid, text);
drop function if exists activities.dev_run_build(date, text);
drop function if exists activities.dev_pay_cash(uuid, numeric, text, text);
drop function if exists activities.dev_settle_check(uuid);
drop function if exists activities.dev_deliver(jsonb, text);
drop function if exists activities.dev_schedule(uuid);
drop function if exists activities.dev_monthly_load(uuid, date);
drop function if exists activities.dev_cap();
drop table if exists activities.dev_run_lines;
drop table if exists activities.dev_runs;
drop table if exists activities.dev_installments;
drop trigger if exists dev_offer_cc on activities.dev_offers;
drop function if exists activities.dev_cost_center();
delete from finance.cost_centers c where c.kind = 'مبادرة' and c.code like 'DEV-%'
  and not exists (select 1 from finance.lines l where l.cost_center = c.code);

alter table activities.dev_items drop column if exists supplier_price;
alter table activities.dev_items drop column if exists down_pct;
alter table activities.dev_items rename column member_price to offer_price;       -- سعر العرض المعلن
alter table activities.dev_items add column if not exists notes text;           -- مواصفات/شروط المورد
alter table activities.dev_offers add column if not exists contact text;        -- للتواصل مع المورد
alter table activities.dev_offers drop column if exists first_due;
alter table activities.dev_orders drop column if exists entry_id;
alter table activities.dev_orders drop column if exists subsidy;
alter table activities.dev_orders drop column if exists down_payment;
alter table activities.dev_orders drop column if exists monthly;
alter table activities.dev_orders drop column if exists eligible;
alter table activities.dev_orders drop column if exists delivered_by;
alter table activities.dev_orders rename column price to offer_price;
alter table activities.dev_orders alter column months drop not null;
alter table activities.dev_orders drop constraint if exists dev_orders_method_check;
alter table activities.dev_orders alter column method set default 'تقسيط';
alter table activities.dev_orders add constraint dev_orders_method_check check (method in ('تقسيط','كاش'));
alter table activities.dev_orders drop constraint if exists dev_orders_status_check;
alter table activities.dev_orders add constraint dev_orders_status_check check (status in ('مطلوب','مؤكد','مسلّم','مرفوض','ملغى'));
alter table activities.dev_orders add column if not exists notes text;

create or replace function activities.dev_order(p_person uuid, p jsonb, p_actor text) returns uuid language plpgsql as $$
declare it activities.dev_items; ofr activities.dev_offers; v_m int; v_id uuid; v_used int;
begin
  select * into it from activities.dev_items where id = (p->>'itemId')::uuid and active;
  if it.id is null then raise exception 'الصنف غير متاح' using errcode = 'check_violation'; end if;
  select * into ofr from activities.dev_offers where id = it.offer_id for update;
  if ofr.status <> 'الطلب مفتوح' or (ofr.order_close is not null and current_date > ofr.order_close) then
    raise exception 'الحجز غير متاح الآن' using errcode = 'check_violation'; end if;
  if exists (select 1 from activities.dev_orders where item_id = it.id and person_id = p_person and status not in ('مرفوض','ملغى')) then
    raise exception 'لك حجز قائم لهذا الصنف' using errcode = 'check_violation'; end if;
  if it.stock is not null then
    select count(*) into v_used from activities.dev_orders where item_id = it.id and status not in ('مرفوض','ملغى');
    if v_used >= it.stock then raise exception 'الكمية نفدت' using errcode = 'check_violation'; end if;
  end if;
  v_m := case when coalesce(p->>'method','تقسيط') = 'تقسيط' then coalesce((nullif(p->>'months',''))::int, it.max_months) end;
  if v_m is not null and (v_m < 1 or v_m > it.max_months) then raise exception 'عدد الشهور من 1 إلى %', it.max_months using errcode = 'check_violation'; end if;
  insert into activities.dev_orders(order_no, offer_id, item_id, person_id, months, method, offer_price, notes, requested_by)
  values (core.next_doc_no('DEVICE', 'جهاز', extract(year from current_date)::int), ofr.id, it.id, p_person, v_m, coalesce(p->>'method','تقسيط'),
          it.offer_price, nullif(trim(p->>'notes'),''), p_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function activities.dev_decide(p jsonb, p_actor text) returns void language plpgsql as $$
declare o activities.dev_orders; v_to text := p->>'status';
begin
  select * into o from activities.dev_orders where id = (p->>'orderId')::uuid for update;
  if o.id is null then raise exception 'الحجز غير موجود' using errcode = 'check_violation'; end if;
  if v_to = 'مؤكد' and o.status = 'مطلوب' then
    update activities.dev_orders set status = 'مؤكد', approved_by = p_actor where id = o.id;
  elsif v_to = 'مسلّم' and o.status = 'مؤكد' then
    update activities.dev_orders set status = 'مسلّم', delivered_at = current_date where id = o.id;
  elsif v_to = 'مرفوض' and o.status in ('مطلوب','مؤكد') then
    if nullif(trim(p->>'reason'),'') is null then raise exception 'السبب مطلوب' using errcode = 'check_violation'; end if;
    update activities.dev_orders set status = 'مرفوض', reject_reason = trim(p->>'reason'), approved_by = p_actor where id = o.id;
  else raise exception 'لا يمكن تحويل الحجز من «%» إلى «%»', o.status, v_to using errcode = 'check_violation'; end if;
end $$;

create or replace function api.dev_order_json(p_order uuid) returns jsonb language sql stable as $$
  select to_jsonb(o) || jsonb_build_object(
    'item', (select jsonb_build_object('name', name, 'market_price', market_price) from activities.dev_items where id = o.item_id),
    'offer', (select jsonb_build_object('id', id, 'title', title, 'supplier', supplier, 'contact', contact) from activities.dev_offers where id = o.offer_id),
    'person', (select jsonb_build_object('full_name', full_name, 'job_id', job_id, 'phone', phone) from core.persons where id = o.person_id))
  from activities.dev_orders o where o.id = p_order
$$;

create or replace function api.handle_devices(p_action text, p jsonb, uid uuid, pid uuid) returns jsonb language plpgsql as $$
declare v_id uuid; v_person uuid; a text := uid::text; r jsonb; x jsonb;
begin
  if p_action = 'DEV_OFFERS' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(f) || jsonb_build_object(
        'items', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object('left', case when i.stock is null then null
                   else i.stock - (select count(*) from activities.dev_orders where item_id = i.id and status not in ('مرفوض','ملغى')) end)
                   order by i.offer_price) from activities.dev_items i where i.offer_id = f.id and (i.active or core.can(uid,'devices.manage'))), '[]'),
        'myOrders', coalesce((select jsonb_agg(api.dev_order_json(o.id) order by o.created_at desc) from activities.dev_orders o
                   where o.offer_id = f.id and o.person_id = pid and o.status <> 'ملغى'), '[]'),
        'orderCount', (select count(*) from activities.dev_orders where offer_id = f.id and status not in ('مرفوض','ملغى'))
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
    update activities.dev_orders set status = 'ملغى' where id = (p->>'orderId')::uuid and person_id = pid and status in ('مطلوب','مؤكد');
    if not found then return api.err('الحجز لا يُلغى في حالته.'); end if;
    return api.ok();
  end if;
  if not core.can(uid,'devices.manage') then return api.err('غير مسموح.'); end if;
  if p_action = 'DEV_SAVE' then
    r := p->'offer';
    if api.t(r,'title') is null or api.t(r,'supplier') is null then return api.err('العنوان والمورد مطلوبان.'); end if;
    if nullif(r->>'id','') is null then
      insert into activities.dev_offers(code, title, supplier, contact, order_open, order_close, decision_id, notes, created_by)
      values (core.next_doc_no('DEVOFFER','DEV', extract(year from current_date)::int), api.t(r,'title'), api.t(r,'supplier'), api.t(r,'contact'),
        (api.t(r,'order_open'))::date, (api.t(r,'order_close'))::date, (nullif(r->>'decision_id',''))::uuid, api.t(r,'notes'), a)
      returning id into v_id;
    else
      v_id := (r->>'id')::uuid;
      update activities.dev_offers set title = api.t(r,'title'), supplier = api.t(r,'supplier'), contact = api.t(r,'contact'),
        order_open = (api.t(r,'order_open'))::date, order_close = (api.t(r,'order_close'))::date,
        decision_id = (nullif(r->>'decision_id',''))::uuid, notes = api.t(r,'notes')
      where id = v_id;
    end if;
    if r ? 'items' then
      for x in select * from jsonb_array_elements(r->'items') loop
        insert into activities.dev_items(offer_id, name, offer_price, market_price, max_months, stock, notes, active)
        values (v_id, x->>'name', (x->>'offer_price')::numeric, (nullif(x->>'market_price',''))::numeric,
          coalesce((nullif(x->>'max_months',''))::int, 10), (nullif(x->>'stock',''))::int, nullif(x->>'notes',''), coalesce((x->>'active')::boolean, true))
        on conflict (offer_id, name) do update set offer_price = excluded.offer_price, market_price = excluded.market_price,
          max_months = excluded.max_months, stock = excluded.stock, notes = excluded.notes, active = excluded.active;
      end loop;
    end if;
    return api.ok(jsonb_build_object('id', v_id));
  elsif p_action = 'DEV_SET_STATUS' then
    update activities.dev_offers set status = api.t(p,'status') where id = (p->>'offerId')::uuid;
    return api.ok();
  elsif p_action = 'DEV_ORDERS' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(api.dev_order_json(o.id) order by
        case o.status when 'مطلوب' then 1 when 'مؤكد' then 2 when 'مسلّم' then 3 else 4 end, o.created_at)
      from activities.dev_orders o where (nullif(p->>'offerId','') is null or o.offer_id = (p->>'offerId')::uuid)
        and (api.t(p,'status') is null or o.status = api.t(p,'status'))), '[]')));
  elsif p_action = 'DEV_DECIDE' then
    perform activities.dev_decide(p, a); return api.ok(jsonb_build_object('order', api.dev_order_json((p->>'orderId')::uuid)));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

revoke all on all functions in schema api, activities, grants, core from public, anon, authenticated;
