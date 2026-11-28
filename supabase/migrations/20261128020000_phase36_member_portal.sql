-- Phase 36: Member Portal Overhaul (Tickets/Complaints, Self-Service Activation Requests & API Routing)

create table if not exists core.member_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text unique not null,
  person_id uuid not null references core.persons(id) on delete cascade,
  category text not null default 'استفسار',
  subject text not null,
  body text not null,
  status text not null default 'مفتوح' check (status in ('مفتوح','تم الرد','مغلق')),
  reply text,
  replied_by text,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_member_tickets_person on core.member_tickets(person_id, created_at desc);

create table if not exists core.activation_requests (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  person_id uuid references core.persons(id) on delete set null,
  full_name text not null,
  national_id text not null,
  phone text not null,
  status text not null default 'معلّق' check (status in ('معلّق','معتمد','مرفوض')),
  reviewed_by text,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists idx_activation_requests_status on core.activation_requests(status, created_at desc);

create or replace function api.handle_phase36(p_action text, p jsonb, uid uuid, pid uuid)
returns jsonb
language plpgsql
set search_path to 'core', 'public', 'extensions', 'pg_temp'
as $$
declare
  v_job text;
  v_nat text;
  v_ph text;
  v_per core.persons;
  v_tkt core.member_tickets;
  v_actv core.activation_requests;
  v_no text;
  v_id uuid;
  v_approve boolean;
  v_can_staff boolean;
begin
  -- Public unauthenticated activation request for members missing national_id
  if p_action = 'ACTV_REQUEST' then
    v_job := trim(coalesce(p->>'job_id', ''));
    v_nat := regexp_replace(coalesce(p->>'national_id', ''), '\D', '', 'g');
    v_ph := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
    if v_job = '' then return api.err('الرقم الوظيفي مطلوب.'); end if;
    if length(v_nat) <> 14 then return api.err('الرقم القومي يجب أن يكون 14 رقماً صحيحاً.'); end if;
    if length(v_ph) < 10 then return api.err('رقم الموبايل غير صحيح.'); end if;
    select * into v_per from core.persons where job_id = v_job limit 1;
    if v_per.id is null then return api.err('الرقم الوظيفي غير مسجّل بقاعدة بيانات اللجنة.'); end if;
    if coalesce(v_per.national_id, '') <> '' then
      return api.err('حسابك مفعّل بالفعل — يمكنك الدخول مباشرة بالرقم الوظيفي والرقم القومي.');
    end if;
    if exists (select 1 from core.activation_requests where job_id = v_job and status = 'معلّق') then
      return api.err('لديك طلب تفعيل قيد المراجعة بالفعل — سيتم التفعيل قريباً.');
    end if;
    insert into core.activation_requests(job_id, person_id, full_name, national_id, phone)
    values (v_job, v_per.id, v_per.full_name, v_nat, v_ph)
    returning id into v_id;
    return api.ok(jsonb_build_object('id', v_id, 'full_name', v_per.full_name));

  elsif p_action = 'ACTV_LIST' then
    if not (core.can(uid, 'profile.edit') or core.can(uid, 'profile.change.approve')) then
      return api.err('غير مسموح.');
    end if;
    return api.ok(jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(to_jsonb(ar) order by case ar.status when 'معلّق' then 1 else 2 end, ar.created_at desc)
        from core.activation_requests ar
        where api.t(p, 'status') is null or ar.status = api.t(p, 'status')
      ), '[]'::jsonb),
      'pendingCount', (select count(*) from core.activation_requests where status = 'معلّق')
    ));

  elsif p_action = 'ACTV_DECIDE' then
    if not (core.can(uid, 'profile.edit') or core.can(uid, 'profile.change.approve')) then
      return api.err('غير مسموح.');
    end if;
    select * into v_actv from core.activation_requests where id = (p->>'id')::uuid and status = 'معلّق' for update;
    if v_actv.id is null then return api.err('الطلب غير موجود أو تم حسمه.'); end if;
    v_approve := coalesce((p->>'approve')::boolean, false);
    if v_approve then
      update core.persons
      set national_id = v_actv.national_id,
          phone = case when coalesce(phone, '') = '' then v_actv.phone else phone end
      where id = v_actv.person_id;
    elsif api.t(p, 'notes') is null then
      return api.err('سبب الرفض مطلوب.');
    end if;
    update core.activation_requests
    set status = case when v_approve then 'معتمد' else 'مرفوض' end,
        reviewed_by = uid::text,
        reviewed_at = now(),
        notes = api.t(p, 'notes')
    where id = v_actv.id;
    return api.ok();

  elsif p_action = 'TKT_CREATE' then
    if pid is null then return api.err('هذه الخدمة متاحة للأعضاء المسجّلين.'); end if;
    if api.t(p, 'subject') is null or api.t(p, 'body') is null then
      return api.err('العنوان وتفاصيل الرسالة مطلوبان.');
    end if;
    v_no := core.next_doc_no('TKT', 'تذكرة', extract(year from current_date)::int);
    insert into core.member_tickets(ticket_no, person_id, category, subject, body)
    values (v_no, pid, coalesce(api.t(p, 'category'), 'استفسار'), api.t(p, 'subject'), api.t(p, 'body'))
    returning id into v_id;
    return api.ok(jsonb_build_object('id', v_id, 'ticket_no', v_no));

  elsif p_action = 'TKT_LIST' then
    v_can_staff := core.can(uid, 'profile.view') or core.can(uid, 'profile.change.approve');
    if v_can_staff and coalesce((p->>'mine')::boolean, false) = false then
      return api.ok(jsonb_build_object(
        'staff', true,
        'openCount', (select count(*) from core.member_tickets where status = 'مفتوح'),
        'items', coalesce((
          select jsonb_agg(to_jsonb(t) || jsonb_build_object('full_name', pe.full_name, 'job_id', pe.job_id, 'workplace', pe.workplace)
            order by case t.status when 'مفتوح' then 1 when 'تم الرد' then 2 else 3 end, t.created_at desc)
          from core.member_tickets t
          join core.person_current pe on pe.id = t.person_id
          where api.t(p, 'status') is null or t.status = api.t(p, 'status')
        ), '[]'::jsonb)
      ));
    else
      if pid is null then return api.ok(jsonb_build_object('staff', false, 'items', '[]'::jsonb)); end if;
      return api.ok(jsonb_build_object(
        'staff', false,
        'items', coalesce((
          select jsonb_agg(to_jsonb(t) order by t.created_at desc)
          from core.member_tickets t
          where t.person_id = pid
        ), '[]'::jsonb)
      ));
    end if;

  elsif p_action = 'TKT_REPLY' then
    if not (core.can(uid, 'profile.view') or core.can(uid, 'profile.change.approve')) then
      return api.err('غير مسموح.');
    end if;
    select * into v_tkt from core.member_tickets where id = (p->>'id')::uuid for update;
    if v_tkt.id is null then return api.err('التذكرة غير موجودة.'); end if;
    if api.t(p, 'reply') is null then return api.err('نص الرد مطلوب.'); end if;
    update core.member_tickets
    set reply = api.t(p, 'reply'),
        status = coalesce(api.t(p, 'status'), 'تم الرد'),
        replied_by = api.actor_label(uid::text),
        replied_at = now()
    where id = v_tkt.id;
    insert into core.notifications(person_id, kind, title, body, link)
    values (v_tkt.person_id, 'تذكرة', 'تم الرد على رسالتك رقم ' || v_tkt.ticket_no,
            left(api.t(p, 'reply'), 140), '#/tickets');
    return api.ok();
  end if;

  return api.err('عملية غير معروفة: ' || p_action);
exception
  when check_violation then return api.err(coalesce(nullif(sqlerrm,''), 'قيمة غير صحيحة.'));
  when unique_violation then return api.err('الرقم القومي مسجّل بالفعل لعضو آخر.');
end $$;

-- Update api.handle to route Phase 35 & Phase 36 actions seamlessly
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'core', 'public'
as $$
declare uid uuid;
begin
  if p_action = 'VERIFY_CARD' then return api.verify_card(p); end if;
  if p_action = 'ACTV_REQUEST' then return api.handle_phase36(p_action, p, null, null); end if;
  if p_action like 'IMPORT\_%' or p_action like 'GOV\_%' or p_action like 'FIN\_%' or p_action like 'BEN\_%' or p_action like 'ACT\_%'
     or p_action like 'SUM\_%' or p_action like 'GRT\_%' or p_action like 'DEV\_%' or p_action like 'REP\_%' or p_action like 'NTF\_%'
     or p_action like 'NEWS\_%' or p_action like 'SYS\_%' or p_action like 'BANK\_%' or p_action like 'DOC\_%' or p_action like 'POL\_%'
     or p_action like 'DUES\_%' or p_action like 'TKT\_%' or p_action like 'ACTV\_%' then
    uid := api.session_user(s);
    if uid is null then return api.err('انتهت الجلسة. سجّل الدخول مرة أخرى.') || '{"expired":true}'; end if;
    perform set_config('erp.reason', coalesce(p->>'reason', ''), true);
    if p_action in ('IMPORT_GOVERNANCE','IMPORT_FINANCE','IMPORT_BENEFITS') then
      if not core.can(uid,'data.import') then return api.err('غير مسموح.'); end if;
      if p_action = 'IMPORT_GOVERNANCE' then return api.import_governance(p); end if;
      if p_action = 'IMPORT_BENEFITS' then return api.import_benefits(p); end if;
      return api.import_finance(p, uid);
    elsif p_action in ('FIN_PERIODS_LIST','FIN_PERIOD_TOGGLE','FIN_YEAR_CLOSE','FIN_CUSTODIAN_ALERT','FIN_SETTLE_ACTIVITIES') then
      return api.handle_phase35(p_action, p, uid);
    elsif p_action like 'TKT\_%' or p_action like 'ACTV\_%' then
      return api.handle_phase36(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'IMPORT\_%' then return api.handle_import(p_action, p, uid);
    elsif p_action like 'GOV\_%' then return api.handle_governance(p_action, p, uid);
    elsif p_action like 'BEN\_%' then return api.handle_benefits(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'ACT\_%' then return api.handle_activities(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'SUM\_%' then return api.handle_summer(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'GRT\_%' then return api.handle_grants(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'DEV\_%' then return api.handle_devices(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'REP\_%' then return api.handle_reports(p_action, p, uid);
    elsif p_action like 'NTF\_%' then return api.handle_notifications(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'NEWS\_%' then return api.handle_news(p_action, p, uid);
    elsif p_action like 'SYS\_%' then return api.handle_system(p_action, p, uid);
    elsif p_action like 'BANK\_%' then return api.handle_bank(p_action, p, uid);
    elsif p_action like 'DOC\_%' then return api.handle_docs(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'POL\_%' or p_action like 'DUES\_%' then return api.handle_finpol(p_action, p, uid);
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
