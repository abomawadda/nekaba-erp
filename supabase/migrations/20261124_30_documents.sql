-- المرحلة 22: الأرشيف الإلكتروني للمستندات (وحدة DOC_).
-- الملفات تُحفظ في قاعدة البيانات (صور مضغوطة أو PDF حتى 3 ميجا) مربوطة بكيان؛ الحذف منطقي؛ التدقيق بلا محتوى الملف.
create table if not exists core.documents (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('cheque','receipt','entry','grant','meeting','decision','person','activity','general')),
  entity_id    text not null,
  doc_type     text not null default 'أخرى',
  title        text not null,
  mime         text not null check (mime in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes   int not null check (size_bytes > 0 and size_bytes <= 3145728),
  content      bytea not null,
  uploaded_by  text,
  uploaded_at  timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   text
);
create index if not exists documents_entity_idx on core.documents(entity_type, entity_id) where deleted_at is null;
alter table core.documents enable row level security;
revoke all on core.documents from public, anon, authenticated;

create or replace function audit.track_document() returns trigger language plpgsql security definer as $$
begin
  insert into audit.log(actor, action, entity, entity_id, before, after, reason)
  values (coalesce(current_setting('erp.actor', true), 'SYSTEM'), tg_op, 'core.documents', coalesce(new.id, old.id)::text,
          case when tg_op <> 'INSERT' then to_jsonb(old) - 'content' end, case when tg_op <> 'DELETE' then to_jsonb(new) - 'content' end,
          nullif(current_setting('erp.reason', true), ''));
  return coalesce(new, old);
end $$;
drop trigger if exists documents_audit on core.documents;
create trigger documents_audit after insert or update or delete on core.documents for each row execute function audit.track_document();

-- صلاحية الكيان: p_write = رفع/حذف
create or replace function api.doc_can(uid uuid, pid uuid, p_type text, p_id text, p_write boolean) returns boolean language sql stable set search_path = core, public as $$
  select core.is_admin(uid) or case p_type
    when 'cheque'   then core.can(uid, case when p_write then 'treasury.cheque.issue' else 'finance.view' end) or (p_write and core.can(uid,'treasury.settlement'))
    when 'receipt'  then core.can(uid, case when p_write then 'treasury.receipt' else 'finance.view' end)
    when 'entry'    then core.can(uid, case when p_write then 'finance.journal' else 'finance.view' end)
    when 'grant'    then core.can(uid, case when p_write then 'grants.review' else 'grants.review' end) or (not p_write and core.can(uid,'grants.approve'))
                         or (pid is not null and exists (select 1 from grants.requests r where r.id::text = p_id and r.person_id = pid
                                                         and (not p_write or r.status in ('مقدَّم','ناقص مستندات'))))
    when 'meeting'  then core.can(uid, case when p_write then 'governance.manage' else 'governance.view' end) or core.can(uid,'governance.manage')
    when 'decision' then core.can(uid, case when p_write then 'governance.manage' else 'governance.view' end) or core.can(uid,'governance.manage')
    when 'person'   then core.can(uid, case when p_write then 'profile.edit' else 'profile.view' end) or (pid is not null and p_id = pid::text)
    when 'activity' then core.can(uid,'activities.manage')
    when 'general'  then core.can(uid, case when p_write then 'finance.journal' else 'audit.view' end) or core.can(uid,'finance.view')
    else false end
$$;

create or replace function api.handle_docs(p_action text, p jsonb, uid uuid, pid uuid) returns jsonb language plpgsql set search_path = core, public as $$
declare v_user text := (select username from core.users where id = uid); d core.documents; v_bytes bytea; v_mime text := api.t(p,'mime');
begin
  perform set_config('erp.actor', coalesce(v_user, 'SYSTEM'), true);

  if p_action = 'DOC_LIST' then
    if not api.doc_can(uid, pid, api.t(p,'entityType'), api.t(p,'entityId'), false) then return api.err('غير مسموح.'); end if;
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'doc_type', doc_type, 'title', title, 'mime', mime,
        'size', size_bytes, 'by', uploaded_by, 'at', uploaded_at) order by uploaded_at desc)
      from core.documents where entity_type = api.t(p,'entityType') and entity_id = api.t(p,'entityId') and deleted_at is null), '[]'),
      'canWrite', api.doc_can(uid, pid, api.t(p,'entityType'), api.t(p,'entityId'), true)));

  elsif p_action = 'DOC_GET' then
    select * into d from core.documents where id = (api.t(p,'id'))::uuid and deleted_at is null;
    if d.id is null or not api.doc_can(uid, pid, d.entity_type, d.entity_id, false) then return api.err('غير موجود أو غير مسموح.'); end if;
    return api.ok(jsonb_build_object('mime', d.mime, 'title', d.title, 'data', encode(d.content, 'base64')));

  elsif p_action = 'DOC_UPLOAD' then
    if not api.doc_can(uid, pid, api.t(p,'entityType'), api.t(p,'entityId'), true) then return api.err('غير مسموح بالرفع هنا.'); end if;
    if v_mime not in ('image/jpeg','image/png','image/webp','application/pdf') then return api.err('نوع الملف غير مسموح (صورة أو PDF فقط).'); end if;
    begin v_bytes := decode(p->>'data', 'base64'); exception when others then return api.err('ملف تالف.'); end;
    if v_bytes is null or length(v_bytes) = 0 then return api.err('الملف فاضي.'); end if;
    if length(v_bytes) > 3145728 then return api.err('الملف أكبر من 3 ميجا.'); end if;
    if (v_mime = 'application/pdf' and substring(v_bytes from 1 for 4) <> '\x25504446'::bytea)
       or (v_mime = 'image/jpeg' and substring(v_bytes from 1 for 3) <> '\xffd8ff'::bytea)
       or (v_mime = 'image/png' and substring(v_bytes from 1 for 4) <> '\x89504e47'::bytea) then return api.err('محتوى الملف لا يطابق نوعه.'); end if;
    if (select count(*) from core.documents where entity_type = api.t(p,'entityType') and entity_id = api.t(p,'entityId') and deleted_at is null) >= 30 then
      return api.err('الحد الأقصى 30 مستنداً لكل سجل.'); end if;
    insert into core.documents(entity_type, entity_id, doc_type, title, mime, size_bytes, content, uploaded_by)
    values (api.t(p,'entityType'), api.t(p,'entityId'), coalesce(api.t(p,'docType'), 'أخرى'), coalesce(api.t(p,'title'), 'مستند'), v_mime, length(v_bytes), v_bytes, v_user)
    returning * into d;
    return api.ok(jsonb_build_object('id', d.id));

  elsif p_action = 'DOC_DELETE' then
    select * into d from core.documents where id = (api.t(p,'id'))::uuid and deleted_at is null;
    if d.id is null then return api.err('غير موجود.'); end if;
    if not (api.doc_can(uid, pid, d.entity_type, d.entity_id, true) and (d.uploaded_by = v_user or core.is_admin(uid) or core.can(uid,'finance.journal'))) then
      return api.err('الحذف لمن رفع المستند أو للمدير.'); end if;
    perform set_config('erp.reason', coalesce(api.t(p,'reason'), ''), true);
    update core.documents set deleted_at = now(), deleted_by = v_user where id = d.id;
    return api.ok();

  elsif p_action = 'DOC_SEARCH' then
    return api.ok(jsonb_build_object('items', coalesce((select jsonb_agg(x order by x.at desc) from (
      select id, entity_type, entity_id, doc_type, title, mime, size_bytes size, uploaded_by "by", uploaded_at at
      from core.documents dd where deleted_at is null
        and (api.t(p,'entityType') is null or entity_type = api.t(p,'entityType'))
        and (api.t(p,'docType') is null or doc_type = api.t(p,'docType'))
        and (api.t(p,'q') is null or title ilike '%' || api.t(p,'q') || '%')
        and api.doc_can(uid, pid, entity_type, entity_id, false)
      order by uploaded_at desc limit 300) x), '[]')));
  end if;
  return api.err('عملية غير معروفة: ' || p_action);
end $$;

do $$ declare d text := pg_get_functiondef('api.handle(text,jsonb,jsonb)'::regprocedure); begin
  if position('DOC\_%' in d) > 0 then return; end if;
  if position($a$or p_action like 'BANK\_%' then$a$ in d) = 0 or position($a$elsif p_action like 'BANK\_%' then return api.handle_bank(p_action, p, uid);$a$ in d) = 0 then
    raise exception 'مرساة الموجّه غير موجودة'; end if;
  d := replace(d, $a$or p_action like 'BANK\_%' then$a$, $a$or p_action like 'BANK\_%' or p_action like 'DOC\_%' then$a$);
  d := replace(d, $a$elsif p_action like 'BANK\_%' then return api.handle_bank(p_action, p, uid);$a$,
    $a$elsif p_action like 'BANK\_%' then return api.handle_bank(p_action, p, uid);
    elsif p_action like 'DOC\_%' then return api.handle_docs(p_action, p, uid, (s->>'pid')::uuid);$a$);
  execute d;
end $$;

revoke all on all functions in schema core, api from public, anon, authenticated;
revoke all on function audit.track_document() from public, anon, authenticated;
