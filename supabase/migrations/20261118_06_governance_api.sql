-- المرحلة 2 — واجهة الحوكمة (GOV_*) + استيراد MyNekaba (IMPORT_GOVERNANCE)

create or replace function api.pid_by_job(j text) returns uuid language sql stable as
$$ select id from core.persons where job_id = nullif(trim(j),'') $$;

create or replace function api.term_json(t_id uuid) returns jsonb language sql stable as $$
  select to_jsonb(t) - 'legacy_ref' || jsonb_build_object(
    'seats', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'person_id', s.person_id, 'job_id', p.job_id,
        'full_name', p.full_name, 'role', s.role, 'from_date', s.from_date, 'to_date', s.to_date, 'join_method', s.join_method,
        'end_reason', s.end_reason, 'decision_ref', s.decision_ref, 'election_votes', s.election_votes,
        'workplace', core.state_at(p.id,'workplace'), 'phone', p.phone)
      order by s.to_date is not null, case s.role when 'رئيس المجلس' then 1 when 'نائب الرئيس' then 2 when 'الأمين العام' then 3
               when 'أمين الصندوق' then 4 else 5 end, s.from_date)
      from governance.board_seats s join core.persons p on p.id = s.person_id where s.term_id = t.id), '[]'),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'full_name', p.full_name, 'job_id', p.job_id,
        'position', c.position, 'votes', c.votes, 'rank', c.rank, 'result', c.result) order by c.position desc, c.votes desc nulls last)
      from governance.candidates c join core.persons p on p.id = c.person_id where c.term_id = t.id), '[]'),
    'stats', jsonb_build_object(
      'meetings', (select count(*) from governance.meetings where term_id = t.id and status = 'منعقد'),
      'decisions', (select count(*) from governance.decisions d join governance.meetings m on m.id = d.meeting_id where m.term_id = t.id)))
  from governance.terms t where t.id = t_id
$$;

create or replace function api.meeting_json(m_id uuid) returns jsonb language sql stable as $$
  select to_jsonb(m) - 'legacy_ref' || jsonb_build_object(
    'attendance', coalesce((select jsonb_agg(jsonb_build_object('person_id', a.person_id, 'full_name', p.full_name,
        'job_id', p.job_id, 'status', a.status, 'role', governance.board_role_at(a.person_id, m.meeting_date), 'notes', a.notes)
      order by p.full_name) from governance.attendance a join core.persons p on p.id = a.person_id where a.meeting_id = m.id), '[]'),
    'decisions', coalesce((select jsonb_agg(to_jsonb(d) order by d.seq) from governance.decisions d where d.meeting_id = m.id), '[]'),
    'board', coalesce((select jsonb_agg(jsonb_build_object('person_id', b.person_id, 'role', b.role, 'full_name', p.full_name))
      from governance.board_at(m.meeting_date) b join core.persons p on p.id = b.person_id), '[]'))
  from governance.meeting_summary m where m.id = m_id
$$;

create or replace function api.handle_governance(p_action text, p jsonb, uid uuid) returns jsonb
language plpgsql as $$
declare v_id uuid; v_term uuid; r jsonb; i int; v_old governance.board_seats; v_no int;
begin
  if not core.can(uid,'governance.view') and not core.can(uid,'governance.manage') then return api.err('غير مسموح.'); end if;
  v_term := coalesce((api.t(p,'termId'))::uuid, (select id from governance.terms where status = 'جارية' limit 1));

  if p_action = 'GOV_OVERVIEW' then
    return api.ok(jsonb_build_object('term', api.term_json(v_term),
      'terms', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status) order by start_date desc) from governance.terms), '[]'),
      'canManage', core.can(uid,'governance.manage')));

  elsif p_action = 'GOV_LIST_MEETINGS' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'meeting_no', meeting_no,
      'title', title, 'kind', kind, 'meeting_date', meeting_date, 'status', status, 'present', present, 'seats', seats,
      'decisions_count', decisions_count) order by meeting_date desc, meeting_no desc)
      from governance.meeting_summary where term_id = v_term), '[]')));

  elsif p_action = 'GOV_GET_MEETING' then
    r := api.meeting_json((p->>'id')::uuid);
    if r is null then return api.err('غير موجود.'); end if;
    return api.ok(jsonb_build_object('meeting', r));

  elsif p_action = 'GOV_LIST_DECISIONS' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'decision_no', d.decision_no,
      'text', d.text, 'category', d.category, 'amount', d.amount, 'status', d.status, 'meeting_id', m.id,
      'meeting_title', m.title, 'meeting_date', m.meeting_date, 'votes_for', d.votes_for, 'votes_against', d.votes_against,
      'votes_abstain', d.votes_abstain) order by m.meeting_date desc, d.seq)
      from governance.decisions d join governance.meetings m on m.id = d.meeting_id
      where m.term_id = v_term and (api.t(p,'category') is null or d.category = api.t(p,'category'))
        and (api.t(p,'q') is null or d.text ilike '%' || api.t(p,'q') || '%' or d.decision_no = api.t(p,'q'))), '[]')));
  end if;

  -- ── الكتابة ──
  if not core.can(uid,'governance.manage') then return api.err('غير مسموح.'); end if;

  if p_action = 'GOV_SAVE_TERM' then
    r := p->'term';
    if (r->>'id') is null then
      insert into governance.terms(term_no, title, election_date, start_date, end_date, approval_ref, approval_date, target_seats, opening_balance, status, notes)
      values ((api.t(r,'term_no'))::int, api.t(r,'title'), (api.t(r,'election_date'))::date, (api.t(r,'start_date'))::date,
        (api.t(r,'end_date'))::date, api.t(r,'approval_ref'), (api.t(r,'approval_date'))::date, (api.t(r,'target_seats'))::int,
        (api.t(r,'opening_balance'))::numeric, coalesce(api.t(r,'status'),'مخططة'), api.t(r,'notes')) returning id into v_id;
    else
      update governance.terms set term_no = (api.t(r,'term_no'))::int, title = api.t(r,'title'), election_date = (api.t(r,'election_date'))::date,
        start_date = (api.t(r,'start_date'))::date, end_date = (api.t(r,'end_date'))::date, approval_ref = api.t(r,'approval_ref'),
        approval_date = (api.t(r,'approval_date'))::date, target_seats = (api.t(r,'target_seats'))::int,
        opening_balance = (api.t(r,'opening_balance'))::numeric, status = coalesce(api.t(r,'status'), status), notes = api.t(r,'notes')
      where id = (r->>'id')::uuid returning id into v_id;
    end if;
    return api.ok(jsonb_build_object('term', api.term_json(v_id)));

  elsif p_action = 'GOV_ADD_SEAT' then
    v_id := coalesce((api.t(p,'personId'))::uuid, api.pid_by_job(api.t(p,'jobId')));
    if v_id is null then return api.err('العضو غير موجود.'); end if;
    if not core.is_union_beneficiary(v_id, coalesce((api.t(p,'fromDate'))::date, current_date)) then
      return api.err('عضوية المجلس لأعضاء النقابة العامة النشطين فقط.'); end if;
    insert into governance.board_seats(term_id, person_id, role, from_date, join_method, replaces_seat_id, decision_ref, election_votes)
    values (v_term, v_id, api.t(p,'role'), (api.t(p,'fromDate'))::date, coalesce(api.t(p,'joinMethod'),'انتخاب'),
            (api.t(p,'replacesSeatId'))::uuid, api.t(p,'decisionRef'), (api.t(p,'votes'))::int);
    perform governance.sync_board_roles();
    return api.ok(jsonb_build_object('term', api.term_json(v_term)));

  elsif p_action = 'GOV_END_SEAT' then
    if api.t(p,'reason') is null or api.t(p,'toDate') is null then return api.err('تاريخ الانتهاء والسبب مطلوبان.'); end if;
    update governance.board_seats set to_date = (api.t(p,'toDate'))::date, end_reason = api.t(p,'reason'),
      decision_ref = coalesce(api.t(p,'decisionRef'), decision_ref) where id = (p->>'seatId')::uuid and to_date is null
    returning * into v_old;
    if v_old.id is null then return api.err('المقعد غير موجود أو منتهي.'); end if;
    -- تغيير المنصب: نفس الشخص يبدأ مقعداً بمنصب جديد من اليوم التالي
    if api.t(p,'newRole') is not null then
      insert into governance.board_seats(term_id, person_id, role, from_date, join_method, decision_ref)
      values (v_old.term_id, v_old.person_id, api.t(p,'newRole'), v_old.to_date + 1, 'توزيع مناصب', api.t(p,'decisionRef'));
    end if;
    perform governance.sync_board_roles();
    return api.ok(jsonb_build_object('term', api.term_json(v_old.term_id)));

  elsif p_action = 'GOV_SAVE_MEETING' then
    r := p->'meeting';
    if api.t(r,'title') is null or api.t(r,'meeting_date') is null then return api.err('العنوان والتاريخ مطلوبان.'); end if;
    if (r->>'id') is null then
      v_no := coalesce((api.t(r,'meeting_no'))::int, (select coalesce(max(meeting_no),0) + 1 from governance.meetings where term_id = v_term));
      insert into governance.meetings(term_id, meeting_no, title, kind, meeting_date, meeting_time, venue, agenda, status, minutes_ref, notes)
      values (v_term, v_no, api.t(r,'title'), coalesce(api.t(r,'kind'),'عادي'), (api.t(r,'meeting_date'))::date, api.t(r,'meeting_time'),
        api.t(r,'venue'), coalesce(r->'agenda','[]'), coalesce(api.t(r,'status'),'منعقد'), api.t(r,'minutes_ref'), api.t(r,'notes'))
      returning id, meeting_no into v_id, v_no;
    else
      update governance.meetings set title = api.t(r,'title'), kind = coalesce(api.t(r,'kind'), kind), meeting_date = (api.t(r,'meeting_date'))::date,
        meeting_time = api.t(r,'meeting_time'), venue = api.t(r,'venue'), agenda = coalesce(r->'agenda', agenda),
        status = coalesce(api.t(r,'status'), status), minutes_ref = api.t(r,'minutes_ref'), notes = api.t(r,'notes')
      where id = (r->>'id')::uuid returning id, meeting_no into v_id, v_no;
      if v_id is null then return api.err('الاجتماع غير موجود.'); end if;
    end if;
    if r ? 'attendance' then
      delete from governance.attendance where meeting_id = v_id;
      insert into governance.attendance(meeting_id, person_id, status, notes)
      select v_id, (a->>'person_id')::uuid, a->>'status', api.t(a,'notes') from jsonb_array_elements(r->'attendance') a;
    end if;
    if r ? 'decisions' then
      -- القرارات تُحدَّث بترتيبها؛ القرار المسجّل لا يُحذف (يُلغى بحالة «ملغى»)
      i := 0;
      for r in select * from jsonb_array_elements(p->'meeting'->'decisions') loop
        i := i + 1;
        insert into governance.decisions(meeting_id, decision_no, seq, text, category, amount, votes_for, votes_against, votes_abstain, status, follow_up)
        values (v_id, v_no || '/' || i, i, api.t(r,'text'), coalesce(api.t(r,'category'),'إداري'), (api.t(r,'amount'))::numeric,
          (api.t(r,'votes_for'))::int, (api.t(r,'votes_against'))::int, (api.t(r,'votes_abstain'))::int, coalesce(api.t(r,'status'),'معتمد'), api.t(r,'follow_up'))
        on conflict (meeting_id, seq) do update set text = excluded.text, category = excluded.category, amount = excluded.amount,
          votes_for = excluded.votes_for, votes_against = excluded.votes_against, votes_abstain = excluded.votes_abstain,
          status = excluded.status, follow_up = excluded.follow_up;
      end loop;
      if exists (select 1 from governance.decisions where meeting_id = v_id and seq > i and status <> 'ملغى') then
        return api.err('لا يُحذف قرار مسجّل — غيّر حالته إلى «ملغى».');
      end if;
    end if;
    return api.ok(jsonb_build_object('meeting', api.meeting_json(v_id)));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

-- ── استيراد الحوكمة من نسخة MyNekaba (قابل للتكرار عبر legacy_ref) ──
create or replace function api.import_governance(p jsonb) returns jsonb language plpgsql as $$
declare t jsonb := p->'term'; v_term uuid; r jsonb; a jsonb; v_pid uuid; v_mid uuid; i int; n jsonb := '{}'; miss jsonb := '[]';
        v_seat uuid;
begin
  select id into v_term from governance.terms where legacy_ref = t->>'legacy_ref';
  if v_term is null then
    insert into governance.terms(term_no, title, election_date, start_date, end_date, approval_ref, approval_date, target_seats, opening_balance, status, legacy_ref)
    values ((api.t(t,'term_no'))::int, api.t(t,'title'), (api.t(t,'election_date'))::date, (api.t(t,'start_date'))::date, (api.t(t,'end_date'))::date,
      api.t(t,'approval_ref'), (api.t(t,'approval_date'))::date, (api.t(t,'target_seats'))::int, (api.t(t,'opening_balance'))::numeric,
      'جارية', t->>'legacy_ref') returning id into v_term;
  end if;
  for r in select * from jsonb_array_elements(p->'candidates') loop
    v_pid := api.pid_by_job(r->>'job_id');
    if v_pid is null then miss := miss || jsonb_build_object('type','مرشح','job_id',r->>'job_id'); continue; end if;
    insert into governance.candidates(term_id, person_id, position, nomination_date, votes, result)
    values (v_term, v_pid, r->>'position', (api.t(r,'nomination_date'))::date, (api.t(r,'votes'))::int, api.t(r,'result'))
    on conflict (term_id, person_id, position) do update set votes = excluded.votes, result = excluded.result;
  end loop;
  -- الرتبة بالأصوات
  update governance.candidates c set rank = x.rk from (select id, rank() over (partition by term_id, position order by votes desc nulls last) rk
    from governance.candidates where term_id = v_term) x where x.id = c.id;
  for r in select * from jsonb_array_elements(p->'seats') loop
    v_pid := api.pid_by_job(r->>'job_id');
    if v_pid is null then miss := miss || jsonb_build_object('type','مقعد','job_id',r->>'job_id'); continue; end if;
    if not exists (select 1 from governance.board_seats where legacy_ref = r->>'legacy_ref') then
      insert into governance.board_seats(term_id, person_id, role, from_date, to_date, join_method, end_reason, decision_ref, election_votes, election_rank, legacy_ref)
      values (v_term, v_pid, r->>'role', (api.t(r,'from_date'))::date, (api.t(r,'to_date'))::date, r->>'join_method', api.t(r,'end_reason'),
        api.t(r,'decision_ref'), (api.t(r,'votes'))::int, (api.t(r,'rank'))::int, r->>'legacy_ref');
    end if;
  end loop;
  -- ربط مقعد التصعيد بالمقعد الذي حلّ محله
  for r in select * from jsonb_array_elements(p->'seats') loop
    if api.t(r,'replaces_legacy') is not null then
      update governance.board_seats s set replaces_seat_id = (select id from governance.board_seats where legacy_ref = r->>'replaces_legacy')
      where s.legacy_ref = r->>'legacy_ref';
    end if;
  end loop;
  for r in select * from jsonb_array_elements(p->'meetings') loop
    select id into v_mid from governance.meetings where legacy_ref = r->>'legacy_ref';
    if v_mid is not null then continue; end if;
    insert into governance.meetings(term_id, meeting_no, title, kind, meeting_date, meeting_time, venue, agenda, status, notes, legacy_ref)
    values (v_term, (api.t(r,'meeting_no'))::int, r->>'title', r->>'kind', (r->>'meeting_date')::date, api.t(r,'meeting_time'), api.t(r,'venue'),
      coalesce(r->'agenda','[]'), 'منعقد', api.t(r,'notes'), r->>'legacy_ref') returning id into v_mid;
    for a in select * from jsonb_array_elements(coalesce(r->'attendance','[]')) loop
      v_pid := api.pid_by_job(a->>'job_id');
      if v_pid is null then miss := miss || jsonb_build_object('type','حضور','job_id',a->>'job_id'); continue; end if;
      insert into governance.attendance(meeting_id, person_id, status) values (v_mid, v_pid, a->>'status') on conflict do nothing;
    end loop;
    i := 0;
    for a in select * from jsonb_array_elements(coalesce(r->'decisions','[]')) loop
      i := i + 1;
      insert into governance.decisions(meeting_id, decision_no, seq, text, category, votes_for, votes_against, votes_abstain)
      values (v_mid, coalesce(api.t(r,'meeting_no'), 'L' || substr(md5(r->>'legacy_ref'),1,6)) || '/' || i, i, a->>'text',
        coalesce(api.t(a,'category'),'إداري'), (api.t(a,'for'))::int, (api.t(a,'against'))::int, (api.t(a,'abstain'))::int);
    end loop;
  end loop;
  perform governance.sync_board_roles();
  return api.ok(jsonb_build_object('term_id', v_term,
    'seats', (select count(*) from governance.board_seats where term_id = v_term),
    'candidates', (select count(*) from governance.candidates where term_id = v_term),
    'meetings', (select count(*) from governance.meetings where term_id = v_term),
    'decisions', (select count(*) from governance.decisions d join governance.meetings m on m.id = d.meeting_id where m.term_id = v_term),
    'attendance', (select count(*) from governance.attendance a join governance.meetings m on m.id = a.meeting_id where m.term_id = v_term),
    'missing', miss));
end $$;

-- الموجّه: فرع الحوكمة + الاستيراد
create or replace function api.handle(p_action text, p jsonb, s jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare uid uuid;
begin
  if p_action like 'IMPORT\_%' or p_action like 'GOV\_%' then
    uid := api.session_user(s);
    if uid is null then return api.err('انتهت الجلسة. سجّل الدخول مرة أخرى.') || '{"expired":true}'; end if;
    perform set_config('erp.reason', coalesce(p->>'reason', ''), true);
    if p_action = 'IMPORT_GOVERNANCE' then
      if not core.can(uid,'data.import') then return api.err('غير مسموح.'); end if;
      return api.import_governance(p);
    elsif p_action like 'IMPORT\_%' then return api.handle_import(p_action, p, uid);
    else return api.handle_governance(p_action, p, uid);
    end if;
  end if;
  return api.handle_core(p_action, p, s);
exception
  when check_violation then return api.err(coalesce(nullif(sqlerrm,''),'قيمة غير صحيحة'));
  when unique_violation then return api.err('القيمة مسجّلة من قبل.');
  when invalid_datetime_format or datetime_field_overflow then return api.err('تاريخ غير صحيح (yyyy-mm-dd).');
  when invalid_text_representation then return api.err('قيمة غير صحيحة.');
end $$;

-- ملف العضو يعرض مقاعده في المجلس
create or replace function api.profile(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'person', to_jsonb(pc) - 'legacy_ref',
    'family', coalesce((select jsonb_agg(to_jsonb(f) - 'books_key' order by f.relation, f.birth_date) from core.family_members f where f.person_id = p_id and f.active), '[]'),
    'movements', coalesce((select jsonb_agg(to_jsonb(m) order by m.effective_date desc, m.created_at desc) from core.person_movements m where m.person_id = p_id), '[]'),
    'periods', coalesce((select jsonb_agg(to_jsonb(x) order by x.field, x.from_date) from core.person_periods x where x.person_id = p_id), '[]'),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from core.change_requests r where r.person_id = p_id), '[]'),
    'board', coalesce((select jsonb_agg(jsonb_build_object('role', s.role, 'from_date', s.from_date, 'to_date', s.to_date,
        'join_method', s.join_method, 'term', t.title) order by s.from_date desc)
      from governance.board_seats s join governance.terms t on t.id = s.term_id where s.person_id = p_id), '[]'),
    'boardRoleToday', governance.board_role_at(p_id),
    'eligibleToday', core.is_union_beneficiary(p_id),
    'completeness', api.completeness(p_id))
  from core.person_current pc where pc.id = p_id
$$;
revoke all on all functions in schema api from public, anon, authenticated;
revoke all on all functions in schema governance from public, anon, authenticated;
