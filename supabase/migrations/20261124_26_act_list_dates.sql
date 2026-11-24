-- التقويم: ACT_LIST يرجّع تاريخ النهاية وآخر موعد للحجز (إضافة حقلين للاستجابة فقط — تعديل جراحي بالمرساة).
do $$ declare d text := pg_get_functiondef('api.handle_activities(text,jsonb,uuid,uuid)'::regprocedure);
  a text := $a$'title', ac.title, 'location', ac.location, 'start_date', ac.start_date, 'status', ac.status,$a$;
begin
  if position('''booking_close'', ac.booking_close' in d) > 0 then return; end if;
  if (select count(*) from regexp_matches(d, $r$'title', ac\.title, 'location', ac\.location, 'start_date', ac\.start_date, 'status', ac\.status,$r$, 'g')) <> 1 then
    raise exception 'مرساة ACT_LIST غير موجودة أو مكررة'; end if;
  d := replace(d, a, a || $b$ 'end_date', ac.end_date, 'booking_close', ac.booking_close,$b$);
  execute d;
end $$;
revoke all on all functions in schema api from public, anon, authenticated;
