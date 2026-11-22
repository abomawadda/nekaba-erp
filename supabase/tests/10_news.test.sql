-- اختبار الأخبار (7 فحوص — نجحت 22 نوفمبر 2026، ينتهي بـ ALL_NEWS_TESTS_PASSED ويرجع كل شيء)
-- العضو لا ينشر؛ المثبت أولاً؛ المنتهي لا يظهر؛ النشر يرسل إشعاراً عاماً؛ الإخفاء يخفي عن العضو ويبقى ظاهراً للمسئول في «الكل».
do $$ declare pm uuid; ub uuid; um uuid; sb jsonb; sm jsonb; r jsonb; n1 uuid; c int := 0; begin
  insert into core.persons(job_id, national_id, full_name) values ('ZZ-W1','29900000007777','عضو اختبار الأخبار') returning id into pm;
  insert into core.person_movements(person_id, kind, field, to_value, effective_date) values (pm,'انضمام','union_org','النقابة العامة','2020-01-01'),(pm,'تعيين','member_state','نشط','2020-01-01');
  insert into core.users(username, active) values ('zz_w_b',true) returning id into ub; insert into core.user_roles values (ub,'BOARD');
  insert into core.users(person_id, username, active) values (pm,'zz_w_m',true) returning id into um; insert into core.user_roles values (um,'MEMBER');
  sb := jsonb_build_object('uid',ub); sm := jsonb_build_object('uid',um,'pid',pm);
  perform api.handle('NTF_READ', '{}', sm);
  r := api.handle('NEWS_SAVE', '{"news":{"title":"x"}}', sm); if (r->>'success')::boolean then raise exception 'عضو نشر'; end if; c := c+1;
  r := api.handle('NEWS_SAVE', '{"news":{"title":"ZZ اجتماع الجمعية العمومية","category":"موعد","body":"يوم الخميس"}}', sb); n1 := r->>'id';
  r := api.handle('NEWS_SAVE', '{"news":{"title":"ZZ مثبت","pinned":true}}', sb);
  r := api.handle('NEWS_SAVE', '{"news":{"title":"ZZ منتهي","expires_at":"2020-01-01"}}', sb);
  r := api.handle('NEWS_LIST', '{}', sm);
  if r#>>'{items,0,title}' <> 'ZZ مثبت' then raise exception 'pinned %', r; end if;
  if exists (select 1 from jsonb_array_elements(r->'items') x where x->>'title' = 'ZZ منتهي') then raise exception 'expired shown'; end if;
  if (r->>'canManage')::boolean then raise exception 'member canManage'; end if; c := c+3;
  r := api.handle('NTF_LIST', '{}', sm);
  if (r->>'unread')::int <> 3 or not exists (select 1 from jsonb_array_elements(r->'items') x where x->>'title' = '📅 ZZ اجتماع الجمعية العمومية') then raise exception 'notif %', r; end if; c := c+1;
  perform api.handle('NEWS_HIDE', jsonb_build_object('id', n1), sb);
  r := api.handle('NEWS_LIST', '{}', sm);
  if exists (select 1 from jsonb_array_elements(r->'items') x where x->>'id' = n1::text) then raise exception 'hidden shown'; end if;
  r := api.handle('NEWS_LIST', '{"all":true}', sb);
  if not exists (select 1 from jsonb_array_elements(r->'items') x where x->>'id' = n1::text and not (x->>'active')::boolean) then raise exception 'manager all'; end if; c := c+2;
  raise exception 'ALL_NEWS_TESTS_PASSED (%)', c;
end $$;
