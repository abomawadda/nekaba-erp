-- اختبار الأجهزة بالتقسيط والاستقطاع (20 فحصاً — نجحت 22 نوفمبر 2026، ينتهي بـ ALL_DEVICES_TESTS_PASSED ويرجع كل شيء)
-- ثلاجة: المورد 8000، العضو 9000، السوق 10000، 10 شهور، مقدم 10% ⇒ مقدم 900 وقسط 810 ودعم 1000؛ سقف الاستقطاع يمنع؛
-- التسليم ⇒ 1201 = 8100 و2101 للمورد 8000 والدعم في المزايا؛ كشف الاستقطاع 810 (المُعِد لا يعتمد) ⇒ 1201 = 7290؛
-- تحصيل جهة العمل يصفّر 1203؛ السداد النقدي للباقي ⇒ «مسدد» و1201 = صفر.
do $$
declare pm uuid; um uuid; udev uuid; utr uuid; sm jsonb; sdev jsonb; str jsonb; r jsonb; dec uuid; off uuid; itm uuid; ord uuid; run uuid; checks int := 0;
        fd date := (date_trunc('month', current_date) + interval '1 month')::date; bal numeric;
begin
  select id into dec from governance.decisions limit 1;
  insert into core.persons(job_id, national_id, full_name) values ('ZZ-D1','29900000003333','عضو اختبار الأجهزة') returning id into pm;
  insert into core.person_movements(person_id, kind, field, to_value, effective_date) values
    (pm,'انضمام','union_org','النقابة العامة','2020-01-01'),(pm,'تعيين','member_state','نشط','2020-01-01');
  insert into core.users(person_id, username, active) values (pm,'zz_d_m',true) returning id into um; insert into core.user_roles values (um,'MEMBER');
  insert into core.users(username, active) values ('zz_d_dev',true) returning id into udev; insert into core.user_roles values (udev,'DEVICES_OFFICER');
  insert into core.users(username, active) values ('zz_d_tr',true) returning id into utr; insert into core.user_roles values (utr,'TREASURER');
  sm := jsonb_build_object('uid',um,'pid',pm); sdev := jsonb_build_object('uid',udev); str := jsonb_build_object('uid',utr);

  r := api.handle('DEV_SAVE', jsonb_build_object('offer', jsonb_build_object('title','ZZ عرض ثلاجات','supplier','ZZ معرض','first_due', fd, 'decision_id', dec,
        'items', jsonb_build_array(jsonb_build_object('name','ثلاجة','supplier_price',8000,'member_price',9000,'market_price',10000,'max_months',10,'down_pct',10)))), sdev);
  if not (r->>'success')::boolean then raise exception 'SAVE %', r; end if; off := r->>'id';
  select id into itm from activities.dev_items where offer_id = off;
  r := api.handle('DEV_SAVE', jsonb_build_object('offer', jsonb_build_object('title','x','supplier','x')), sm);
  if (r->>'success')::boolean then raise exception 'عضو أنشأ عرضاً'; end if; checks := checks + 2;
  r := api.handle('DEV_ORDER', jsonb_build_object('itemId', itm), sm);
  if (r->>'success')::boolean then raise exception 'طلب والعرض مسودة'; end if; checks := checks + 1;
  perform api.handle('DEV_SET_STATUS', jsonb_build_object('offerId', off, 'status','الطلب مفتوح'), sdev);
  update core.settings set value = '{"monthly": 500}' where key = 'PAYROLL_DEDUCTION_CAP';
  r := api.handle('DEV_ORDER', jsonb_build_object('itemId', itm, 'months', 10), sm);
  if (r->>'success')::boolean or r->>'message' not like '%سقف%' then raise exception 'السقف %', r; end if; checks := checks + 1;
  update core.settings set value = '{"monthly": null}' where key = 'PAYROLL_DEDUCTION_CAP';
  r := api.handle('DEV_ORDER', jsonb_build_object('itemId', itm, 'months', 12), sm);
  if (r->>'success')::boolean then raise exception 'شهور زيادة'; end if; checks := checks + 1;
  r := api.handle('DEV_ORDER', jsonb_build_object('itemId', itm, 'months', 10), sm);
  if not (r->>'success')::boolean or (r#>>'{order,down_payment}')::numeric <> 900 or (r#>>'{order,monthly}')::numeric <> 810 or (r#>>'{order,subsidy}')::numeric <> 1000 then raise exception 'ORDER %', r; end if;
  ord := r#>>'{order,id}'; checks := checks + 1;
  r := api.handle('DEV_ORDER', jsonb_build_object('itemId', itm, 'months', 5), sm);
  if (r->>'success')::boolean then raise exception 'طلب مكرر'; end if; checks := checks + 1;
  r := api.handle('DEV_DECIDE', jsonb_build_object('orderId', ord, 'approve', true), sdev);
  if (select count(*) from activities.dev_installments where order_id = ord) <> 10 or (select sum(amount) from activities.dev_installments where order_id = ord) <> 8100
     or (select min(due_month) from activities.dev_installments where order_id = ord) <> fd then raise exception 'الجدول'; end if; checks := checks + 1;
  r := api.handle('DEV_DELIVER', jsonb_build_object('orderId', ord), sdev);
  if not (r->>'success')::boolean then raise exception 'DELIVER %', r; end if;
  select sum(debit - credit) into bal from finance.lines where account = '1201' and person_id = pm;
  if bal <> 8100 then raise exception '1201 = %', bal; end if;
  if (select sum(credit) from finance.lines where account = '2101' and party = 'ZZ معرض') <> 8000 then raise exception '2101'; end if;
  if not exists (select 1 from benefits.ledger where person_id = pm and category = 'دعم مبادرة شراء' and amount = 1000) then raise exception 'دعم'; end if;
  checks := checks + 3;
  r := api.handle('DEV_RUN_BUILD', jsonb_build_object('month', fd), sdev);
  run := r->>'runId';
  if (select total from activities.dev_runs where id = run) <> 810 then raise exception 'الكشف'; end if;
  r := api.handle('DEV_RUN_APPROVE', jsonb_build_object('runId', run), sdev);
  if (r->>'success')::boolean then raise exception 'مسئول الأجهزة اعتمد'; end if;
  insert into core.user_roles values (udev,'TREASURER');
  r := api.handle('DEV_RUN_APPROVE', jsonb_build_object('runId', run), sdev);
  if (r->>'success')::boolean then raise exception 'المُعِد اعتمد'; end if;
  r := api.handle('DEV_RUN_APPROVE', jsonb_build_object('runId', run), str);
  if not (r->>'success')::boolean then raise exception 'APPROVE %', r; end if;
  select sum(debit - credit) into bal from finance.lines where account = '1201' and person_id = pm;
  if bal <> 7290 then raise exception '1201 بعد الاستقطاع %', bal; end if; checks := checks + 4;
  r := api.handle('DEV_RUN_RECEIVE', jsonb_build_object('runId', run), str);
  if not (r->>'success')::boolean or (select sum(debit - credit) from finance.lines l join finance.entries e on e.id = l.entry_id where l.account = '1203' and e.source_ref = run) <> 0 then raise exception 'RECEIVE %', r; end if;
  checks := checks + 1;
  r := api.handle('DEV_PAY', jsonb_build_object('orderId', ord, 'amount', 9999), str);
  if (r->>'success')::boolean then raise exception 'سداد زائد'; end if;
  r := api.handle('DEV_PAY', jsonb_build_object('orderId', ord, 'amount', 7290), str);
  if not (r->>'success')::boolean or r#>>'{order,status}' <> 'مسدد' then raise exception 'PAY %', r; end if;
  select sum(debit - credit) into bal from finance.lines where account = '1201' and person_id = pm;
  if bal <> 0 then raise exception '1201 نهائي %', bal; end if; checks := checks + 3;
  r := api.handle('DEV_MY', '{}', sm);
  if jsonb_array_length(r->'items') <> 1 then raise exception 'MY'; end if; checks := checks + 1;
  set constraints all immediate;
  raise exception 'ALL_DEVICES_TESTS_PASSED (%)', checks;
end $$;
