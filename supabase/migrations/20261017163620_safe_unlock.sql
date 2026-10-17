-- Make an unlock survive a dropped connection (load test finding, tests/load/README.md).
--
-- Before: heartbeat marked an unlock command consumed in the same call that returned it. If the student's connection
-- dropped just as the response was lost, the server had unlocked the attempt, the student never heard about it, and their
-- next heartbeat reported 'locked' again, so they stayed locked while the dashboard said "Unlock sent".
--
-- Now: the server counts the unlocks it has applied to each attempt (attempts.unlocked_seq). The extension reports how many
-- it has seen (p_unlocks_seen). A student who reports 'locked' while the server has already unlocked them, and has not seen
-- that unlock, gets it handed over again instead of being overwritten. Callers that do not send p_unlocks_seen (older
-- extension builds) behave exactly as before.
-- Re-runnable.

alter table public.attempts add column if not exists unlocked_seq int not null default 0;

-- p_unlocks_seen is a new argument, so the old four-argument function must go; two overloads would be ambiguous.
drop function if exists public.heartbeat(uuid, text, int, jsonb);

create or replace function public.heartbeat(
  p_attempt_id uuid, p_status text, p_strikes int, p_q jsonb default null, p_unlocks_seen int default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_att     public.attempts;
  v_test    public.tests;
  v_cmds    jsonb;
  v_status  text := p_status;
  v_strikes int := p_strikes;
  v_max     int;
  v_seq     int;
  v_unlock  boolean := false;
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

  -- The student missed an unlock the server already applied: keep the unlock and hand it over again.
  if p_unlocks_seen is not null and p_unlocks_seen < v_att.unlocked_seq
     and p_status = 'locked' and v_att.status <> 'locked' then
    update public.attempts set current_q = p_q, last_heartbeat = now() where id = v_att.id;
    return jsonb_build_object('status', v_att.status, 'strikes', v_att.strikes, 'commands', '[]'::jsonb,
                              'closed', false, 'finished', false, 'unlock', true, 'unlocks', v_att.unlocked_seq);
  end if;

  -- atomically claim pending commands: each is claimed exactly once
  with claimed as (
    update public.commands set consumed_at = now()
    where attempt_id = v_att.id and consumed_at is null
    returning id, type
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type) order by id), '[]'::jsonb)
  into v_cmds from claimed;

  v_seq := v_att.unlocked_seq;
  if v_cmds @> '[{"type":"unlock"}]'::jsonb and (v_status = 'locked' or v_att.status = 'locked') then
    v_max := greatest(1, least(10, coalesce((v_test.settings ->> 'maxStrikes')::int, 3)));
    v_status := 'active';
    v_strikes := least(v_strikes, v_max - 1);
    v_seq := v_seq + 1;
    v_unlock := true;
  end if;

  update public.attempts
  set status = v_status, strikes = v_strikes, current_q = p_q, last_heartbeat = now(), unlocked_seq = v_seq
  where id = v_att.id;

  return jsonb_build_object('status', v_status, 'strikes', v_strikes,
                            'commands', v_cmds, 'closed', false, 'finished', false,
                            'unlock', v_unlock, 'unlocks', v_seq);
end
$$;

revoke execute on function public.heartbeat(uuid, text, int, jsonb, int) from public, anon;
grant execute on function public.heartbeat(uuid, text, int, jsonb, int) to authenticated;
