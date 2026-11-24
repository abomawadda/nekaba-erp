-- المرحلة 26: تنبيهات ذكية في صندوق المهام (إعادة تعريف api.staff_tasks كاملة بكل البنود السابقة + تنبيهات المتابعة).
create or replace function api.staff_tasks(uid uuid) returns jsonb language sql stable set search_path = core, public, extensions, pg_temp as $$
  select coalesce(jsonb_agg(t) filter (where (t->>'count')::int > 0), '[]') from (
    select jsonb_build_object('title','طلبات تعديل بيانات','count',(select count(*) from core.change_requests where status = 'معلّق'),'link','#/requests') t where core.can(uid,'profile.change.approve')
    union all select jsonb_build_object('title','منح تحتاج مراجعة مستندات','count',(select count(*) from grants.requests where status in ('مقدَّم','ناقص مستندات')),'link','#/grantsadmin') where core.can(uid,'grants.review')
    union all select jsonb_build_object('title','منح جاهزة للاعتماد','count',(select count(*) from grants.requests where status = 'مستوفى'),'link','#/grantsadmin') where core.can(uid,'grants.approve')
    union all select jsonb_build_object('title','منح معتمدة للصرف','count',(select count(*) from grants.requests where status = 'معتمد'),'link','#/grantsadmin') where core.can(uid,'treasury.cheque.issue')
    union all select jsonb_build_object('title','حجوزات أجهزة/عمرة جديدة','count',(select count(*) from activities.dev_orders where status = 'مطلوب'),'link','#/devadmin') where core.can(uid,'devices.manage')
    union all select jsonb_build_object('title','طلبات تبديل مصايف','count',(select count(*) from activities.summer_swaps where status in ('مطلوب','وافق الطرف الآخر')),'link','#/summer') where core.can(uid,'summer.manage')
    union all select jsonb_build_object('title','حجوزات رحلات بانتظار التحصيل','count',(select count(*) from activities.bookings where status = 'بانتظار السداد'),'link','#/trips') where core.can(uid,'treasury.receipt')
    -- تنبيهات المتابعة
    union all select jsonb_build_object('title','⚠️ عُهد وسلف متأخرة التسوية (+30 يوماً)','count',(select count(*) from treasury.cheques where requires_settlement and status in ('صادر','مرحّل الرصيد') and issue_date < current_date - 30),'link','#/settlements','level','warn')
      where core.can(uid,'treasury.settlement') or core.can(uid,'treasury.cheque.issue')
    union all select jsonb_build_object('title','⚠️ شيكات لم تُصرف منذ أكثر من 6 شهور','count',(select count(*) from treasury.cheques where status <> 'ملغى' and cleared_date is null and issue_date < current_date - 180
        and exists (select 1 from treasury.cheques x where x.cleared_date is not null)),'link','#/bank','level','warn')
      where core.can(uid,'treasury.cheque.issue')
    union all select jsonb_build_object('title','🏦 مطابقة البنك لم تُعمل هذا الشهر','count',case when exists (select 1 from treasury.bank_reconciliations where stmt_date >= date_trunc('month', current_date) - interval '1 month') then 0 else 1 end,'link','#/bank','level','warn')
      where core.can(uid,'treasury.cheque.issue')
    union all select jsonb_build_object('title','🚨 قيود غير متوازنة — راجع فوراً','count',(select count(*) from (select entry_id from finance.lines group by entry_id having abs(sum(debit) - sum(credit)) >= 0.005) u),'link','#/entries','level','bad')
      where core.can(uid,'finance.view')
  ) q
$$;
revoke all on all functions in schema api from public, anon, authenticated;
