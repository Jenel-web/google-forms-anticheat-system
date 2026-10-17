# Load test report (safe-unlock)

- Target: http://127.0.0.1:54321 (local Supabase stack on this PC)
- Students: 60 of 60 requested, run on 2026-10-17T16:38:11.050Z
- Live status updates (Realtime) received by the dashboard client: 564; alert events shown by the polled feed: 132

| Phase | Call | Count | Errors | p50 | p95 | p99 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| setup | dashboard poll: alert events | 1 | 0 | 18 ms | 18 ms | 18 ms | 18 ms |
| A start storm | anonymous sign-in | 60 | 0 | 255 ms | 347 ms | 383 ms | 383 ms |
| A start storm | get_live_test | 60 | 0 | 190 ms | 284 ms | 312 ms | 312 ms |
| A start storm | start_attempt | 60 | 0 | 64 ms | 174 ms | 278 ms | 278 ms |
| B steady exam | log_events | 354 | 0 | 20 ms | 82 ms | 115 ms | 136 ms |
| B steady exam | dashboard poll: alert events | 5 | 0 | 34 ms | 41 ms | 41 ms | 41 ms |
| B steady exam | alert event -> dashboard feed | 12 | 0 | 2.12 s | 4.84 s | 4.84 s | 4.84 s |
| B steady exam | dashboard poll: list attempts | 4 | 0 | 10 ms | 21 ms | 21 ms | 21 ms |
| B steady exam | heartbeat | 227 | 0 | 21 ms | 64 ms | 82 ms | 109 ms |
| B steady exam | realtime: heartbeat -> dashboard | 227 | 0 | 296 ms | 522 ms | 532 ms | 548 ms |
| C all locked | heartbeat | 96 | 0 | 83 ms | 193 ms | 207 ms | 207 ms |
| C all locked | log_events | 60 | 0 | 137 ms | 206 ms | 207 ms | 207 ms |
| C all locked | dashboard poll: alert events | 2 | 0 | 29 ms | 141 ms | 141 ms | 141 ms |
| C all locked | alert event -> dashboard feed | 120 | 0 | 211 ms | 1.34 s | 1.34 s | 1.34 s |
| C all locked | dashboard poll: list attempts | 2 | 0 | 5 ms | 20 ms | 20 ms | 20 ms |
| C all locked | realtime: heartbeat -> dashboard | 89 | 0 | 605 ms | 606 ms | 606 ms | 606 ms |
| C all locked | alert feed complete after all-locked burst | 1 | 0 | 2.15 s | 2.15 s | 2.15 s | 2.15 s |
| D unlock all | teacher: insert unlock command | 60 | 0 | 72 ms | 113 ms | 115 ms | 115 ms |
| D unlock all | realtime: heartbeat -> dashboard | 126 | 0 | 313 ms | 536 ms | 590 ms | 590 ms |
| D unlock all | heartbeat | 120 | 0 | 20 ms | 66 ms | 90 ms | 114 ms |
| D unlock all | dashboard poll: alert events | 3 | 0 | 40 ms | 61 ms | 61 ms | 61 ms |
| D unlock all | dashboard poll: list attempts | 2 | 0 | 9 ms | 32 ms | 32 ms | 32 ms |
| D unlock all | unlock click -> student unlocked | 1 | 0 | 3.47 s | 3.47 s | 3.47 s | 3.47 s |
| E reconnect burst | heartbeat | 61 | 0 | 190 ms | 363 ms | 382 ms | 382 ms |
| E reconnect burst | log_events | 120 | 0 | 123 ms | 345 ms | 405 ms | 405 ms |
| E reconnect burst | realtime: heartbeat -> dashboard | 62 | 0 | 461 ms | 486 ms | 638 ms | 638 ms |
| E reconnect burst | status updates caught up after burst | 1 | 0 | 530 ms | 530 ms | 530 ms | 530 ms |
| F end test | teacher: end_test | 1 | 0 | 5 ms | 5 ms | 5 ms | 5 ms |
| F end test | heartbeat | 60 | 0 | 20 ms | 77 ms | 81 ms | 81 ms |
| F end test | dashboard poll: alert events | 2 | 0 | 40 ms | 40 ms | 40 ms | 40 ms |
| F end test | dashboard poll: list attempts | 1 | 0 | 20 ms | 20 ms | 20 ms | 20 ms |
| F end test | end_test -> student sees closed | 1 | 0 | 2.73 s | 2.73 s | 2.73 s | 2.73 s |
| F end test | log_events | 5 | 5 | - | - | - | - |
| G integrity + report | report: events page (1000 rows) | 7 | 0 | 121 ms | 252 ms | 252 ms | 252 ms |
| G integrity + report | dashboard poll: list attempts | 1 | 0 | 71 ms | 71 ms | 71 ms | 71 ms |
| G integrity + report | dashboard poll: alert events | 1 | 0 | 25 ms | 25 ms | 25 ms | 25 ms |
| G integrity + report | report: score + heatmap for all students (in the browser) | 1 | 0 | 9 ms | 9 ms | 9 ms | 9 ms |

## Errors
- F end test / log_events: {"attempt is finished":5}

## Findings
- No problems found in this run.
