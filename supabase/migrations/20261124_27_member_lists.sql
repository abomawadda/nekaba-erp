-- المرحلة 17: كشوف الأعضاء — تصفية متعددة وتجميعات للتصدير (عرض فقط، بصلاحية profile.view).
create or replace function api.member_list(p jsonb) returns jsonb language sql stable set search_path = core, public as $$
  with base as (
    select c.* from core.person_current c
    where (api.t(p,'workplace') is null or c.workplace = api.t(p,'workplace'))
      and (api.t(p,'union_org') is null or c.union_org = api.t(p,'union_org'))
      and (api.t(p,'member_state') is null or c.member_state = api.t(p,'member_state'))
      and (api.t(p,'job_title') is null or c.job_title = api.t(p,'job_title'))
      and (api.t(p,'grade') is null or c.grade = api.t(p,'grade'))
      and (coalesce(p->>'missing','') = '' or (p->>'missing' = 'phone' and c.phone is null) or (p->>'missing' = 'national_id' and c.national_id is null)
           or (p->>'missing' = 'hire_date' and c.hire_date is null) or (p->>'missing' = 'retirement_date' and c.member_state = 'معاش' and c.retirement_date is null))
      and (coalesce(p->>'retireYear','') = '' or extract(year from c.retirement_date) = (p->>'retireYear')::int)),
  facet as (select 1)
  select jsonb_build_object(
    'total', (select count(*) from base),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'job_id', b.job_id, 'full_name', b.full_name, 'phone', b.phone,
        'union_org', b.union_org, 'member_state', b.member_state, 'workplace', b.workplace, 'job_title', b.job_title, 'grade', b.grade,
        'hire_date', b.hire_date, 'retirement_date', b.retirement_date,
        'family', (select count(*) from core.family_members f where f.person_id = b.id)) order by b.full_name)
      from (select * from base order by full_name limit 3000) b), '[]'),
    'facets', jsonb_build_object(
      'workplace', (select jsonb_object_agg(coalesce(k,'—'), n) from (select workplace k, count(*) n from core.person_current group by 1) q),
      'union_org', (select jsonb_object_agg(coalesce(k,'—'), n) from (select union_org k, count(*) n from core.person_current group by 1) q),
      'member_state', (select jsonb_object_agg(coalesce(k,'—'), n) from (select member_state k, count(*) n from core.person_current group by 1) q),
      'job_title', (select jsonb_object_agg(coalesce(k,'—'), n) from (select job_title k, count(*) n from core.person_current group by 1) q),
      'grade', (select jsonb_object_agg(coalesce(k,'—'), n) from (select grade k, count(*) n from core.person_current group by 1) q)),
    'byWorkplace', (select jsonb_object_agg(coalesce(k,'—'), n) from (select workplace k, count(*) n from base group by 1) q),
    'byState', (select jsonb_object_agg(coalesce(k,'—'), n) from (select member_state k, count(*) n from base group by 1) q))
$$;

create or replace function api.handle_reports(p_action text, p jsonb, uid uuid) returns jsonb language plpgsql as $$
begin
  if p_action = 'REP_MEMBERS' then
    if not core.can(uid,'profile.view') then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object('report', api.member_list(p)));
  end if;
  if not (core.can(uid,'reports.view') or core.can(uid,'finance.view')) then return api.err('غير مسموح.'); end if;
  if p_action = 'REP_OVERVIEW' then
    return api.ok(jsonb_build_object('report', api.report_overview((nullif(p->>'year',''))::int)));
  elsif p_action = 'REP_BUDGET' then
    return api.ok(jsonb_build_object('report', api.budget_report(coalesce((nullif(p->>'year',''))::int, extract(year from now())::int)),
      'canEdit', core.can(uid,'finance.budget')));
  elsif p_action = 'REP_BUDGET_SAVE' then
    if not core.can(uid,'finance.budget') then return api.err('غير مسموح — تحتاج صلاحية إعداد الموازنة.'); end if;
    return api.budget_save(p, uid);
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

revoke all on all functions in schema api from public, anon, authenticated;
