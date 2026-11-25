-- اختبار المرحلة 30: التسوية المجمّعة + الترحيل الآلي + المسودة + الاسترجاع
-- التشغيل (لا يترك أثراً): psql "$DB" -v ON_ERROR_STOP=0 -f supabase/tests/11_settlement_ops.test.sql
do $$
declare a text := 'zz_test'; c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; s0 uuid; s1 uuid; s2 uuid; s3 uuid; v uuid; e uuid;
        n int := 0; ok boolean; r jsonb; adm uuid; ben uuid; d date := current_date;
begin
  select user_id into adm from core.user_roles where role = 'SYS_ADMIN' limit 1;
  select person_id into ben from benefits.ledger where status = 'فعّالة' and kind = 'بدل' order by benefit_date desc limit 1;
  c1 := treasury.issue_cheque(jsonb_build_object('date', d, 'amount', 1000, 'payee_name', 'ZZ صاحب عهدة', 'purpose', 'عهدة', 'cheque_no', 'ZZ-1'), a);
  c2 := treasury.issue_cheque(jsonb_build_object('date', d, 'amount', 500,  'payee_name', 'ZZ صاحب عهدة', 'purpose', 'عهدة', 'cheque_no', 'ZZ-2'), a);
  c3 := treasury.issue_cheque(jsonb_build_object('date', d, 'amount', 300,  'payee_name', 'ZZ شخص تاني',  'purpose', 'عهدة', 'cheque_no', 'ZZ-3'), a);
  c4 := treasury.issue_cheque(jsonb_build_object('date', d, 'amount', 400,  'payee_name', 'ZZ صاحب عهدة', 'purpose', 'عهدة', 'cheque_no', 'ZZ-4'), a);
  c5 := treasury.issue_cheque(jsonb_build_object('date', d, 'amount', 200,  'payee_name', 'ZZ صاحب عهدة', 'purpose', 'عهدة', 'cheque_no', 'ZZ-5'), a);

  -- 1) المسودة: بلا قيد، والشيكات تفضل «صادر»، وتتحدّث
  s0 := treasury.settle(jsonb_build_object('cheque_id', c1, 'draft', true, 'cheque_ids', jsonb_build_array(c2),
          'lines', jsonb_build_array(jsonb_build_object('category','مشروبات ومأكولات','amount',100))), a);
  assert (select status = 'مسودة' and entry_id is null and advance = 1500 and spent = 100 from treasury.settlements where id = s0), 'مسودة'; n := n + 1;
  v := treasury.settle(jsonb_build_object('cheque_id', c1, 'draft', true, 'cheque_ids', jsonb_build_array(c2),
          'lines', jsonb_build_array(jsonb_build_object('category','مشروبات ومأكولات','amount',700))), a);
  assert v = s0 and (select spent from treasury.settlements where id = s0) = 700, 'تحديث المسودة'; n := n + 1;
  assert (select count(*) from treasury.cheques where id in (c1,c2) and status = 'صادر') = 2, 'المسودة لا تغيّر الشيكات'; n := n + 1;
  assert treasury.cheque_settlement(c1) is null, 'المسودة ليست تسوية'; n := n + 1;

  -- 2) مجموعة بشيك لصاحب عهدة مختلف ⇒ مرفوضة
  ok := false; begin perform treasury.settle(jsonb_build_object('cheque_id', c1, 'date', d, 'cheque_ids', jsonb_build_array(c3),
     'lines', jsonb_build_array(jsonb_build_object('category','مشروبات ومأكولات','amount',1300))), a);
  exception when check_violation then ok := true; end; assert ok, 'مجموعة بصاحب مختلف'; n := n + 1;

  -- 3) اعتماد مجمّع (1000+500) بمصروف 1200 وترحيل 300 + مستفيد بدل
  s1 := treasury.settle(jsonb_build_object('cheque_id', c1, 'date', d, 'cheque_ids', jsonb_build_array(c2), 'return_mode', 'ترحيل',
          'lines', jsonb_build_array(jsonb_build_object('category','مشروبات ومأكولات','amount',1000),
                                     jsonb_build_object('category','بدل انتقال','amount',200,'beneficiaries', jsonb_build_array(jsonb_build_object('person_id', ben))))), a);
  assert (select status = 'معتمدة' and advance = 1500 and entry_id is not null from treasury.settlements where id = s1), 'اعتماد مجمّع'; n := n + 1;
  assert not exists (select 1 from treasury.settlements where id = s0), 'المسودة اتمسحت عند الاعتماد'; n := n + 1;
  assert (select count(*) from treasury.cheques where id in (c1,c2) and status = 'مرحّل الرصيد') = 2, 'الشيكين مرحّلين'; n := n + 1;
  assert treasury.cheque_settlement(c2) = s1, 'شيك المجموعة مربوط'; n := n + 1;
  assert (select sum(debit) = sum(credit) from finance.lines where entry_id = (select entry_id from treasury.settlements where id = s1)), 'القيد متوازن'; n := n + 1;
  assert exists (select 1 from benefits.ledger where source_ref like 'STL:' || s1 || ':%' and status = 'فعّالة'), 'ميزة المستفيد'; n := n + 1;
  ok := false; begin perform treasury.settle(jsonb_build_object('cheque_id', c2, 'date', d, 'return_mode','ترحيل'), a);
  exception when check_violation then ok := true; end; assert ok, 'شيك المجموعة لا يتسوّى تاني'; n := n + 1;

  -- 4) المساعد: المجموعة المتاحة والرصيد المرحّل
  r := api.handle_finance('FIN_SETTLE_HELP', jsonb_build_object('cheque_id', c4), adm);
  assert (r->>'success')::boolean and jsonb_array_length(r->'carry') = 1 and (r->'carry'->0->>'amount')::numeric = 300, 'رصيد مرحّل مقترح: ' || r; n := n + 1;
  assert jsonb_array_length(r->'group') = 1 and r->'group'->0->>'id' = c5::text, 'مجموعة مقترحة'; n := n + 1;

  -- 5) ترحيل آلي: 400 + 300 مرحّل − 650 مصروف = 50 توريد للبنك
  s2 := treasury.settle(jsonb_build_object('cheque_id', c4, 'date', d, 'carried_from', s1, 'prev_balance', 9999, 'returned', 50, 'return_mode', 'توريد للبنك',
          'lines', jsonb_build_array(jsonb_build_object('category','مشروبات ومأكولات','amount',650))), a);
  assert (select prev_balance = 300 and carried_from = s1 from treasury.settlements where id = s2), 'الرصيد اتجاب آلياً (والإدخال اليدوي متجاهل)'; n := n + 1;
  assert (select count(*) from treasury.cheques where id in (c1,c2,c4) and status = 'مسوّى') = 3, 'كلهم اتقفلوا'; n := n + 1;
  ok := false; begin perform treasury.settle(jsonb_build_object('cheque_id', c5, 'date', d, 'carried_from', s1, 'returned', 500, 'return_mode','توريد للبنك'), a);
  exception when check_violation then ok := true; end; assert ok, 'الرصيد لا يُستخدم مرتين'; n := n + 1;

  -- 6) الاسترجاع
  ok := false; begin perform treasury.settle_reverse(s1, d, 'اختبار', a);
  exception when check_violation then ok := true; end; assert ok, 'لا استرجاع لتسوية رصيدها اترحّل'; n := n + 1;
  ok := false; begin perform treasury.settle_reverse(s2, d, '  ', a);
  exception when check_violation then ok := true; end; assert ok, 'السبب مطلوب'; n := n + 1;
  e := (select entry_id from treasury.settlements where id = s2);
  v := treasury.settle_reverse(s2, d, 'خطأ في الفواتير', a);
  assert (select status = 'مسترجعة' and reverse_entry_id = v from treasury.settlements where id = s2), 'حالة مسترجعة'; n := n + 1;
  assert (select status from finance.entries where id = e) = 'معكوس', 'القيد الأصلي معكوس'; n := n + 1;
  assert (select status from treasury.cheques where id = c4) = 'صادر'
     and (select count(*) from treasury.cheques where id in (c1,c2) and status = 'مرحّل الرصيد') = 2, 'الشيكات رجعت لحالتها'; n := n + 1;
  v := treasury.settle_reverse(s1, d, 'إعادة التسوية', a);
  assert (select count(*) from treasury.cheques where id in (c1,c2) and status = 'صادر') = 2, 'المجموعة رجعت صادر'; n := n + 1;
  assert not exists (select 1 from benefits.ledger where source_ref like 'STL:' || s1 || ':%' and status = 'فعّالة'), 'المزايا اتلغت'; n := n + 1;
  s3 := treasury.settle(jsonb_build_object('cheque_id', c1, 'date', d, 'returned', 1000, 'return_mode', 'توريد للبنك'), a);
  assert treasury.cheque_settlement(c1) = s3, 'إعادة التسوية بعد الاسترجاع'; n := n + 1;

  -- 7) شاشة الشيك: التسوية الفعّالة + السجل المسترجع
  r := api.handle_finance('FIN_CHEQUE', jsonb_build_object('id', c1), adm);
  assert r->'cheque'->'settlement'->>'id' = s3::text and jsonb_array_length(r->'cheque'->'reversed') = 1, 'FIN_CHEQUE: ' || r; n := n + 1;
  r := api.handle_finance('FIN_SETTLE_REVERSE', jsonb_build_object('id', s3, 'reason', 'اختبار الواجهة'), adm);
  assert (r->>'success')::boolean, 'FIN_SETTLE_REVERSE: ' || r; n := n + 1;

  set constraints all immediate;
  raise exception 'ALL_SETTLEMENT_OPS_PASSED (%)', n;
end $$;
