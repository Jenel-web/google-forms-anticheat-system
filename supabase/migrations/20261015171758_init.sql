-- ExamGuard M2: tables, RLS (teacher side) and RPCs (student side). See PRD section 8.
-- Written to be re-runnable: tables, indexes and functions are only created or replaced, policies and the trigger are
-- dropped and recreated, and the realtime publication is only added to when needed. If you paste the files into the
-- SQL editor by hand, run them in filename order (this one, then teacher_lifecycle).

-- ============ tables ============
create table if not exists public.tests (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  form_id     text not null check (char_length(form_id) < 200),
  form_url    text not null,
  status      text not null default 'draft' check (status in ('draft', 'live', 'ended')),
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists tests_one_live_per_form on public.tests (form_id) where status = 'live';
create index if not exists tests_owner_idx on public.tests (owner_id);

create table if not exists public.attempts (
  id                uuid primary key default gen_random_uuid(),
  test_id           uuid not null references public.tests on delete cascade,
  student_uid       uuid not null references auth.users on delete cascade,
  student_name      text not null check (char_length(student_name) between 1 and 100),
  student_email     text not null check (char_length(student_email) <= 200),
  chrome_email      text check (char_length(chrome_email) <= 200),
  verified          boolean not null default false,
  status            text not null default 'active'
                    check (status in ('active', 'away', 'warned', 'locked', 'submitted', 'abandoned', 'closed')),
  strikes           int not null default 0 check (strikes between 0 and 100),
  current_q         jsonb check (pg_column_size(current_q) < 512),
  extension_version text check (char_length(extension_version) <= 40),
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  last_heartbeat    timestamptz not null default now()
);
create index if not exists attempts_test_idx on public.attempts (test_id);
create index if not exists attempts_student_test_idx on public.attempts (student_uid, test_id);
-- a student has at most one unfinished attempt per test (makes start_attempt race-safe)
create unique index if not exists attempts_one_open_per_student on public.attempts (test_id, student_uid)
  where status not in ('submitted', 'abandoned', 'closed');

-- seq and received_at are additions to the PRD sketch (NFR-3): seq makes retries idempotent and lets gaps be proven;
-- received_at is the server's arrival time, which a changed device clock cannot fake.
create table if not exists public.events (
  id           bigint generated always as identity primary key,
  attempt_id   uuid not null references public.attempts on delete cascade,
  seq          int,
  t            timestamptz not null,
  received_at  timestamptz not null default now(),
  type         text not null check (char_length(type) between 1 and 40),
  q            jsonb check (pg_column_size(q) < 512),
  data         jsonb not null default '{}'::jsonb check (pg_column_size(data) < 2048)
);
create index if not exists events_attempt_t_idx on public.events (attempt_id, t);
create unique index if not exists events_attempt_seq_idx on public.events (attempt_id, seq) where seq is not null;

create table if not exists public.commands (
  id          bigint generated always as identity primary key,
  attempt_id  uuid not null references public.attempts on delete cascade,
  type        text not null check (type in ('unlock')),
  created_by  uuid not null default auth.uid() references auth.users,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz
);
create index if not exists commands_pending_idx on public.commands (attempt_id) where consumed_at is null;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists tests_touch on public.tests;
create trigger tests_touch before update on public.tests
  for each row execute function public.touch_updated_at();

-- ============ table privileges ============
-- Students (anonymous users are in the authenticated role) get no table access at all; they use the RPCs.
revoke all on public.tests, public.attempts, public.events, public.commands from anon, authenticated;
grant select, insert, update, delete on public.tests to authenticated;
grant select on public.attempts, public.events to authenticated;
grant select, insert on public.commands to authenticated;

-- ============ RLS (teacher side) ============
alter table public.tests enable row level security;
alter table public.attempts enable row level security;
alter table public.events enable row level security;
alter table public.commands enable row level security;

-- true for real (non-anonymous) signed-in users
create or replace function public.is_teacher() returns boolean
language sql stable set search_path = public as $$
  select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

drop policy if exists tests_owner_all on public.tests;
create policy tests_owner_all on public.tests for all
  using (owner_id = auth.uid() and public.is_teacher())
  with check (owner_id = auth.uid() and public.is_teacher());

drop policy if exists attempts_owner_read on public.attempts;
create policy attempts_owner_read on public.attempts for select
  using (public.is_teacher() and exists (
    select 1 from public.tests t where t.id = test_id and t.owner_id = auth.uid()));

drop policy if exists events_owner_read on public.events;
create policy events_owner_read on public.events for select
  using (public.is_teacher() and exists (
    select 1 from public.attempts a join public.tests t on t.id = a.test_id
    where a.id = attempt_id and t.owner_id = auth.uid()));

-- the PRD sketch only checked is_teacher() on insert, which let any teacher unlock another teacher's student
drop policy if exists commands_owner_read on public.commands;
create policy commands_owner_read on public.commands for select
  using (public.is_teacher() and exists (
    select 1 from public.attempts a join public.tests t on t.id = a.test_id
    where a.id = attempt_id and t.owner_id = auth.uid()));
drop policy if exists commands_owner_insert on public.commands;
create policy commands_owner_insert on public.commands for insert
  with check (public.is_teacher() and exists (
    select 1 from public.attempts a join public.tests t on t.id = a.test_id
    where a.id = attempt_id and t.owner_id = auth.uid()));

-- ============ RPCs (student side) ============
create or replace function public.get_live_test(p_form_id text)
returns table (id uuid, title text, settings jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return query
    select t.id, t.title, t.settings
    from public.tests t
    where t.form_id = p_form_id and t.status = 'live';
end
$$;

create or replace function public.start_attempt(
  p_form_id text, p_name text, p_email text, p_chrome_email text default null, p_ext_version text default null)
returns public.attempts
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_test  public.tests;
  v_name  text := btrim(coalesce(p_name, ''));
  v_email text := btrim(coalesce(p_email, ''));
  v_att   public.attempts;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_test from public.tests where form_id = p_form_id and status = 'live';
  if not found then
    raise exception 'test not live' using errcode = 'P0001';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  if char_length(v_email) > 200 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  select * into v_att from public.attempts
  where test_id = v_test.id and student_uid = v_uid
    and status not in ('submitted', 'abandoned', 'closed');
  if found then
    return v_att;
  end if;

  begin
    insert into public.attempts
      (test_id, student_uid, student_name, student_email, chrome_email, verified, extension_version)
    values
      (v_test.id, v_uid, v_name, v_email, nullif(btrim(coalesce(p_chrome_email, '')), ''),
       nullif(btrim(coalesce(p_chrome_email, '')), '') is not null
         and lower(btrim(p_chrome_email)) = lower(v_email),
       p_ext_version)
    returning * into v_att;
  exception when unique_violation then
    select * into v_att from public.attempts
    where test_id = v_test.id and student_uid = v_uid
      and status not in ('submitted', 'abandoned', 'closed');
  end;
  return v_att;
end
$$;

create or replace function public.log_events(p_attempt_id uuid, p_events jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_att public.attempts;
  v_n   int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_att from public.attempts where id = p_attempt_id and student_uid = auth.uid();
  if not found then
    raise exception 'attempt not found' using errcode = '42501';
  end if;
  if v_att.status in ('submitted', 'abandoned', 'closed') then
    raise exception 'attempt is finished';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'events must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 50 then
    raise exception 'too many events' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_events) e where jsonb_typeof(e) <> 'object') then
    raise exception 'each event must be an object' using errcode = '22023';
  end if;

  -- on conflict makes a retried batch idempotent
  insert into public.events (attempt_id, seq, t, type, q, data)
  select p_attempt_id,
         (e ->> 'seq')::int,
         (e ->> 't')::timestamptz,
         e ->> 'type',
         e -> 'q',
         coalesce(e -> 'data', '{}'::jsonb)
  from jsonb_array_elements(p_events) e
  on conflict (attempt_id, seq) where seq is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

create or replace function public.heartbeat(
  p_attempt_id uuid, p_status text, p_strikes int, p_q jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_att    public.attempts;
  v_test   public.tests;
  v_cmds   jsonb;
  v_status text := p_status;
  v_strikes int := p_strikes;
  v_max    int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_att from public.attempts
  where id = p_attempt_id and student_uid = auth.uid() for update;
  if not found then
    raise exception 'attempt not found' using errcode = '42501';
  end if;
  if v_att.status in ('submitted', 'abandoned', 'closed') then
    return jsonb_build_object('status', v_att.status, 'strikes', v_att.strikes,
                              'commands', '[]'::jsonb, 'closed', v_att.status = 'closed', 'finished', true);
  end if;
  if p_status not in ('active', 'away', 'warned', 'locked') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_strikes not between 0 and 100 then
    raise exception 'invalid strikes' using errcode = '22023';
  end if;

  select * into v_test from public.tests where id = v_att.test_id;
  if v_test.status = 'ended' then
    update public.attempts set status = 'closed', ended_at = now(), last_heartbeat = now()
    where id = v_att.id;
    return jsonb_build_object('status', 'closed', 'strikes', v_att.strikes,
                              'commands', '[]'::jsonb, 'closed', true, 'finished', true);
  end if;

  -- atomically claim pending commands: each is delivered exactly once
  with claimed as (
    update public.commands set consumed_at = now()
    where attempt_id = v_att.id and consumed_at is null
    returning id, type
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type) order by id), '[]'::jsonb)
  into v_cmds from claimed;

  if v_cmds @> '[{"type":"unlock"}]'::jsonb and (v_status = 'locked' or v_att.status = 'locked') then
    v_max := greatest(1, least(10, coalesce((v_test.settings ->> 'maxStrikes')::int, 3)));
    v_status := 'active';
    v_strikes := least(v_strikes, v_max - 1);
  end if;

  update public.attempts
  set status = v_status, strikes = v_strikes, current_q = p_q, last_heartbeat = now()
  where id = v_att.id;

  return jsonb_build_object('status', v_status, 'strikes', v_strikes,
                            'commands', v_cmds, 'closed', false, 'finished', false);
end
$$;

create or replace function public.finish_attempt(p_attempt_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_att public.attempts;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_status not in ('submitted', 'abandoned', 'closed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select * into v_att from public.attempts
  where id = p_attempt_id and student_uid = auth.uid() for update;
  if not found then
    raise exception 'attempt not found' using errcode = '42501';
  end if;
  -- idempotent: the first final status wins
  if v_att.status in ('submitted', 'abandoned', 'closed') then
    return;
  end if;
  update public.attempts set status = p_status, ended_at = now() where id = v_att.id;
end
$$;

-- ============ function privileges ============
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_teacher() to authenticated;
grant execute on function public.get_live_test(text) to authenticated;
grant execute on function public.start_attempt(text, text, text, text, text) to authenticated;
grant execute on function public.log_events(uuid, jsonb) to authenticated;
grant execute on function public.heartbeat(uuid, text, int, jsonb) to authenticated;
grant execute on function public.finish_attempt(uuid, text) to authenticated;

-- ============ realtime ============
do $$
declare
  t text;
begin
  foreach t in array array['attempts', 'events'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
