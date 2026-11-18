-- استيراد الأعضاء والحركات والقوائم (قابل للتكرار: upsert بالرقم الوظيفي — إعادة الاستيراد تحدّث ولا تكرر)
insert into core.permissions(code, module, name) values ('data.import','core','استيراد البيانات بالجملة') on conflict do nothing;
insert into core.role_permissions(role, permission) values ('SYS_ADMIN','data.import') on conflict do nothing;

-- صف واحد ← شخص (+ حركات افتتاحية للأبعاد لو تغيرت). يرجع {action, warnings[]}
create or replace function api.import_person(r jsonb, p_opening date, p_actor text) returns jsonb
language plpgsql as $$
declare v_id uuid; w text[] := '{}'; v_nid text := api.t(r,'national_id'); v_phone text := api.t(r,'phone');
        v_phone2 text := api.t(r,'phone2'); f text; v_val text; v_new boolean := false; v_date date;
begin
  if api.t(r,'job_id') is null or api.t(r,'full_name') is null then
    return jsonb_build_object('action','skipped','warnings',jsonb_build_array('بلا رقم وظيفي أو اسم'));
  end if;
  if v_nid is not null and v_nid !~ '^[23][0-9]{13}$' then w := array_append(w, 'قومي غير صحيح: تُرك فارغاً'); v_nid := null; end if;
  if v_nid is not null and exists (select 1 from core.persons where national_id = v_nid and job_id <> api.t(r,'job_id')) then
    w := array_append(w, 'قومي مسجّل لموظف آخر: تُرك فارغاً'); v_nid := null; end if;
  v_phone := nullif(regexp_replace(coalesce(v_phone,''), '\D', '', 'g'), '');
  if v_phone is not null and v_phone ~ '^1[0-9]{9}$' then v_phone := '0' || v_phone; end if;
  if v_phone is not null and v_phone !~ '^01[0-9]{9}$' then w := array_append(w, 'موبايل غير صحيح: تُرك فارغاً'); v_phone := null; end if;
  v_phone2 := nullif(regexp_replace(coalesce(v_phone2,''), '\D', '', 'g'), '');
  if v_phone2 is not null and v_phone2 ~ '^1[0-9]{9}$' then v_phone2 := '0' || v_phone2; end if;
  if v_phone2 is not null and v_phone2 !~ '^01[0-9]{9}$' then v_phone2 := null; end if;

  select id into v_id from core.persons where job_id = api.t(r,'job_id');
  if v_id is null then
    insert into core.persons(job_id, full_name) values (api.t(r,'job_id'), api.t(r,'full_name')) returning id into v_id;
    v_new := true;
  end if;
  -- الإدارة تكتب فوق البيانات الإدارية؛ الشخصية تُملأ فقط لو فاضية (لا نمسح ما حدّثه الموظف بنفسه)
  update core.persons set
    full_name = api.t(r,'full_name'),
    national_id = coalesce(v_nid, national_id),
    insurance_no = coalesce(api.t(r,'insurance_no'), insurance_no),
    hire_date = coalesce((api.t(r,'hire_date'))::date, hire_date),
    retirement_date = coalesce((api.t(r,'retirement_date'))::date, retirement_date),
    monthly_dues = coalesce((api.t(r,'monthly_dues'))::numeric, monthly_dues),
    phone = coalesce(phone, v_phone), phone2 = coalesce(phone2, v_phone2),
    email = coalesce(email, api.t(r,'email')), address = coalesce(address, api.t(r,'address')),
    qualification = coalesce(qualification, api.t(r,'qualification')),
    specialization = coalesce(specialization, api.t(r,'specialization')),
    marital_status = coalesce(marital_status, case when api.t(r,'marital_status') in ('أعزب','متزوج','مطلق','أرمل') then api.t(r,'marital_status') end),
    legacy_ref = coalesce(legacy_ref, api.t(r,'legacy_ref'))
  where id = v_id;

  -- الأبعاد: لو القيمة المستوردة غير الحالية ⇒ حركة «بيانات افتتاحية (استيراد)»
  v_date := coalesce((api.t(r,'state_date'))::date, (api.t(r,'hire_date'))::date, p_opening);
  foreach f in array api.movement_fields() loop
    v_val := api.t(r, f);
    if v_val is null then continue; end if;
    if f = 'union_org' and v_val not in ('النقابة العامة','نقابة مستقلة','غير منضم') then w := array_append(w, 'تنظيم غير معروف: ' || v_val); continue; end if;
    if f = 'member_state' and v_val not in ('نشط','موقوف','إجازة بدون أجر','نقل','معاش','استقالة','وفاة') then w := array_append(w, 'حالة غير معروفة: ' || v_val); continue; end if;
    if core.state_at(v_id, f) is distinct from v_val then
      insert into core.person_movements(person_id, kind, field, from_value, to_value, effective_date, notes, created_by)
      values (v_id, 'بيانات افتتاحية (استيراد)', f, core.state_at(v_id, f),
              v_val, case when core.state_at(v_id, f) is null then v_date else current_date end, 'استيراد', p_actor);
    end if;
  end loop;
  return jsonb_build_object('action', case when v_new then 'inserted' else 'updated' end, 'warnings', to_jsonb(w));
end $$;

create or replace function api.import_movement(r jsonb, p_actor text) returns text language plpgsql as $$
declare v_id uuid; v_field text; v_kind text := api.t(r,'kind'); v_to text := api.t(r,'to_value'); v_date date;
begin
  select id into v_id from core.persons where job_id = api.t(r,'job_id');
  if v_id is null then return 'رقم وظيفي غير موجود'; end if;
  begin v_date := (api.t(r,'effective_date'))::date; exception when others then return 'تاريخ غير صحيح'; end;
  if v_date is null then return 'ناقص التاريخ'; end if;
  v_field := case
    when v_kind in ('ترقية','تغيير وظيفة/مسمى') then 'job_title'
    when v_kind in ('نقل جهة عمل','انتداب/إعارة') then 'workplace'
    when v_kind in ('انتقال إلى النقابة العامة','انضمام للنقابة العامة (أول مرة)') then 'union_org'
    when v_kind = 'انتقال إلى نقابة مستقلة' then 'union_org'
    when v_kind = 'انسحاب من التنظيم' then 'union_org'
    when v_kind in ('إيقاف','عودة من إيقاف','إجازة بدون أجر','عودة من إجازة','إحالة للمعاش','استقالة','إنهاء خدمة','وفاة') then 'member_state'
    else api.t(r,'field') end;
  if v_field is null then return 'نوع حركة غير معروف'; end if;
  if v_field = 'union_org' then v_to := case v_kind when 'انتقال إلى نقابة مستقلة' then 'نقابة مستقلة'
                                                  when 'انسحاب من التنظيم' then 'غير منضم' else 'النقابة العامة' end; end if;
  if v_field = 'member_state' then v_to := case v_kind when 'إيقاف' then 'موقوف' when 'عودة من إيقاف' then 'نشط'
      when 'إجازة بدون أجر' then 'إجازة بدون أجر' when 'عودة من إجازة' then 'نشط' when 'إحالة للمعاش' then 'معاش'
      when 'استقالة' then 'استقالة' when 'إنهاء خدمة' then 'استقالة' when 'وفاة' then 'وفاة' else v_to end; end if;
  if v_to is null then return 'ناقص القيمة الجديدة'; end if;   -- بعد اشتقاقها من نوع الحركة
  if exists (select 1 from core.person_movements where person_id = v_id and field = v_field and to_value = v_to and effective_date = v_date) then
    return 'مكرر'; end if;
  insert into core.person_movements(person_id, kind, field, from_value, to_value, effective_date, expected_return, decision_ref, decision_date, notes, created_by)
  values (v_id, coalesce(v_kind,'أخرى'), v_field, coalesce(api.t(r,'from_value'), core.state_at(v_id, v_field, v_date)), v_to, v_date,
          (api.t(r,'expected_return'))::date, api.t(r,'decision_ref'), (api.t(r,'decision_date'))::date, api.t(r,'notes'), p_actor);
  return 'ok';
end $$;

-- الموزّع: عمليات الاستيراد تُضاف قبل باقي العمليات
create or replace function api.handle_import(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql as $$
declare r jsonb; res jsonb; ins int := 0; upd int := 0; skp int := 0; warns jsonb := '[]'; m text; ok int := 0; bad jsonb := '[]';
begin
  if not core.can(uid,'data.import') then return api.err('غير مسموح.'); end if;
  if p_action = 'IMPORT_PERSONS' then
    for r in select * from jsonb_array_elements(coalesce(p->'rows','[]')) loop
      res := api.import_person(r, coalesce((api.t(p,'openingDate'))::date, '2000-01-01'), uid::text);
      case res->>'action' when 'inserted' then ins := ins + 1; when 'updated' then upd := upd + 1; else skp := skp + 1; end case;
      if jsonb_array_length(res->'warnings') > 0 then
        warns := warns || jsonb_build_object('job_id', r->>'job_id', 'warnings', res->'warnings'); end if;
    end loop;
    return api.ok(jsonb_build_object('inserted', ins, 'updated', upd, 'skipped', skp, 'warnings', warns));
  elsif p_action = 'IMPORT_MOVEMENTS' then
    for r in select * from jsonb_array_elements(coalesce(p->'rows','[]')) loop
      m := api.import_movement(r, uid::text);
      if m = 'ok' then ok := ok + 1; else bad := bad || jsonb_build_object('job_id', r->>'job_id', 'kind', r->>'kind', 'reason', m); end if;
    end loop;
    return api.ok(jsonb_build_object('imported', ok, 'rejected', bad));
  elsif p_action = 'IMPORT_LIST' then
    insert into core.ref_lists(list_key, value, sort)
    select api.t(p,'listKey'), v, o from jsonb_array_elements_text(p->'values') with ordinality t(v,o) where trim(v) <> ''
    on conflict (list_key, value) do update set active = true, sort = excluded.sort;
    return api.ok(jsonb_build_object('count', (select count(*) from core.ref_lists where list_key = api.t(p,'listKey') and active)));
  end if;
  return api.err('عملية غير معروفة');
end $$;
revoke all on all functions in schema api from public, anon, authenticated;

-- ───────── موجّه الوحدات ─────────
-- api.handle صار موجّهاً: كل وحدة لها دالتها (النواة = handle_core). وحدة جديدة = فرع جديد هنا فقط.
alter function api.handle(text, jsonb, jsonb) rename to handle_core;
create or replace function api.session_user(s jsonb) returns uuid language plpgsql as $$
declare uid uuid := (s->>'uid')::uuid;
begin
  if uid is null or not exists (select 1 from core.users where id = uid and active) then return null; end if;
  perform set_config('erp.actor', uid::text, true);
  return uid;
end $$;
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  if p_action like 'IMPORT\_%' then
    uid := api.session_user(s);
    if uid is null then return api.err('انتهت الجلسة. سجّل الدخول مرة أخرى.') || '{"expired":true}'; end if;
    perform set_config('erp.reason', coalesce(p->>'reason','استيراد'), true);
    return api.handle_import(p_action, p, uid);
  end if;
  return api.handle_core(p_action, p, s);
end $$;
revoke all on all functions in schema api from public, anon, authenticated;
