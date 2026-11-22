-- المرحلة 2 — الحوكمة: الدورات، المرشحون، مقاعد المجلس بتواريخ، الاجتماعات، الحضور، القرارات
create schema if not exists governance;
revoke all on schema governance from public, anon, authenticated;

create table governance.terms (
  id              uuid primary key default gen_random_uuid(),
  term_no         int,
  title           text not null,
  election_date   date,
  start_date      date not null,
  end_date        date,
  approval_ref    text,
  approval_date   date,
  target_seats    int check (target_seats > 0),
  opening_balance numeric(14,2),
  closing_balance numeric(14,2),
  status          text not null default 'جارية' check (status in ('مخططة','جارية','منتهية')),
  notes           text,
  legacy_ref      text,
  created_at      timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create unique index on governance.terms ((true)) where status = 'جارية';   -- دورة جارية واحدة فقط

create table governance.candidates (
  id              uuid primary key default gen_random_uuid(),
  term_id         uuid not null references governance.terms(id),
  person_id       uuid not null references core.persons(id),
  position        text not null check (position in ('رئيس','عضو')),
  nomination_date date,
  votes           int check (votes >= 0),
  rank            int,
  result          text check (result in ('فائز أصلي','احتياطي','لم يفز','منسحب')),
  notes           text,
  unique (term_id, person_id, position)
);

-- المقعد = شخص في منصب لفترة. أي سؤال «كان عضو مجلس يوم X؟» يُجاب من هنا.
create table governance.board_seats (
  id               uuid primary key default gen_random_uuid(),
  term_id          uuid not null references governance.terms(id),
  person_id        uuid not null references core.persons(id),
  role             text not null check (role in ('رئيس المجلس','نائب الرئيس','الأمين العام','أمين الصندوق','عضو مجلس إدارة')),
  from_date        date not null,
  to_date          date,
  join_method      text not null default 'انتخاب' check (join_method in ('انتخاب','تصعيد','تعيين','توزيع مناصب')),
  replaces_seat_id uuid references governance.board_seats(id),
  end_reason       text,
  decision_ref     text,
  election_votes   int,
  election_rank    int,
  legacy_ref       text,
  created_at       timestamptz not null default now(),
  check (to_date is null or to_date >= from_date)
);
create index on governance.board_seats (person_id, from_date);

-- لا تداخل: نفس الشخص لا يشغل مقعدين في نفس الوقت، والمناصب الفردية لا يشغلها اثنان معاً
create or replace function governance.check_seat() returns trigger language plpgsql as $$
begin
  if exists (select 1 from governance.board_seats s where s.id <> new.id and s.person_id = new.person_id
             and daterange(s.from_date, s.to_date, '[]') && daterange(new.from_date, new.to_date, '[]')) then
    raise exception 'العضو له مقعد آخر في نفس الفترة' using errcode = 'check_violation';
  end if;
  if new.role <> 'عضو مجلس إدارة' and exists (select 1 from governance.board_seats s where s.id <> new.id and s.role = new.role
             and daterange(s.from_date, s.to_date, '[]') && daterange(new.from_date, new.to_date, '[]')) then
    raise exception 'منصب «%» مشغول في نفس الفترة', new.role using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger seats_check before insert or update on governance.board_seats for each row execute function governance.check_seat();

create table governance.meetings (
  id          uuid primary key default gen_random_uuid(),
  term_id     uuid not null references governance.terms(id),
  meeting_no  int,
  title       text not null,
  kind        text not null default 'عادي' check (kind in ('عادي','طارئ','سنوي','جمعية عمومية')),
  meeting_date date not null,
  meeting_time text,
  venue       text,
  agenda      jsonb not null default '[]',
  status      text not null default 'منعقد' check (status in ('مجدول','منعقد','ملغى')),
  minutes_ref text,
  notes       text,
  legacy_ref  text,
  created_at  timestamptz not null default now(),
  unique (term_id, meeting_no)
);

create table governance.attendance (
  meeting_id uuid not null references governance.meetings(id) on delete cascade,
  person_id  uuid not null references core.persons(id),
  seat_id    uuid references governance.board_seats(id),
  status     text not null check (status in ('حاضر','غائب بعذر','غائب','مدعو')),
  notes      text,
  primary key (meeting_id, person_id)
);

create table governance.decisions (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references governance.meetings(id) on delete restrict,
  decision_no   text not null unique,              -- مثال: 12/3 (رقم الاجتماع/ترتيب القرار)
  seq           int not null,
  text          text not null,
  category      text not null default 'إداري'
                check (category in ('صرف','دعم نشاط','منحة','إعفاء','تكليف','موازنة','لائحة','إداري','أخرى')),
  amount        numeric(14,2) check (amount >= 0),
  votes_for     int, votes_against int, votes_abstain int,
  status        text not null default 'معتمد' check (status in ('معتمد','مرفوض','مؤجل','ملغى')),
  follow_up     text,
  created_at    timestamptz not null default now(),
  unique (meeting_id, seq)
);
create index on governance.decisions (category, status);

do $$ declare t text; begin
  foreach t in array array['terms','candidates','board_seats','meetings','attendance','decisions'] loop
    execute format('create trigger %I after insert or update or delete on governance.%I for each row execute function audit.track()', t || '_audit', t);
    execute format('alter table governance.%I enable row level security', t);
    execute format('revoke all on governance.%I from anon, authenticated', t);
  end loop;
end $$;

-- منصب الشخص في تاريخ (null = ليس عضو مجلس)
create or replace function governance.board_role_at(p_person uuid, p_date date default current_date)
returns text language sql stable as $$
  select role from governance.board_seats where person_id = p_person
    and from_date <= p_date and (to_date is null or to_date >= p_date) order by from_date desc limit 1
$$;

-- المجلس في تاريخ
create or replace function governance.board_at(p_date date default current_date)
returns table (seat_id uuid, person_id uuid, role text, from_date date, join_method text)
language sql stable as $$
  select id, person_id, role, from_date, join_method from governance.board_seats
  where from_date <= p_date and (to_date is null or to_date >= p_date)
  order by case role when 'رئيس المجلس' then 1 when 'نائب الرئيس' then 2 when 'الأمين العام' then 3 when 'أمين الصندوق' then 4 else 5 end
$$;

-- صلاحيات أعضاء المجلس على المنصة تتبع المقعد تلقائياً (BOARD + TREASURER لأمين الصندوق)
create or replace function governance.sync_board_roles() returns void language plpgsql as $$
begin
  delete from core.user_roles ur where ur.role in ('BOARD','TREASURER') and ur.granted_by = 'BOARD_SYNC'
    and not exists (select 1 from core.users u join governance.board_at() b on b.person_id = u.person_id
                    where u.id = ur.user_id and (ur.role = 'BOARD' or b.role = 'أمين الصندوق'));
  insert into core.user_roles(user_id, role, granted_by)
  select u.id, 'BOARD', 'BOARD_SYNC' from core.users u join governance.board_at() b on b.person_id = u.person_id
  on conflict do nothing;
  insert into core.user_roles(user_id, role, granted_by)
  select u.id, 'TREASURER', 'BOARD_SYNC' from core.users u join governance.board_at() b on b.person_id = u.person_id
  where b.role = 'أمين الصندوق' on conflict do nothing;
end $$;

-- النصاب: عدد الحاضرين مقابل المقاعد المشغولة يوم الاجتماع
create or replace view governance.meeting_summary as
select m.*, t.title as term_title,
  (select count(*) from governance.attendance a where a.meeting_id = m.id and a.status = 'حاضر') as present,
  (select count(*) from governance.board_at(m.meeting_date)) as seats,
  (select count(*) from governance.decisions d where d.meeting_id = m.id) as decisions_count
from governance.meetings m join governance.terms t on t.id = m.term_id;
