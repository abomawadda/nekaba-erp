-- المرحلة 24: تصحيح جماعي لتواريخ المعاش (SYS_BULK_RETIRE).
-- لمن سُجّل «معاش» من البيانات الافتتاحية بلا تاريخ معاش: حركة تصحيح «نشط» بتاريخ الحركة الافتتاحية + حركة «معاش» بتاريخ المعاش + تعبئة retirement_date.
-- لا حذف ولا تعديل للحركات القائمة؛ كل شيء مُدقَّق.
create or replace function api.bulk_retire(p jsonb, v_user text) returns jsonb language plpgsql set search_path = core, public as $$
declare it jsonb; v_pid uuid; v_date date; v_open core.person_movements; v_hire date; ok int := 0; skipped jsonb := '[]'; v_reason text := api.t(p,'reason');
begin
  if v_reason is null then return api.err('سبب/مصدر التواريخ مطلوب (مثلاً: كشف شئون العاملين).'); end if;
  perform set_config('erp.reason', v_reason, true);
  for it in select * from jsonb_array_elements(coalesce(p->'items','[]')) loop
    v_pid := (it->>'personId')::uuid; v_date := (nullif(it->>'date',''))::date;
    select hire_date into v_hire from core.persons where id = v_pid;
    select * into v_open from core.person_movements where person_id = v_pid and field = 'member_state' order by effective_date, created_at limit 1;
    if v_date is null or v_date > current_date then skipped := skipped || jsonb_build_object('personId', v_pid, 'why', 'تاريخ غير صالح'); continue; end if;
    if core.state_at(v_pid, 'member_state', current_date) <> 'معاش' or (select retirement_date from core.persons where id = v_pid) is not null then
      skipped := skipped || jsonb_build_object('personId', v_pid, 'why', 'ليس معاشاً بلا تاريخ'); continue; end if;
    if (select count(*) from core.person_movements where person_id = v_pid and field = 'member_state') <> 1 or v_open.to_value <> 'معاش' then
      skipped := skipped || jsonb_build_object('personId', v_pid, 'why', 'له حركات حالة متعددة — يُصحَّح يدوياً من ملفه'); continue; end if;
    if v_date <= v_open.effective_date or (v_hire is not null and v_date <= v_hire) then
      skipped := skipped || jsonb_build_object('personId', v_pid, 'why', 'تاريخ المعاش قبل التعيين/الحركة الافتتاحية'); continue; end if;
    insert into core.person_movements(person_id, kind, field, from_value, to_value, effective_date, notes, created_by)
    values (v_pid, 'تصحيح بيانات افتتاحية', 'member_state', 'معاش', 'نشط', v_open.effective_date, 'الحالة قبل المعاش — ' || v_reason, v_user),
           (v_pid, 'إحالة للمعاش', 'member_state', 'نشط', 'معاش', v_date, v_reason, v_user);
    perform api.set_person_field(v_pid, 'retirement_date', v_date::text);
    ok := ok + 1;
  end loop;
  return api.ok(jsonb_build_object('fixed', ok, 'skipped', skipped));
end $$;

do $$ declare d text := pg_get_functiondef('api.handle_system(text,jsonb,uuid)'::regprocedure);
  a text := $a$  elsif p_action = 'SYS_AUDIT' then$a$;
begin
  if position('SYS_BULK_RETIRE' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'مرساة handle_system غير موجودة'; end if;
  d := replace(d, a, $b$  elsif p_action = 'SYS_BULK_RETIRE' then
    if not (core.can(uid,'profile.movement') and core.can(uid,'profile.edit')) then return api.err('غير مسموح — تحتاج صلاحية الحركات وتعديل الملفات.'); end if;
    return api.bulk_retire(p, v_user);
$b$ || a);
  execute d;
end $$;
revoke all on all functions in schema api from public, anon, authenticated;
