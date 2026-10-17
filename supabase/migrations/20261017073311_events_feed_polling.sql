-- Load test finding (tests/load/README.md): streaming every inserted event row through Realtime makes a burst of events
-- (thousands at once after an outage) delay the live status updates behind them, and can drop messages. The dashboard's
-- alert feed now polls the database for new alert events instead, so events leave the realtime publication. `attempts`
-- stays in it: that is the live status table, about one small update per student every 5 seconds.
-- Re-runnable.

do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events') then
    alter publication supabase_realtime drop table public.events;
  end if;
end
$$;

-- The feed asks for "alert events that arrived in the last few seconds", so index by arrival time.
create index if not exists events_received_at_idx on public.events (received_at);
