-- اختبار المصايف (39 فحصاً — نجحت 22 نوفمبر 2026، ينتهي بـ ALL_SUMMER_TESTS_PASSED ويرجع كل شيء)
-- السيناريو: موسم قرعة، مصيف بشقتين (4 و6 سراير) × فوجين = 4 خانات؛ 6 متقدمين (واحد نقابة مستقلة، وواحد استفاد قبل كده)؛
-- القرعة قابلة للتحقق (إعادة حساب المفاتيح والهاش)؛ 4 مقبولين و2 احتياطي؛ السداد ⇒ 4201؛ الاعتذار بالشروط ⇒ رد + تصعيد أول احتياطي؛
-- تبديل فوج لخانة فاضية؛ تبادل بموافقة الطرف الآخر ثم الإدارة؛ محضر تسليم (تأمين 2202) واستلام بتلفيات (خصم 4901 ورد الباقي)؛
-- الإقفال: الدعم لمستحقيه في سجل المزايا + استحقاق المالك 5302/2101.
do $$
declare adm uuid; s jsonb; r jsonb; sid uuid; dec uuid; ppl uuid[]; jobs text[]; uids uuid[]; i int; apps jsonb; a1 jsonb; tmp uuid;
        sess jsonb[]; v_hash text; v_order text; b1 uuid; b2 uuid; n int; checks int := 0; v_app uuid; v_app2 uuid; sw uuid; resv text;
begin
  select id into adm from core.users where username = 'admin';
  s := jsonb_build_object('uid', adm);
  -- أمين صندوق للاختبار (فصل المهام: التحصيل لـ TREASURER)
  insert into core.users(person_id, username, password_hash, password_salt, active) values ((select person_id from core.users where id = adm), 'zz_sum_tr', 'x', 'x', true) returning id into tmp;
  insert into core.user_roles(user_id, role) values (tmp, 'TREASURER'), (tmp, 'SYS_ADMIN');
  s := jsonb_build_object('uid', tmp);
  select id into dec from governance.decisions limit 1;
  -- 6 أشخاص حقيقيين نشطين في النقابة العامة (داخل معاملة تُرجع)
  select array_agg(id), array_agg(job_id) into ppl, jobs from (select id, job_id from core.persons
    where job_id is not null and core.is_union_beneficiary(id, '2027-07-01') order by job_id limit 6) q;
  -- مستخدمو أعضاء
  uids := array[]::uuid[]; sess := array[]::jsonb[];
  for i in 1..6 loop
    insert into core.users(person_id, username, password_hash, password_salt, active) values (ppl[i], 'zz_sum' || i, 'x', 'x', true) returning id into tmp;
    insert into core.user_roles(user_id, role) values (tmp, 'MEMBER');
    uids := uids || tmp; sess := sess || jsonb_build_object('uid', tmp, 'pid', ppl[i]);
  end loop;
  -- العضو 6 «نقابة مستقلة» ⇒ غير مستحق للدعم
  insert into core.person_movements(person_id, kind, field, to_value, effective_date) values (ppl[6], 'انتقال إلى نقابة مستقلة', 'union_org', 'نقابة مستقلة', '2026-01-01');
  -- العضو 5 استفاد من مصيف 2026
  perform benefits.record(ppl[5], '2026-08-01', 'دعم', 'دعم مصيف', 500, 'يدوي', 'ZZ-SUM-PRIOR');

  -- إنشاء الموسم
  r := api.handle('SUM_SAVE', jsonb_build_object('season', jsonb_build_object('title','ZZ مصيف اختبار','year',2027,'method','أولوية لمن لم يستفد',
        'decision_id', dec, 'batches', jsonb_build_array(jsonb_build_object('name','فوج 1','start_date','2027-07-01','end_date','2027-07-07'),
                                                          jsonb_build_object('name','فوج 2','start_date','2027-07-08','end_date','2027-07-14')),
        'resorts', jsonb_build_array(jsonb_build_object('name','ZZ رأس البر','owner_party','ZZ شركة المالك','units', jsonb_build_array(
            jsonb_build_object('code','A1','unit_type','شقة','beds',4,'full_price',3000,'member_price',1000,'deposit',500,'owner_cost',2500),
            jsonb_build_object('code','A2','unit_type','شقة','beds',6,'full_price',4000,'member_price',1500,'deposit',500,'owner_cost',3500)))))), s);
  if not (r->>'success')::boolean then raise exception 'SAVE: %', r; end if;
  sid := (r#>>'{season,id}'); checks := checks + 1;
  select id into b1 from activities.summer_batches where season_id = sid and name = 'فوج 1';
  select id into b2 from activities.summer_batches where season_id = sid and name = 'فوج 2';
  if not exists (select 1 from finance.cost_centers where code = r#>>'{season,code}') then raise exception 'مركز التكلفة'; end if; checks := checks + 1;

  -- العضو لا يدير
  r := api.handle('SUM_SAVE', jsonb_build_object('season', jsonb_build_object('title','x','year',2027)), sess[1]);
  if (r->>'success')::boolean then raise exception 'العضو أنشأ موسماً'; end if; checks := checks + 1;
  -- التقديم مقفول في المسودة
  r := api.handle('SUM_APPLY', jsonb_build_object('seasonId', sid, 'prefs', jsonb_build_array(jsonb_build_object('batch_id', b1))), sess[1]);
  if (r->>'success')::boolean then raise exception 'تقديم في مسودة'; end if; checks := checks + 1;
  r := api.handle('SUM_SET_STATUS', jsonb_build_object('seasonId', sid, 'status','التقديم مفتوح'), s);
  if not (r->>'success')::boolean then raise exception 'OPEN %', r; end if;

  -- التقديم: الكل يفضّل فوج 1 ثم فوج 2؛ العضو 2 بأسرة 5 أفراد (يلزمه A2)
  for i in 1..6 loop
    r := api.handle('SUM_APPLY', jsonb_build_object('seasonId', sid, 'prefs', jsonb_build_array(jsonb_build_object('batch_id', b1), jsonb_build_object('batch_id', b2)),
          'people', case when i = 2 then '[{"full_name":"ف1"},{"full_name":"ف2"},{"full_name":"ف3"},{"full_name":"ف4"}]'::jsonb else '[]'::jsonb end), sess[i]);
    if not (r->>'success')::boolean then raise exception 'APPLY % %', i, r; end if;
  end loop;
  checks := checks + 1;
  -- لا طلب مكرر، ولا أسرة أكبر من أي وحدة
  r := api.handle('SUM_APPLY', jsonb_build_object('seasonId', sid, 'prefs', jsonb_build_array(jsonb_build_object('batch_id', b1))), sess[1]);
  if (r->>'success')::boolean then raise exception 'طلب مكرر'; end if; checks := checks + 1;
  if (select prior_benefit from activities.summer_applications where season_id = sid and person_id = ppl[5]) is not true then raise exception 'prior'; end if;
  if (select eligible from activities.summer_applications where season_id = sid and person_id = ppl[6]) then raise exception 'eligible مستقلة'; end if; checks := checks + 2;

  -- لا توزيع والتقديم مفتوح
  r := api.handle('SUM_ALLOCATE', jsonb_build_object('seasonId', sid, 'seed','12345'), s);
  if (r->>'success')::boolean then raise exception 'توزيع والتقديم مفتوح'; end if; checks := checks + 1;
  perform api.handle('SUM_SET_STATUS', jsonb_build_object('seasonId', sid, 'status','التقديم مقفول'), s);
  r := api.handle('SUM_ALLOCATE', jsonb_build_object('seasonId', sid, 'seed','سحب-علني-777'), s);
  if not (r->>'success')::boolean then raise exception 'ALLOC %', r; end if;
  if (r#>>'{result,accepted}')::int <> 4 or (r#>>'{result,reserve}')::int <> 2 then raise exception 'ALLOC counts %', r; end if; checks := checks + 1;
  -- التحقق المستقل من القرعة
  if exists (select 1 from activities.summer_applications where season_id = sid and draw_key <> encode(sha256(convert_to('سحب-علني-777|' || app_no,'UTF8')),'hex')) then
    raise exception 'مفاتيح القرعة'; end if;
  select string_agg(app_no, ',' order by rank) into v_order from activities.summer_applications where season_id = sid;
  if (select lottery_hash from activities.summer_seasons where id = sid) <> encode(sha256(convert_to(v_order,'UTF8')),'hex') then raise exception 'hash'; end if; checks := checks + 2;
  -- من استفاد قبل كده في آخر الترتيب (أولوية لمن لم يستفد)
  if (select rank from activities.summer_applications where season_id = sid and person_id = ppl[5]) <> 6 then raise exception 'ترتيب الأولوية'; end if; checks := checks + 1;
  -- العضو 2 (5 أفراد) في A2
  if (select u.code from activities.summer_applications ap join activities.summer_units u on u.id = ap.unit_id where ap.season_id = sid and ap.person_id = ppl[2]) is distinct from 'A2'
     and (select status from activities.summer_applications where season_id = sid and person_id = ppl[2]) <> 'احتياطي' then raise exception 'سعة'; end if; checks := checks + 1;
  -- لا توزيع ثانٍ
  r := api.handle('SUM_ALLOCATE', jsonb_build_object('seasonId', sid, 'seed','x'), s);
  if (r->>'success')::boolean then raise exception 'توزيع مرتين'; end if; checks := checks + 1;

  -- السداد: العضو لا يحصّل، الزيادة مرفوضة، الكامل يؤكد
  select id into v_app from activities.summer_applications where season_id = sid and status = 'بانتظار السداد' and eligible order by rank limit 1;
  r := api.handle('SUM_PAY', jsonb_build_object('applicationId', v_app, 'amount', 100), sess[1]);
  if (r->>'success')::boolean then raise exception 'عضو حصّل'; end if;
  r := api.handle('SUM_PAY', jsonb_build_object('applicationId', v_app, 'amount', 99999), s);
  if (r->>'success')::boolean then raise exception 'سداد زائد'; end if; checks := checks + 2;
  for v_app2 in select id from activities.summer_applications where season_id = sid and status = 'بانتظار السداد' loop
    r := api.handle('SUM_PAY', jsonb_build_object('applicationId', v_app2, 'amount', (select total from activities.summer_applications where id = v_app2)), s);
    if not (r->>'success')::boolean then raise exception 'PAY %', r; end if;
  end loop;
  if exists (select 1 from activities.summer_applications where season_id = sid and status = 'بانتظار السداد') then raise exception 'تأكيد'; end if;
  if (select sum(credit) from finance.lines l join finance.entries e on e.id = l.entry_id where l.account = '4201' and l.cost_center = (select code from activities.summer_seasons where id = sid))
     <> (select sum(paid) from activities.summer_applications where season_id = sid) then raise exception '4201'; end if; checks := checks + 2;
  -- غير المستحق يدفع الكامل
  if exists (select 1 from activities.summer_applications ap join activities.summer_units u on u.id = ap.unit_id where ap.season_id = sid and not ap.eligible and ap.total <> u.full_price) then
    raise exception 'سعر المستقلة'; end if; checks := checks + 1;

  -- الاعتذار (قبل الفوج بأكتر من 14 يوم ⇒ 100%) ⇒ يصعد أول احتياطي
  select ap.reserve_rank, ap.app_no into n, resv from activities.summer_applications ap where season_id = sid and status = 'احتياطي' order by reserve_rank limit 1;
  select id into v_app from activities.summer_applications where season_id = sid and status = 'مؤكد' and person_id <> ppl[2] order by rank limit 1;
  r := api.handle('SUM_APOLOGIZE_MY', jsonb_build_object('applicationId', v_app, 'reason','ظروف'),
        sess[array_position(ppl, (select person_id from activities.summer_applications where id = v_app))]);
  if not (r->>'success')::boolean or (r->>'refund')::numeric <> (select refunded from activities.summer_applications where id = v_app) or (r->>'refund')::numeric = 0 then raise exception 'APOLOGY %', r; end if;
  if (select status from activities.summer_applications where app_no = resv) <> 'بانتظار السداد' then raise exception 'التصعيد'; end if;
  if not exists (select 1 from activities.summer_events e join activities.summer_applications a on a.id = e.application_id where a.app_no = resv and e.kind = 'تصعيد') then raise exception 'سجل التصعيد'; end if;
  checks := checks + 3;
  -- سقوط مهلة المُصعَّد ⇒ يصعد التالي
  update activities.summer_applications set hold_until = now() - interval '1 hour' where app_no = resv;
  perform activities.sum_housekeep(sid);
  if (select status from activities.summer_applications where app_no = resv) <> 'ملغى' then raise exception 'سقوط المهلة'; end if;
  if exists (select 1 from activities.summer_applications where season_id = sid and status = 'احتياطي') then raise exception 'التصعيد الثاني'; end if; checks := checks + 2;
  for v_app2 in select id from activities.summer_applications where season_id = sid and status = 'بانتظار السداد' loop
    perform api.handle('SUM_PAY', jsonb_build_object('applicationId', v_app2, 'amount', (select total from activities.summer_applications where id = v_app2)), s);
  end loop;

  -- تبديل فوج: يلزم خانة فاضية ⇒ نعتذر واحد عشان تفضى خانة في فوج 2 ثم نطلب نقل من فوج 1 لها
  select id into v_app from activities.summer_applications where season_id = sid and status = 'مؤكد' and batch_id = b2 order by rank limit 1;
  perform api.handle('SUM_APOLOGIZE', jsonb_build_object('applicationId', v_app, 'reason','ZZ اختبار'), s);
  select id into v_app2 from activities.summer_applications ap where season_id = sid and status = 'مؤكد' and batch_id = b1
    and (select beds from activities.summer_units where id = ap.unit_id) = (select beds from activities.summer_units where id = (select unit_id from activities.summer_applications where id = v_app)) limit 1;
  if v_app2 is not null then
    r := api.handle('SUM_SWAP_REQUEST_MY', jsonb_build_object('applicationId', v_app2, 'kind','تبديل فوج', 'batch_id', b2),
          sess[array_position(ppl, (select person_id from activities.summer_applications where id = v_app2))]);
    if not (r->>'success')::boolean then raise exception 'SWAPREQ %', r; end if;
    r := api.handle('SUM_SWAP_DECIDE', jsonb_build_object('swapId', r->>'swapId', 'approve', true), s);
    if not (r->>'success')::boolean then raise exception 'SWAPDEC %', r; end if;
    if (select batch_id from activities.summer_applications where id = v_app2) <> b2 then raise exception 'تبديل الفوج'; end if;
    checks := checks + 1;
  else raise exception 'لم يُختبر تبديل الفوج'; end if;

  -- تبادل بين عضوين مؤكدين
  select id into v_app from activities.summer_applications where season_id = sid and status = 'مؤكد' order by rank limit 1;
  select id into v_app2 from activities.summer_applications where season_id = sid and status = 'مؤكد' and id <> v_app and batch_id <> (select batch_id from activities.summer_applications where id = v_app)
    and family_size <= 4 order by rank limit 1;
  if v_app2 is not null and (select family_size from activities.summer_applications where id = v_app) <= (select beds from activities.summer_units where id = (select unit_id from activities.summer_applications where id = v_app2)) then
    r := api.handle('SUM_SWAP_REQUEST_MY', jsonb_build_object('applicationId', v_app, 'kind','تبادل', 'withApplicationId', v_app2),
          sess[array_position(ppl, (select person_id from activities.summer_applications where id = v_app))]);
    sw := (r->>'swapId')::uuid;
    r := api.handle('SUM_SWAP_DECIDE', jsonb_build_object('swapId', sw, 'approve', true), s);
    if (r->>'success')::boolean then raise exception 'تبادل بلا موافقة الآخر'; end if;
    -- صاحب الطلب لا يوافق بدلاً من الطرف الآخر
    r := api.handle('SUM_SWAP_ACCEPT', jsonb_build_object('swapId', sw), sess[array_position(ppl, (select person_id from activities.summer_applications where id = v_app))]);
    if (r->>'success')::boolean then raise exception 'صاحب الطلب وافق بدل الآخر'; end if;
    r := api.handle('SUM_SWAP_ACCEPT', jsonb_build_object('swapId', sw), sess[array_position(ppl, (select person_id from activities.summer_applications where id = v_app2))]);
    if not (r->>'success')::boolean then raise exception 'ACCEPT %', r; end if;
    tmp := (select batch_id from activities.summer_applications where id = v_app2);
    r := api.handle('SUM_SWAP_DECIDE', jsonb_build_object('swapId', sw, 'approve', true), s);
    if not (r->>'success')::boolean then raise exception 'EXCH %', r; end if;
    if (select batch_id from activities.summer_applications where id = v_app) <> tmp then raise exception 'التبادل'; end if;
    checks := checks + 3;
  else raise exception 'لم يُختبر التبادل'; end if;

  -- التسليم والاستلام
  select id into v_app from activities.summer_applications where season_id = sid and status = 'مؤكد' order by rank limit 1;
  r := api.handle('SUM_HANDOVER', jsonb_build_object('applicationId', v_app, 'kind','استلام'), s);
  if (r->>'success')::boolean then raise exception 'استلام قبل تسليم'; end if;
  r := api.handle('SUM_HANDOVER', jsonb_build_object('applicationId', v_app, 'kind','تسليم', 'condition','سليمة'), s);
  if not (r->>'success')::boolean or (select deposit_held from activities.summer_applications where id = v_app) <> 500 then raise exception 'تسليم %', r; end if;
  r := api.handle('SUM_APOLOGIZE', jsonb_build_object('applicationId', v_app, 'reason','x'), s);
  if (r->>'success')::boolean then raise exception 'اعتذار بعد التسليم'; end if;
  r := api.handle('SUM_HANDOVER', jsonb_build_object('applicationId', v_app, 'kind','استلام', 'damages', 120, 'notes','كسر كوب'), s);
  if not (r->>'success')::boolean or (r#>>'{result,deducted}')::numeric <> 120 or (r#>>'{result,returned}')::numeric <> 380 then raise exception 'استلام %', r; end if;
  if (select coalesce(sum(credit - debit),0) from finance.lines where account = '2202' and cost_center = (select code from activities.summer_seasons where id = sid)) <> 0 then raise exception '2202 لم يتصفر'; end if;
  checks := checks + 5;

  -- الإقفال: ليس قبل نهاية آخر فوج
  r := api.handle('SUM_CLOSE', jsonb_build_object('seasonId', sid), s);
  if (r->>'success')::boolean then raise exception 'إقفال مبكر'; end if;
  update activities.summer_batches set start_date = start_date - 400, end_date = end_date - 400 where season_id = sid;
  r := api.handle('SUM_CLOSE', jsonb_build_object('seasonId', sid), s);
  if not (r->>'success')::boolean then raise exception 'CLOSE %', r; end if;
  if (select count(*) from benefits.ledger where source_ref like 'SUM:' || sid || ':%') <>
     (select count(*) from activities.summer_applications where season_id = sid and status = 'منتهٍ' and eligible and subsidy > 0) or
     (select count(*) from benefits.ledger where source_ref like 'SUM:' || sid || ':%') = 0 then raise exception 'المزايا'; end if;
  if exists (select 1 from benefits.ledger where source_ref like 'SUM:' || sid || ':%' and person_id = ppl[6]) then raise exception 'دعم لغير مستحق'; end if;
  if (select sum(credit) from finance.lines where account = '2101' and party = 'ZZ شركة المالك') <>
     (select sum(u.owner_cost) from activities.summer_applications ap join activities.summer_units u on u.id = ap.unit_id where ap.season_id = sid and ap.status = 'منتهٍ') then raise exception '2101'; end if;
  checks := checks + 4;
  -- ميزاني في «استفاداتي»؟ الـ api.sum_app_json للعضو
  r := api.handle('SUM_MY', '{}', sess[1]);
  if not (r->>'success')::boolean then raise exception 'MY'; end if; checks := checks + 1;
  set constraints all immediate;
  raise exception 'ALL_SUMMER_TESTS_PASSED (%)', checks;
end $$;
