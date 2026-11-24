-- المرحلة 13: مسارات الاعتماد — عرض موحّد (قراءة فقط) لكل طلب: مراحله، أين وصل، ومن عليه الإجراء.
-- لا جداول جديدة ولا تغيير على المنطق المالي؛ الإجراءات نفسها تبقى في وحداتها.

create or replace function api.wf_items(only_pid uuid) returns table(item jsonb, perm text, open boolean)
language sql stable set search_path = core, public as $$
  with g as (
    select r.*, p.full_name, t.name tname,
      case r.status when 'مقدَّم' then 1 when 'ناقص مستندات' then 1 when 'مستوفى' then 2 when 'معتمد' then 3 when 'مصروف' then 4 else -1 end idx
    from grants.requests r join core.persons p on p.id = r.person_id left join grants.types t on t.code = r.type_code
    where only_pid is null or r.person_id = only_pid),
  c as (
    select r.*, p.full_name, case r.status when 'معلّق' then 1 when 'معتمد' then 2 else -1 end idx
    from core.change_requests r join core.persons p on p.id = r.person_id where only_pid is null or r.person_id = only_pid),
  d as (
    select o.*, p.full_name, f.title otitle, f.category,
      case o.status when 'مطلوب' then 1 when 'مؤكد' then 2 when 'مسلّم' then 3 else -1 end idx
    from activities.dev_orders o join core.persons p on p.id = o.person_id join activities.dev_offers f on f.id = o.offer_id
    where only_pid is null or o.person_id = only_pid),
  b as (
    select k.*, p.full_name, a.title atitle, a.start_date,
      case k.status when 'قائمة انتظار' then 0 when 'بانتظار السداد' then 1 when 'مؤكد' then 2 when 'منتهٍ' then 3 else -1 end idx
    from activities.bookings k join core.persons p on p.id = k.person_id join activities.activities a on a.id = k.activity_id
    where only_pid is null or k.person_id = only_pid)
  select jsonb_build_object('module','منحة','icon','🎁','ref',req_no,'title',coalesce(tname,type_code) || coalesce(' — ' || subject_name,''),
      'person',full_name,'person_id',person_id,'at',created_at,'status',status,'amount',amount,'idx',idx,
      'stages',jsonb_build_array('تقديم الطلب','مراجعة المستندات','اعتماد المنحة','صرف الشيك','تم الصرف'),
      'actor',case idx when 1 then 'مراجع المنح' when 2 then 'معتمِد المنح' when 3 then 'الخزينة' end,
      'note',case when status='ناقص مستندات' then 'ناقص مستندات' when status='مرفوض' then reject_reason end,'link','#/grantsadmin','mylink','#/grants'),
    case idx when 1 then 'grants.review' when 2 then 'grants.approve' when 3 then 'treasury.cheque.issue' end, idx between 1 and 3
  from g
  union all
  select jsonb_build_object('module','تعديل بيانات','icon','📝','ref',null,'title',field || ': ' || coalesce(old_value,'—') || ' ← ' || new_value,
      'person',full_name,'person_id',person_id,'at',created_at,'status',status,'idx',idx,
      'stages',jsonb_build_array('تقديم الطلب','اعتماد مسؤول البيانات','تحديث الملف'),
      'actor',case idx when 1 then 'مسؤول البيانات' end,'note',decision_note,'link','#/requests','mylink','#/profile'),
    'profile.change.approve', idx = 1
  from c
  union all
  select jsonb_build_object('module',coalesce(category,'جهاز'),'icon',case when category in ('عمرة','حج') then '🕋' else '📱' end,'ref',order_no,'title',otitle,
      'person',full_name,'person_id',person_id,'at',created_at,'status',status,'amount',offer_price,'idx',idx,
      'stages',jsonb_build_array('الحجز','تأكيد الإدارة','التسليم','تم'),
      'actor',case idx when 1 then 'مسؤول العروض' when 2 then 'مسؤول العروض / المورد' end,'note',reject_reason,'link','#/devadmin','mylink','#/devices'),
    'devices.manage', idx between 1 and 2
  from d
  union all
  select jsonb_build_object('module','حجز نشاط','icon','🚌','ref',booking_no,'title',atitle,
      'person',full_name,'person_id',person_id,'at',created_at,'status',status,'amount',total - coalesce(paid,0),'idx',greatest(idx,1),
      'stages',jsonb_build_array('الحجز','السداد','مؤكد','انتهى'),
      'actor',case idx when 0 then 'بانتظار مقعد' when 1 then 'الخزينة (التحصيل)' end,
      'note',case when idx = 0 then 'قائمة انتظار' when idx = 1 and hold_until is not null then 'مهلة السداد حتى ' || to_char(hold_until,'YYYY-MM-DD HH24:MI') else cancel_reason end,
      'link','#/trips','mylink','#/mytrips'),
    'treasury.receipt', idx = 1
  from b
$$;

create or replace function api.wf_inbox(uid uuid) returns jsonb language sql stable set search_path = core, public as $$
  select coalesce(jsonb_agg(item order by item->>'at'), '[]') from api.wf_items(null) where open and core.can(uid, perm)
$$;
create or replace function api.wf_mine(pid uuid) returns jsonb language sql stable set search_path = core, public as $$
  select coalesce(jsonb_agg(item - 'link' order by item->>'at' desc), '[]') from (select item from api.wf_items(pid) where pid is not null order by item->>'at' desc limit 100) q
$$;

create or replace function api.handle_notifications(p_action text, p jsonb, uid uuid, pid uuid) returns jsonb language plpgsql as $$
begin
  if p_action = 'NTF_LIST' then return api.ok(api.notifications(uid, pid));
  elsif p_action = 'NTF_READ' then perform api.notifications_read(uid, pid); return api.ok();
  elsif p_action = 'NTF_INBOX' then return api.ok(jsonb_build_object('items', api.wf_inbox(uid)));
  elsif p_action = 'NTF_MINE' then return api.ok(jsonb_build_object('items', api.wf_mine(pid)));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

revoke all on all functions in schema core, api, activities, grants from public, anon, authenticated;
