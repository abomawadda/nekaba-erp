-- المرحلة 15: إدارة المستخدمين والصلاحيات + مستعرض سجل التدقيق (وحدة SYS_).
create or replace function api.handle_system(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql set search_path = core, public as $$
declare v_id uuid; v_user text := (select username from core.users where id = uid); v_roles text[];
begin
  perform set_config('erp.actor', coalesce(v_user, 'SYSTEM'), true);

  if p_action = 'SYS_USERS' then
    if not core.can(uid,'users.manage') then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object(
      'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username, 'person_id', u.person_id, 'person', p.full_name,
          'active', u.active, 'must_change', u.must_change, 'last_login', u.last_login, 'created_at', u.created_at,
          'roles', coalesce((select jsonb_agg(ur.role order by ur.role) from core.user_roles ur where ur.user_id = u.id and ur.role not in ('MEMBER','NON_MEMBER')), '[]'))
        order by u.active desc, u.username)
        from core.users u left join core.persons p on p.id = u.person_id where u.username is not null), '[]'),
      'roles', (select jsonb_agg(jsonb_build_object('code', r.code, 'name', r.name, 'kind', r.kind,
          'perms', coalesce((select jsonb_agg(jsonb_build_object('code', rp.permission, 'max', rp.max_amount) order by rp.permission) from core.role_permissions rp where rp.role = r.code), '[]'))
        order by r.kind desc, r.code) from core.roles r where r.kind <> 'member'),
      'perms', (select jsonb_agg(jsonb_build_object('code', code, 'module', module, 'name', name) order by module, code) from core.permissions),
      'me', uid));

  elsif p_action = 'SYS_USER_SAVE' then
    if not core.can(uid,'users.manage') then return api.err('غير مسموح.'); end if;
    if coalesce(api.t(p,'username'),'') !~ '^[a-z0-9_.]{3,30}$' then return api.err('اسم المستخدم: 3–30 حرفاً إنجليزياً صغيراً أو أرقام.'); end if;
    if p ? 'password' and length(coalesce(p->>'password','')) < 8 then return api.err('كلمة المرور 8 أحرف على الأقل.'); end if;
    if not exists (select 1 from core.users where username = lower(api.t(p,'username'))) and not p ? 'password' then
      return api.err('كلمة مرور مؤقتة مطلوبة للمستخدم الجديد.'); end if;
    select array_agg(x) into v_roles from jsonb_array_elements_text(coalesce(p->'roles','[]')) x;
    if exists (select 1 from unnest(coalesce(v_roles,'{}')) r where not exists (select 1 from core.roles where code = r and kind in ('staff','admin'))) then
      return api.err('دور غير صالح.'); end if;
    v_id := (select id from core.users where username = lower(api.t(p,'username')));
    if v_id = uid and (coalesce((p->>'active')::boolean, true) = false or (core.is_admin(uid) and not 'SYS_ADMIN' = any(coalesce(v_roles,'{}')))) then
      return api.err('لا يمكنك إيقاف حسابك أو سحب صلاحية المدير من نفسك.'); end if;
    if api.t(p,'personId') is not null and exists (select 1 from core.users where person_id = (api.t(p,'personId'))::uuid and id is distinct from v_id) then
      return api.err('هذا العضو مربوط بحساب آخر.'); end if;
    insert into core.users(username, person_id, password_hash, must_change, active)
    values (lower(api.t(p,'username')), (api.t(p,'personId'))::uuid, extensions.crypt(p->>'password', extensions.gen_salt('bf', 10)), true, coalesce((p->>'active')::boolean, true))
    on conflict (username) do update set active = coalesce((p->>'active')::boolean, core.users.active),
      person_id = case when p ? 'personId' then (api.t(p,'personId'))::uuid else core.users.person_id end,
      password_hash = case when p ? 'password' then extensions.crypt(p->>'password', extensions.gen_salt('bf', 10)) else core.users.password_hash end,
      must_change = case when p ? 'password' then true else core.users.must_change end
    returning id into v_id;
    delete from core.user_roles where user_id = v_id and role not in ('MEMBER','NON_MEMBER') and role <> all(coalesce(v_roles,'{}'));
    insert into core.user_roles(user_id, role, granted_by) select v_id, r, v_user from unnest(coalesce(v_roles,'{}')) r on conflict do nothing;
    return api.ok(jsonb_build_object('id', v_id));

  elsif p_action = 'SYS_AUDIT' then
    if not core.can(uid,'audit.view') then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object(
      'items', coalesce((select jsonb_agg(x order by x.id desc) from (
        select l.id, l.at, l.actor, l.action, l.entity, l.entity_id, l.reason,
          (select jsonb_agg(k) from (select k from jsonb_object_keys(coalesce(l.after, l.before)) k
             where l.before is null or l.after is null or l.before->k is distinct from l.after->k limit 8) q) changed
        from audit.log l
        where (api.t(p,'entity') is null or l.entity = api.t(p,'entity'))
          and (api.t(p,'actor') is null or l.actor ilike '%' || api.t(p,'actor') || '%')
          and (api.t(p,'action') is null or l.action = api.t(p,'action'))
          and (api.t(p,'entityId') is null or l.entity_id = api.t(p,'entityId'))
          and l.at >= coalesce((api.t(p,'from'))::date, now() - interval '30 days')
          and l.at < coalesce((api.t(p,'to'))::date + 1, now() + interval '1 day')
        order by l.id desc limit least(coalesce((p->>'limit')::int, 200), 500)) x), '[]'),
      'entities', (select jsonb_agg(e order by e) from (select distinct entity e from audit.log) q)));

  elsif p_action = 'SYS_AUDIT_GET' then
    if not core.can(uid,'audit.view') then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object('item', (select to_jsonb(l) from audit.log l where l.id = (p->>'id')::bigint)));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- الموجّه: إضافة فرع SYS_ جراحياً مع التحقق من المرساة
do $$ declare d text := pg_get_functiondef('api.handle(text,jsonb,jsonb)'::regprocedure); begin
  if position('SYS\_%' in d) > 0 then return; end if;
  if position($a$or p_action like 'NEWS\_%' then$a$ in d) = 0 or position($a$elsif p_action like 'NEWS\_%' then return api.handle_news(p_action, p, uid);$a$ in d) = 0 then
    raise exception 'مرساة الموجّه غير موجودة'; end if;
  d := replace(d, $a$or p_action like 'NEWS\_%' then$a$, $a$or p_action like 'NEWS\_%' or p_action like 'SYS\_%' then$a$);
  d := replace(d, $a$elsif p_action like 'NEWS\_%' then return api.handle_news(p_action, p, uid);$a$,
    $a$elsif p_action like 'NEWS\_%' then return api.handle_news(p_action, p, uid);
    elsif p_action like 'SYS\_%' then return api.handle_system(p_action, p, uid);$a$);
  execute d;
end $$;

revoke all on all functions in schema core, api from public, anon, authenticated;
