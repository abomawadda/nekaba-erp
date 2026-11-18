-- اختبار النواة — يُشغَّل كاملاً ويرجع كل شيء (ينتهي بـ ALL_TESTS_PASSED = نجاح)
do $$
declare p uuid; n1 text; n2 text;
begin
  insert into core.persons(job_id, national_id, full_name) values ('T-1','28501011234577','اختبار تجريبي') returning id into p;
  assert (select gender from core.persons where id=p)='ذكر', 'النوع من القومي';
  assert (select birth_date from core.persons where id=p)='1985-01-01', 'الميلاد من القومي';
  insert into core.person_movements(person_id,kind,field,to_value,effective_date) values
    (p,'انضمام','union_org','النقابة العامة','2020-01-01'),
    (p,'انتقال إلى نقابة مستقلة','union_org','نقابة مستقلة','2024-06-01'),
    (p,'انتقال إلى النقابة العامة','union_org','النقابة العامة','2025-03-01'),
    (p,'تعيين','member_state','نشط','2010-01-01');
  assert core.state_at(p,'union_org','2024-01-01')='النقابة العامة', 'الوضع في تاريخ';
  assert core.state_at(p,'union_org','2024-12-01')='نقابة مستقلة', 'الوضع بعد الانتقال';
  assert core.is_union_beneficiary(p,'2024-12-01')=false, 'لا دعم أثناء المستقلة';
  assert core.is_union_beneficiary(p,'2026-01-01')=true, 'دعم بعد العودة';
  assert (select count(*) from core.person_periods where person_id=p and field='union_org')=3, 'الفترات';
  assert (select days from core.person_periods where person_id=p and value='نقابة مستقلة')=273, 'مدة البقاء';
  begin insert into core.person_movements(person_id,kind,field,to_value,effective_date) values (p,'x','union_org','خطأ','2025-01-01');
        raise exception 'should fail'; exception when check_violation then null; end;
  begin insert into core.persons(full_name,national_id) values ('آخر خطأ','123'); raise exception 'should fail';
        exception when check_violation then null; end;
  n1 := core.next_doc_no('TEST','TST',2099); n2 := core.next_doc_no('TEST','TST',2099);
  assert n1='TST-2099-00001' and n2='TST-2099-00002', 'الترقيم المتصل';
  assert (select count(*) from audit.log where entity='core.persons' and entity_id=p::text)>=1, 'التدقيق';
  begin update audit.log set actor='x' where entity_id=p::text; raise exception 'should fail';
        exception when raise_exception then if sqlerrm not like '%لا يُعدَّل%' then raise; end if; end;
  raise exception 'ALL_TESTS_PASSED';
end $$;
