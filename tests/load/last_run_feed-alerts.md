# Load test report (feed-alerts)

- Target: http://127.0.0.1:54321 (local Supabase stack on this PC)
- Students: 60 of 60 requested, run on 2026-10-17T07:11:40.198Z
- Feed subscription: alerts
- Realtime: 837 attempt updates and 132 event inserts reached the dashboard client

| Phase | Call | Count | Errors | p50 | p95 | p99 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A start storm | anonymous sign-in | 60 | 0 | 123 ms | 190 ms | 194 ms | 194 ms |
| A start storm | get_live_test | 60 | 0 | 210 ms | 296 ms | 340 ms | 340 ms |
| A start storm | start_attempt | 60 | 0 | 49 ms | 135 ms | 192 ms | 192 ms |
| B steady exam | log_events | 557 | 0 | 16 ms | 51 ms | 93 ms | 122 ms |
| B steady exam | realtime: event -> dashboard | 12 | 0 | 998 ms | 1.68 s | 1.68 s | 1.68 s |
| B steady exam | dashboard poll: list attempts | 6 | 0 | 22 ms | 44 ms | 44 ms | 44 ms |
| B steady exam | heartbeat | 357 | 0 | 17 ms | 51 ms | 82 ms | 110 ms |
| B steady exam | realtime: heartbeat -> dashboard | 350 | 0 | 236 ms | 529 ms | 565 ms | 652 ms |
| C all locked | heartbeat | 88 | 0 | 91 ms | 169 ms | 170 ms | 170 ms |
| C all locked | log_events | 60 | 0 | 130 ms | 170 ms | 171 ms | 171 ms |
| C all locked | dashboard poll: list attempts | 2 | 0 | 7 ms | 21 ms | 21 ms | 21 ms |
| C all locked | dashboard feed initial load (60 ids) | 1 | 0 | 22 ms | 22 ms | 22 ms | 22 ms |
| C all locked | realtime: heartbeat -> dashboard | 95 | 0 | 377 ms | 556 ms | 681 ms | 681 ms |
| C all locked | realtime: event -> dashboard | 120 | 0 | 470 ms | 543 ms | 544 ms | 544 ms |
| D unlock all | teacher: insert unlock command | 60 | 0 | 66 ms | 77 ms | 80 ms | 80 ms |
| D unlock all | heartbeat | 60 | 0 | 21 ms | 66 ms | 82 ms | 82 ms |
| D unlock all | realtime: heartbeat -> dashboard | 52 | 0 | 327 ms | 524 ms | 553 ms | 553 ms |
| D unlock all | dashboard poll: list attempts | 1 | 0 | 37 ms | 37 ms | 37 ms | 37 ms |
| D unlock all | unlock click -> student unlocked | 1 | 0 | 2.75 s | 2.75 s | 2.75 s | 2.75 s |
| E reconnect burst | realtime: heartbeat -> dashboard | 220 | 0 | 3.24 s | 9.18 s | 9.84 s | 10.12 s |
| E reconnect burst | heartbeat | 212 | 0 | 35 ms | 262 ms | 294 ms | 298 ms |
| E reconnect burst | log_events | 120 | 0 | 106 ms | 276 ms | 300 ms | 301 ms |
| E reconnect burst | dashboard poll: list attempts | 2 | 0 | 53 ms | 76 ms | 76 ms | 76 ms |
| E reconnect burst | status updates caught up after burst | 1 | 0 | 12.76 s | 12.76 s | 12.76 s | 12.76 s |
| E reconnect burst | feed drain after burst (time to last message) | 1 | 0 | 0 ms | 0 ms | 0 ms | 0 ms |
| F end test | teacher: end_test | 1 | 0 | 5 ms | 5 ms | 5 ms | 5 ms |
| F end test | heartbeat | 60 | 0 | 29 ms | 52 ms | 83 ms | 83 ms |
| F end test | dashboard poll: list attempts | 2 | 0 | 21 ms | 161 ms | 161 ms | 161 ms |
| F end test | end_test -> student sees closed | 1 | 0 | 2.35 s | 2.35 s | 2.35 s | 2.35 s |
| F end test | log_events | 5 | 5 | - | - | - | - |
| G integrity + report | report: events page (1000 rows) | 7 | 0 | 116 ms | 1.07 s | 1.07 s | 1.07 s |
| G integrity + report | report: score + heatmap for all students (in the browser) | 1 | 0 | 9 ms | 9 ms | 9 ms | 9 ms |

## Errors
- F end test / log_events: {"attempt is finished":5}

## Findings
- After a reconnect burst of 6000 events, the live monitor's status updates took 12.76 s to catch up (feed=alerts).
