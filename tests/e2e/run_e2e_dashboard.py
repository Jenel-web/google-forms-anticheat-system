"""Phase 4 gate: teacher dashboard with two teacher accounts and one live student (extension), against the local stack.

    supabase start && supabase db reset
    npm --prefix dashboard install && npm --prefix extension install
    python tests/e2e/run_e2e_dashboard.py

The dashboard runs in headless Chromium (two separate browser contexts = two teachers). The student is a headed
Chromium window with the built extension, so don't click around while it runs. Starts `npm run dev` for the
dashboard (port 3000) if nothing is listening there. Set E2E_SHOTS=<dir> to keep screenshots.
"""
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "e2e"))
sys.path.insert(0, str(ROOT / "supabase" / "tests"))
import mailpit  # noqa: E402
import run_e2e_supabase as sb  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

DASH = "http://127.0.0.1:3000"
RUN = secrets.token_hex(3)
FORM_ID = f"1FAIpQLSdDashE2E{RUN}"
FORM_URL = f"https://docs.google.com/forms/d/e/{FORM_ID}/viewform"
RESPONSE_URL = f"https://docs.google.com/forms/d/e/{FORM_ID}/formResponse"
EDIT_LINK = "https://docs.google.com/forms/d/1AbCdEfGhIjKlMnOp/edit"
PASSWORD = "password123"
STUDENT = f"Dash Student {RUN}"
SHOTS = os.environ.get("E2E_SHOTS")
check = sb.check


def shot(page, name):
    if SHOTS:
        Path(SHOTS).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(Path(SHOTS) / f"{name}.png"), full_page=True)


def port_open():
    try:
        socket.create_connection(("127.0.0.1", 3000), timeout=1).close()
        return True
    except OSError:
        return False


def start_dev_server():
    if port_open():
        return None
    proc = subprocess.Popen("npm run dev", shell=True, cwd=ROOT / "dashboard", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    end = time.time() + 40
    while time.time() < end and not port_open():
        time.sleep(0.5)
    if not port_open():
        sys.exit("The dashboard dev server did not start on port 3000.")
    return proc


def stop_dev_server(proc):
    if proc:
        subprocess.run(f"taskkill /F /T /PID {proc.pid}", shell=True, capture_output=True)


# ------------------------------------------------------------------ teacher UI helpers
def sign_up(page, email):
    page.goto(DASH)
    page.get_by_role("link", name="Create an account").or_(page.get_by_text("Create an account")).first.click()
    page.locator("#email").fill(email)
    page.locator("#password").fill(PASSWORD)
    page.get_by_role("button", name="Create account").click()


def confirm_by_email(page, email):
    link = mailpit.wait_for_link(email, r"/auth/v1/verify\?.*type=signup")
    page.goto(link)  # the real path: the emailed link signs the teacher in and lands on the dashboard


def signed_in(page, timeout=15):
    return sb.wait_until(lambda: page.get_by_role("heading", name="Tests").count() > 0, timeout=timeout)


def rest_login(email):
    res = sb.http("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": PASSWORD}, anon=ANON)
    return res["access_token"]


def api(token, method, path, body=None):
    return sb.http(method, path, body, token=token, anon=ANON)


ANON = None


def main():
    global ANON
    ANON = sb.anon_key()
    mailpit.clear()
    dev = start_dev_server()
    tmp = tempfile.mkdtemp(prefix="cheatnono-e2e-dash-")
    ext = sb.prepare_extension(tmp)
    email_a, email_b = f"teacher-a-{RUN}@example.com", f"teacher-b-{RUN}@example.com"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx_a, ctx_b = browser.new_context(viewport={"width": 1280, "height": 900}), browser.new_context(viewport={"width": 1280, "height": 900})
            page_a, page_b = ctx_a.new_page(), ctx_b.new_page()
            student_ctx, helper = sb.launch(p, tmp, ext, profile="student")
            try:
                sb.PUMP = helper
                run(page_a, page_b, email_a, email_b, student_ctx, helper)
            finally:
                student_ctx.close()
                browser.close()
    finally:
        stop_dev_server(dev)
        shutil.rmtree(tmp, ignore_errors=True)
    print()
    if sb.failures:
        print(f"{len(sb.failures)} check(s) failed")
        sys.exit(1)
    print("All checks passed.")


def run(page_a, page_b, email_a, email_b, student_ctx, helper):
    wait = sb.wait_until

    # ---------------------------------------------------------------- 1. sign up, confirm by email, sign in; isolation
    sign_up(page_a, email_a)
    check("sign-up asks the teacher to confirm by email", wait(lambda: page_a.get_by_text("We sent a confirmation link").count() > 0, timeout=10))
    page_a.get_by_role("link", name="Back to sign in").click()
    page_a.locator("#email").fill(email_a)
    page_a.locator("#password").fill(PASSWORD)
    page_a.get_by_role("button", name="Sign in").click()
    check("an unconfirmed account cannot sign in", wait(lambda: page_a.get_by_text("Confirm your email first").count() > 0, timeout=10))
    shot(page_a, "01_auth_unconfirmed")
    confirm_by_email(page_a, email_a)
    check("the emailed link confirms the account and signs the teacher in", signed_in(page_a))
    check("a new teacher sees the empty state", wait(lambda: page_a.get_by_text("No tests yet").count() > 0, timeout=8))
    page_a.get_by_role("button", name="Sign out").or_(page_a.get_by_label("Sign out")).first.click()
    check("sign out returns to the sign-in screen", wait(lambda: page_a.locator("#email").count() > 0))
    page_a.locator("#email").fill(email_a)
    page_a.locator("#password").fill(PASSWORD)
    page_a.get_by_role("button", name="Sign in").click()
    check("teacher A signs in with email and password", signed_in(page_a))

    sign_up(page_b, email_b)
    wait(lambda: page_b.get_by_text("We sent a confirmation link").count() > 0, timeout=10)
    confirm_by_email(page_b, email_b)
    check("teacher B signs up, confirms and signs in", signed_in(page_b))

    # ---------------------------------------------------------------- 2. link validation
    page_a.get_by_role("button", name="Add test").first.click()
    link = page_a.locator("#form-link")
    link.fill(EDIT_LINK)
    link.blur()
    check("an edit link (/d/.../edit) is rejected with a message",
          wait(lambda: page_a.get_by_text("That is the edit link").count() > 0, timeout=5))
    link.fill("https://docs.google.com/forms/d/1AbCdEfGhIjKlMnOp/viewform")
    check("an editor-ID viewform link is rejected too", page_a.get_by_text("form editor ID").count() > 0)
    link.fill("https://example.com/hello")
    check("a non-Form link is rejected", page_a.get_by_text("does not look like a Google Form link").count() > 0)
    shot(page_a, "02_editor_rejected")
    link.fill(FORM_URL + "?usp=publish-editor")
    check("the published link is accepted", wait(lambda: page_a.get_by_text("Form found").count() > 0, timeout=5))
    page_a.locator("#title").fill(f"Dashboard E2E {RUN}")
    page_a.get_by_role("button", name="More").click()
    page_a.get_by_role("button", name="Fewer").click()
    check("the strikes stepper changes the value", page_a.get_by_test_id("max-strikes").inner_text() == "3")
    page_a.locator("#allowlist").fill("https://www.Desmos.com/")
    page_a.locator("#allowlist").press("Enter")
    check("the allow-list tag is cleaned (desmos.com)", page_a.locator(".cn-tag", has_text="desmos.com").count() == 1)
    shot(page_a, "03_editor_filled")

    # ---------------------------------------------------------------- 3. Go live needs both D7 checkboxes
    page_a.get_by_role("button", name="Go live…").click()
    go = page_a.get_by_role("button", name="Go live", exact=True)
    check("Go live opens the D7 dialog with the button disabled", wait(lambda: go.count() > 0) and go.is_disabled())
    page_a.locator("#ack-one").check()
    check("Go live is still blocked with one box ticked", go.is_disabled())
    page_a.locator("#ack-verified").check()
    check("Go live is enabled with both boxes ticked", go.is_enabled())
    shot(page_a, "04_golive_dialog")
    go.click()
    check("the test goes live and the monitor opens", wait(lambda: page_a.get_by_test_id("test-title").count() > 0, timeout=10)
          and page_a.get_by_text("Live", exact=True).count() > 0)
    check("the monitor shows the empty state before anyone joins", page_a.get_by_text("Waiting for students").count() > 0)
    attested = sb.psql(f"select attested_at is not null from public.tests where form_id='{FORM_ID}'").strip()
    check("the D7 attestation is recorded", attested == "t", attested)
    page_a.get_by_role("link", name="All tests").click()
    check("the list shows the live test", wait(lambda: page_a.get_by_text(f"Dashboard E2E {RUN}").count() > 0))
    shot(page_a, "05_tests_list")

    # teacher B cannot see teacher A's test
    page_b.goto(DASH)
    check("teacher B sees none of teacher A's tests", wait(lambda: page_b.get_by_text("No tests yet").count() > 0) and page_b.get_by_text(f"Dashboard E2E {RUN}").count() == 0)
    test_id = sb.psql(f"select id from public.tests where form_id='{FORM_ID}'").strip()
    page_b.goto(f"{DASH}/tests/{test_id}")
    check("teacher B cannot open teacher A's test by URL", wait(lambda: page_b.get_by_text("Test not found").count() > 0, timeout=10))
    page_a.get_by_test_id("test-row").first.click()
    wait(lambda: page_a.get_by_test_id("test-title").count() > 0)

    # ---------------------------------------------------------------- 4. a real student; the monitor follows within 2 s
    student = student_ctx.new_page()
    student.goto(FORM_URL)
    check("the student sees the consent screen on the live test", wait(lambda: sb.overlay(student, "Before you begin").count() > 0, timeout=15))
    student.locator("#eg-host #eg-name").fill(STUDENT)
    student.locator("#eg-host #eg-email").fill("dash.student@school.edu")
    student.locator("#eg-host #eg-agree").check()
    student.locator("#eg-host button", has_text="Start exam").click()
    check("the student's exam starts", wait(lambda: student.locator("#eg-host .cn-hud").count() == 1))
    rows = page_a.get_by_test_id("attempt-row")
    check("the student appears on the monitor", wait(lambda: rows.count() == 1, timeout=10))
    check("the row shows the student's name, email and unverified badge",
          STUDENT in rows.first.inner_text() and "dash.student@school.edu" in rows.first.inner_text() and "unverified" in rows.first.inner_text())
    check("the row starts Active with no strikes", rows.first.get_attribute("data-status") == "active" and rows.first.get_attribute("data-strikes") == "0")
    shot(page_a, "06_monitor_active")

    token_a = rest_login(email_a)
    attempt_q = f"/rest/v1/attempts?select=id,strikes,status&student_name=eq.{STUDENT.replace(' ', '%20')}"

    def db_state():
        return api(token_a, "GET", attempt_q)[0]

    def latency_of_change(trigger, want_strikes):
        """Seconds between the database showing the change and the dashboard row showing it."""
        t_db = t_dom = None
        trigger()
        end = time.time() + 20
        while time.time() < end and not (t_db and t_dom):
            if t_db is None and db_state()["strikes"] >= want_strikes:
                t_db = time.time()
            if t_dom is None and int(rows.first.get_attribute("data-strikes") or 0) >= want_strikes:
                t_dom = time.time()
            sb.pause(0.05)
        return (t_dom - t_db) if (t_db and t_dom) else None

    lat = latency_of_change(lambda: sb.open_tab(helper, "https://example.org/"), 1)
    check(f"strike 1 shows on the monitor within 2 s of reaching the database ({'n/a' if lat is None else f'{max(0.0, lat):.2f}s'})", lat is not None and lat <= 2.0)
    check("the row's status chip follows the student (warned or away)", rows.first.get_attribute("data-status") in ("warned", "away", "active"))
    check("the alert feed shows the strike", wait(lambda: "left the exam" in page_a.get_by_test_id("feed").inner_text(), timeout=6))
    student.locator("#eg-host button", has_text="Continue exam").click()
    sb.open_tab(helper, "https://example.net/")
    wait(lambda: sb.overlay(student, "One more and your exam pauses").count() > 0, timeout=10)
    student.locator("#eg-host button", has_text="Return to exam").click()
    lat = latency_of_change(lambda: sb.open_tab(helper, "https://example.com/"), 3)
    check(f"the lock shows on the monitor within 2 s of reaching the database ({'n/a' if lat is None else f'{max(0.0, lat):.2f}s'})", lat is not None and lat <= 2.0)
    check("the row turns Locked with an Unlock button", wait(lambda: rows.first.get_attribute("data-status") == "locked", timeout=5)
          and page_a.get_by_role("button", name="Unlock").count() == 1)
    check("the feed reports the lock", wait(lambda: "is locked" in page_a.get_by_test_id("feed").inner_text(), timeout=6))
    shot(page_a, "07_monitor_locked")

    # ---------------------------------------------------------------- 5. unlock from the dashboard
    sent = time.time()
    page_a.get_by_role("button", name="Unlock").click()
    check("the dashboard shows 'Unlock sent'", wait(lambda: page_a.get_by_text("Unlock sent").count() > 0, timeout=5))
    unlocked = wait(lambda: sb.overlay(student, "Your exam is paused").count() == 0, timeout=10, step=0.1)
    took = time.time() - sent
    check(f"the Unlock button unlocks the student within 6 s (took {took:.1f}s)", unlocked and took <= 6.5)
    check("the row returns to Active with 2 strikes", wait(lambda: rows.first.get_attribute("data-strikes") == "2"
                                                          and rows.first.get_attribute("data-status") in ("active", "warned"), timeout=8))
    cmds = sb.psql(f"select count(*), count(consumed_at) from public.commands where attempt_id='{db_state()['id']}'").strip()
    check("the unlock command was consumed exactly once", cmds == "1|1", cmds)

    # ---------------------------------------------------------------- 6. End: warning, count, closed screen, late submission
    page_a.get_by_role("button", name="End test…").click()
    check("End shows how many students are still working", wait(lambda: page_a.get_by_test_id("still-working").count() > 0)
          and page_a.get_by_test_id("still-working").inner_text().startswith("1 student is still working"),
          page_a.get_by_test_id("still-working").inner_text() if page_a.get_by_test_id("still-working").count() else "")
    check("End warns that unsubmitted answers will be lost", page_a.get_by_text("Unsubmitted answers will be lost").count() > 0)
    check("End asks the teacher to stop accepting responses in Google Forms first", page_a.get_by_text("Accepting responses").count() > 0)
    end_btn = page_a.get_by_role("button", name="End test", exact=True)
    check("End is blocked until the teacher confirms Google Forms is closed", end_btn.is_disabled())
    shot(page_a, "08_end_dialog")
    page_a.locator("#ack-closed").check()
    sent = time.time()
    end_btn.click()
    check("the test shows as Ended", wait(lambda: page_a.get_by_text("This test has ended").count() > 0, timeout=10))
    check("the dashboard says how many attempts were closed", page_a.get_by_text("1 unfinished attempt was closed").count() > 0)
    closed_screen = wait(lambda: sb.overlay(student, "Your teacher has ended this exam").count() > 0, timeout=12, step=0.2)
    took = time.time() - sent
    check(f"the student sees the closed screen within about 5 s (took {took:.1f}s)", closed_screen and took <= 6.5)
    check("the row shows Closed", wait(lambda: rows.first.get_attribute("data-status") == "closed", timeout=8))
    shot(page_a, "09_ended")

    student.locator("#eg-host button", has_text="Close").click()
    student.goto(RESPONSE_URL)
    flagged = wait(lambda: int(sb.psql(f"select count(*) from public.events e join public.attempts a on a.id = e.attempt_id "
                                       f"where a.student_name = '{STUDENT}' and e.type = 'submitted_after_close'").strip() or 0) == 1, timeout=15)
    check("a submission after End is flagged submitted_after_close", flagged)
    check("the flag appears in the teacher's alert feed", wait(lambda: "submitted after the test ended" in page_a.get_by_test_id("feed").inner_text(), timeout=10))
    status = sb.psql(f"select status from public.attempts where student_name = '{STUDENT}'").strip()
    check("the attempt stays closed (the first final status wins)", status == "closed", status)
    shot(page_a, "10_after_close")

    # ---------------------------------------------------------------- 7. the anon key cannot read dashboard data
    for table in ("tests", "attempts", "events", "commands"):
        try:
            api(None, "GET", f"/rest/v1/{table}?select=*")
            ok = False
        except RuntimeError as e:
            ok = "42501" in str(e) or "401" in str(e) or "403" in str(e)
        check(f"the anon key alone cannot read {table}", ok)
    anon_user = sb.http("POST", "/auth/v1/signup", {}, anon=ANON)["access_token"]
    for table in ("tests", "attempts", "events", "commands"):
        res = api(anon_user, "GET", f"/rest/v1/{table}?select=*")
        check(f"an anonymous (student) session reads no rows from {table}", res == [])
    token_b = rest_login(email_b)
    for table in ("tests", "attempts", "events"):
        check(f"teacher B reads none of teacher A's {table}", api(token_b, "GET", f"/rest/v1/{table}?select=id") == [])


if __name__ == "__main__":
    main()
