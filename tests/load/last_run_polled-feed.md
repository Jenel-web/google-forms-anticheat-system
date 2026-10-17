# Load test report (polled-feed)

- Target: http://127.0.0.1:54321 (local Supabase stack on this PC)
- Students: 60 of 60 requested, run on 2026-10-17T07:34:46.344Z
- Live status updates (Realtime) received by the dashboard client: 627; alert events shown by the polled feed: 132

| Phase | Call | Count | Errors | p50 | p95 | p99 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| setup | dashboard poll: alert events | 1 | 0 | 22 ms | 22 ms | 22 ms | 22 ms |
| A start storm | anonymous sign-in | 60 | 0 | 121 ms | 221 ms | 230 ms | 230 ms |
| A start storm | get_live_test | 60 | 0 | 216 ms | 246 ms | 276 ms | 276 ms |
| A start storm | start_attempt | 60 | 0 | 95 ms | 183 ms | 195 ms | 195 ms |
| B steady exam | log_events | 527 | 0 | 19 ms | 71 ms | 104 ms | 143 ms |
| B steady exam | dashboard poll: alert events | 13 | 0 | 14 ms | 33 ms | 33 ms | 33 ms |
| B steady exam | alert event -> dashboard feed | 12 | 0 | 2.18 s | 8.75 s | 8.75 s | 8.75 s |
| B steady exam | dashboard poll: list attempts | 6 | 0 | 8 ms | 21 ms | 21 ms | 21 ms |
| B steady exam | heartbeat | 349 | 0 | 20 ms | 54 ms | 69 ms | 84 ms |
| B steady exam | realtime: heartbeat -> dashboard | 342 | 0 | 285 ms | 527 ms | 549 ms | 573 ms |
| C all locked | realtime: heartbeat -> dashboard | 90 | 0 | 640 ms | 642 ms | 642 ms | 642 ms |
| C all locked | log_events | 60 | 0 | 113 ms | 161 ms | 163 ms | 163 ms |
| C all locked | heartbeat | 88 | 0 | 96 ms | 160 ms | 162 ms | 162 ms |
| C all locked | dashboard poll: list attempts | 2 | 0 | 5 ms | 21 ms | 21 ms | 21 ms |
| C all locked | dashboard poll: alert events | 2 | 0 | 36 ms | 58 ms | 58 ms | 58 ms |
| C all locked | alert event -> dashboard feed | 120 | 0 | 265 ms | 265 ms | 266 ms | 266 ms |
| C all locked | alert feed complete after all-locked burst | 1 | 0 | 2.20 s | 2.20 s | 2.20 s | 2.20 s |
| D unlock all | realtime: heartbeat -> dashboard | 63 | 0 | 338 ms | 535 ms | 574 ms | 574 ms |
| D unlock all | teacher: insert unlock command | 60 | 0 | 69 ms | 81 ms | 84 ms | 84 ms |
| D unlock all | heartbeat | 60 | 0 | 20 ms | 72 ms | 80 ms | 80 ms |
| D unlock all | dashboard poll: alert events | 1 | 0 | 49 ms | 49 ms | 49 ms | 49 ms |
| D unlock all | dashboard poll: list attempts | 1 | 0 | 57 ms | 57 ms | 57 ms | 57 ms |
| D unlock all | unlock click -> student unlocked | 1 | 0 | 2.66 s | 2.66 s | 2.66 s | 2.66 s |
| E reconnect burst | heartbeat | 69 | 0 | 143 ms | 279 ms | 292 ms | 292 ms |
| E reconnect burst | log_events | 120 | 0 | 98 ms | 279 ms | 297 ms | 297 ms |
| E reconnect burst | realtime: heartbeat -> dashboard | 71 | 0 | 450 ms | 451 ms | 536 ms | 536 ms |
| E reconnect burst | status updates caught up after burst | 1 | 0 | 1.05 s | 1.05 s | 1.05 s | 1.05 s |
| F end test | heartbeat | 63 | 0 | 20 ms | 55 ms | 87 ms | 87 ms |
| F end test | teacher: end_test | 1 | 0 | 5 ms | 5 ms | 5 ms | 5 ms |
| F end test | dashboard poll: alert events | 3 | 0 | 25 ms | 38 ms | 38 ms | 38 ms |
| F end test | realtime: heartbeat -> dashboard | 1 | 0 | 523 ms | 523 ms | 523 ms | 523 ms |
| F end test | dashboard poll: list attempts | 1 | 0 | 41 ms | 41 ms | 41 ms | 41 ms |
| F end test | end_test -> student sees closed | 1 | 0 | 2.24 s | 2.24 s | 2.24 s | 2.24 s |
| F end test | log_events | 5 | 5 | - | - | - | - |
| G integrity + report | dashboard poll: list attempts | 1 | 0 | 623 ms | 623 ms | 623 ms | 623 ms |
| G integrity + report | report: events page (1000 rows) | 7 | 0 | 104 ms | 137 ms | 137 ms | 137 ms |
| G integrity + report | dashboard poll: alert events | 1 | 0 | 23 ms | 23 ms | 23 ms | 23 ms |
| G integrity + report | report: score + heatmap for all students (in the browser) | 1 | 0 | 9 ms | 9 ms | 9 ms | 9 ms |

## Errors
- F end test / log_events: {"attempt is finished":5}

## Findings
- No problems found in this run.
