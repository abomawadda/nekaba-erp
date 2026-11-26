-- اختبار المرحلة 32: طلبات الصرف واستخراج الشيكات والمنح (الضوابط المحاسبية والإدارية وفصل المهام)
-- يُشغَّل داخل معاملة تُلغى في النهاية (ROLLBACK) فلا يترك أي أثر في البيانات الحية
begin;

do $$
declare adm uuid; u_req uuid; u_trs uuid; u_brd uuid; p_mem uuid;
        pr1 uuid; pr2 uuid; g_id uuid; chq1 uuid; chq2 uuid;
        r jsonb; bal_before numeric; bal_mid numeric; bal_after numeric;
        n int := 0; ok boolean; dt date := current_date;
begin
  select user_id into adm from core.user_roles where role = 'SYS_ADMIN' limit 1;
  select person_id into p_mem from governance.board_seats where to_date is null limit 1;

  -- إنشاء مستخدمين تجريبيين داخل المعاملة لاختبار فصل المهام وحدود الصلاحية المالية
  insert into core.users(username, password_hash, must_change, active)
  values ('zz_officer', 'x', false, true) returning id into u_req;
  insert into core.user_roles(user_id, role) values (u_req, 'TRIPS_OFFICER');

  insert into core.users(username, password_hash, must_change, active)
  values ('zz_treasurer', 'x', false, true) returning id into u_trs;
  insert into core.user_roles(user_id, role) values (u_trs, 'TREASURER');

  insert into core.users(username, password_hash, must_change, active)
  values ('zz_board', 'x', false, true) returning id into u_brd;
  insert into core.user_roles(user_id, role) values (u_brd, 'BOARD');

  select coalesce(sum(debit - credit), 0) into bal_before from finance.lines where account = '1102';

  -- 1) تقديم طلب صرف بدون قرار مجلس (لائحي اختياري) — لا يولّد قيداً محاسبياً قبل إصدار الشيك
  r := api.handle_finance('FIN_PAY_CREATE', jsonb_build_object(
    'date', dt, 'purpose', 'مصروف', 'payee_name', 'ZZ مكتبة النور',
    'amount', 1200, 'expense_account', '5501', 'description', 'ZZ شراء مطبوعات وأدوات مكتبية',
    'supporting_docs', 'فاتورة ضريبية رقم 401'
  ), u_req);
  assert (r->>'success')::boolean, '1) إنشاء طلب صرف بدون قرار: ' || r::text; n := n + 1;
  pr1 := (r->>'id')::uuid;
  assert (r->'request'->>'auth_basis') = 'لائحي' and (r->'request'->>'status') = 'مقدَّم', '1ب) سند لائحي وحالة مقدَّم'; n := n + 1;

  select coalesce(sum(debit - credit), 0) into bal_mid from finance.lines where account = '1102';
  assert bal_mid = bal_before, '2) لا قيد محاسبي عند تقديم طلب الصرف'; n := n + 1;

  -- 2) فصل المهام: مقدّم الطلب لا يملك اعتماده لنفسه حتى لو مُنح صلاحية الاعتماد
  insert into core.user_roles(user_id, role) values (u_req, 'TREASURER');
  r := api.handle_finance('FIN_PAY_DECIDE', jsonb_build_object('id', pr1, 'approve', true), u_req);
  assert not (r->>'success')::boolean, '3) منع اعتماد الشخص لطلبه الذاتي'; n := n + 1;
  delete from core.user_roles where user_id = u_req and role = 'TREASURER';

  -- 3) اعتماد أمين الصندوق ضمن حد الصلاحية (1,200 <= 5,000) بدون قرار مجلس — لا يولّد قيداً محاسبياً بعد
  r := api.handle_finance('FIN_PAY_DECIDE', jsonb_build_object('id', pr1, 'approve', true, 'note', 'مطابق للفاتورة'), u_trs);
  assert (r->>'success')::boolean and (r->'request'->>'status') = 'معتمد', '4) اعتماد أمين الصندوق ضمن الحد: ' || r::text; n := n + 1;
  select coalesce(sum(debit - credit), 0) into bal_mid from finance.lines where account = '1102';
  assert bal_mid = bal_before, '5) لا قيد محاسبي عند الاعتماد قبل استخراج الشيك'; n := n + 1;

  -- 4) استخراج الشيك البنكي من الطلب المعتمد ⇐ يولّد الشيك والقيد المحاسبي المتوازن آلياً
  r := api.handle_finance('FIN_PAY_ISSUE', jsonb_build_object('id', pr1, 'date', dt), u_trs);
  assert (r->>'success')::boolean and (r->'request'->>'status') = 'مصروف', '6) استخراج الشيك من الطلب: ' || r::text; n := n + 1;
  chq1 := (r->>'cheque_id')::uuid;
  select coalesce(sum(debit - credit), 0) into bal_after from finance.lines where account = '1102';
  assert bal_after = bal_before - 1200, '7) خصم مبلغ الشيك من البنك عند الإصدار الفعلي فقط'; n := n + 1;

  -- 5) إلغاء الشيك (BANK_VOID) يعكس القيد ويعيد طلب الصرف تلقائياً إلى «معتمد» لاستخراج شيك بديل
  r := api.handle_bank('BANK_VOID', jsonb_build_object('id', chq1, 'reason', 'خطأ في اسم المستفيد على الشيك', 'date', dt), u_trs);
  assert (r->>'success')::boolean, '8) إلغاء الشيك بقيد عكسي: ' || r::text; n := n + 1;
  assert (select status from treasury.payment_requests where id = pr1) = 'معتمد'
     and (select cheque_id from treasury.payment_requests where id = pr1) is null, '9) عودة طلب الصرف لحالة معتمد بعد إلغاء الشيك'; n := n + 1;
  select coalesce(sum(debit - credit), 0) into bal_after from finance.lines where account = '1102';
  assert bal_after = bal_before, '10) عودة رصيد البنك بعد إلغاء الشيك'; n := n + 1;

  -- 6) حد الصلاحية المالية: طلب بمبلغ 8,000 يتجاوز حد أمين الصندوق (5,000) بلا قرار مجلس ⇐ يُرفض اعتماده من أمين الصندوق ويُقبل من المجلس
  r := api.handle_finance('FIN_PAY_CREATE', jsonb_build_object(
    'date', dt, 'purpose', 'عهدة', 'person_id', p_mem, 'amount', 8000, 'description', 'ZZ عهدة تنظيم احتفالية سنوية'
  ), u_req);
  assert (r->>'success')::boolean, '11) إنشاء طلب عهدة 8,000: ' || r::text; n := n + 1;
  pr2 := (r->>'id')::uuid;
  r := api.handle_finance('FIN_PAY_DECIDE', jsonb_build_object('id', pr2, 'approve', true), u_trs);
  assert not (r->>'success')::boolean, '12) منع تجاوز السقف المالي لأمين الصندوق بلا قرار مجلس'; n := n + 1;

  r := api.handle_finance('FIN_PAY_DECIDE', jsonb_build_object('id', pr2, 'approve', true), u_brd);
  assert (r->>'success')::boolean and (r->'request'->>'status') = 'معتمد', '13) اعتماد المجلس للمبلغ الأكبر: ' || r::text; n := n + 1;

  -- 7) طلب استخراج منحة (بما فيها وفاة العضو نفسه + استلام المستندات الفوري من الموظف + ظهورها في طابور الشيكات)
  r := api.handle_grants('GRT_APPLY', jsonb_build_object(
    'personId', p_mem, 'type', 'DEATH', 'event_date', dt, 'subject_relation', 'العضو',
    'staff_verified', true, 'docs', jsonb_build_array(jsonb_build_object('name', 'شهادة الوفاة', 'received', true))
  ), u_brd, null);
  assert (r->>'success')::boolean and (r->'request'->>'status') = 'مستوفى', '14) إنشاء طلب منحة وفاة العضو مستوفى المستندات: ' || r::text; n := n + 1;
  g_id := (r->'request'->>'id')::uuid;

  r := api.handle_grants('GRT_DECIDE', jsonb_build_object('requestId', g_id, 'approve', true), adm, null);
  assert (r->>'success')::boolean and (r->'request'->>'status') = 'معتمد', '15) اعتماد طلب المنحة: ' || r::text; n := n + 1;

  r := api.handle_finance('FIN_PAY_LIST', '{}'::jsonb, u_trs);
  assert exists (select 1 from jsonb_array_elements(r->'approvedGrants') x where x->>'id' = g_id::text), '16) ظهور المنحة المعتمدة في طابور استخراج الشيكات بالخزينة'; n := n + 1;

  r := api.handle_grants('GRT_PAY', jsonb_build_object('requestId', g_id, 'date', dt), u_trs, null);
  assert (r->>'success')::boolean and (r->'request'->>'status') = 'مصروف', '17) صرف شيك المنحة بدون قرار مجلس إلزامي: ' || r::text; n := n + 1;

  -- 8) توازن الدفاتر العام = صفر
  assert (select coalesce(sum(debit - credit), 0) from finance.lines) = 0, '18) توازن القيود العام'; n := n + 1;

  raise notice 'PASSED %/19 assertions in 13_payment_requests.test.sql', n;
end $$;

rollback;
