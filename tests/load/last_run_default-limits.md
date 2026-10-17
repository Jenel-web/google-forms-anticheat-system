# Load test report (default-limits)

- Target: http://127.0.0.1:54321 (local Supabase stack on this PC)
- Students: 60 of 60 requested, run on 2026-10-17T06:59:10.888Z
- Realtime: 565 attempt updates and 5740 event inserts reached the dashboard client

| Phase | Call | Count | Errors | p50 | p95 | p99 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A start storm | anonymous sign-in | 60 | 0 | 138 ms | 231 ms | 236 ms | 236 ms |
| A start storm | get_live_test | 60 | 0 | 243 ms | 324 ms | 353 ms | 353 ms |
| A start storm | start_attempt | 60 | 0 | 28 ms | 193 ms | 221 ms | 221 ms |
| B steady exam | log_events | 525 | 0 | 18 ms | 64 ms | 93 ms | 194 ms |
| B steady exam | realtime: event -> dashboard | 560 | 0 | 1.36 s | 2.44 s | 3.91 s | 4.96 s |
| B steady exam | dashboard poll: list attempts | 6 | 0 | 21 ms | 23 ms | 23 ms | 23 ms |
| B steady exam | heartbeat | 349 | 0 | 20 ms | 55 ms | 76 ms | 80 ms |
| B steady exam | realtime: heartbeat -> dashboard | 349 | 0 | 328 ms | 535 ms | 568 ms | 581 ms |
| C all locked | heartbeat | 90 | 0 | 93 ms | 174 ms | 176 ms | 176 ms |
| C all locked | log_events | 60 | 0 | 99 ms | 174 ms | 175 ms | 175 ms |
| C all locked | dashboard poll: list attempts | 2 | 0 | 5 ms | 8 ms | 8 ms | 8 ms |
| C all locked | dashboard feed initial load (60 ids) | 1 | 0 | 11 ms | 11 ms | 11 ms | 11 ms |
| C all locked | realtime: heartbeat -> dashboard | 90 | 0 | 645 ms | 966 ms | 967 ms | 967 ms |
| C all locked | realtime: event -> dashboard | 180 | 0 | 853 ms | 966 ms | 967 ms | 967 ms |
| D unlock all | heartbeat | 65 | 0 | 35 ms | 223 ms | 450 ms | 450 ms |
| D unlock all | teacher: insert unlock command | 60 | 0 | 49 ms | 74 ms | 74 ms | 74 ms |
| D unlock all | realtime: heartbeat -> dashboard | 55 | 0 | 304 ms | 812 ms | 872 ms | 872 ms |
| D unlock all | dashboard poll: list attempts | 1 | 0 | 32 ms | 32 ms | 32 ms | 32 ms |
| D unlock all | unlock click -> student unlocked | 1 | 0 | 2.59 s | 2.59 s | 2.59 s | 2.59 s |
| E reconnect burst | heartbeat | 66 | 0 | 147 ms | 319 ms | 322 ms | 322 ms |
| E reconnect burst | log_events | 120 | 0 | 125 ms | 297 ms | 316 ms | 318 ms |
| E reconnect burst | realtime: heartbeat -> dashboard | 10 | 0 | 241 ms | 441 ms | 441 ms | 441 ms |
| F end test | teacher: end_test | 1 | 0 | 8 ms | 8 ms | 8 ms | 8 ms |
| F end test | realtime: heartbeat -> dashboard | 55 | 0 | 3.62 s | 7.46 s | 8.41 s | 8.41 s |
| F end test | realtime: event -> dashboard | 4500 | 0 | 4.37 s | 8.07 s | 8.41 s | 8.41 s |
| F end test | heartbeat | 60 | 0 | 20 ms | 59 ms | 83 ms | 83 ms |
| F end test | dashboard poll: list attempts | 2 | 0 | 29 ms | 131 ms | 131 ms | 131 ms |
| F end test | end_test -> student sees closed | 1 | 0 | 2.80 s | 2.80 s | 2.80 s | 2.80 s |
| F end test | log_events | 5 | 5 | - | - | - | - |
| G integrity + report | realtime: event -> dashboard | 500 | 0 | 8.95 s | 9.33 s | 9.33 s | 9.33 s |
| G integrity + report | realtime: heartbeat -> dashboard | 6 | 0 | 8.77 s | 9.32 s | 9.32 s | 9.32 s |
| G integrity + report | report: events page (1000 rows) | 7 | 0 | 117 ms | 216 ms | 216 ms | 216 ms |
| G integrity + report | report: score + heatmap for all students (in the browser) | 1 | 0 | 10 ms | 10 ms | 10 ms | 10 ms |

## Errors
- F end test / log_events: {"attempt is finished":5}

## Findings
- No problems found in this run.
