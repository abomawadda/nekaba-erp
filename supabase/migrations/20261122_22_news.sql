-- المرحلة 12 — إعلانات وأخبار النقابة
-- ينشرها المجلس/المدير (news.manage)، تظهر في «أنشطتي» وصفحة الأخبار، ونشر خبر جديد يرسل إشعاراً عاماً للجميع.
create table core.news (
  id           uuid primary key default gen_random_uuid(),
  category     text not null default 'خبر' check (category in ('خبر','قرار','موعد','تهنئة','تعزية')),
  title        text not null check (length(trim(title)) > 0),
  body         text,
  pinned       boolean not null default false,
  published_at timestamptz not null default clock_timestamp(),
  expires_at   date,                                    -- يختفي بعده (اختياري)
  active       boolean not null default true,           -- الحذف = إخفاء (يبقى في التدقيق)
  created_by   text,
  created_at   timestamptz not null default clock_timestamp()
);
create index on core.news (active, pinned desc, published_at desc);
alter table core.news enable row level security;
revoke all on core.news from anon, authenticated;
create trigger news_audit after insert or update or delete on core.news for each row execute function audit.track();

insert into core.permissions(code, module, name) values ('news.manage','core','نشر الأخبار والإعلانات') on conflict do nothing;
insert into core.role_permissions(role, permission) values ('BOARD','news.manage') on conflict do nothing;

create or replace function core.news_announce() returns trigger language plpgsql as $$
begin
  if new.active then
    perform core.notify(null, 'إعلان', (case new.category when 'تهنئة' then '🎉 ' when 'تعزية' then '🕊️ ' when 'قرار' then '📜 ' when 'موعد' then '📅 ' else '📰 ' end) || new.title,
      left(coalesce(new.body, ''), 140), '#/news');
  end if;
  return new;
end $$;
create trigger news_notify after insert on core.news for each row execute function core.news_announce();

create or replace function api.news_list(p_all boolean, p_limit int) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(n) - 'created_by' order by n.pinned desc, n.published_at desc), '[]')
  from (select * from core.news where (p_all or (active and (expires_at is null or expires_at >= current_date)))
        order by pinned desc, published_at desc limit p_limit) n
$$;

create or replace function api.handle_news(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql as $$
declare r jsonb := p->'news'; v_id uuid; m boolean := core.can(uid,'news.manage');
begin
  if p_action = 'NEWS_LIST' then
    return api.ok(jsonb_build_object('items', api.news_list(m and coalesce((p->>'all')::boolean, false), coalesce((nullif(p->>'limit',''))::int, 30)), 'canManage', m));
  end if;
  if not m then return api.err('غير مسموح.'); end if;
  if p_action = 'NEWS_SAVE' then
    if api.t(r,'title') is null then return api.err('العنوان مطلوب.'); end if;
    if nullif(r->>'id','') is null then
      insert into core.news(category, title, body, pinned, expires_at, created_by)
      values (coalesce(api.t(r,'category'),'خبر'), api.t(r,'title'), api.t(r,'body'), coalesce((r->>'pinned')::boolean, false), (api.t(r,'expires_at'))::date, uid::text)
      returning id into v_id;
    else
      v_id := (r->>'id')::uuid;
      update core.news set category = coalesce(api.t(r,'category'), category), title = api.t(r,'title'), body = api.t(r,'body'),
        pinned = coalesce((r->>'pinned')::boolean, pinned), expires_at = (api.t(r,'expires_at'))::date where id = v_id;
    end if;
    return api.ok(jsonb_build_object('id', v_id));
  elsif p_action = 'NEWS_HIDE' then
    update core.news set active = coalesce((p->>'show')::boolean, false) where id = (p->>'id')::uuid;
    return api.ok();
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- الموجّه (كل الفروع)
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  if p_action like 'IMPORT\_%' or p_action like 'GOV\_%' or p_action like 'FIN\_%' or p_action like 'BEN\_%' or p_action like 'ACT\_%'
     or p_action like 'SUM\_%' or p_action like 'GRT\_%' or p_action like 'DEV\_%' or p_action like 'REP\_%' or p_action like 'NTF\_%'
     or p_action like 'NEWS\_%' then
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
    elsif p_action like 'REP\_%' then return api.handle_reports(p_action, p, uid);
    elsif p_action like 'NTF\_%' then return api.handle_notifications(p_action, p, uid, (s->>'pid')::uuid);
    elsif p_action like 'NEWS\_%' then return api.handle_news(p_action, p, uid);
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

do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
           where s.nspname in ('core','api','audit','governance','finance','treasury','benefits','activities','grants','legacy')
             and p.prokind = 'f' and d.objid is null
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') loop
    execute format('alter function %s set search_path = core, public, extensions, pg_temp', f.sig);
  end loop;
end $$;
revoke all on all functions in schema core, api from public, anon, authenticated;
