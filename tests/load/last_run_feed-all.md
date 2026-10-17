# Load test report (feed-all)

- Target: http://127.0.0.1:54321 (local Supabase stack on this PC)
- Students: 60 of 60 requested, run on 2026-10-17T07:07:45.063Z
- Feed subscription: all
- Realtime: 1313 attempt updates and 5760 event inserts reached the dashboard client

| Phase | Call | Count | Errors | p50 | p95 | p99 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A start storm | anonymous sign-in | 60 | 0 | 115 ms | 192 ms | 200 ms | 200 ms |
| A start storm | get_live_test | 60 | 0 | 209 ms | 289 ms | 302 ms | 302 ms |
| A start storm | start_attempt | 60 | 0 | 45 ms | 210 ms | 222 ms | 222 ms |
| B steady exam | log_events | 549 | 0 | 20 ms | 55 ms | 72 ms | 122 ms |
| B steady exam | realtime: event -> dashboard | 580 | 0 | 1.33 s | 2.31 s | 3.78 s | 4.41 s |
| B steady exam | dashboard poll: list attempts | 6 | 0 | 9 ms | 53 ms | 53 ms | 53 ms |
| B steady exam | heartbeat | 349 | 0 | 19 ms | 55 ms | 82 ms | 90 ms |
| B steady exam | realtime: heartbeat -> dashboard | 348 | 0 | 235 ms | 518 ms | 562 ms | 590 ms |
| C all locked | heartbeat | 91 | 0 | 88 ms | 108 ms | 110 ms | 110 ms |
| C all locked | log_events | 60 | 0 | 101 ms | 108 ms | 110 ms | 110 ms |
| C all locked | dashboard poll: list attempts | 2 | 0 | 5 ms | 8 ms | 8 ms | 8 ms |
| C all locked | dashboard feed initial load (60 ids) | 1 | 0 | 21 ms | 21 ms | 21 ms | 21 ms |
| C all locked | realtime: heartbeat -> dashboard | 82 | 0 | 435 ms | 678 ms | 680 ms | 680 ms |
| C all locked | realtime: event -> dashboard | 180 | 0 | 600 ms | 679 ms | 680 ms | 680 ms |
| D unlock all | teacher: insert unlock command | 60 | 0 | 61 ms | 79 ms | 81 ms | 81 ms |
| D unlock all | realtime: heartbeat -> dashboard | 68 | 0 | 293 ms | 538 ms | 577 ms | 577 ms |
| D unlock all | heartbeat | 60 | 0 | 20 ms | 53 ms | 100 ms | 100 ms |
| D unlock all | dashboard poll: list attempts | 1 | 0 | 8 ms | 8 ms | 8 ms | 8 ms |
| D unlock all | unlock click -> student unlocked | 1 | 0 | 2.96 s | 2.96 s | 2.96 s | 2.96 s |
| E reconnect burst | heartbeat | 1143 | 0 | 21 ms | 89 ms | 280 ms | 336 ms |
| E reconnect burst | log_events | 120 | 0 | 124 ms | 304 ms | 334 ms | 336 ms |
| E reconnect burst | realtime: heartbeat -> dashboard | 692 | 0 | 311 ms | 2.73 s | 7.43 s | 8.97 s |
| E reconnect burst | realtime: event -> dashboard | 5000 | 0 | 4.81 s | 8.80 s | 9.14 s | 9.14 s |
| E reconnect burst | dashboard poll: list attempts | 18 | 0 | 21 ms | 89 ms | 89 ms | 89 ms |
| E reconnect burst | status updates caught up after burst | 1 | 0 | - | - | - | - |
| E reconnect burst | feed drain after burst (time to last message) | 1 | 0 | 8.89 s | 8.89 s | 8.89 s | 8.89 s |
| F end test | teacher: end_test | 1 | 0 | 5 ms | 5 ms | 5 ms | 5 ms |
| F end test | heartbeat | 60 | 0 | 34 ms | 69 ms | 89 ms | 89 ms |
| F end test | realtime: heartbeat -> dashboard | 3 | 0 | 549 ms | 595 ms | 595 ms | 595 ms |
| F end test | dashboard poll: list attempts | 1 | 0 | 67 ms | 67 ms | 67 ms | 67 ms |
| F end test | end_test -> student sees closed | 1 | 0 | 3.00 s | 3.00 s | 3.00 s | 3.00 s |
| F end test | log_events | 5 | 5 | - | - | - | - |
| G integrity + report | report: events page (1000 rows) | 7 | 0 | 119 ms | 365 ms | 365 ms | 365 ms |
| G integrity + report | dashboard poll: list attempts | 1 | 0 | 63 ms | 63 ms | 63 ms | 63 ms |
| G integrity + report | report: score + heatmap for all students (in the browser) | 1 | 0 | 8 ms | 8 ms | 8 ms | 8 ms |

## Errors
- F end test / log_events: {"attempt is finished":5}

## Findings
- The dashboard's live feed received 5760 of 6760 event inserts (1000 not delivered).
