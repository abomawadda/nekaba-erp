-- المرحلة 11 — الإشعارات داخل المنصة
-- (أ) إشعار شخصي للعضو يتولد تلقائياً بمُشغّلات عند تغيّر حالة: حجز رحلة/فعالية، طلب مصيف، طلب منحة، حجز جهاز/عمرة، طلب تعديل بيانات.
-- (ب) إعلان عام (person_id فارغ) عند فتح حجز نشاط / تقديم مصيف / عرض أجهزة أو عمرة. القراءة: users.notif_seen_at.
-- (ج) «مهام مستنياك» للمسئولين تُحسب لحظياً حسب الصلاحية (بلا تخزين).
create table core.notifications (
  id         bigint generated always as identity primary key,
  person_id  uuid references core.persons(id) on delete cascade,   -- null = إعلان للجميع
  kind       text not null,                                         -- رحلة / مصيف / منحة / جهاز / بيانات / إعلان
  title      text not null,
  body       text,
  link       text,                                                  -- مسار داخل المنصة (#/...)
  created_at timestamptz not null default clock_timestamp(),
  read_at    timestamptz
);
create index on core.notifications (person_id, created_at desc);
create index on core.notifications (created_at desc) where person_id is null;
alter table core.notifications enable row level security;
revoke all on core.notifications from anon, authenticated;
alter table core.users add column if not exists notif_seen_at timestamptz;

create or replace function core.notify(p_person uuid, p_kind text, p_title text, p_body text, p_link text) returns void language sql as $$
  insert into core.notifications(person_id, kind, title, body, link) values (p_person, p_kind, p_title, p_body, p_link)
$$;

-- ── الرحلات والفعاليات ──
create or replace function activities.notify_booking() returns trigger language plpgsql as $$
declare a activities.activities;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into a from activities.activities where id = new.activity_id;
  if new.status = 'مؤكد' then
    perform core.notify(new.person_id, 'رحلة', 'حجزك اتأكد ✓', a.title || ' — ' || to_char(a.start_date, 'YYYY-MM-DD'), '#/trip/' || a.id);
  elsif new.status = 'بانتظار السداد' and old.status = 'قائمة انتظار' then
    perform core.notify(new.person_id, 'رحلة', 'فضي مكان — ادفع علشان يتأكد', a.title || ' — ادفع قبل ' || to_char(new.hold_until at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'), '#/trip/' || a.id);
  elsif new.status = 'ملغى' then
    perform core.notify(new.person_id, 'رحلة', 'اتلغى حجزك', a.title || coalesce(' — ' || new.cancel_reason, '') || case when new.refunded > 0 then ' — مردود ' || new.refunded else '' end, '#/mytrips');
  end if;
  return new;
end $$;
create trigger booking_notify after update of status on activities.bookings for each row execute function activities.notify_booking();

-- ── المصايف ──
create or replace function activities.notify_summer() returns trigger language plpgsql as $$
declare s activities.summer_seasons;
begin
  if new.status is not distinct from old.status and new.batch_id is not distinct from old.batch_id then return new; end if;
  select * into s from activities.summer_seasons where id = new.season_id;
  if new.status = 'بانتظار السداد' and old.status in ('مقدَّم','احتياطي') then
    perform core.notify(new.person_id, 'مصيف', case when old.status = 'احتياطي' then 'اتصعّدت من الاحتياطي 🎉' else 'اتقبلت في المصيف 🎉' end,
      s.title || ' — ادفع ' || new.total || ' ج قبل ' || to_char(new.hold_until at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'), '#/season/' || s.id);
  elsif new.status = 'احتياطي' and old.status = 'مقدَّم' then
    perform core.notify(new.person_id, 'مصيف', 'أنت في الاحتياطي رقم ' || new.reserve_rank, s.title || ' — هتتصعّد تلقائياً لو حد اعتذر', '#/season/' || s.id);
  elsif new.status = 'مؤكد' and old.status = 'بانتظار السداد' then
    perform core.notify(new.person_id, 'مصيف', 'طلب المصيف اتأكد ✓', s.title, '#/season/' || s.id);
  elsif new.status = 'ملغى' and old.status = 'بانتظار السداد' then
    perform core.notify(new.person_id, 'مصيف', 'سقط طلبك', s.title || coalesce(' — ' || new.cancel_reason, ''), '#/season/' || s.id);
  elsif new.batch_id is distinct from old.batch_id and old.batch_id is not null and new.batch_id is not null then
    perform core.notify(new.person_id, 'مصيف', 'اتغيّر فوجك/وحدتك', s.title || ' — راجع التفاصيل', '#/season/' || s.id);
  end if;
  return new;
end $$;
create trigger summer_notify after update of status, batch_id on activities.summer_applications for each row execute function activities.notify_summer();

-- ── المنح ──
create or replace function grants.notify_request() returns trigger language plpgsql as $$
declare t text := (select name from grants.types where code = new.type_code);
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'ناقص مستندات' then
    perform core.notify(new.person_id, 'منحة', t || ': مستندات ناقصة', 'سلّم أصل المستندات لمكتب النقابة', '#/grants');
  elsif new.status = 'معتمد' then
    perform core.notify(new.person_id, 'منحة', t || ' اتعتمدت ✓', 'المبلغ ' || new.amount || ' ج — بانتظار الصرف', '#/grants');
  elsif new.status = 'مصروف' then
    perform core.notify(new.person_id, 'منحة', t || ' اتصرفت ✓', 'المبلغ ' || new.amount || ' ج', '#/grants');
  elsif new.status = 'مرفوض' then
    perform core.notify(new.person_id, 'منحة', t || ' اترفضت', new.reject_reason, '#/grants');
  end if;
  return new;
end $$;
create trigger grant_notify after update of status on grants.requests for each row execute function grants.notify_request();

-- ── الأجهزة والعمرة ──
create or replace function activities.notify_dev() returns trigger language plpgsql as $$
declare f activities.dev_offers; it text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into f from activities.dev_offers where id = new.offer_id;
  it := (select name from activities.dev_items where id = new.item_id);
  if new.status in ('مؤكد','مسلّم','مرفوض') then
    perform core.notify(new.person_id, case when f.category in ('عمرة','حج') then 'عمرة' else 'جهاز' end,
      case new.status when 'مؤكد' then 'حجزك اتأكد ✓' when 'مسلّم' then 'اتسلّم ✓' else 'حجزك اترفض' end,
      it || ' — ' || f.title || coalesce(' — ' || new.reject_reason, ''), case when f.category in ('عمرة','حج') then '#/umrah' else '#/devices' end);
  end if;
  return new;
end $$;
create trigger dev_notify after update of status on activities.dev_orders for each row execute function activities.notify_dev();

-- ── طلبات تعديل البيانات ──
create or replace function core.notify_change() returns trigger language plpgsql as $$
begin
  if new.status is not distinct from old.status or new.status = 'معلّق' then return new; end if;
  perform core.notify(new.person_id, 'بيانات', case when new.status = 'معتمد' then 'طلب تعديل بياناتك اتعتمد ✓' else 'طلب تعديل بياناتك اترفض' end,
    coalesce(new.decision_note, ''), '#/profile');
  return new;
end $$;
create trigger change_notify after update of status on core.change_requests for each row execute function core.notify_change();

-- ── الإعلانات العامة ──
create or replace function activities.announce() returns trigger language plpgsql as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if tg_table_name = 'activities' and new.status = 'الحجز مفتوح' then
    perform core.notify(null, 'إعلان', 'اتفتح الحجز: ' || new.title, coalesce(new.location || ' — ', '') || to_char(new.start_date, 'YYYY-MM-DD'), '#/trip/' || new.id);
  elsif tg_table_name = 'summer_seasons' and new.status = 'التقديم مفتوح' then
    perform core.notify(null, 'إعلان', 'اتفتح التقديم: ' || new.title, 'قدّم ورتّب تفضيلاتك', '#/season/' || new.id);
  elsif tg_table_name = 'dev_offers' and new.status = 'الطلب مفتوح' then
    perform core.notify(null, 'إعلان', 'عرض جديد: ' || new.title, new.supplier, case when new.category in ('عمرة','حج') then '#/umrah' else '#/devices' end);
  end if;
  return new;
end $$;
create trigger act_announce after update of status on activities.activities for each row execute function activities.announce();
create trigger sum_announce after update of status on activities.summer_seasons for each row execute function activities.announce();
create trigger dev_announce after update of status on activities.dev_offers for each row execute function activities.announce();

-- ── المهام المنتظرة للمسئول (لحظياً) ──
create or replace function api.staff_tasks(uid uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(t) filter (where (t->>'count')::int > 0), '[]') from (
    select jsonb_build_object('title','طلبات تعديل بيانات','count',(select count(*) from core.change_requests where status = 'معلّق'),'link','#/requests') t where core.can(uid,'profile.change.approve')
    union all select jsonb_build_object('title','منح تحتاج مراجعة مستندات','count',(select count(*) from grants.requests where status in ('مقدَّم','ناقص مستندات')),'link','#/grantsadmin') where core.can(uid,'grants.review')
    union all select jsonb_build_object('title','منح جاهزة للاعتماد','count',(select count(*) from grants.requests where status = 'مستوفى'),'link','#/grantsadmin') where core.can(uid,'grants.approve')
    union all select jsonb_build_object('title','منح معتمدة للصرف','count',(select count(*) from grants.requests where status = 'معتمد'),'link','#/grantsadmin') where core.can(uid,'treasury.cheque.issue')
    union all select jsonb_build_object('title','حجوزات أجهزة/عمرة جديدة','count',(select count(*) from activities.dev_orders where status = 'مطلوب'),'link','#/devadmin') where core.can(uid,'devices.manage')
    union all select jsonb_build_object('title','طلبات تبديل مصايف','count',(select count(*) from activities.summer_swaps where status in ('مطلوب','وافق الطرف الآخر')),'link','#/summer') where core.can(uid,'summer.manage')
    union all select jsonb_build_object('title','حجوزات رحلات بانتظار التحصيل','count',(select count(*) from activities.bookings where status = 'بانتظار السداد'),'link','#/trips') where core.can(uid,'treasury.receipt')
  ) q
$$;

-- ── واجهة NTF_* (تمر عبر handle_core بلا بادئة جديدة في الموجّه) ──
create or replace function api.notifications(uid uuid, pid uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'link', n.link, 'at', n.created_at,
        'unread', case when n.person_id is null then n.created_at > coalesce(u.notif_seen_at, '-infinity') else n.read_at is null end) order by n.created_at desc, n.id desc)
      from (select * from core.notifications where (person_id = pid and pid is not null) or (person_id is null and created_at > now() - interval '60 days')
            order by created_at desc, id desc limit 50) n), '[]'),
    'unread', (select count(*) from core.notifications n where (n.person_id = pid and pid is not null and n.read_at is null)
               or (n.person_id is null and n.created_at > greatest(coalesce(u.notif_seen_at, '-infinity'), now() - interval '60 days'))),
    'tasks', api.staff_tasks(uid))
  from core.users u where u.id = uid
$$;
create or replace function api.notifications_read(uid uuid, pid uuid) returns void language sql as $$
  update core.notifications set read_at = now() where person_id = pid and read_at is null;
  update core.users set notif_seen_at = clock_timestamp() where id = uid;
$$;

revoke all on all functions in schema core, api, activities, grants from public, anon, authenticated;

create or replace function api.handle_notifications(p_action text, p jsonb, uid uuid, pid uuid) returns jsonb language plpgsql as $$
begin
  if p_action = 'NTF_LIST' then return api.ok(api.notifications(uid, pid));
  elsif p_action = 'NTF_READ' then perform api.notifications_read(uid, pid); return api.ok();
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- الموجّه (كل الفروع)
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  if p_action like 'IMPORT\_%' or p_action like 'GOV\_%' or p_action like 'FIN\_%' or p_action like 'BEN\_%' or p_action like 'ACT\_%'
     or p_action like 'SUM\_%' or p_action like 'GRT\_%' or p_action like 'DEV\_%' or p_action like 'REP\_%' or p_action like 'NTF\_%' then
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

-- تثبيت search_path للدوال الجديدة (سياسة migration 20)
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
           where s.nspname in ('core','api','audit','governance','finance','treasury','benefits','activities','grants','legacy')
             and p.prokind = 'f' and d.objid is null
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') loop
    execute format('alter function %s set search_path = core, public, extensions, pg_temp', f.sig);
  end loop;
end $$;
revoke all on all functions in schema core, api, activities, grants from public, anon, authenticated;
