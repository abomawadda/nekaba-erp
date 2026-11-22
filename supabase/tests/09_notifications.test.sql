-- اختبار الإشعارات (7 فحوص — نجحت 22 نوفمبر 2026، ينتهي بـ ALL_NOTIF_TESTS_PASSED ويرجع كل شيء)
-- منحة: «مستندات ناقصة» ثم «اتعتمدت» للعضو + مهام المسئول؛ فتح حجز رحلة ⇒ إعلان عام؛ إلغاء الحجز ⇒ إشعار؛ القراءة تصفّر العداد.
do $$ declare pm uuid; ua uuid; um uuid; sa jsonb; sm jsonb; r jsonb; g uuid; act uuid; dec uuid; c int := 0; begin
  select id into dec from governance.decisions limit 1;
  insert into core.persons(job_id, national_id, full_name) values ('ZZ-N1','29900000006666','عضو اختبار الإشعارات') returning id into pm;
  insert into core.person_movements(person_id, kind, field, to_value, effective_date) values (pm,'انضمام','union_org','النقابة العامة','2020-01-01'),(pm,'تعيين','member_state','نشط','2020-01-01');
  insert into core.users(username, active) values ('zz_n_a',true) returning id into ua; insert into core.user_roles values (ua,'SYS_ADMIN');
  insert into core.users(person_id, username, active) values (pm,'zz_n_m',true) returning id into um; insert into core.user_roles values (um,'MEMBER');
  sa := jsonb_build_object('uid',ua); sm := jsonb_build_object('uid',um,'pid',pm);
  perform api.handle('NTF_READ', '{}', sm);
  r := api.handle('NTF_LIST', '{}', sm); if (r->>'unread')::int <> 0 then raise exception 'start %', r->>'unread'; end if; c := c+1;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','MARRIAGE','event_date',current_date-3), sm); g := r#>>'{request,id}';
  r := api.handle('NTF_LIST', '{}', sa);
  if not exists (select 1 from jsonb_array_elements(r->'tasks') t where t->>'title' like 'منح تحتاج مراجعة%') then raise exception 'tasks %', r->'tasks'; end if; c := c+1;
  perform api.handle('GRT_REVIEW', jsonb_build_object('requestId',g,'docs','[{"name":"قسيمة الزواج","received":false}]'::jsonb), sa);
  perform api.handle('GRT_REVIEW', jsonb_build_object('requestId',g,'docs','[{"name":"قسيمة الزواج","received":true}]'::jsonb), sa);
  perform api.handle('GRT_DECIDE', jsonb_build_object('requestId',g,'approve',true), sa);
  r := api.handle('NTF_LIST', '{}', sm);
  if (r->>'unread')::int <> 2 or r#>>'{items,0,title}' not like '%اتعتمدت%' then raise exception 'grant notifs %', r; end if; c := c+2;
  r := api.handle('ACT_SAVE', jsonb_build_object('activity', jsonb_build_object('title','ZZ رحلة إشعار','start_date', current_date + 10, 'capacity', 5,
        'decision_id', dec, 'prices', jsonb_build_array(jsonb_build_object('label','العضو','applies_to','العضو','full_price',100,'member_price',50)))), sa);
  act := r#>>'{activity,id}';
  perform api.handle('ACT_SET_STATUS', jsonb_build_object('activityId',act,'status','الحجز مفتوح'), sa);
  r := api.handle('NTF_LIST', '{}', sm);
  if (r->>'unread')::int <> 3 or r#>>'{items,0,title}' not like 'اتفتح الحجز%' then raise exception 'broadcast %', r; end if; c := c+1;
  r := api.handle('ACT_BOOK', jsonb_build_object('activityId',act), sm);
  perform api.handle('ACT_CANCEL_MY', jsonb_build_object('bookingId', r#>>'{booking,id}'), sm);
  r := api.handle('NTF_LIST', '{}', sm);
  if r#>>'{items,0,title}' <> 'اتلغى حجزك' then raise exception 'booking notif %', r#>'{items,0}'; end if; c := c+1;
  perform api.handle('NTF_READ', '{}', sm);
  r := api.handle('NTF_LIST', '{}', sm); if (r->>'unread')::int <> 0 then raise exception 'read %', r->>'unread'; end if; c := c+1;
  raise exception 'ALL_NOTIF_TESTS_PASSED (%)', c;
end $$;
