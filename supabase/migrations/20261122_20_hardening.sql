-- المرحلة 9 — تجهيز التشغيل: تقوية حسب مستشار Supabase (الأمان والأداء) لـ schemas المنصة فقط (لا public ولا books)
-- (1) تثبيت search_path لكل دوال المنصة (كانت ترث مسار الجلسة) — نفس المسار الفعلي وقت التشغيل عبر api.handle
do $$ declare f record; n int := 0; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
           where s.nspname in ('core','api','audit','governance','finance','treasury','benefits','activities','grants','legacy')
             and p.prokind = 'f' and d.objid is null
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') loop
    execute format('alter function %s set search_path = core, public, extensions, pg_temp', f.sig); n := n + 1;
  end loop;
  raise notice 'search_path pinned on % functions', n;
end $$;

-- (2) فهارس للمفاتيح الأجنبية غير المفهرسة (أداء الحذف/الربط مع نمو البيانات)
do $$ declare c record; n int := 0; begin
  for c in select con.conrelid::regclass tbl, con.conname, s.nspname, cl.relname,
                  (select string_agg(quote_ident(a.attname), ', ' order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord)
                   join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) cols
           from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_namespace s on s.oid = cl.relnamespace
           where con.contype = 'f' and s.nspname in ('core','audit','governance','finance','treasury','benefits','activities','grants','legacy')
             and not exists (select 1 from pg_index i where i.indrelid = con.conrelid
                             and (i.indkey::int2[])[0:array_length(con.conkey,1)-1] = con.conkey) loop
    execute format('create index if not exists %I on %s (%s)', left(c.relname || '_' || replace(c.cols, ', ', '_') || '_fk_idx', 63), c.tbl, c.cols);
    n := n + 1;
  end loop;
  raise notice 'created % fk indexes', n;
end $$;
