-- اختبار المرحلة 31: بدل الجلسات من الحضور + التوقيعات الرسمية + متابعة تنفيذ القرارات وربطها المالي
-- التشغيل (لا يترك أثراً): psql "$DB" -v ON_ERROR_STOP=0 -f supabase/tests/12_phase31_governance.test.sql
do $$
declare adm uuid; a text := 'zz_test'; m_id uuid; d_id uuid; c1 uuid; c2 uuid; s1 uuid; r jsonb;
        p1 uuid; p2 uuid; p3 uuid; n int := 0; ok boolean; dt date := current_date;
begin
  select user_id into adm from core.user_roles where role = 'SYS_ADMIN' limit 1;
  select person_id into p1 from governance.board_seats where to_date is null order by from_date, id limit 1 offset 0;
  select person_id into p2 from governance.board_seats where to_date is null order by from_date, id limit 1 offset 1;
  select person_id into p3 from governance.board_seats where to_date is null order by from_date, id limit 1 offset 2;

  -- 1) التهيئة التاريخية: الـ 31 اجتماعاً القديمة مربوطة ببدلاتها المنصرفة، والتوقيعات الثلاثة مكتملة
  assert (select count(*) from governance.meeting_allowances) >= 31, 'ربط بدلات الاجتماعات التاريخية'; n := n + 1;
  r := governance.signatories_at(dt);
  assert nullif(r->>'treasurer','') is not null and nullif(r->>'secretary','') is not null and nullif(r->>'chair','') is not null,
    'التوقيعات الثلاثة: ' || r::text; n := n + 1;

  -- 2) إنشاء اجتماع جديد بحاضرَين وغائب واحد وقرار بسقف 1,000
  r := api.handle_governance('GOV_SAVE_MEETING', jsonb_build_object('meeting', jsonb_build_object(
    'title', 'ZZ اجتماع اختبار 31', 'meeting_date', dt, 'kind', 'عادي', 'venue', 'مقر اللجنة',
    'attendance', jsonb_build_array(
      jsonb_build_object('person_id', p1, 'status', 'حاضر'),
      jsonb_build_object('person_id', p2, 'status', 'حاضر'),
      jsonb_build_object('person_id', p3, 'status', 'غائب بعذر')),
    'decisions', jsonb_build_array(
      jsonb_build_object('text', 'ZZ قرار صرف تجريبي', 'category', 'دعم نشاط', 'amount', 1000, 'votes_for', 2, 'votes_against', 0, 'votes_abstain', 0))
  )), adm);
  assert (r->>'success')::boolean, 'حفظ الاجتماع: ' || r::text; n := n + 1;
  m_id := (r->'meeting'->>'id')::uuid;
  d_id := (r->'meeting'->'decisions'->0->>'id')::uuid;
  assert (r->'meeting'->'allowance'->>'present')::int = 2
     and (r->'meeting'->'allowance'->>'rate')::numeric = 75
     and (r->'meeting'->'allowance'->>'total')::numeric = 150
     and not (r->'meeting'->'allowance'->>'paid')::boolean, 'حساب البدل التلقائي 2×75=150'; n := n + 1;

  -- 3) ظهور الاجتماع في مساعد التسوية (FIN_SETTLE_HELP) ثم صرف بدله ضمن تسوية عهدة وتغذية المزايا
  c1 := treasury.issue_cheque(jsonb_build_object('date', dt, 'amount', 150, 'payee_name', 'ZZ عهدة بدلات', 'person_id', p1, 'purpose', 'عهدة', 'cheque_no', 'ZZ-M1'), a);
  r := api.handle_finance('FIN_SETTLE_HELP', jsonb_build_object('cheque_id', c1), adm);
  assert exists (select 1 from jsonb_array_elements(r->'meetings') x where x->>'id' = m_id::text and (x->>'total')::numeric = 150), 'الاجتماع متاح في التسوية'; n := n + 1;

  s1 := treasury.settle(jsonb_build_object('cheque_id', c1, 'date', dt,
    'lines', jsonb_build_array(jsonb_build_object('category', 'بدل جلسات', 'amount', 150, 'notes', 'بدل جلسات ZZ',
      'meeting_ids', jsonb_build_array(m_id),
      'beneficiaries', jsonb_build_array(jsonb_build_object('person_id', p1, 'amount', 75), jsonb_build_object('person_id', p2, 'amount', 75))))), a);
  assert (select (api.meeting_json(m_id)->'allowance'->>'paid')::boolean), 'علّم الاجتماع أنه صُرف بدله'; n := n + 1;
  assert (select count(*) from benefits.ledger where source_ref = 'STL:' || s1 || ':1' and status = 'فعّالة' and amount = 75) = 2, 'ميزة 75 لكل عضو حاضر'; n := n + 1;

  -- منع تكرار صرف بدل نفس الاجتماع في تسوية تانية
  c2 := treasury.issue_cheque(jsonb_build_object('date', dt, 'amount', 150, 'payee_name', 'ZZ عهدة بدلات', 'person_id', p1, 'purpose', 'عهدة', 'cheque_no', 'ZZ-M2'), a);
  ok := false;
  begin
    perform treasury.settle(jsonb_build_object('cheque_id', c2, 'date', dt,
      'lines', jsonb_build_array(jsonb_build_object('category', 'بدل جلسات', 'amount', 150, 'meeting_ids', jsonb_build_array(m_id)))), a);
  exception when check_violation then ok := true; end;
  assert ok, 'منع تكرار صرف بدل نفس الاجتماع'; n := n + 1;

  -- عند استرجاع التسوية يرجع الاجتماع غير مصروف وتتلغي المزايا
  perform treasury.settle_reverse(s1, dt, 'اختبار استرجاع البدلات', a);
  assert not (select (api.meeting_json(m_id)->'allowance'->>'paid')::boolean), 'رجع الاجتماع غير مصروف بعد الاسترجاع'; n := n + 1;

  -- 4) متابعة تنفيذ القرارات والتنبيه والربط المالي وتجاوز السقف
  r := api.handle_governance('GOV_SAVE_DECISION', jsonb_build_object(
    'id', d_id, 'exec_status', 'قيد التنفيذ', 'assignee_name', 'أمين الصندوق', 'due_date', (dt - 5)::text, 'follow_up', 'جارٍ التعاقد'), adm);
  assert (r->>'success')::boolean and r->'decision'->>'exec_status' = 'قيد التنفيذ', 'حفظ متابعة القرار'; n := n + 1;
  assert exists (select 1 from jsonb_array_elements(api.staff_tasks(adm)) t where (t->>'title') like '%قرارات مجلس متأخرة%'), 'تنبيه القرارات المتأخرة'; n := n + 1;

  -- صرف شيك بـ 1,200 مربوط بالقرار (سقفه 1,000) ⇒ يظهر في ملف القرار ويُعلَّم تجاوز السقف
  perform treasury.issue_cheque(jsonb_build_object('date', dt, 'amount', 1200, 'payee_name', 'ZZ مورد', 'purpose', 'دعم نشاط',
    'expense_account', '5204', 'decision_id', d_id, 'cheque_no', 'ZZ-D1'), a);
  r := api.handle_governance('GOV_GET_DECISION', jsonb_build_object('id', d_id), adm);
  assert (r->'decision'->>'spent')::numeric = 1200 and jsonb_array_length(r->'decision'->'cheques') = 1, 'ربط الشيك بالقرار وحساب المنصرف'; n := n + 1;
  r := api.handle_governance('GOV_LIST_DECISIONS', jsonb_build_object('alert', 'exceeded'), adm);
  assert exists (select 1 from jsonb_array_elements(r->'items') x where x->>'id' = d_id::text), 'فلتر القرارات المتجاوزة للسقف'; n := n + 1;

  -- 5) حفظ الحضور السريع GOV_SAVE_ATTENDANCE
  r := api.handle_governance('GOV_SAVE_ATTENDANCE', jsonb_build_object('meetingId', m_id, 'attendance', jsonb_build_array(
    jsonb_build_object('person_id', p1, 'status', 'حاضر'),
    jsonb_build_object('person_id', p2, 'status', 'حاضر'),
    jsonb_build_object('person_id', p3, 'status', 'حاضر'))), adm);
  assert (r->'meeting'->'allowance'->>'present')::int = 3 and (r->'meeting'->'allowance'->>'total')::numeric = 225, 'الحضور السريع وتحديث البدل'; n := n + 1;

  set constraints all immediate;
  raise exception 'ALL_PHASE31_GOV_PASSED (%)', n;
end $$;
