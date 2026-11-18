-- اختبار واجهة الخادم api.handle — 30 فحصاً، ينتهي بـ ALL_API_TESTS_PASSED ويرجع كل شيء
-- (نفس النص المُشغَّل في 18 نوفمبر 2026؛ راجع سجل الجلسة)
do $$
declare p uuid; adm uuid; r jsonb; ms jsonb; asn jsonb; fid text; rid uuid;
begin
  insert into core.persons(job_id, national_id, full_name, phone) values ('T-9','28501011234577','عضو تجريبي','01000000001') returning id into p;
  insert into core.person_movements(person_id,kind,field,to_value,effective_date) values (p,'x','union_org','النقابة العامة','2020-01-01'),(p,'x','member_state','نشط','2020-01-01');
  r := api.handle('LOGIN_MEMBER','{"jobId":"T-9","secret":"9999"}',null); assert not (r->>'success')::bool, 'wrong secret rejected';
  r := api.handle('LOGIN_MEMBER','{"jobId":"T-9","secret":"4577"}',null); assert (r->>'success')::bool, 'login by nid4';
  assert r->'roles' ? 'MEMBER', 'member role'; ms := r->'session';
  r := api.handle('LOGIN_MEMBER','{"jobId":"T-9","secret":"01000000001"}',null); assert (r->>'success')::bool, 'login by phone';
  r := api.handle('GET_ME','{}',ms); assert (r->'profile'->'person'->>'union_org')='النقابة العامة' and (r->'profile'->>'eligibleToday')::bool, 'get me';
  assert (r->'profile'->'completeness'->>'percent')::int < 100, 'completeness';
  r := api.handle('UPDATE_MY_PROFILE','{"fields":{"address":"المنصورة","marital_status":"متزوج"}}',ms); assert (r->>'success')::bool, 'self edit';
  assert r->'profile'->'completeness'->'missing' ? 'بيانات الأسرة', 'married needs family';
  r := api.handle('UPDATE_MY_PROFILE','{"fields":{"full_name":"تغيير"}}',ms); assert not (r->>'success')::bool, 'admin field blocked';
  r := api.handle('UPDATE_MY_PROFILE','{"fields":{"phone":"123"}}',ms); assert not (r->>'success')::bool, 'bad phone';
  assert (select phone from core.persons where id=p)='01000000001', 'bad phone not saved';
  r := api.handle('SAVE_MY_FAMILY_MEMBER','{"member":{"full_name":"مريم","relation":"ابنة","birth_date":"2015-05-01","edu_stage":"ابتدائي","edu_grade":"5"}}',ms);
  assert (r->>'success')::bool and jsonb_array_length(r->'profile'->'family')=1, 'add kid'; fid := r->>'id';
  r := api.handle('SAVE_MY_FAMILY_MEMBER','{"member":{"full_name":"x","relation":"قطة"}}',ms); assert not (r->>'success')::bool, 'bad relation';
  r := api.handle('REMOVE_MY_FAMILY_MEMBER',jsonb_build_object('id',fid),ms); assert jsonb_array_length(r->'profile'->'family')=0, 'remove = deactivate';
  assert (select count(*) from core.family_members where person_id=p)=1, 'history kept';
  r := api.handle('SEARCH_PERSONS','{}',ms); assert not (r->>'success')::bool, 'member cannot search';
  r := api.handle('REQUEST_CHANGE','{"field":"workplace","newValue":"طلخا","reason":"نُقلت"}',ms); assert (r->>'success')::bool, 'request';
  r := api.handle('REQUEST_CHANGE','{"field":"workplace","newValue":"أجا"}',ms); assert not (r->>'success')::bool, 'dup request';
  insert into core.users(username,password_hash,must_change) values ('t_admin',extensions.crypt('Secret123!',extensions.gen_salt('bf',4)),false) returning id into adm;
  insert into core.user_roles(user_id,role) values (adm,'SYS_ADMIN');
  r := api.handle('LOGIN_ADMIN','{"username":"t_admin","password":"bad"}',null); assert not (r->>'success')::bool, 'admin bad pw';
  r := api.handle('LOGIN_ADMIN','{"username":"T_ADMIN","password":"Secret123!"}',null); assert (r->>'success')::bool, 'admin login'; asn := r->'session';
  r := api.handle('SEARCH_PERSONS','{"q":"تجريبي"}',asn); assert jsonb_array_length(r->'items')>=1, 'admin search';
  r := api.handle('LIST_CHANGE_REQUESTS','{}',asn); rid := (r->'items'->0->>'id')::uuid;
  r := api.handle('DECIDE_CHANGE_REQUEST',jsonb_build_object('id',rid,'approve',false),asn); assert not (r->>'success')::bool, 'reject needs note';
  r := api.handle('DECIDE_CHANGE_REQUEST',jsonb_build_object('id',rid,'approve',true),asn); assert (r->>'success')::bool, 'approve';
  assert core.state_at(p,'workplace')='طلخا', 'movement applied';
  r := api.handle('ADD_MOVEMENT',jsonb_build_object('personId',p,'field','union_org','toValue','نقابة مستقلة','effectiveDate',current_date::text,'kind','انتقال إلى نقابة مستقلة'),asn);
  assert (r->>'success')::bool and not (r->'profile'->>'eligibleToday')::bool, 'moved to independent';
  r := api.handle('GET_ME','{}',ms); assert r->'roles' ? 'NON_MEMBER' and not (r->'roles' ? 'MEMBER'), 'role switched';
  r := api.handle('SAVE_PERSON',jsonb_build_object('id',p,'fields',jsonb_build_object('union_org','x')),asn); assert not (r->>'success')::bool, 'movement field via save blocked';
  assert (select count(*) from audit.log where actor=adm::text)>=2, 'admin actions audited';
  r := api.handle('GET_ME','{}','{"uid":"00000000-0000-0000-0000-000000000000"}'); assert (r->>'expired')::bool, 'unknown session';
  raise exception 'ALL_API_TESTS_PASSED';
end $$;
