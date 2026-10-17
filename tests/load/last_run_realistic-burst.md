# Load test report (realistic-burst)

- Target: http://127.0.0.1:54321 (local Supabase stack on this PC)
- Students: 60 of 60 requested, run on 2026-10-17T07:14:40.188Z
- Feed subscription: all
- Realtime: 740 attempt updates and 1359 event inserts reached the dashboard client

| Phase | Call | Count | Errors | p50 | p95 | p99 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A start storm | anonymous sign-in | 60 | 0 | 119 ms | 202 ms | 214 ms | 214 ms |
| A start storm | get_live_test | 60 | 0 | 214 ms | 350 ms | 378 ms | 378 ms |
| A start storm | start_attempt | 60 | 0 | 64 ms | 226 ms | 260 ms | 260 ms |
| B steady exam | log_events | 545 | 0 | 20 ms | 52 ms | 87 ms | 198 ms |
| B steady exam | realtime: event -> dashboard | 579 | 0 | 1.38 s | 2.51 s | 3.87 s | 5.80 s |
| B steady exam | dashboard poll: list attempts | 6 | 0 | 8 ms | 53 ms | 53 ms | 53 ms |
| B steady exam | heartbeat | 352 | 0 | 20 ms | 57 ms | 87 ms | 104 ms |
| B steady exam | realtime: heartbeat -> dashboard | 350 | 0 | 279 ms | 542 ms | 573 ms | 597 ms |
| C all locked | heartbeat | 88 | 0 | 98 ms | 218 ms | 219 ms | 219 ms |
| C all locked | log_events | 60 | 0 | 164 ms | 218 ms | 219 ms | 219 ms |
| C all locked | dashboard poll: list attempts | 2 | 0 | 5 ms | 37 ms | 37 ms | 37 ms |
| C all locked | dashboard feed initial load (60 ids) | 1 | 0 | 22 ms | 22 ms | 22 ms | 22 ms |
| C all locked | realtime: heartbeat -> dashboard | 90 | 0 | 425 ms | 683 ms | 690 ms | 690 ms |
| C all locked | realtime: event -> dashboard | 180 | 0 | 601 ms | 683 ms | 684 ms | 684 ms |
| D unlock all | teacher: insert unlock command | 60 | 0 | 63 ms | 99 ms | 100 ms | 100 ms |
| D unlock all | heartbeat | 63 | 0 | 21 ms | 80 ms | 88 ms | 88 ms |
| D unlock all | realtime: heartbeat -> dashboard | 62 | 0 | 305 ms | 517 ms | 564 ms | 564 ms |
| D unlock all | dashboard poll: list attempts | 1 | 0 | 21 ms | 21 ms | 21 ms | 21 ms |
| D unlock all | unlock click -> student unlocked | 1 | 0 | 2.49 s | 2.49 s | 2.49 s | 2.49 s |
| E reconnect burst | heartbeat | 117 | 0 | 71 ms | 193 ms | 196 ms | 197 ms |
| E reconnect burst | log_events | 60 | 0 | 147 ms | 195 ms | 197 ms | 197 ms |
| E reconnect burst | realtime: heartbeat -> dashboard | 110 | 0 | 795 ms | 1.49 s | 1.60 s | 1.60 s |
| E reconnect burst | realtime: event -> dashboard | 600 | 0 | 1.15 s | 1.60 s | 1.60 s | 1.60 s |
| E reconnect burst | dashboard poll: list attempts | 1 | 0 | 35 ms | 35 ms | 35 ms | 35 ms |
| E reconnect burst | status updates caught up after burst | 1 | 0 | 2.72 s | 2.72 s | 2.72 s | 2.72 s |
| E reconnect burst | feed drain after burst (time to last message) | 1 | 0 | 1.43 s | 1.43 s | 1.43 s | 1.43 s |
| F end test | teacher: end_test | 1 | 0 | 5 ms | 5 ms | 5 ms | 5 ms |
| F end test | heartbeat | 62 | 0 | 30 ms | 81 ms | 98 ms | 98 ms |
| F end test | realtime: heartbeat -> dashboard | 8 | 0 | 352 ms | 587 ms | 587 ms | 587 ms |
| F end test | dashboard poll: list attempts | 1 | 0 | 37 ms | 37 ms | 37 ms | 37 ms |
| F end test | end_test -> student sees closed | 1 | 0 | 2.48 s | 2.48 s | 2.48 s | 2.48 s |
| F end test | log_events | 5 | 5 | - | - | - | - |
| G integrity + report | report: events page (1000 rows) | 2 | 0 | 58 ms | 384 ms | 384 ms | 384 ms |
| G integrity + report | dashboard poll: list attempts | 1 | 0 | 61 ms | 61 ms | 61 ms | 61 ms |
| G integrity + report | report: score + heatmap for all students (in the browser) | 1 | 0 | 3 ms | 3 ms | 3 ms | 3 ms |

## Errors
- F end test / log_events: {"attempt is finished":5}

## Findings
- No problems found in this run.
