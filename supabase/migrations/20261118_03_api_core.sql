-- المرحلة 1 — واجهة الخادم للنواة: كل العمليات دالة واحدة api.handle(action, payload, session)
-- تُستدعى فقط من دالة الحافة erp-api (service role). schema api غير معروض.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists api;
revoke all on schema api from public, anon, authenticated;

-- أسرار الخادم (مفتاح توقيع الجلسات) + حد المحاولات
create table if not exists core.secrets (key text primary key, value text not null);
insert into core.secrets values ('session_secret', encode(extensions.gen_random_bytes(32), 'hex')) on conflict do nothing;
create table if not exists core.auth_fails (k text primary key, fails int not null default 0,
  locked_until timestamptz, updated_at timestamptz not null default now());
alter table core.secrets enable row level security;
alter table core.auth_fails enable row level security;
revoke all on core.secrets, core.auth_fails from anon, authenticated;

-- ───────── أدوات ─────────
create or replace function api.ok(p jsonb default '{}'::jsonb) returns jsonb language sql immutable
as $$ select jsonb_build_object('success', true) || p $$;
create or replace function api.err(m text) returns jsonb language sql immutable
as $$ select jsonb_build_object('success', false, 'message', m) $$;
create or replace function api.t(p jsonb, k text) returns text language sql immutable
as $$ select nullif(trim(p->>k), '') $$;

-- حقول يعدّلها الموظف بنفسه / حقول إدارية (بطلب تعديل) / أبعاد الحركات
create or replace function api.self_fields() returns text[] language sql immutable as $$
  select array['phone','phone2','email','address','qualification','specialization','marital_status',
               'blood_type','special_needs','emergency'] $$;
create or replace function api.admin_fields() returns text[] language sql immutable as $$
  select array['full_name','national_id','insurance_no','hire_date','retirement_date','monthly_dues','person_type',
               'job_id'] $$;
create or replace function api.movement_fields() returns text[] language sql immutable as $$
  select array['job_title','grade','workplace','union_org','member_state'] $$;

-- تحديث حقل واحد في core.persons بأمان (اسم العمود من قائمة مغلقة فقط)
create or replace function api.set_person_field(p_id uuid, p_field text, p_value text) returns void
language plpgsql as $$
begin
  if not (p_field = any(api.self_fields() || api.admin_fields())) then
    raise exception 'حقل غير مسموح: %', p_field;
  end if;
  if p_field = 'emergency' then
    execute 'update core.persons set emergency = $1::jsonb where id = $2' using p_value, p_id;
  elsif p_field in ('hire_date','retirement_date') then
    execute format('update core.persons set %I = $1::date where id = $2', p_field) using p_value, p_id;
  elsif p_field = 'monthly_dues' then
    execute 'update core.persons set monthly_dues = $1::numeric where id = $2' using p_value, p_id;
  else
    execute format('update core.persons set %I = $1 where id = $2', p_field) using p_value, p_id;
  end if;
end $$;

-- نسبة اكتمال الملف + ما ينقصه
create or replace function api.completeness(p_id uuid) returns jsonb language plpgsql stable as $$
declare p core.persons; missing text[] := '{}'; total int := 9;
begin
  select * into p from core.persons where id = p_id;
  if p.national_id is null then missing := array_append(missing, 'الرقم القومي'); end if;
  if p.phone is null then missing := array_append(missing, 'الموبايل'); end if;
  if p.address is null then missing := array_append(missing, 'العنوان'); end if;
  if p.qualification is null then missing := array_append(missing, 'المؤهل'); end if;
  if p.marital_status is null then missing := array_append(missing, 'الحالة الاجتماعية'); end if;
  if p.emergency is null then missing := array_append(missing, 'رقم للطوارئ'); end if;
  if p.email is null then missing := array_append(missing, 'البريد الإلكتروني'); end if;
  if p.marital_status in ('متزوج','مطلق','أرمل') and not exists
     (select 1 from core.family_members where person_id = p_id and active) then
    missing := array_append(missing, 'بيانات الأسرة'); end if;
  if exists (select 1 from core.family_members where person_id = p_id and active
             and relation in ('ابن','ابنة') and birth_date is null) then
    missing := array_append(missing, 'تاريخ ميلاد الأبناء'); end if;
  return jsonb_build_object('percent', round(100.0 * (total - cardinality(missing)) / total), 'missing', to_jsonb(missing));
end $$;

-- الملف الكامل لشخص
create or replace function api.profile(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'person', to_jsonb(pc) - 'legacy_ref',
    'family', coalesce((select jsonb_agg(to_jsonb(f) - 'books_key' order by f.relation, f.birth_date)
                        from core.family_members f where f.person_id = p_id and f.active), '[]'),
    'movements', coalesce((select jsonb_agg(to_jsonb(m) order by m.effective_date desc, m.created_at desc)
                           from core.person_movements m where m.person_id = p_id), '[]'),
    'periods', coalesce((select jsonb_agg(to_jsonb(x) order by x.field, x.from_date)
                         from core.person_periods x where x.person_id = p_id), '[]'),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc)
                          from core.change_requests r where r.person_id = p_id), '[]'),
    'eligibleToday', core.is_union_beneficiary(p_id),
    'completeness', api.completeness(p_id))
  from core.person_current pc where pc.id = p_id
$$;

create or replace function api.perms(p_user uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(role) from core.user_roles where user_id = p_user), '[]'),
    'perms', coalesce((select jsonb_object_agg(rp.permission, rp.max_amount)
                       from core.user_roles ur join core.role_permissions rp on rp.role = ur.role
                       where ur.user_id = p_user), '{}'))
$$;

-- دور العضو تلقائياً حسب التنظيم النقابي
create or replace function api.sync_member_role(p_user uuid, p_person uuid) returns void language plpgsql as $$
declare want text := case when core.state_at(p_person,'union_org') = 'النقابة العامة' then 'MEMBER' else 'NON_MEMBER' end;
begin
  delete from core.user_roles where user_id = p_user and role in ('MEMBER','NON_MEMBER') and role <> want;
  insert into core.user_roles(user_id, role, granted_by) values (p_user, want, 'SYSTEM') on conflict do nothing;
end $$;

-- ───────── الدخول ─────────
create or replace function api.login_member(p jsonb) returns jsonb language plpgsql as $$
declare v_job text := api.t(p,'jobId'); v_sec text := regexp_replace(coalesce(p->>'secret',''), '\D', '', 'g');
        per core.persons; u core.users;
begin
  if v_job is null or length(v_sec) < 4 then return api.err('اكتب الرقم الوظيفي وآخر 4 أرقام من القومي أو الموبايل المسجّل.'); end if;
  select * into per from core.persons where job_id = v_job;
  if per.id is null
     or not ((per.national_id is not null and length(v_sec) = 4 and right(per.national_id, 4) = v_sec)
          or (per.phone is not null and length(v_sec) = 11 and per.phone = v_sec)) then
    return api.err('البيانات غير مطابقة. تأكد من الرقم الوظيفي وآخر 4 أرقام من القومي أو الموبايل.');
  end if;
  if core.state_at(per.id,'member_state') in ('وفاة') then return api.err('هذا الحساب غير متاح.'); end if;
  insert into core.users(person_id, must_change) values (per.id, false)
    on conflict (person_id) where person_id is not null do update set last_login = now()
    returning * into u;
  if not u.active then return api.err('الحساب موقوف. كلّم المسؤول.'); end if;
  perform api.sync_member_role(u.id, per.id);
  update core.users set last_login = now() where id = u.id;
  return api.ok(jsonb_build_object('session', jsonb_build_object('uid', u.id, 'pid', per.id, 'kind', 'member'),
                                   'name', per.full_name) || api.perms(u.id));
end $$;

create or replace function api.login_admin(p jsonb) returns jsonb language plpgsql as $$
declare u core.users;
begin
  select * into u from core.users where lower(username) = lower(api.t(p,'username'));
  if u.id is null or u.password_hash is null
     or u.password_hash <> extensions.crypt(coalesce(p->>'password',''), u.password_hash) then
    return api.err('اسم المستخدم أو كلمة المرور غير صحيحة.');
  end if;
  if not u.active then return api.err('الحساب موقوف.'); end if;
  update core.users set last_login = now() where id = u.id;
  return api.ok(jsonb_build_object('session', jsonb_build_object('uid', u.id, 'pid', u.person_id, 'kind', 'staff'),
                                   'mustChange', u.must_change, 'name', u.username) || api.perms(u.id));
end $$;

-- ───────── المُوزّع ─────────
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid := (s->>'uid')::uuid; pid uuid := (s->>'pid')::uuid;
        u core.users; v_id uuid; r record; v jsonb; k text; n int;
begin
  -- بلا جلسة
  if p_action = 'LOGIN_MEMBER' then return api.login_member(p); end if;
  if p_action = 'LOGIN_ADMIN'  then return api.login_admin(p); end if;

  select * into u from core.users where id = uid;
  if u.id is null or not u.active then return api.err('انتهت الجلسة. سجّل الدخول مرة أخرى.') || '{"expired":true}'; end if;
  perform set_config('erp.actor', uid::text, true);
  perform set_config('erp.reason', coalesce(p->>'reason',''), true);

  -- ── للجميع ──
  if p_action = 'GET_ME' then
    return api.ok(jsonb_build_object('profile', case when pid is not null then api.profile(pid) end,
                                     'username', u.username, 'mustChange', u.must_change) || api.perms(uid));

  elsif p_action = 'GET_LISTS' then
    return api.ok(jsonb_build_object('lists', (select jsonb_object_agg(list_key, vals) from
      (select list_key, jsonb_agg(jsonb_build_object('value', value, 'parent', parent) order by sort, value) vals
       from core.ref_lists where active group by list_key) x)));

  elsif p_action = 'CHANGE_PASSWORD' then
    if u.username is null then return api.err('غير متاح لهذا الحساب.'); end if;
    if length(coalesce(p->>'newPassword','')) < 8 then return api.err('كلمة المرور 8 أحرف على الأقل.'); end if;
    if u.password_hash <> extensions.crypt(coalesce(p->>'oldPassword',''), u.password_hash) then
      return api.err('كلمة المرور الحالية غير صحيحة.'); end if;
    update core.users set password_hash = extensions.crypt(p->>'newPassword', extensions.gen_salt('bf', 10)),
                          must_change = false where id = uid;
    return api.ok();

  -- ── ملفي ──
  elsif p_action = 'UPDATE_MY_PROFILE' then
    if pid is null or not core.can(uid,'profile.self.edit') then return api.err('غير مسموح.'); end if;
    for k in select jsonb_object_keys(coalesce(p->'fields','{}')) loop
      if not (k = any(api.self_fields())) then return api.err('الحقل «' || k || '» يتعدّل بطلب للمسؤول.'); end if;
      perform api.set_person_field(pid, k, case when k = 'emergency' then (p->'fields'->k)::text
                                                 else nullif(trim(p->'fields'->>k),'') end);
    end loop;
    return api.ok(jsonb_build_object('profile', api.profile(pid)));

  elsif p_action = 'SAVE_MY_FAMILY_MEMBER' or p_action = 'SAVE_FAMILY_MEMBER' then
    if p_action = 'SAVE_FAMILY_MEMBER' then
      if not core.can(uid,'profile.edit') then return api.err('غير مسموح.'); end if;
      pid := (p->>'personId')::uuid;
    elsif pid is null or not core.can(uid,'profile.self.edit') then return api.err('غير مسموح.'); end if;
    v := p->'member';
    if api.t(v,'full_name') is null or api.t(v,'relation') is null then return api.err('اكتب الاسم وصلة القرابة.'); end if;
    if (v->>'id') is not null then
      update core.family_members set full_name = api.t(v,'full_name'), relation = api.t(v,'relation'),
        relation_note = api.t(v,'relation_note'), gender = api.t(v,'gender'), birth_date = (api.t(v,'birth_date'))::date,
        national_id = api.t(v,'national_id'), edu_stage = api.t(v,'edu_stage'), edu_grade = api.t(v,'edu_grade'),
        school_type = api.t(v,'school_type'), edu_track = api.t(v,'edu_track'),
        special_needs = coalesce((v->>'special_needs')::boolean, false), notes = api.t(v,'notes')
      where id = (v->>'id')::uuid and person_id = pid and active returning id into v_id;
      if v_id is null then return api.err('الفرد غير موجود.'); end if;
    else
      insert into core.family_members(person_id, full_name, relation, relation_note, gender, birth_date, national_id,
        edu_stage, edu_grade, school_type, edu_track, special_needs, notes)
      values (pid, api.t(v,'full_name'), api.t(v,'relation'), api.t(v,'relation_note'), api.t(v,'gender'),
        (api.t(v,'birth_date'))::date, api.t(v,'national_id'), api.t(v,'edu_stage'), api.t(v,'edu_grade'),
        api.t(v,'school_type'), api.t(v,'edu_track'), coalesce((v->>'special_needs')::boolean, false), api.t(v,'notes'))
      returning id into v_id;
    end if;
    return api.ok(jsonb_build_object('id', v_id, 'profile', api.profile(pid)));

  elsif p_action = 'REMOVE_MY_FAMILY_MEMBER' then
    if pid is null or not core.can(uid,'profile.self.edit') then return api.err('غير مسموح.'); end if;
    update core.family_members set active = false where id = (p->>'id')::uuid and person_id = pid and active;
    if not found then return api.err('الفرد غير موجود.'); end if;
    return api.ok(jsonb_build_object('profile', api.profile(pid)));

  elsif p_action = 'REQUEST_CHANGE' then
    if pid is null then return api.err('غير مسموح.'); end if;
    k := api.t(p,'field');
    if not (k = any(api.admin_fields() || api.movement_fields())) then return api.err('حقل غير معروف.'); end if;
    if api.t(p,'newValue') is null then return api.err('اكتب القيمة الجديدة.'); end if;
    if exists (select 1 from core.change_requests where person_id = pid and field = k and status = 'معلّق') then
      return api.err('فيه طلب معلّق لنفس البيان.'); end if;
    insert into core.change_requests(person_id, field, old_value, new_value, reason)
    values (pid, k, case when k = any(api.movement_fields()) then core.state_at(pid,k)
                         else (select to_jsonb(x)->>k from core.persons x where x.id = pid) end,
            api.t(p,'newValue'), api.t(p,'reason'));
    return api.ok();

  -- ── الإدارة ──
  elsif p_action = 'SEARCH_PERSONS' then
    if not core.can(uid,'profile.view') then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(x) from (
      select id, job_id, full_name, phone, union_org, member_state, workplace, job_title
      from core.person_current
      where api.t(p,'q') is null or job_id = api.t(p,'q') or full_name ilike '%' || api.t(p,'q') || '%'
            or phone = api.t(p,'q') or national_id = api.t(p,'q')
      order by full_name limit least(coalesce((p->>'limit')::int, 50), 200)) x), '[]')));

  elsif p_action = 'GET_PERSON' then
    if not core.can(uid,'profile.view') then return api.err('غير مسموح.'); end if;
    v := api.profile((p->>'id')::uuid);
    if v is null then return api.err('غير موجود.'); end if;
    return api.ok(jsonb_build_object('profile', v));

  elsif p_action = 'SAVE_PERSON' then
    if not core.can(uid,'profile.edit') then return api.err('غير مسموح.'); end if;
    v_id := (p->>'id')::uuid;
    if v_id is null then
      if api.t(p->'fields','full_name') is null then return api.err('الاسم مطلوب.'); end if;
      insert into core.persons(full_name) values (api.t(p->'fields','full_name')) returning id into v_id;
    end if;
    for k in select jsonb_object_keys(coalesce(p->'fields','{}')) loop
      if k = any(api.movement_fields()) then return api.err('«' || k || '» يتغير بتسجيل حركة.'); end if;
      perform api.set_person_field(v_id, k, case when k = 'emergency' then (p->'fields'->k)::text
                                                  else nullif(trim(p->'fields'->>k),'') end);
    end loop;
    return api.ok(jsonb_build_object('profile', api.profile(v_id)));

  elsif p_action = 'ADD_MOVEMENT' then
    if not core.can(uid,'profile.movement') then return api.err('غير مسموح.'); end if;
    v_id := (p->>'personId')::uuid; k := api.t(p,'field');
    if api.t(p,'toValue') is null or api.t(p,'effectiveDate') is null then return api.err('القيمة الجديدة وتاريخ السريان مطلوبان.'); end if;
    if (api.t(p,'effectiveDate'))::date > current_date + 365 then return api.err('تاريخ السريان بعيد جداً.'); end if;
    insert into core.person_movements(person_id, kind, field, from_value, to_value, effective_date, expected_return,
      decision_ref, decision_date, notes, created_by)
    values (v_id, coalesce(api.t(p,'kind'),'أخرى'), k, core.state_at(v_id, k, (api.t(p,'effectiveDate'))::date),
      api.t(p,'toValue'), (api.t(p,'effectiveDate'))::date, (api.t(p,'expectedReturn'))::date,
      api.t(p,'decisionRef'), (api.t(p,'decisionDate'))::date, api.t(p,'notes'), uid::text);
    for r in select id from core.users where person_id = v_id loop perform api.sync_member_role(r.id, v_id); end loop;
    return api.ok(jsonb_build_object('profile', api.profile(v_id)));

  elsif p_action = 'LIST_CHANGE_REQUESTS' then
    if not core.can(uid,'profile.change.approve') then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(to_jsonb(cr) || jsonb_build_object(
      'job_id', pe.job_id, 'full_name', pe.full_name) order by cr.created_at)
      from core.change_requests cr join core.persons pe on pe.id = cr.person_id
      where cr.status = coalesce(api.t(p,'status'),'معلّق')), '[]')));

  elsif p_action = 'DECIDE_CHANGE_REQUEST' then
    if not core.can(uid,'profile.change.approve') then return api.err('غير مسموح.'); end if;
    select * into r from core.change_requests where id = (p->>'id')::uuid and status = 'معلّق' for update;
    if r.id is null then return api.err('الطلب غير موجود أو اتحسم.'); end if;
    if (p->>'approve')::boolean then
      if r.field = any(api.movement_fields()) then
        insert into core.person_movements(person_id, kind, field, from_value, to_value, effective_date, notes, created_by)
        values (r.person_id, 'طلب تعديل معتمد', r.field, r.old_value, r.new_value,
                coalesce((api.t(p,'effectiveDate'))::date, current_date), r.reason, uid::text);
        for v_id in select id from core.users where person_id = r.person_id loop perform api.sync_member_role(v_id, r.person_id); end loop;
      else
        perform api.set_person_field(r.person_id, r.field, r.new_value);
      end if;
    elsif api.t(p,'note') is null then return api.err('سبب الرفض مطلوب.');
    end if;
    update core.change_requests set status = case when (p->>'approve')::boolean then 'معتمد' else 'مرفوض' end,
      decided_by = uid::text, decided_at = now(), decision_note = api.t(p,'note') where id = r.id;
    return api.ok();

  elsif p_action = 'SAVE_LIST_ITEM' then
    if not core.can(uid,'lists.manage') then return api.err('غير مسموح.'); end if;
    insert into core.ref_lists(list_key, value, parent, sort, active)
    values (api.t(p,'listKey'), api.t(p,'value'), api.t(p,'parent'), coalesce((p->>'sort')::int,0), coalesce((p->>'active')::boolean,true))
    on conflict (list_key, value) do update set parent = excluded.parent, sort = excluded.sort, active = excluded.active;
    return api.ok();

  elsif p_action = 'SAVE_STAFF_USER' then
    if not core.can(uid,'users.manage') then return api.err('غير مسموح.'); end if;
    if api.t(p,'username') is null then return api.err('اسم المستخدم مطلوب.'); end if;
    insert into core.users(username, person_id, password_hash, must_change, active)
    values (lower(api.t(p,'username')), (api.t(p,'personId'))::uuid,
            extensions.crypt(p->>'password', extensions.gen_salt('bf', 10)), true, true)
    on conflict (username) do update set active = coalesce((p->>'active')::boolean, core.users.active),
      password_hash = case when p ? 'password' then extensions.crypt(p->>'password', extensions.gen_salt('bf', 10))
                           else core.users.password_hash end,
      must_change = case when p ? 'password' then true else core.users.must_change end
    returning id into v_id;
    if p ? 'roles' then
      delete from core.user_roles where user_id = v_id and role not in ('MEMBER','NON_MEMBER');
      insert into core.user_roles(user_id, role, granted_by)
      select v_id, x, uid::text from jsonb_array_elements_text(p->'roles') x where x not in ('MEMBER','NON_MEMBER');
    end if;
    return api.ok(jsonb_build_object('id', v_id));
  end if;

  return api.err('عملية غير معروفة: ' || p_action);
exception
  when check_violation then return api.err('قيمة غير صحيحة: ' || coalesce(nullif(sqlerrm,''),'تحقق من البيانات'));
  when unique_violation then return api.err('القيمة مسجّلة من قبل لشخص آخر.');
  when invalid_datetime_format or datetime_field_overflow then return api.err('تاريخ غير صحيح (yyyy-mm-dd).');
  when invalid_text_representation then return api.err('قيمة غير صحيحة.');
end $$;

revoke all on all functions in schema api from public, anon, authenticated;
