# Load test: 60 students

`load.mjs` simulates a class against a Supabase stack. Each simulated student is a separate anonymous user that makes the
same calls the extension makes (`signInAnonymously`, `get_live_test`, `start_attempt`, `heartbeat` every 5 s, `log_events`
batches every 2 s). One teacher client watches through Realtime and the 5 s poll, exactly like the dashboard.

```bash
supabase start && supabase db reset              # local stack with the seed teacher
node tests/load/load.mjs                         # 60 students, 45 s steady phase, ~3 min
STUDENTS=30 STEADY_SECONDS=20 BURST_PER=10 node tests/load/load.mjs
FEED=alerts node tests/load/load.mjs             # dashboard subscribed to alert events only (experiment)
```

Each run writes `tests/load/last_run_<LABEL>.md` (set `LABEL=...`) and removes the test and its simulated users afterwards
(`--keep` to skip). Realtime keeps working through the cleanup deletes, so wait about a minute between runs, or the next
run starts while Realtime is still processing the last one's deletions.

**Hosted projects.** The script refuses a non-local URL unless you pass `--allow-hosted`. If you do, use a throwaway
teacher account and a small `STUDENTS` (25 is a safe smoke test): it creates one test and one anonymous user per student.
The test and its data are deleted at the end, but the anonymous users stay in Authentication, Users and have to be
removed there. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TEACHER_EMAIL` and `TEACHER_PASSWORD`.

## Phases

| | Scenario | What it checks |
| --- | --- | --- |
| A | All students start at the same moment | sign-in, `get_live_test`, `start_attempt` under a burst |
| B | Steady exam: heartbeat every 5 s, events every ~3 s, 20% of students leave once | normal load, heartbeat to dashboard latency |
| C | **Every student locks at the same moment** | write time, dashboard poll, Realtime delivery of 60 locks and 180 events |
| D | **Teacher unlocks all 60 at the same moment** | delivery time, each command consumed exactly once |
| E | **Outage ends: every student flushes a queue at once** | write burst, idempotent replay, Realtime head-of-line blocking |
| F | Teacher ends the test while all 60 work | time until every student sees "closed", late events rejected |
| G | Integrity and report | events stored = events acknowledged, report fetch and scoring time |

## Results (60 students, local Supabase stack, 2026-10-17)

The stack ran on the same PC as the simulated students, so there is no internet round trip and the server is not the
small shared machine a free hosted project has. Read the times as a best case and add your real network latency to each
call. The shape of the behaviour is what carries over.

| Scenario | Result |
| --- | --- |
| Start storm | 60 of 60 started in about 0.5 s. Sign-in p95 about 230 ms, `start_attempt` p95 about 190 ms. |
| Steady exam | 0 errors. `heartbeat` p95 about 55 ms, `log_events` p95 about 65 ms. A student's status change reached the dashboard in about 0.3 s (p50) and 0.5 s (p95). |
| **All 60 locked at once** | All 60 lock writes finished in about 0.18 s. The dashboard poll showed 60 of 60 locked straight away. Realtime showed all 60 locked within about 0.9 to 1.0 s, and all 180 burst events arrived. |
| **Unlock all 60** | The 60 clicks were stored in under 0.1 s. Every student received the unlock: median 2.2 to 3.1 s, worst case about 5.0 s (this is the 5 s heartbeat cadence, not server load). Each command was consumed exactly once. Strikes reset to 2. |
| End test | All 60 saw "closed": median about 2.5 to 2.9 s, worst about 5.0 s. Events sent after the end were rejected as designed. |
| Data integrity | **No event was lost in any run.** Stored events matched what the server acknowledged for every student. Replaying a batch inserted 0 duplicate rows. |
| Report page | 6,700 events fetched in 0.7 to 0.9 s. Scores and heatmap for all 60 students computed in about 10 ms. |
| Realistic reconnect burst (10 queued events per student, 600 total) | Written in 0.2 s. The dashboard caught up in about 2.7 s. |
| **Extreme reconnect burst (100 per student, 6,000 total)** | The database took all of it in 0.3 s. The live monitor did not keep up: Realtime needed 9 to 13 s to drain, status updates queued behind it, and in one of three runs about 1,000 event messages were never delivered to the dashboard. |

## Findings and what was done

1. **The live feed lagged under an extreme burst (fixed).** Thousands of event rows at once slowed Realtime for everything,
   including status updates, and in one run dropped about 1,000 event messages. Events no longer go through Realtime: the
   dashboard's alert feed polls the database (every 5 s, and 0.7 s after a status change arrives live). Re-run with the
   same 6,000-event burst: status updates caught up in about 1 s (was 12.8 s or never), and the feed showed 132 of 132
   alerts. `FEED=alerts` (filtering the stream instead) did not help, because Realtime reads every inserted row.
2. **The status table was already protected by the 5 s poll**, which reads the database directly.
3. **Unlock and End take up to 5 s to reach a student.** This is the heartbeat interval, the same at 1 or 60 students.
4. **A lost unlock is repaired (fixed).** If the response carrying an unlock was lost, the student stayed locked while the
   dashboard said "Unlock sent". The server now counts the unlocks it applied and re-sends a missed one. In this test 6 of
   60 students "lost" the response and all 6 were unlocked by the next heartbeat (up to about 10 s instead of 5 s). The
   dashboard label also expires after 15 s so the teacher can click again.
5. **Noisy events are capped (done).** At most 10 copy, paste, right-click or shortcut events per minute are stored per
   student (30 for tab flicker, 60 for question changes); the rest become one "events_capped" summary. Retries now use
   jitter and long queues go out paced, so students do not all hit the server together after an outage.
6. **Not testable locally: the anonymous sign-in limit.** Supabase limits anonymous sign-ins per hour per IP address (the
   config shows 30), but the local stack does not enforce it, so all 60 started in every run. A hosted project does, so
   students sharing one school IP could be blocked from starting. Check and raise it under Authentication, Rate Limits.
7. **Hosted free tier will be slower and stricter than this run.** Run this script with `--allow-hosted` and 25 students.
8. **Still open: events for a closed attempt are rejected.** Events from the last ~2 s before End, and the backlog of a
   student who was offline when the test ended, are lost. Letting the server accept events dated before the close time
   would fix it.
