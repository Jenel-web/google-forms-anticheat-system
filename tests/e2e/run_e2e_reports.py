"""Phase 5 gate: timeline, integrity score, heatmap, CSV export and reconciliation, against the local stack.

    supabase start && supabase db reset
    npm --prefix dashboard install
    python tests/e2e/run_e2e_reports.py

No extension and no student window: a teacher signs up through the real UI, and the attempts and events a student would
have produced are written straight into the database (the extension side is covered by run_e2e_supabase.py). Everything
runs in headless Chromium, ~1 minute. Set E2E_SHOTS=<dir> to keep screenshots.
"""
import csv
import io
import os
import re
import secrets
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "e2e"))
sys.path.insert(0, str(ROOT / "supabase" / "tests"))
import mailpit  # noqa: E402
import run_e2e_dashboard as d  # noqa: E402
import run_e2e_supabase as sb  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

check = sb.check
wait = sb.wait_until
RUN = secrets.token_hex(3)
FORM_ID = f"1FAIpQLSdReports{RUN}"
TITLE = f"Reports E2E {RUN}"
BASE = "2026-10-15 09:00:00+00"

NAMES = {"A": f"Hand Calc {RUN}", "B": f"Gap Student {RUN}", "C": f"Busy Student {RUN}"}
EMAILS = {"A": f"handcalc-{RUN}@school.edu", "B": f"gap-{RUN}@school.edu", "C": f"busy-{RUN}@school.edu"}
STRANGER = f"stranger-{RUN}@school.edu"


def ts(secs):
    return f"timestamptz '{BASE}' + interval '{secs} seconds'"


def event(attempt, seq, secs, typ, q=None, data="{}", lag=1):
    qv = "null" if q is None else f"'{{\"i\":{q},\"n\":10}}'::jsonb"
    return (f"('{attempt}', {seq}, {ts(secs)}, '{typ}', {qv}, '{data}'::jsonb, {ts(secs + lag)})")


def seed(test_id, uids):
    """Three attempts. A is the hand-checked score, B has two connection gaps, C has 500 events."""
    ids = {k: sb.psql("select gen_random_uuid()").strip() for k in "ABC"}
    for k, status in (("A", "submitted"), ("B", "submitted"), ("C", "active")):
        sb.psql(f"insert into public.attempts (id, test_id, student_uid, student_name, student_email, chrome_email, verified, status, strikes, started_at) "
                f"values ('{ids[k]}', '{test_id}', '{uids[k]}', '{NAMES[k]}', '{EMAILS[k]}', '{EMAILS[k]}', true, '{status}', 0, {ts(0)})")
    a = ids["A"]
    rows = [
        event(a, 1, 0, "session_start", data='{"mode":"enforce"}'),
        event(a, 2, 5, "question_changed", q=3),
        event(a, 3, 20, "tab_switch", q=3),
        event(a, 4, 20, "strike", q=3, data='{"n":1,"reason":"tab_switch"}'),
        event(a, 5, 30, "returned", q=3, data='{"durationMs":10000,"reasons":["tab_switch"],"domains":[]}'),
        event(a, 6, 60, "question_changed", q=5),
        event(a, 7, 100, "tab_opened", q=5, data='{"domain":"example.org"}'),
        event(a, 8, 100, "strike", q=5, data='{"n":2,"reason":"tab_opened"}'),
        event(a, 9, 120, "returned", q=5, data='{"durationMs":20000,"reasons":["tab_opened"],"domains":["example.org"]}'),
        event(a, 10, 200, "submitted"),
    ]
    b = ids["B"]
    rows += [
        event(b, 1, 0, "session_start", data='{"mode":"enforce"}'),
        event(b, 2, 100, "connection_gap", data='{"seconds":60,"from":"x"}'),  # reported: 40 s to 100 s
        event(b, 3, 500, "question_changed", q=2, lag=45),  # delivered 45 s late: a second, inferred gap
        event(b, 4, 600, "submitted"),
    ]
    sb.psql("insert into public.events (attempt_id, seq, t, type, q, data, received_at) values " + ",".join(rows))
    # C: 500 events. Every fifth is a question change, the rest are blocked copy attempts.
    sb.psql(f"insert into public.events (attempt_id, seq, t, type, q, data, received_at) "
            f"select '{ids['C']}', i, timestamptz '{BASE}' + (i || ' seconds')::interval, "
            f"case when i % 5 = 0 then 'question_changed' else 'copy_attempt' end, "
            f"jsonb_build_object('i', (i % 20) + 1, 'n', 20), '{{}}'::jsonb, "
            f"timestamptz '{BASE}' + ((i + 1) || ' seconds')::interval from generate_series(1, 500) i")
    return ids


def main():
    d.ANON = sb.anon_key()
    mailpit.clear()
    dev = d.start_dev_server()
    tmp = tempfile.mkdtemp(prefix="cheatnono-e2e-reports-")
    email = f"teacher-r-{RUN}@example.com"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
            page = ctx.new_page()
            sb.PUMP = page
            try:
                run(page, email, tmp)
            finally:
                browser.close()
    finally:
        d.stop_dev_server(dev)
        shutil.rmtree(tmp, ignore_errors=True)
    print()
    if sb.failures:
        print(f"{len(sb.failures)} check(s) failed")
        sys.exit(1)
    print("All checks passed.")


def run(page, email, tmp):
    # ------------------------------------------------------------ set up: a teacher, a test, three students' data
    d.sign_up(page, email)
    wait(lambda: page.get_by_text("We sent a confirmation link").count() > 0, timeout=10)
    d.confirm_by_email(page, email)
    check("teacher signs up, confirms and signs in", d.signed_in(page))
    token = d.rest_login(email)
    d.api(token, "POST", "/rest/v1/tests", {
        "title": TITLE, "form_id": FORM_ID, "form_url": f"https://docs.google.com/forms/d/e/{FORM_ID}/viewform", "settings": {}})
    test_id = sb.psql(f"select id from public.tests where form_id = '{FORM_ID}'").strip()
    d.api(token, "POST", "/rest/v1/rpc/go_live", {"p_test_id": test_id, "p_one_response": True, "p_verified_email": True})
    uids = {k: sb.http("POST", "/auth/v1/signup", {}, anon=d.ANON)["user"]["id"] for k in "ABC"}
    ids = seed(test_id, uids)
    total_events = int(sb.psql(f"select count(*) from public.events e join public.attempts a on a.id = e.attempt_id where a.test_id = '{test_id}'").strip())
    check("seeded 3 attempts and their events", total_events == 10 + 4 + 500, str(total_events))
    d.api(token, "POST", "/rest/v1/rpc/end_test", {"p_test_id": test_id})  # C was still working: End closes it (D13)

    # ------------------------------------------------------------ the report
    page.goto(f"{d.DASH}/tests/{test_id}")
    check("the monitor has a Report button", wait(lambda: page.get_by_test_id("open-report").count() > 0, timeout=10))
    page.get_by_test_id("open-report").click()
    check("the report opens", wait(lambda: page.get_by_test_id("report-row").count() == 3, timeout=15))
    d.shot(page, "10_report")

    # hand calculation, PRD 6.8: 2 strikes and 30 seconds away = 100 - 20 - 15 = 65
    hand = 100 - 2 * 10 - min(30, 0.5 * (10 + 20))
    row_a = page.get_by_test_id("report-row").filter(has_text=NAMES["A"])
    check("hand-calculated score (100 - 20 - 15) is 65", hand == 65)
    check("the report shows 65 for the hand-checked student", row_a.get_attribute("data-score") == "65", str(row_a.get_attribute("data-score")))
    scores = [int(r.get_attribute("data-score")) for r in page.get_by_test_id("report-row").all()]
    check("students are listed lowest score first", scores == sorted(scores) and scores == [65, 90, 100], str(scores))
    check("class summary counts 3 students", page.get_by_test_id("stat-students").inner_text() == "3")
    check("average integrity is (65 + 90 + 100) / 3 = 85", page.get_by_test_id("stat-average").inner_text() == "85")
    check("one student is flagged for review (score under 85)", page.get_by_test_id("stat-flagged").inner_text() == "1",
          page.get_by_test_id("stat-flagged").inner_text())

    # heatmap matches the events: A left once on Q3 (10 s) and once on Q5 (20 s), nobody else left
    cell = lambda q: page.locator(f'[data-testid=heatmap] [data-q="{q}"]')
    check("heatmap Q3: 1 episode, 10 s", cell(3).get_attribute("data-episodes") == "1" and cell(3).get_attribute("data-seconds") == "10")
    check("heatmap Q5: 1 episode, 20 s", cell(5).get_attribute("data-episodes") == "1" and cell(5).get_attribute("data-seconds") == "20")
    others = sum(int(c.get_attribute("data-episodes")) for c in page.locator("[data-testid=heatmap] [data-q]").all())
    check("heatmap has no other episodes", others == 2, str(others))

    # ------------------------------------------------------------ timeline of the hand-checked student
    row_a.get_by_role("link", name=NAMES["A"]).click()
    check("the timeline opens", wait(lambda: page.get_by_test_id("timeline").count() > 0, timeout=10))
    check("the ring shows 65", page.get_by_test_id("ring-score").inner_text().startswith("65"))
    pen = page.get_by_test_id("penalties").inner_text()
    check("the score breakdown lists -20 for strikes and -15 for time away", "−20" in pen and "−15" in pen, pen)
    titles = [t.inner_text() for t in page.locator("[data-testid=timeline] .cn-tl__body b").all()]
    check("the timeline reads Started, two leave episodes, Submitted",
          titles == ["Started exam", "Left the exam tab for 10s", "Left the exam tab for 20s", "Submitted"], str(titles))
    check("an episode names its question", page.locator("[data-testid=timeline] .cn-q", has_text="Q5").count() == 1)
    check("an episode names the domain", page.locator("[data-testid=timeline] .cn-domain", has_text="example.org").count() == 1)
    d.shot(page, "11_timeline")

    # ------------------------------------------------------------ connection gaps (D12)
    page.goto(f"{d.DASH}/tests/{test_id}/attempts/{ids['B']}")
    wait(lambda: page.get_by_test_id("timeline").count() > 0, timeout=10)
    check("a gap shows as 'Connection gap (unverified)'", page.get_by_text("Connection gap (unverified)").count() >= 2)
    check("the gap summary counts both gaps", page.get_by_test_id("gap-summary").inner_text() == "2 gaps, 1m 45s in total", page.get_by_test_id("gap-summary").inner_text())
    check("gaps are not in the score", page.get_by_test_id("ring-score").inner_text().startswith("100"))
    d.shot(page, "12_gaps")

    # ------------------------------------------------------------ 500 events
    page.goto(f"{d.DASH}/tests/{test_id}/attempts/{ids['C']}")
    check("the 500-event timeline loads", wait(lambda: page.get_by_test_id("timeline").count() > 0, timeout=20))
    page.wait_for_function("document.querySelectorAll('[data-testid=timeline] li').length >= 400", timeout=20000)
    ms = page.evaluate("""async () => {
        const t = performance.now();
        document.querySelector('[data-testid=toggle-all]').click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t;
    }""")
    n = page.locator("[data-testid=timeline] li").count()
    check("showing every event lists all 500", n == 500, str(n))
    check("500 events render in under 1.5 s", ms < 1500, f"{ms:.0f} ms")
    frames = page.evaluate("""async () => {
        let frames = 0; const end = performance.now() + 1000; const el = document.scrollingElement;
        await new Promise((resolve) => { const tick = () => { el.scrollTop += 120; frames += 1;
          performance.now() < end ? requestAnimationFrame(tick) : resolve(); }; requestAnimationFrame(tick); });
        return frames;
    }""")
    check("scrolling the long timeline stays smooth (>= 20 frames in 1 s)", frames >= 20, f"{frames} frames")
    d.shot(page, "13_timeline_500")

    # ------------------------------------------------------------ CSV export
    page.goto(f"{d.DASH}/tests/{test_id}/report")
    wait(lambda: page.get_by_test_id("report-row").count() == 3, timeout=15)
    wait(lambda: page.get_by_test_id("csv-events").is_enabled(), timeout=10)
    with page.expect_download() as dl:
        page.get_by_test_id("csv-events").click()
    raw = Path(dl.value.path()).read_bytes()
    check("events CSV starts with a UTF-8 BOM (Excel)", raw[:3] == b"\xef\xbb\xbf")
    check("events CSV uses CRLF line ends", b"\r\n" in raw and raw.count(b"\n") == raw.count(b"\r\n"))
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    check("events CSV rows match the events table", len(rows) - 1 == total_events, f"{len(rows) - 1} vs {total_events}")
    with page.expect_download() as dl2:
        page.get_by_test_id("csv-attempts").click()
    arows = list(csv.reader(io.StringIO(Path(dl2.value.path()).read_bytes().decode("utf-8-sig"))))
    check("attempts CSV has one row per attempt", len(arows) - 1 == 3, str(len(arows) - 1))
    score_col = arows[0].index("Integrity score")
    by_name = {r[0]: r for r in arows[1:]}
    check("attempts CSV carries the same score (65)", by_name[NAMES["A"]][score_col] == "65")

    # ------------------------------------------------------------ reconciliation (D8), entirely in the browser
    sample = Path(tmp) / "responses.csv"
    sample.write_text(
        "Timestamp,Email Address,Question 1,Question 2\r\n"
        f"2026/10/15 9:03:20,{EMAILS['A'].upper()},TOPSECRETANSWER one,\"a long, answer\nwith a break\"\r\n"
        f"2026/10/15 9:10:00,{EMAILS['B']},TOPSECRETANSWER two,x\r\n"
        f"2026/10/15 9:11:00,{STRANGER},TOPSECRETANSWER three,y\r\n", encoding="utf-8")
    seen = []
    page.on("request", lambda r: seen.append((r.method, r.url, r.post_data or "")))
    page.get_by_test_id("responses-file").set_input_files(str(sample))
    check("the reconciliation lists appear", wait(lambda: page.get_by_test_id("reconcile-summary").count() > 0, timeout=5))
    text = lambda tid: page.get_by_test_id(tid).inner_text()
    check("matched list has the 2 students who submitted", page.get_by_test_id("matched-count").inner_text() == "2" and NAMES["A"] in text("matched") and NAMES["B"] in text("matched"))
    check("'submitted with no monitored attempt' lists the stranger", page.get_by_test_id("no-attempt-count").inner_text() == "1" and STRANGER in text("no-attempt"))
    check("'monitored but no submission' lists the busy student", page.get_by_test_id("no-submission-count").inner_text() == "1" and NAMES["C"] in text("no-submission"))
    check("the upload made no network request at all", not seen, str(seen[:3]))
    check("no answer text is on the page", "TOPSECRETANSWER" not in page.content())
    d.shot(page, "14_reconcile")
    nomail = Path(tmp) / "no-email.csv"
    nomail.write_text("Timestamp,Name,Q1\r\n1,Ana,x\r\n", encoding="utf-8")
    page.get_by_test_id("responses-file").set_input_files(str(nomail))
    check("a file with no email column is rejected with a clear message", wait(lambda: page.get_by_text("could not find an email column").count() > 0, timeout=5))

    # ------------------------------------------------------------ data access
    for table in ("events", "attempts"):
        try:
            blocked = sb.http("GET", f"/rest/v1/{table}?select=id", anon=d.ANON) == []
        except RuntimeError as e:  # permission denied (401/403) is the stronger result
            blocked = "401" in str(e) or "403" in str(e)
        check(f"the anon key cannot read {table}", blocked)
    leaked = sb.psql(f"select count(*) from public.events where data::text ilike '%TOPSECRETANSWER%'").strip()
    check("no answer text reached the database", leaked == "0", leaked)


if __name__ == "__main__":
    main()
