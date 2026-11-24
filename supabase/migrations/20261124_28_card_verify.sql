-- المرحلة 19: التحقق من بطاقة العضوية برمز QR.
-- لكل عضو رمز عشوائي (24 بايت) غير قابل للتخمين؛ صفحة التحقق العامة تعرض الحد الأدنى فقط (بلا قومي ولا موبايل).
create table if not exists core.member_cards (
  person_id  uuid primary key references core.persons(id) on delete cascade,
  token      text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  issued_at  timestamptz not null default now(),
  issued_by  text
);
alter table core.member_cards enable row level security;
revoke all on core.member_cards from public, anon, authenticated;
drop trigger if exists member_cards_audit on core.member_cards;
create trigger member_cards_audit after insert or update or delete on core.member_cards for each row execute function audit.track();

create or replace function api.card_token(p_person uuid, p_by text, p_reissue boolean default false) returns text language plpgsql set search_path = core, public as $$
declare t text;
begin
  if p_reissue then delete from core.member_cards where person_id = p_person; end if;
  insert into core.member_cards(person_id, issued_by) values (p_person, p_by) on conflict (person_id) do nothing;
  select token into t from core.member_cards where person_id = p_person;
  return t;
end $$;

create or replace function api.verify_card(p jsonb) returns jsonb language sql stable set search_path = core, public as $$
  select coalesce((select api.ok(jsonb_build_object('card', jsonb_build_object(
      'full_name', c.full_name, 'job_id', c.job_id, 'union_org', c.union_org, 'member_state', c.member_state,
      'workplace', c.workplace, 'eligible', core.is_union_beneficiary(c.id, current_date),
      'board_role', (select s.role from governance.board_seats s where s.person_id = c.id and s.to_date is null order by s.from_date desc limit 1),
      'issued_at', m.issued_at, 'checked_at', now())))
    from core.member_cards m join core.person_current c on c.id = m.person_id
    where m.token = api.t(p,'token') and api.t(p,'token') ~ '^[0-9a-f]{48}$'),
    api.err('البطاقة غير صحيحة أو أُلغيت.'))
$$;

-- رمز البطاقة: SYS_CARD (العضو لنفسه، أو الإدارة بصلاحية profile.view لأي عضو؛ reissue يلغي القديم بصلاحية profile.edit)
do $$ declare d text := pg_get_functiondef('api.handle_system(text,jsonb,uuid)'::regprocedure);
  a text := $a$  elsif p_action = 'SYS_AUDIT' then$a$;
begin
  if position('SYS_CARD' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'مرساة handle_system غير موجودة'; end if;
  d := replace(d, a, $b$  elsif p_action = 'SYS_CARD' then
    declare v_pid uuid := coalesce((api.t(p,'personId'))::uuid, (select person_id from core.users where id = uid)); v_own boolean := coalesce(v_pid = (select person_id from core.users where id = uid), false);
    begin
      if v_pid is null then return api.err('الحساب غير مربوط بعضو.'); end if;
      if not v_own and not core.can(uid,'profile.view') then return api.err('غير مسموح.'); end if;
      if coalesce((p->>'reissue')::boolean, false) and not core.can(uid,'profile.edit') then return api.err('إعادة الإصدار تحتاج صلاحية تعديل الملفات.'); end if;
      return api.ok(jsonb_build_object('token', api.card_token(v_pid, v_user, coalesce((p->>'reissue')::boolean, false))));
    end;
$b$ || a);
  execute d;
end $$;

-- الموجّه: VERIFY_CARD عام بلا جلسة (قبل أي فحص)
do $$ declare d text := pg_get_functiondef('api.handle(text,jsonb,jsonb)'::regprocedure);
  a text := E'declare uid uuid;\nbegin\n';
begin
  if position('VERIFY_CARD' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'مرساة الموجّه غير موجودة'; end if;
  d := replace(d, a, a || E'  if p_action = ''VERIFY_CARD'' then return api.verify_card(p); end if;\n');
  execute d;
end $$;

revoke all on all functions in schema core, api from public, anon, authenticated;
