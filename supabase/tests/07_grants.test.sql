-- اختبار منح المناسبات (27 فحصاً — نجحت 22 نوفمبر 2026، ينتهي بـ ALL_GRANTS_TESTS_PASSED ويرجع كل شيء)
-- التقديم بمبلغ من الجدول، منع التكرار، الصلات المقبولة، المهلة، استبعاد النقابة المستقلة، الحد السنوي للعلاج،
-- المراجعة (ناقص ← مستوفى)، الاعتماد (مبلغ مختلف أو نوع بلا مبلغ يلزمه قرار)، فصل المهام، الصرف بشيك ⇒ قيد 5102 + سجل المزايا.
do $$
declare pm uuid; pind uuid; fm uuid; um uuid; uind uuid; urev uuid; uapp uuid; utr uuid; sm jsonb; sind jsonb; srev jsonb; sapp jsonb; str jsonb;
        r jsonb; g1 uuid; g2 uuid; g3 uuid; dec uuid; checks int := 0;
begin
  select id into dec from governance.decisions limit 1;
  insert into core.persons(job_id, national_id, full_name) values ('ZZ-G1','29900000001111','عضو اختبار المنح') returning id into pm;
  insert into core.persons(job_id, national_id, full_name) values ('ZZ-G2','29900000002222','عضو مستقل اختبار') returning id into pind;
  insert into core.person_movements(person_id, kind, field, to_value, effective_date) values
    (pm,'انضمام','union_org','النقابة العامة','2020-01-01'),(pm,'تعيين','member_state','نشط','2020-01-01'),
    (pind,'انضمام','union_org','نقابة مستقلة','2020-01-01'),(pind,'تعيين','member_state','نشط','2020-01-01');
  insert into core.family_members(person_id, full_name, relation) values (pm,'ابن اختبار','ابن') returning id into fm;
  insert into core.users(person_id, username, active) values (pm,'zz_g_m',true) returning id into um; insert into core.user_roles values (um,'MEMBER');
  insert into core.users(person_id, username, active) values (pind,'zz_g_i',true) returning id into uind; insert into core.user_roles values (uind,'MEMBER');
  insert into core.users(username, active) values ('zz_g_rev',true) returning id into urev; insert into core.user_roles values (urev,'BOARD');
  insert into core.users(username, active) values ('zz_g_app',true) returning id into uapp; insert into core.user_roles values (uapp,'SYS_ADMIN');
  insert into core.users(username, active) values ('zz_g_tr',true) returning id into utr; insert into core.user_roles values (utr,'TREASURER');
  sm := jsonb_build_object('uid',um,'pid',pm); sind := jsonb_build_object('uid',uind,'pid',pind);
  srev := jsonb_build_object('uid',urev); sapp := jsonb_build_object('uid',uapp); str := jsonb_build_object('uid',utr);

  r := api.handle('GRT_TYPES', '{}', sm);
  if not (r->>'success')::boolean or jsonb_array_length(r->'items') <> 5 then raise exception 'TYPES %', r; end if; checks := checks + 1;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','MARRIAGE','event_date', current_date - 10), sm);
  if not (r->>'success')::boolean or (r#>>'{request,amount}')::numeric <> 300 or r#>>'{request,status}' <> 'مقدَّم' then raise exception 'APPLY %', r; end if;
  g1 := r#>>'{request,id}'; checks := checks + 1;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','MARRIAGE','event_date', current_date - 5), sm);
  if (r->>'success')::boolean then raise exception 'تكرار الزواج'; end if; checks := checks + 1;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','BIRTH','event_date', current_date - 3, 'family_member_id', fm), sm);
  if not (r->>'success')::boolean or (r#>>'{request,amount}') is not null then raise exception 'BIRTH %', r; end if; g2 := r#>>'{request,id}'; checks := checks + 1;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','DEATH','event_date', current_date - 3, 'subject_name','فلان','subject_relation','أخ'), sm);
  if (r->>'success')::boolean then raise exception 'صلة غير مقبولة'; end if; checks := checks + 1;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','DEATH','event_date', current_date - 200, 'subject_name','فلان','subject_relation','أب'), sm);
  if (r->>'success')::boolean then raise exception 'المهلة'; end if; checks := checks + 1;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','MARRIAGE','event_date', current_date - 3), sind);
  if (r->>'success')::boolean then raise exception 'نقابة مستقلة'; end if; checks := checks + 1;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','MEDICAL','event_date', current_date - 3), sm);
  if not (r->>'success')::boolean then raise exception 'MED %', r; end if; g3 := r#>>'{request,id}';
  r := api.handle('GRT_APPLY', jsonb_build_object('type','MEDICAL','event_date', current_date - 2), sm);
  if (r->>'success')::boolean then raise exception 'حد سنوي'; end if; checks := checks + 1;
  r := api.handle('GRT_LIST', '{}', sm);
  if (r->>'success')::boolean then raise exception 'عضو يرى القائمة'; end if; checks := checks + 1;
  -- المراجعة
  r := api.handle('GRT_REVIEW', jsonb_build_object('requestId', g1, 'docs', '[{"name":"قسيمة الزواج","received":false}]'::jsonb), srev);
  if r->>'status' <> 'ناقص مستندات' then raise exception 'REVIEW1 %', r; end if;
  r := api.handle('GRT_DECIDE', jsonb_build_object('requestId', g1, 'approve', true), sapp);
  if (r->>'success')::boolean then raise exception 'اعتماد قبل الاستيفاء'; end if;
  r := api.handle('GRT_REVIEW', jsonb_build_object('requestId', g1, 'docs', '[{"name":"قسيمة الزواج","received":true}]'::jsonb), srev);
  if r->>'status' <> 'مستوفى' then raise exception 'REVIEW2 %', r; end if; checks := checks + 3;
  r := api.handle('GRT_REVIEW', jsonb_build_object('requestId', g1), sm);
  if (r->>'success')::boolean then raise exception 'عضو راجع'; end if; checks := checks + 1;
  -- الاعتماد
  r := api.handle('GRT_DECIDE', jsonb_build_object('requestId', g1, 'approve', true, 'amount', 500), sapp);
  if (r->>'success')::boolean then raise exception 'مبلغ مختلف بلا قرار'; end if;
  r := api.handle('GRT_DECIDE', jsonb_build_object('requestId', g1, 'approve', true), sapp);
  if not (r->>'success')::boolean or r#>>'{request,status}' <> 'معتمد' then raise exception 'APPROVE %', r; end if; checks := checks + 2;
  -- المولود بلا مبلغ مقرر يحتاج قرار
  perform api.handle('GRT_REVIEW', jsonb_build_object('requestId', g2, 'docs', '[{"name":"شهادة الميلاد","received":true}]'::jsonb), srev);
  r := api.handle('GRT_DECIDE', jsonb_build_object('requestId', g2, 'approve', true, 'amount', 400), sapp);
  if (r->>'success')::boolean then raise exception 'بلا قرار'; end if;
  r := api.handle('GRT_DECIDE', jsonb_build_object('requestId', g2, 'approve', true, 'amount', 400, 'decision_id', dec), sapp);
  if not (r->>'success')::boolean then raise exception 'BIRTH APPROVE %', r; end if; checks := checks + 2;
  -- الصرف: المعتمِد لا يصرف حتى لو معه صلاحية الصرف
  insert into core.user_roles values (uapp,'TREASURER');
  r := api.handle('GRT_PAY', jsonb_build_object('requestId', g1, 'cheque_no','ZZ-9001'), sapp);
  if (r->>'success')::boolean then raise exception 'المعتمد صرف'; end if; checks := checks + 1;
  r := api.handle('GRT_PAY', jsonb_build_object('requestId', g1, 'cheque_no','ZZ-9001'), str);
  if not (r->>'success')::boolean or r#>>'{request,status}' <> 'مصروف' then raise exception 'PAY %', r; end if;
  if not exists (select 1 from benefits.ledger where person_id = pm and kind = 'منحة' and amount = 300) then raise exception 'المزايا'; end if;
  if not exists (select 1 from finance.lines l join treasury.cheques c on c.entry_id = l.entry_id where c.cheque_no = 'ZZ-9001' and l.account = '5102' and l.debit = 300) then raise exception 'القيد'; end if;
  checks := checks + 3;
  r := api.handle('GRT_PAY', jsonb_build_object('requestId', g1), str);
  if (r->>'success')::boolean then raise exception 'صرف مرتين'; end if; checks := checks + 1;
  -- الرفض والإلغاء
  r := api.handle('GRT_DECIDE', jsonb_build_object('requestId', g3, 'approve', false), sapp);
  if (r->>'success')::boolean then raise exception 'رفض بلا سبب'; end if;
  r := api.handle('GRT_CANCEL_MY', jsonb_build_object('requestId', g3), sm);
  if not (r->>'success')::boolean then raise exception 'CANCEL %', r; end if;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','MEDICAL','event_date', current_date - 1), sm);
  if not (r->>'success')::boolean then raise exception 'إعادة تقديم بعد الإلغاء %', r; end if; checks := checks + 3;
  r := api.handle('GRT_MY', '{}', sm);
  if jsonb_array_length(r->'items') <> 4 then raise exception 'MY %', jsonb_array_length(r->'items'); end if; checks := checks + 1;
  -- تعديل المبلغ بقرار
  r := api.handle('GRT_SET_RATE', jsonb_build_object('type','BIRTH','amount',350,'decision_id',dec), sapp);
  if grants.rate('BIRTH', 'ابن', current_date) <> 350 then raise exception 'RATE'; end if; checks := checks + 1;
  set constraints all immediate;
  raise exception 'ALL_GRANTS_TESTS_PASSED (%)', checks;
end $$;
