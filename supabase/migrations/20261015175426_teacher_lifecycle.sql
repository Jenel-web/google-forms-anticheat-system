-- M3: test lifecycle through RPCs only (Go live with the D7 attestation, End with D13), and the late-submission flag.
-- Re-runnable: the column is added only if missing, policies are dropped and recreated, functions are created or replaced.
-- Run it after the init migration.

alter table public.tests add column if not exists attested_at timestamptz;

-- Teachers edit title, link and settings of a DRAFT test. Status changes only through go_live / end_test.
revoke insert, update on public.tests from authenticated;
grant insert (title, form_id, form_url, settings) on public.tests to authenticated;
grant update (title, form_id, form_url, settings) on public.tests to authenticated;

drop policy if exists tests_owner_all on public.tests;
drop policy if exists tests_owner_select on public.tests;
create policy tests_owner_select on public.tests for select
  using (owner_id = auth.uid() and public.is_teacher());
drop policy if exists tests_owner_insert on public.tests;
create policy tests_owner_insert on public.tests for insert
  with check (owner_id = auth.uid() and public.is_teacher() and status = 'draft');
drop policy if exists tests_owner_update on public.tests;
create policy tests_owner_update on public.tests for update
  using (owner_id = auth.uid() and public.is_teacher() and status = 'draft')
  with check (owner_id = auth.uid() and public.is_teacher() and status = 'draft');
drop policy if exists tests_owner_delete on public.tests;
create policy tests_owner_delete on public.tests for delete
  using (owner_id = auth.uid() and public.is_teacher());

-- D7: the teacher attests that "Limit to 1 response" and verified emails are on in Google Forms.
-- We cannot check it without the Forms API (D3), so the attestation is recorded.
create or replace function public.go_live(p_test_id uuid, p_one_response boolean, p_verified_email boolean)
returns public.tests
language plpgsql security definer set search_path = public as $$
declare
  v_test public.tests;
begin
  if not public.is_teacher() then
    raise exception 'not a teacher' using errcode = '42501';
  end if;
  if not (coalesce(p_one_response, false) and coalesce(p_verified_email, false)) then
    raise exception 'confirm both Google Form settings before going live' using errcode = '22023';
  end if;
  select * into v_test from public.tests where id = p_test_id and owner_id = auth.uid() for update;
  if not found then
    raise exception 'test not found' using errcode = '42501';
  end if;
  if v_test.status <> 'draft' then
    raise exception 'only a draft test can go live';
  end if;
  begin
    update public.tests set status = 'live', attested_at = now() where id = v_test.id returning * into v_test;
  exception when unique_violation then
    raise exception 'this form is already live in another test' using errcode = '23505';
  end;
  return v_test;
end
$$;

-- D13 step 2: the test becomes ended and every unfinished attempt is closed. Each student's next heartbeat
-- returns closed = true, so the extension ends the session within about 5 seconds.
create or replace function public.end_test(p_test_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_test   public.tests;
  v_closed int;
begin
  if not public.is_teacher() then
    raise exception 'not a teacher' using errcode = '42501';
  end if;
  select * into v_test from public.tests where id = p_test_id and owner_id = auth.uid() for update;
  if not found then
    raise exception 'test not found' using errcode = '42501';
  end if;
  if v_test.status <> 'live' then
    raise exception 'only a live test can be ended';
  end if;
  update public.attempts set status = 'closed', ended_at = now()
  where test_id = v_test.id and status not in ('submitted', 'abandoned', 'closed');
  get diagnostics v_closed = row_count;
  update public.tests set status = 'ended' where id = v_test.id;
  return jsonb_build_object('closed', v_closed);
end
$$;

-- A submission after End is flagged submitted_after_close (D13). finish_attempt stays idempotent: the first
-- final status wins, but a 'submitted' arriving on a closed attempt leaves one flag event behind.
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
  if v_att.status in ('submitted', 'abandoned', 'closed') then
    if v_att.status = 'closed' and p_status = 'submitted'
       and not exists (select 1 from public.events where attempt_id = v_att.id and type = 'submitted_after_close') then
      insert into public.events (attempt_id, t, type) values (v_att.id, now(), 'submitted_after_close');
    end if;
    return;
  end if;
  update public.attempts set status = p_status, ended_at = now() where id = v_att.id;
end
$$;

revoke execute on function public.go_live(uuid, boolean, boolean), public.end_test(uuid) from public, anon;
grant execute on function public.go_live(uuid, boolean, boolean) to authenticated;
grant execute on function public.end_test(uuid) to authenticated;
revoke execute on function public.finish_attempt(uuid, text) from public, anon;
grant execute on function public.finish_attempt(uuid, text) to authenticated;
