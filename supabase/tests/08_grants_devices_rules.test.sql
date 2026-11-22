-- اختبار المنح والأجهزة بعد قرارات المستخدم (migration 17) — 12 فحصاً نجحت 22 نوفمبر 2026، ينتهي بـ ALL_DECISION_TESTS_PASSED ويرجع كل شيء
-- (فحوص الإصدار الأول — فصل المهام على المدير ودورة أقساط الأجهزة — أُلغيت بقرار المستخدم؛ نص الإصدار الأول في سجل git)
-- وفاة الزوجة 500 والأب 300 · لا منحة لوفاة العضو · المولود موقوف · المدير يقدّم ويراجع ويعتمد ويصرف ·
-- مبلغ استثنائي يلزمه موافقة رئيس المجلس · الأجهزة حجز فقط بلا أي قيد مالي · المدير يرى كل الصلاحيات.
do $$ declare pm uuid; ua uuid; um uuid; sa jsonb; sm jsonb; r jsonb; g uuid; off uuid; itm uuid; ord uuid; n0 bigint; c int := 0; begin
  insert into core.persons(job_id, national_id, full_name) values ('ZZ-X1','29900000005555','عضو اختبار') returning id into pm;
  insert into core.person_movements(person_id, kind, field, to_value, effective_date) values (pm,'انضمام','union_org','النقابة العامة','2020-01-01'),(pm,'تعيين','member_state','نشط','2020-01-01');
  insert into core.users(username, active) values ('zz_x_a',true) returning id into ua; insert into core.user_roles values (ua,'SYS_ADMIN');
  insert into core.users(person_id, username, active) values (pm,'zz_x_m',true) returning id into um; insert into core.user_roles values (um,'MEMBER');
  sa := jsonb_build_object('uid',ua); sm := jsonb_build_object('uid',um,'pid',pm);
  r := api.handle('GRT_APPLY', jsonb_build_object('type','DEATH','event_date',current_date-3,'subject_name','زوجة اختبار','subject_relation','زوجة'), sm);
  if (r#>>'{request,amount}')::numeric <> 500 then raise exception 'زوجة %', r; end if; c := c+1;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','DEATH','event_date',current_date-3,'subject_name','أب اختبار','subject_relation','أب'), sm);
  if (r#>>'{request,amount}')::numeric <> 300 then raise exception 'أب %', r; end if; c := c+1;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','DEATH','event_date',current_date-3,'subject_relation','العضو'), sm);
  if (r->>'success')::boolean then raise exception 'وفاة العضو'; end if; c := c+1;
  r := api.handle('GRT_APPLY', jsonb_build_object('type','BIRTH','event_date',current_date-3), sm);
  if (r->>'success')::boolean then raise exception 'مولود موقوف'; end if; c := c+1;
  r := api.handle('GRT_APPLY', jsonb_build_object('jobId','ZZ-X1','type','MARRIAGE','event_date',current_date-3), sa); g := r#>>'{request,id}';
  r := api.handle('GRT_REVIEW', jsonb_build_object('requestId',g,'docs','[{"name":"قسيمة الزواج","received":true}]'::jsonb), sa);
  if r->>'status' <> 'مستوفى' then raise exception 'مراجعة المدير %', r; end if; c := c+1;
  r := api.handle('GRT_DECIDE', jsonb_build_object('requestId',g,'approve',true,'amount',700), sa);
  if (r->>'success')::boolean then raise exception 'استثناء بلا موافقة'; end if; c := c+1;
  r := api.handle('GRT_DECIDE', jsonb_build_object('requestId',g,'approve',true,'amount',700,'exception_note','موافقة رئيس المجلس'), sa);
  if r#>>'{request,status}' <> 'معتمد' then raise exception 'اعتماد %', r; end if; c := c+1;
  r := api.handle('GRT_PAY', jsonb_build_object('requestId',g,'cheque_no','ZZ-77'), sa);
  if r#>>'{request,status}' <> 'مصروف' or not exists (select 1 from benefits.ledger where person_id = pm and amount = 700) then raise exception 'صرف %', r; end if; c := c+1;
  select count(*) into n0 from finance.entries;
  r := api.handle('DEV_SAVE', jsonb_build_object('offer', jsonb_build_object('title','ZZ','supplier','ZZ','contact','010',
        'items', jsonb_build_array(jsonb_build_object('name','غسالة','offer_price',6500,'market_price',7000,'max_months',6)))), sa); off := r->>'id';
  select id into itm from activities.dev_items where offer_id = off;
  perform api.handle('DEV_SET_STATUS', jsonb_build_object('offerId',off,'status','الطلب مفتوح'), sa);
  r := api.handle('DEV_ORDER', jsonb_build_object('itemId',itm,'method','تقسيط','months',6), sm); ord := r#>>'{order,id}';
  if not (r->>'success')::boolean then raise exception 'حجز %', r; end if;
  r := api.handle('DEV_DECIDE', jsonb_build_object('orderId',ord,'status','مسلّم'), sa);
  if (r->>'success')::boolean then raise exception 'تسليم قبل التأكيد'; end if;
  perform api.handle('DEV_DECIDE', jsonb_build_object('orderId',ord,'status','مؤكد'), sa);
  r := api.handle('DEV_DECIDE', jsonb_build_object('orderId',ord,'status','مسلّم'), sa);
  if r#>>'{order,status}' <> 'مسلّم' then raise exception 'تسليم %', r; end if;
  if (select count(*) from finance.entries) <> n0 then raise exception 'قيود في الأجهزة!'; end if; c := c+3;
  r := api.handle('GET_ME', '{}', sa);
  if not (r->'perms' ? 'treasury.cheque.issue') then raise exception 'perms %', r->'perms'; end if; c := c+1;
  raise exception 'ALL_DECISION_TESTS_PASSED (%)', c;
end $$;
