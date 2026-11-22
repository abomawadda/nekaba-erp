-- اختبار الحوكمة — ينتهي بـ ALL_GOV_TESTS_PASSED ويرجع كل شيء
do $$
declare a uuid; b uuid; c uuid; x uuid; adm uuid; t uuid; s jsonb; r jsonb; sa uuid; m uuid; ua uuid;
begin
  insert into core.persons(job_id, full_name) values ('ZG-1','عضو أ اختبار'),('ZG-2','عضو ب اختبار'),('ZG-3','عضو ج اختبار'),('ZG-4','مستقل اختبار');
  select id into a from core.persons where job_id='ZG-1'; select id into b from core.persons where job_id='ZG-2';
  select id into c from core.persons where job_id='ZG-3'; select id into x from core.persons where job_id='ZG-4';
  insert into core.person_movements(person_id,kind,field,to_value,effective_date)
    select id,'x','union_org','النقابة العامة','2000-01-01'::date from core.persons where job_id in ('ZG-1','ZG-2','ZG-3')
    union all select id,'x','member_state','نشط','2000-01-01' from core.persons where job_id like 'ZG-%'
    union all select x,'x','union_org','نقابة مستقلة','2000-01-01';
  insert into core.users(username,password_hash,must_change) values ('zz_gov',extensions.crypt('x',extensions.gen_salt('bf',4)),false) returning id into adm;
  insert into core.user_roles(user_id,role) values (adm,'SYS_ADMIN');
  insert into core.users(person_id,must_change) values (a,false) returning id into ua;  -- عضو له حساب
  s := jsonb_build_object('uid', adm);
  -- الدورة (أوقف الجارية الحقيقية إن وُجدت داخل الاختبار فقط)
  update governance.terms set status='منتهية' where status='جارية';
  r := api.handle('GOV_SAVE_TERM', '{"term":{"title":"دورة اختبار","start_date":"2022-06-01","end_date":"2026-12-31","target_seats":11,"status":"جارية"}}', s);
  assert (r->>'success')::bool, 'save term'; t := (r->'term'->>'id')::uuid;
  -- المقاعد
  r := api.handle('GOV_ADD_SEAT', jsonb_build_object('termId',t,'jobId','ZG-1','role','رئيس المجلس','fromDate','2022-06-01'), s);
  assert (r->>'success')::bool, 'seat president';
  r := api.handle('GOV_ADD_SEAT', jsonb_build_object('termId',t,'jobId','ZG-2','role','رئيس المجلس','fromDate','2023-01-01'), s);
  assert not (r->>'success')::bool and r->>'message' like '%مشغول%', 'single-holder role blocked';
  r := api.handle('GOV_ADD_SEAT', jsonb_build_object('termId',t,'jobId','ZG-1','role','عضو مجلس إدارة','fromDate','2023-01-01'), s);
  assert not (r->>'success')::bool, 'same person overlap blocked';
  r := api.handle('GOV_ADD_SEAT', jsonb_build_object('termId',t,'jobId','ZG-4','role','عضو مجلس إدارة','fromDate','2022-06-01'), s);
  assert not (r->>'success')::bool and r->>'message' like '%النقابة العامة%', 'independent cannot sit';
  r := api.handle('GOV_ADD_SEAT', jsonb_build_object('termId',t,'jobId','ZG-2','role','أمين الصندوق','fromDate','2022-06-01'), s);
  assert (r->>'success')::bool, 'treasurer seat';
  -- الأدوار تتبع المقعد
  assert exists(select 1 from core.user_roles where user_id=ua and role='BOARD'), 'board role synced';
  assert governance.board_role_at(a,'2024-01-01')='رئيس المجلس', 'role at date';
  assert governance.board_role_at(c,'2024-01-01') is null, 'not board';
  -- إنهاء + تغيير منصب
  select id into sa from governance.board_seats where person_id=a;
  r := api.handle('GOV_END_SEAT', jsonb_build_object('seatId',sa,'toDate','2025-01-01','reason','إعادة توزيع','newRole','عضو مجلس إدارة'), s);
  assert (r->>'success')::bool, 'end seat with new role';
  assert governance.board_role_at(a,'2025-06-01')='عضو مجلس إدارة' and governance.board_role_at(a,'2024-06-01')='رئيس المجلس', 'role history';
  r := api.handle('GOV_END_SEAT', jsonb_build_object('seatId',sa,'toDate','2025-01-01'), s);
  assert not (r->>'success')::bool, 'reason required';
  -- الاجتماع والحضور والقرارات
  r := api.handle('GOV_SAVE_MEETING', jsonb_build_object('termId',t,'meeting', jsonb_build_object('title','اجتماع اختبار','meeting_date','2024-03-01',
        'attendance', jsonb_build_array(jsonb_build_object('person_id',a,'status','حاضر'), jsonb_build_object('person_id',b,'status','غائب بعذر')),
        'decisions', jsonb_build_array(jsonb_build_object('text','صرف دعم رحلة','category','دعم نشاط','amount',5000,'votes_for',2),
                                      jsonb_build_object('text','اعتماد المحضر','votes_for',2)))), s);
  assert (r->>'success')::bool, 'save meeting'; m := (r->'meeting'->>'id')::uuid;
  assert (r->'meeting'->>'present')::int=1 and (r->'meeting'->>'seats')::int=2, 'quorum numbers';
  assert r->'meeting'->'decisions'->0->>'decision_no' = (r->'meeting'->>'meeting_no') || '/1', 'decision number';
  r := api.handle('GOV_SAVE_MEETING', jsonb_build_object('termId',t,'meeting', jsonb_build_object('id',m,'title','اجتماع اختبار','meeting_date','2024-03-01',
        'decisions', jsonb_build_array(jsonb_build_object('text','صرف دعم رحلة','category','دعم نشاط','amount',5000)))), s);
  assert not (r->>'success')::bool and r->>'message' like '%لا يُحذف%', 'cannot delete recorded decision';
  r := api.handle('GOV_LIST_DECISIONS', jsonb_build_object('termId',t,'category','دعم نشاط'), s);
  assert jsonb_array_length(r->'items')=1, 'decisions filter';
  -- عضو عادي لا يدير
  r := api.handle('GOV_OVERVIEW', '{}', jsonb_build_object('uid', ua));
  assert (r->>'success')::bool and not (r->>'canManage')::bool, 'board member views, cannot manage';
  r := api.handle('GOV_SAVE_TERM', '{"term":{"title":"x","start_date":"2030-01-01"}}', jsonb_build_object('uid', ua));
  assert not (r->>'success')::bool, 'board member cannot write';
  r := api.handle('GET_ME', '{}', jsonb_build_object('uid', ua, 'pid', a));
  assert jsonb_array_length(r->'profile'->'board')=2, 'profile shows board seats';
  raise exception 'ALL_GOV_TESTS_PASSED';
end $$;
