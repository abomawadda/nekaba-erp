-- المرحلة 5 — واجهة الأنشطة ACT_*
-- كل نشاط له مركز تكلفة بنفس رمزه (لتسوية الشيك ونتيجة النشاط)
create or replace function activities.ensure_cost_center() returns trigger language plpgsql as $$
begin
  insert into finance.cost_centers(code, name, kind, decision_id) values (new.code, new.title, 'نشاط', new.decision_id)
  on conflict (code) do update set name = excluded.name, decision_id = excluded.decision_id;
  return new;
end $$;
create trigger activity_cost_center after insert or update of title, decision_id on activities.activities
  for each row execute function activities.ensure_cost_center();

create or replace function api.booking_json(p_booking uuid) returns jsonb language sql stable as $$
  select to_jsonb(b) - 'terms' || jsonb_build_object(
    'person', (select jsonb_build_object('full_name', full_name, 'job_id', job_id, 'phone', phone) from core.persons where id = b.person_id),
    'people', coalesce((select jsonb_agg(to_jsonb(bp) - 'booking_id' order by bp.seq) from activities.booking_people bp where bp.booking_id = b.id), '[]'),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'date', pay_date, 'receipt_no', receipt_no) order by created_at)
                 from activities.payments where booking_id = b.id), '[]'),
    'refundPctNow', activities.refund_pct(b.terms, (select start_date from activities.activities where id = b.activity_id)),
    'waitlistNo', case when b.status = 'قائمة انتظار' then (select count(*) from activities.bookings w where w.activity_id = b.activity_id
                   and w.status = 'قائمة انتظار' and w.waitlist_at <= b.waitlist_at) end,
    'cancelPolicy', b.terms->'cancel_policy')
  from activities.bookings b where b.id = p_booking
$$;

create or replace function api.activity_json(p_act uuid, p_person uuid) returns jsonb language sql stable as $$
  select to_jsonb(a) || jsonb_build_object(
    'prices', coalesce((select jsonb_agg(to_jsonb(pc) - 'activity_id' order by pc.sort) from activities.price_categories pc where pc.activity_id = a.id), '[]'),
    'seatsLeft', greatest(a.capacity - activities.seats_used(a.id), 0),
    'decision', (select jsonb_build_object('decision_no', d.decision_no, 'text', d.text) from governance.decisions d where d.id = a.decision_id),
    'supervisors', coalesce((select jsonb_agg(jsonb_build_object('person_id', s.person_id, 'full_name', pe.full_name, 'task', s.task,
        'self_exempt_pct', s.self_exempt_pct, 'family_exempt_pct', s.family_exempt_pct)) from activities.supervisors s join core.persons pe on pe.id = s.person_id
        where s.activity_id = a.id), '[]'),
    'eligible', case when p_person is not null then core.is_union_beneficiary(p_person, a.start_date) end,
    'myBooking', (select api.booking_json(b.id) from activities.bookings b where b.activity_id = a.id and b.person_id = p_person and b.status <> 'ملغى'))
  from activities.activities a where a.id = p_act
$$;

create or replace function api.handle_activities(p_action text, p jsonb, uid uuid, pid uuid) returns jsonb language plpgsql as $$
declare v_id uuid; r jsonb; v_act uuid := (nullif(p->>'activityId',''))::uuid; v_ref numeric; v_person uuid; a text := uid::text; x record;
begin
  if v_act is not null then perform activities.housekeep(v_act); end if;
  -- ── للأعضاء ──
  if p_action = 'ACT_LIST' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('id', ac.id, 'code', ac.code, 'kind', ac.kind,
        'title', ac.title, 'location', ac.location, 'start_date', ac.start_date, 'status', ac.status,
        'seatsLeft', greatest(ac.capacity - activities.seats_used(ac.id), 0), 'capacity', ac.capacity,
        'memberPrice', (select min(member_price) from activities.price_categories where activity_id = ac.id and applies_to = 'العضو'),
        'myStatus', (select status from activities.bookings where activity_id = ac.id and person_id = pid and status <> 'ملغى'))
        order by ac.start_date desc)
      from activities.activities ac
      where ac.status in ('الحجز مفتوح','الحجز مقفول','انتهى') or (core.can(uid,'activities.manage') and ac.status <> 'ملغى')
         or (api.t(p,'all') = 'true' and core.can(uid,'activities.manage'))), '[]')));
  elsif p_action = 'ACT_GET' then
    r := api.activity_json(v_act, pid);
    if r is null then return api.err('النشاط غير موجود.'); end if;
    if (r->>'status') = 'مسودة' and not core.can(uid,'activities.manage') then return api.err('النشاط غير متاح.'); end if;
    return api.ok(jsonb_build_object('activity', r));
  elsif p_action = 'ACT_BOOK' then
    v_person := pid;
    if nullif(p->>'personId','') is not null or nullif(p->>'jobId','') is not null then   -- حجز نيابة عن عضو
      if not core.can(uid,'activities.book.proxy') then return api.err('غير مسموح.'); end if;
      v_person := coalesce((nullif(p->>'personId',''))::uuid, api.pid_by_job(p->>'jobId'));
    elsif not core.can(uid,'activities.book.self') then return api.err('غير مسموح.'); end if;
    if v_person is null then return api.err('العضو غير موجود.'); end if;
    v_id := activities.book(v_person, p, a);
    return api.ok(jsonb_build_object('booking', api.booking_json(v_id)));
  elsif p_action = 'ACT_MY_BOOKINGS' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(api.booking_json(b.id) || jsonb_build_object('activity',
      jsonb_build_object('id', ac.id, 'title', ac.title, 'start_date', ac.start_date, 'status', ac.status, 'whatsapp_link', ac.whatsapp_link,
        'meeting_points', ac.meeting_points)) order by ac.start_date desc)
      from activities.bookings b join activities.activities ac on ac.id = b.activity_id where b.person_id = pid), '[]')));
  elsif p_action = 'ACT_CANCEL_MY' then
    select b.id into v_id from activities.bookings b where b.id = (p->>'bookingId')::uuid and b.person_id = pid;
    if v_id is null then return api.err('الحجز غير موجود.'); end if;
    v_ref := activities.cancel(v_id, api.t(p,'reason'), false, '1101', a);
    return api.ok(jsonb_build_object('refund', v_ref));
  end if;

  -- ── الإدارة ──
  if p_action = 'ACT_PAY' then
    if not core.can(uid,'treasury.receipt') then return api.err('غير مسموح.'); end if;
    v_id := activities.pay((p->>'bookingId')::uuid, (p->>'amount')::numeric, coalesce(api.t(p,'cash_account'),'1101'), a);
    return api.ok(jsonb_build_object('booking', api.booking_json((p->>'bookingId')::uuid),
      'receipt_no', (select receipt_no from activities.payments where id = v_id)));
  end if;
  if not core.can(uid,'activities.manage') then return api.err('غير مسموح.'); end if;
  if p_action = 'ACT_SAVE' then
    r := p->'activity';
    if api.t(r,'title') is null or api.t(r,'start_date') is null or (api.t(r,'capacity'))::int is null then
      return api.err('العنوان والتاريخ وعدد المقاعد مطلوبة.'); end if;
    if (r->>'id') is null then
      if (api.t(r,'start_date'))::date < current_date then return api.err('تاريخ النشاط في الماضي.'); end if;
      insert into activities.activities(code, kind, title, description, location, start_date, end_date, booking_open, booking_close, capacity,
        max_companions, hold_hours, cancel_policy, program, meeting_points, whatsapp_link, decision_id, notes, created_by)
      values (core.next_doc_no('ACTIVITY', 'ACT', extract(year from (api.t(r,'start_date'))::date)::int), coalesce(api.t(r,'kind'),'رحلة يوم واحد'),
        api.t(r,'title'), api.t(r,'description'), api.t(r,'location'), (api.t(r,'start_date'))::date, (api.t(r,'end_date'))::date,
        (api.t(r,'booking_open'))::timestamptz, (api.t(r,'booking_close'))::timestamptz, (api.t(r,'capacity'))::int,
        coalesce((api.t(r,'max_companions'))::int, 4), coalesce((api.t(r,'hold_hours'))::int, 48),
        coalesce(r->'cancel_policy', '[{"days_before":7,"refund_pct":100},{"days_before":3,"refund_pct":50},{"days_before":0,"refund_pct":0}]'),
        coalesce(r->'program','[]'), coalesce(r->'meeting_points','[]'), api.t(r,'whatsapp_link'), (nullif(r->>'decision_id',''))::uuid, api.t(r,'notes'), a)
      returning id into v_id;
    else
      v_id := (r->>'id')::uuid;
      if exists (select 1 from activities.bookings where activity_id = v_id and status <> 'ملغى')
         and (api.t(r,'capacity'))::int < activities.seats_used(v_id) then
        return api.err('السعة الجديدة أقل من المقاعد المحجوزة.'); end if;
      update activities.activities set kind = coalesce(api.t(r,'kind'), kind), title = api.t(r,'title'), description = api.t(r,'description'),
        location = api.t(r,'location'), start_date = (api.t(r,'start_date'))::date, end_date = (api.t(r,'end_date'))::date,
        booking_open = (api.t(r,'booking_open'))::timestamptz, booking_close = (api.t(r,'booking_close'))::timestamptz,
        capacity = (api.t(r,'capacity'))::int, max_companions = coalesce((api.t(r,'max_companions'))::int, max_companions),
        hold_hours = coalesce((api.t(r,'hold_hours'))::int, hold_hours), cancel_policy = coalesce(r->'cancel_policy', cancel_policy),
        program = coalesce(r->'program', program), meeting_points = coalesce(r->'meeting_points', meeting_points),
        whatsapp_link = api.t(r,'whatsapp_link'), decision_id = (nullif(r->>'decision_id',''))::uuid, notes = api.t(r,'notes')
      where id = v_id;   -- الحجوزات القائمة تحتفظ بشروطها المجمّدة
    end if;
    if r ? 'prices' then
      if exists (select 1 from activities.bookings where activity_id = v_id and status <> 'ملغى') then
        return api.err('لا تُغيَّر الأسعار بعد وجود حجوزات — الحجوزات القائمة بأسعارها.'); end if;
      delete from activities.price_categories where activity_id = v_id;
      insert into activities.price_categories(activity_id, code, label, applies_to, min_age, max_age, full_price, member_price, takes_seat, sort)
      select v_id, coalesce(nullif(c->>'code',''), 'C' || o), c->>'label', c->>'applies_to', (nullif(c->>'min_age',''))::int, (nullif(c->>'max_age',''))::int,
        (c->>'full_price')::numeric, coalesce((nullif(c->>'member_price',''))::numeric, (c->>'full_price')::numeric),
        coalesce((c->>'takes_seat')::boolean, true), o
      from jsonb_array_elements(r->'prices') with ordinality t(c, o);
    end if;
    return api.ok(jsonb_build_object('activity', api.activity_json(v_id, null)));
  elsif p_action = 'ACT_SET_STATUS' then
    if api.t(p,'status') = 'الحجز مفتوح' and not exists (select 1 from activities.price_categories where activity_id = v_act and applies_to = 'العضو') then
      return api.err('حدد سعر العضو قبل فتح الحجز.'); end if;
    if api.t(p,'status') = 'الحجز مفتوح' and (select decision_id from activities.activities where id = v_act) is null
       and coalesce((core.setting('FIN_REQUIRE_DECISION'))::text,'true') = 'true' then
      return api.err('اربط النشاط بقرار المجلس قبل فتح الحجز.'); end if;
    if api.t(p,'status') = 'ملغى' then
      update activities.activities set status = 'ملغى' where id = v_act;
      for x in select id from activities.bookings where activity_id = v_act and status in ('بانتظار السداد','مؤكد','قائمة انتظار') loop
        perform activities.cancel(x.id, 'إلغاء النشاط', true, coalesce(api.t(p,'cash_account'),'1101'), a);
      end loop;
    else
      update activities.activities set status = api.t(p,'status') where id = v_act;
    end if;
    return api.ok(jsonb_build_object('activity', api.activity_json(v_act, null)));
  elsif p_action = 'ACT_BOOKINGS' then
    return api.ok(jsonb_build_object('summary', activities.summary(v_act), 'items', coalesce((select jsonb_agg(api.booking_json(b.id)
      order by case b.status when 'مؤكد' then 1 when 'بانتظار السداد' then 2 when 'قائمة انتظار' then 3 when 'منتهٍ' then 4 else 5 end,
               b.priority_at nulls last, b.waitlist_at, b.created_at)
      from activities.bookings b where b.activity_id = v_act and (api.t(p,'status') is null or b.status = api.t(p,'status'))), '[]')));
  elsif p_action = 'ACT_CANCEL' then
    if api.t(p,'reason') is null then return api.err('سبب الإلغاء مطلوب.'); end if;
    v_ref := activities.cancel((p->>'bookingId')::uuid, api.t(p,'reason'), true, coalesce(api.t(p,'cash_account'),'1101'), a);
    return api.ok(jsonb_build_object('refund', v_ref));
  elsif p_action = 'ACT_ASSIGN_SEATS' then
    return api.ok(jsonb_build_object('seats', activities.assign_seats(v_act)));
  elsif p_action = 'ACT_ATTEND' then
    update activities.booking_people set attended = (p->>'attended')::boolean
    where booking_id = (p->>'bookingId')::uuid and (p->>'seq' is null or seq = (p->>'seq')::int);
    return api.ok();
  elsif p_action = 'ACT_SUPERVISOR' then
    v_person := coalesce((nullif(p->>'personId',''))::uuid, api.pid_by_job(p->>'jobId'));
    if v_person is null then return api.err('العضو غير موجود.'); end if;
    if (p->>'remove')::boolean then delete from activities.supervisors where activity_id = v_act and person_id = v_person;
    else
      insert into activities.supervisors(activity_id, person_id, task, self_exempt_pct, family_exempt_pct, decision_ref)
      values (v_act, v_person, coalesce(api.t(p,'task'),'مشرف'), coalesce((p->>'self_exempt_pct')::int,100), coalesce((p->>'family_exempt_pct')::int,0), api.t(p,'decision_ref'))
      on conflict (activity_id, person_id) do update set task = excluded.task, self_exempt_pct = excluded.self_exempt_pct,
        family_exempt_pct = excluded.family_exempt_pct, decision_ref = excluded.decision_ref;
    end if;
    return api.ok(jsonb_build_object('activity', api.activity_json(v_act, null)));
  elsif p_action = 'ACT_CLOSE' then
    return api.ok(jsonb_build_object('result', activities.close_activity(v_act, a), 'summary', activities.summary(v_act)));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- الموجّه (كل الفروع)
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  if p_action like 'IMPORT\_%' or p_action like 'GOV\_%' or p_action like 'FIN\_%' or p_action like 'BEN\_%' or p_action like 'ACT\_%' then
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
-- مسئول الرحلات يرى المالية الخاصة بأنشطته عبر ملخص النشاط؛ التحصيل لأمين الصندوق (treasury.receipt)
insert into core.role_permissions(role, permission) values ('SYS_ADMIN','activities.manage') on conflict do nothing;
revoke all on all functions in schema api, activities from public, anon, authenticated;
-- مسئول الرحلات يقرأ قرارات المجلس ليربط النشاط بقراره (قراءة فقط — بلا إدارة)
insert into core.role_permissions(role, permission) values ('TRIPS_OFFICER','governance.view') on conflict do nothing;
