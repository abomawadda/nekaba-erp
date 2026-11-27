-- اختبار المرحلة 33: تقارير تسوية العهد (المفردة والمجمّعة) وكشف حساب العمليات والشيكات وتقرير الجمعية العمومية
begin;

do $$
declare adm uuid; p_mem uuid;
        c1 uuid; c2 uuid; c3 uuid;
        s_single uuid; s_grp uuid;
        r jsonb; st jsonb; rep jsonb;
        n int := 0;
begin
  select user_id into adm from core.user_roles where role = 'SYS_ADMIN' limit 1;
  select person_id into p_mem from governance.board_seats where to_date is null limit 1;

  -- 1) تسوية سلفة مفردة وبنودها المسوّاة
  c1 := treasury.issue_cheque(jsonb_build_object('date', current_date, 'amount', 1500, 'purpose', 'عهدة',
    'person_id', p_mem, 'notes', 'سلفة مشتريات مكتبية'), adm::text);
  s_single := treasury.settle(jsonb_build_object(
    'cheque_id', c1, 'date', current_date, 'returned', 200, 'return_mode', 'رد للخزينة',
    'lines', jsonb_build_array(
      jsonb_build_object('category', 'أدوات مكتبية', 'amount', 800, 'notes', 'فاتورة رقم 101'),
      jsonb_build_object('category', 'مطبوعات ولافتات', 'amount', 500, 'notes', 'فاتورة رقم 102')
    )
  ), adm::text);

  r := api.handle_reports('REP_SETTLEMENT', jsonb_build_object('id', s_single), adm);
  assert (r->>'success')::boolean, 'فشل جلب تقرير تسوية السلفة المفردة'; n := n + 1;
  st := r->'settlement';
  assert not (st->>'is_grouped')::boolean, 'التسوية المفردة لا يجب أن تُصنّف مجمّعة'; n := n + 1;
  assert jsonb_array_length(st->'lines') = 2, 'عدد البنود المسوّاة يجب أن يكون 2'; n := n + 1;
  assert (st->>'spent')::numeric = 1300 and (st->>'returned')::numeric = 200 and (st->>'remaining_balance')::numeric = 0,
    'حساب المنصرف والمردود والمتبقي في التسوية المفردة غير مطابق'; n := n + 1;

  -- 2) تسوية سلفة مجمّعة لعدة شيكات مع مبلغ متبقٍ مرحّل
  c2 := treasury.issue_cheque(jsonb_build_object('date', current_date, 'amount', 2000, 'purpose', 'عهدة',
    'person_id', p_mem, 'notes', 'عهدة نشاط أولى'), adm::text);
  c3 := treasury.issue_cheque(jsonb_build_object('date', current_date, 'amount', 1200, 'purpose', 'عهدة',
    'person_id', p_mem, 'notes', 'عهدة نشاط ثانية مكمّلة'), adm::text);

  s_grp := treasury.settle(jsonb_build_object(
    'cheque_id', c2,
    'cheque_ids', jsonb_build_array(c3::text),
    'date', current_date,
    'return_mode', 'ترحيل',
    'lines', jsonb_build_array(
      jsonb_build_object('category', 'مشروبات ومأكولات', 'amount', 1750, 'notes', 'ضيافة الفعالية'),
      jsonb_build_object('category', 'انتقالات بالباص', 'amount', 900, 'notes', 'إيجار أتوبيس')
    )
  ), adm::text);

  r := api.handle_reports('REP_SETTLEMENT', jsonb_build_object('chequeId', c3), adm);
  assert (r->>'success')::boolean, 'فشل جلب التسوية المجمّعة عبر الشيك الفرعي'; n := n + 1;
  st := r->'settlement';
  assert (st->>'is_grouped')::boolean and jsonb_array_length(st->'cheques') = 2, 'يجب أن يظهر الشيكان في التسوية المجمّعة'; n := n + 1;
  assert (st->>'advance')::numeric = 3200 and (st->>'spent')::numeric = 2650 and (st->>'remaining_balance')::numeric = 550,
    'إجمالي الشيكات والمنصرف والمبلغ المتبقي (550) غير مطابق'; n := n + 1;
  assert jsonb_array_length(st->'by_account') >= 1, 'تجميع الحسابات المحاسبية مفقود'; n := n + 1;

  -- 3) تقرير كشف حساب العمليات والشيكات
  r := api.handle_reports('REP_OPS_STATEMENT', jsonb_build_object('from', current_date::text, 'to', current_date::text, 'account', '1102'), adm);
  assert (r->>'success')::boolean, 'فشل كشف حساب العمليات والشيكات'; n := n + 1;
  rep := r->'report';
  assert round((rep->>'opening')::numeric + (rep->>'total_debit')::numeric - (rep->>'total_credit')::numeric, 2) = round((rep->>'closing')::numeric, 2),
    'معادلة رصيد كشف حساب العمليات غير متوازنة'; n := n + 1;
  assert jsonb_array_length(rep->'operations') >= 3 and jsonb_array_length(rep->'cheques') >= 3,
    'لم تظهر العمليات أو الشيكات الصادرة اليوم في الكشف'; n := n + 1;

  -- 4) تقرير الجمعية العمومية (النقابة العامة)
  r := api.handle_reports('REP_GENERAL_ASSEMBLY', jsonb_build_object('member_state', 'نشط'), adm);
  assert (r->>'success')::boolean, 'فشل تقرير الجمعية العمومية'; n := n + 1;
  rep := r->'report';
  assert (rep->>'active_voting')::int = jsonb_array_length(rep->'items'), 'عدد أعضاء الجمعية العمومية النشطين لا يطابق جدول الكشف'; n := n + 1;
  assert (rep->>'quorum_first')::int = ((rep->>'active_voting')::int / 2) + 1, 'حساب النصاب القانوني الأول غير مطابق'; n := n + 1;

  raise notice 'PASSED %/% assertions in 14_phase33_reports.test.sql', n, n;
end $$;

rollback;
