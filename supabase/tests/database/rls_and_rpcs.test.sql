begin;
create extension if not exists pgtap with schema extensions;
select plan(71);

-- fixtures (as postgres). T1 + the live test 'seed-form-id-local-dev' come from seed.sql.
insert into auth.users (id, instance_id, aud, role, email, is_anonymous) values
  ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'teacher2@example.com', false),
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', null, true);
insert into public.tests (id, owner_id, title, form_id, form_url, status) values
  ('22222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Teacher 2 exam', 'form-two',
   'https://docs.google.com/forms/d/e/form-two/viewform', 'live');

insert into public.tests (id, owner_id, title, form_id, form_url) values
  ('f0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Draft A', 'form-three', 'https://docs.google.com/forms/d/e/form-three/viewform'),
  ('f0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Draft B', 'form-four', 'https://docs.google.com/forms/d/e/form-four/viewform'),
  ('f0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Draft C (same form as the live seed test)', 'seed-form-id-local-dev', 'https://docs.google.com/forms/d/e/x/viewform');

-- ---------- not signed in (role anon) ----------
set local role anon;
select throws_ok($$select * from public.tests$$, '42501', null, 'anon cannot read tests');
select throws_ok($$select * from public.attempts$$, '42501', null, 'anon cannot read attempts');
select throws_ok($$select * from public.events$$, '42501', null, 'anon cannot read events');
select throws_ok($$select * from public.get_live_test('seed-form-id-local-dev')$$, '42501', null, 'anon cannot call get_live_test');

-- ---------- student 1 (anonymous user) ----------
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;

select is((select count(*) from public.tests)::int, 0, 'student cannot read tests');
select is(public.is_teacher(), false, 'anonymous user is not a teacher');
select throws_ok($$insert into public.tests (title, form_id, form_url, status) values ('x', 'y', 'z', 'live')$$, '42501', null, 'student cannot insert a test');
select throws_ok($$insert into public.commands (attempt_id, type) values (gen_random_uuid(), 'unlock')$$, '42501', null, 'student cannot insert a command');
select throws_ok($$update public.attempts set strikes = 0$$, '42501', null, 'student cannot update attempts directly');
select is((select count(*) from public.get_live_test('seed-form-id-local-dev'))::int, 1, 'get_live_test finds the live test');
select is((select count(*) from public.get_live_test('nope'))::int, 0, 'get_live_test finds nothing for an unknown form');

select throws_ok($$select public.start_attempt('nope', 'Ann', 'ann@example.com')$$, 'P0001', null, 'start_attempt rejects a form that is not live');
select throws_ok($$select public.start_attempt('seed-form-id-local-dev', '  ', 'ann@example.com')$$, '22023', null, 'start_attempt rejects an empty name');
select throws_ok($$select public.start_attempt('seed-form-id-local-dev', 'Ann', 'not-an-email')$$, '22023', null, 'start_attempt rejects a bad email');

select set_config('test.a1',
  (public.start_attempt('seed-form-id-local-dev', 'Ann', 'ann@example.com', 'Ann@Example.com', '1.0')).id::text, true);
select is((public.start_attempt('seed-form-id-local-dev', 'Ann', 'ann@example.com', 'Ann@Example.com', '1.0')).id::text,
          current_setting('test.a1'), 'start_attempt returns the same attempt on the second call (FR-26)');
select is((select count(*) from public.attempts)::int, 0, 'student cannot read attempts, not even their own');

select is(public.log_events(current_setting('test.a1')::uuid,
  '[{"seq":1,"t":"2026-10-15T10:00:00Z","type":"session_start"},{"seq":2,"t":"2026-10-15T10:00:01Z","type":"strike","q":{"i":1,"n":5},"data":{"reason":"tab_opened"}}]'::jsonb),
  2, 'log_events inserts a batch');
select is(public.log_events(current_setting('test.a1')::uuid,
  '[{"seq":1,"t":"2026-10-15T10:00:00Z","type":"session_start"}]'::jsonb),
  0, 'a retried batch is ignored (idempotent by seq)');
select throws_ok(format($f$select public.log_events(%L, jsonb_build_array(jsonb_build_object('seq', 900, 't', '2026-10-15T10:00:00Z', 'type', 'paste',
  'data', jsonb_build_object('x', (select string_agg(md5(g::text), '') from generate_series(1, 200) g)))))$f$, current_setting('test.a1')),
  '23514', null, 'an oversized event is rejected');
select throws_ok(format($f$select public.heartbeat(%L, 'submitted', 0)$f$, current_setting('test.a1')), '22023', null, 'heartbeat cannot set a final status');

-- ---------- student 2 ----------
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;

select set_config('test.a2',
  (public.start_attempt('seed-form-id-local-dev', 'Bob', 'bob@example.com', 'someone-else@example.com', '1.0')).id::text, true);
select isnt(current_setting('test.a2'), current_setting('test.a1'), 'a second student gets a different attempt');
select throws_ok(format($f$select public.log_events(%L, '[{"seq":50,"t":"2026-10-15T10:00:00Z","type":"click"}]'::jsonb)$f$, current_setting('test.a1')),
  '42501', null, 'student 2 cannot log events to student 1''s attempt');
select throws_ok(format($f$select public.heartbeat(%L, 'active', 0)$f$, current_setting('test.a1')),
  '42501', null, 'student 2 cannot heartbeat student 1''s attempt');
select throws_ok(format($f$select public.finish_attempt(%L, 'submitted')$f$, current_setting('test.a1')),
  '42501', null, 'student 2 cannot finish student 1''s attempt');

-- ---------- teacher 2 (does not own the seed test) ----------
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;

select is(public.is_teacher(), true, 'a signed-in non-anonymous user is a teacher');
select is((select count(*) from public.attempts)::int, 0, 'teacher 2 cannot read teacher 1''s attempts');
select is((select count(*) from public.events)::int, 0, 'teacher 2 cannot read teacher 1''s events');
select throws_ok(format($f$insert into public.commands (attempt_id, type) values (%L, 'unlock')$f$, current_setting('test.a1')),
  '42501', null, 'teacher 2 cannot unlock teacher 1''s student');
select throws_ok($$update public.attempts set strikes = 0$$, '42501', null, 'a teacher cannot update attempts directly');

-- ---------- teacher 1 (owns the seed test) ----------
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;

select is((select count(*) from public.attempts where id in (current_setting('test.a1')::uuid, current_setting('test.a2')::uuid))::int, 2,
  'teacher 1 reads both attempts on their test');
select is((select count(*) from public.events where attempt_id = current_setting('test.a1')::uuid)::int, 2, 'teacher 1 reads the events');
select lives_ok(format($f$insert into public.commands (attempt_id, type) values (%L, 'unlock')$f$, current_setting('test.a1')),
  'teacher 1 can unlock their own student');

-- ---------- unlock is delivered exactly once ----------
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;

select set_config('test.hb1', public.heartbeat(current_setting('test.a1')::uuid, 'locked', 3)::text, true);
select is(jsonb_array_length(current_setting('test.hb1')::jsonb -> 'commands'), 1, 'first heartbeat returns the unlock command');
select is(current_setting('test.hb1')::jsonb ->> 'status', 'active', 'unlock sets the status back to active');
select is((current_setting('test.hb1')::jsonb ->> 'strikes')::int, 2, 'unlock sets strikes to max - 1');
select is(jsonb_array_length(public.heartbeat(current_setting('test.a1')::uuid, 'active', 2) -> 'commands'), 0,
  'the command is consumed exactly once');

-- ---------- an unlock survives a dropped response ----------
-- (student 1 is active with 1 unlock applied so far)
select set_config('test.s1', public.heartbeat(current_setting('test.a1')::uuid, 'locked', 3, null, 1)::text, true);
select is(current_setting('test.s1')::jsonb ->> 'status', 'locked', 'a fresh lock reported with the current unlock count is accepted');
select is((current_setting('test.s1')::jsonb ->> 'unlock')::boolean, false, 'a fresh lock is not mistaken for a missed unlock');

reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
select lives_ok(format($f$insert into public.commands (attempt_id, type) values (%L, 'unlock')$f$, current_setting('test.a1')),
  'teacher unlocks the student again');
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;

-- this response is "lost": the student never sees it
select set_config('test.s2', public.heartbeat(current_setting('test.a1')::uuid, 'locked', 3, null, 1)::text, true);
select is((current_setting('test.s2')::jsonb ->> 'unlock')::boolean, true, 'the server applies the unlock');
select is((current_setting('test.s2')::jsonb ->> 'unlocks')::int, 2, 'and counts it');

-- the student still believes they are locked and has seen only 1 unlock
select set_config('test.s3', public.heartbeat(current_setting('test.a1')::uuid, 'locked', 3, null, 1)::text, true);
select is((current_setting('test.s3')::jsonb ->> 'unlock')::boolean, true, 'the missed unlock is handed over again');
select is(current_setting('test.s3')::jsonb ->> 'status', 'active', 'the stale locked report does not undo the unlock');
select is(jsonb_array_length(current_setting('test.s3')::jsonb -> 'commands'), 0, 'no command is replayed, the unlock flag carries it');
reset role;
select is((select status from public.attempts where id = current_setting('test.a1')::uuid), 'active', 'the attempt is still unlocked on the server');
do $$ begin perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;

-- the student has now seen 2 unlocks
select set_config('test.s4', public.heartbeat(current_setting('test.a1')::uuid, 'active', 2, null, 2)::text, true);
select is((current_setting('test.s4')::jsonb ->> 'unlock')::boolean, false, 'once the unlock is seen it is not repeated');
select is(current_setting('test.s4')::jsonb ->> 'status', 'active', 'and the student stays unlocked');

-- a caller that does not know its unlock count (older build, cleared storage) never triggers a repeat
select set_config('test.s5', public.heartbeat(current_setting('test.a1')::uuid, 'locked', 3)::text, true);
select is(current_setting('test.s5')::jsonb ->> 'status', 'locked', 'without an unlock count a locked report is taken as it is');
select is((current_setting('test.s5')::jsonb ->> 'unlock')::boolean, false, 'and no unlock is repeated');

-- ---------- finishing ----------
select lives_ok(format($f$select public.finish_attempt(%L, 'submitted')$f$, current_setting('test.a1')), 'student can finish their attempt');
select throws_ok(format($f$select public.log_events(%L, '[{"seq":901,"t":"2026-10-15T10:05:00Z","type":"click"}]'::jsonb)$f$, current_setting('test.a1')),
  'P0001', null, 'events after the attempt finished are rejected');
select lives_ok(format($f$select public.finish_attempt(%L, 'abandoned')$f$, current_setting('test.a1')), 'finishing twice is allowed');

reset role;
select is((select status from public.attempts where id = current_setting('test.a1')::uuid), 'submitted',
  'the first final status wins');

-- ---------- go live (D7) and end (D13) ----------
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;

select lives_ok($$insert into public.tests (title, form_id, form_url) values ('Direct', 'form-five', 'https://docs.google.com/forms/d/e/form-five/viewform')$$,
  'a teacher can create a draft test directly');
select throws_ok($$update public.tests set status = 'live' where id = 'f0000000-0000-0000-0000-000000000001'$$, '42501', null,
  'a teacher cannot set the status directly');
select throws_ok($$select public.go_live('f0000000-0000-0000-0000-000000000001', true, false)$$, '22023', null, 'go live needs both D7 boxes (one missing)');
select throws_ok($$select public.go_live('f0000000-0000-0000-0000-000000000001', false, false)$$, '22023', null, 'go live needs both D7 boxes (none)');
select is((public.go_live('f0000000-0000-0000-0000-000000000001', true, true)).status, 'live', 'go live with both boxes ticked');
do $$ declare n int; begin
  update public.tests set title = 'changed' where id = 'f0000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  perform set_config('test.rows', n::text, true);
end $$;
select is(current_setting('test.rows')::int, 0, 'a live test can no longer be edited');
select throws_ok($$select public.go_live('f0000000-0000-0000-0000-000000000003', true, true)$$, '23505', null,
  'a form can be live in only one test');

reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
select throws_ok($$select public.go_live('f0000000-0000-0000-0000-000000000002', true, true)$$, '42501', null, 'teacher 2 cannot take teacher 1''s test live');

reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;
select throws_ok($$select public.go_live('f0000000-0000-0000-0000-000000000002', true, true)$$, '42501', null, 'a student cannot go live');
select throws_ok($$select public.end_test('f0000000-0000-0000-0000-000000000001')$$, '42501', null, 'a student cannot end a test');
select set_config('test.a3', (public.start_attempt('form-three', 'Ann', 'ann@example.com')).id::text, true);

reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;
select set_config('test.a4', (public.start_attempt('form-three', 'Bob', 'bob@example.com')).id::text, true);
select public.finish_attempt(current_setting('test.a4')::uuid, 'submitted');

reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
select throws_ok($$select public.end_test('f0000000-0000-0000-0000-000000000001')$$, '42501', null, 'teacher 2 cannot end teacher 1''s test');

reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","is_anonymous":false}', true); end $$;
set local role authenticated;
select is((public.end_test('f0000000-0000-0000-0000-000000000001') ->> 'closed')::int, 1, 'end_test closes the unfinished attempts only');
select throws_ok($$select public.end_test('f0000000-0000-0000-0000-000000000001')$$, 'P0001', null, 'a test can be ended only once');

reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;
select is((public.heartbeat(current_setting('test.a3')::uuid, 'active', 0) ->> 'closed')::boolean, true, 'the next heartbeat reports closed');
select public.finish_attempt(current_setting('test.a3')::uuid, 'submitted');
select public.finish_attempt(current_setting('test.a3')::uuid, 'submitted');

reset role;
select is((select count(*) from public.events where attempt_id = current_setting('test.a3')::uuid and type = 'submitted_after_close')::int, 1,
  'a submission after End is flagged submitted_after_close, once');
select is((select status from public.attempts where id = current_setting('test.a3')::uuid), 'closed', 'the attempt stays closed');
select is((select count(*) from public.events where attempt_id = current_setting('test.a4')::uuid and type = 'submitted_after_close')::int, 0,
  'a submission before End is not flagged');

-- ---------- ending a test closes open attempts on the next heartbeat (D13) ----------
update public.tests set status = 'ended' where id = '22222222-2222-2222-2222-222222222222';
do $$ begin perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":true}', true); end $$;
set local role authenticated;
select is((public.heartbeat(current_setting('test.a2')::uuid, 'active', 0) ->> 'closed')::boolean, true,
  'heartbeat reports closed once the test has ended');

select * from finish();
rollback;
