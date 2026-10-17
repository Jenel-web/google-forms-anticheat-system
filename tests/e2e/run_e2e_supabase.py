"""End-to-end test for the CheatNoNo extension against the LOCAL Supabase stack (M2 acceptance).

    supabase start && supabase db reset          # seeds teacher@example.com and the live form 'seed-form-id-local-dev'
    pip install playwright && python -m playwright install chromium
    python tests/e2e/run_e2e_supabase.py

Builds extension/dist with the supabase backend, loads a temp copy, fakes Google Forms with context.route, and checks the
database through the REST API as the seed teacher. Headed: don't click around while it runs (focus changes are strikes).
Leaves rows named 'E2E Student' in the local database; `supabase db reset` clears them.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
API = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")
FORM_ID = "seed-form-id-local-dev"
TEST_ID = "22222222-2222-2222-2222-222222222222"
FORM_URL = f"https://docs.google.com/forms/d/e/{FORM_ID}/viewform"
RESPONSE_URL = f"https://docs.google.com/forms/d/e/{FORM_ID}/formResponse"
UNPROTECTED_URL = "https://docs.google.com/forms/d/e/1FAIpQLSnotProtected/viewform"
NAME = "E2E Student"

FORM_HTML = """<!doctype html><html><head><title>Practice exam</title></head><body style="margin:0">
<div role="list"><div role="listitem" style="height:900px">Question 1 <input type="text"></div></div></body></html>"""
PLAIN_HTML = "<!doctype html><title>Other site</title><body>Other site</body>"

failures = []
PUMP = None


def check(name, ok, extra=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{extra}]" if extra and not ok else ""))
    if not ok:
        failures.append(name)


def pause(seconds):
    PUMP.wait_for_timeout(int(seconds * 1000))


def wait_until(fn, timeout=8.0, step=0.2):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        pause(step)
    return False


# ------------------------------------------------------------------ REST as the seed teacher
def http(method, path, body=None, token=None, anon=None):
    headers = {"apikey": anon, "Authorization": "Bearer " + (token or anon), "Content-Type": "application/json"}
    req = urllib.request.Request(API + path, data=None if body is None else json.dumps(body).encode(),
                                 method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code} {e.read().decode(errors='replace')}")


def anon_key():
    if os.environ.get("SUPABASE_ANON_KEY"):
        return os.environ["SUPABASE_ANON_KEY"]
    out = subprocess.run("supabase status -o json", shell=True, capture_output=True, text=True, cwd=ROOT).stdout
    return json.loads(out[out.index("{"):])["ANON_KEY"]


class Teacher:
    def __init__(self):
        self.anon = anon_key()
        res = http("POST", "/auth/v1/token?grant_type=password",
                   {"email": "teacher@example.com", "password": "password123"}, anon=self.anon)
        self.token = res["access_token"]

    def get(self, path):
        return http("GET", path, token=self.token, anon=self.anon)

    def write(self, method, path, body):
        return http(method, path, body, token=self.token, anon=self.anon)

    def attempts(self):
        return self.get(f"/rest/v1/attempts?select=*&student_name=eq.{NAME.replace(' ', '%20')}&order=started_at")

    def latest(self):
        a = self.attempts()
        return a[-1] if a else None

    def events(self, attempt_id):
        return self.get(f"/rest/v1/events?select=seq,type&attempt_id=eq.{attempt_id}&order=id")

    def unlock(self, attempt_id):
        self.write("POST", "/rest/v1/commands", {"attempt_id": attempt_id, "type": "unlock"})

    def set_test_status(self, status):
        if status == "ended":  # the real teacher action: End closes the unfinished attempts (D13)
            self.write("POST", "/rest/v1/rpc/end_test", {"p_test_id": TEST_ID})
        else:  # re-arming the seeded test between runs is a database operation, not a teacher action
            psql(f"update public.tests set status='{status}' where id='{TEST_ID}'")


# ------------------------------------------------------------------ browser helpers
def prepare_extension(tmp):
    subprocess.run(["node", "build.mjs", "supabase"], cwd=ROOT / "extension", check=True)
    dest = Path(tmp) / "extension"
    shutil.copytree(ROOT / "extension" / "dist", dest)
    ui = dest / "src" / "content" / "ui.js"
    patched, n = re.subn(r"mode:\s*'closed'", "mode: 'open'", ui.read_text(encoding="utf-8"))
    assert n == 1
    ui.write_text(patched, encoding="utf-8")
    return dest


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=ROOT)


def psql(sql):
    db = sh("docker ps --format {{.Names}} --filter name=supabase_db").stdout.split()[0]
    return subprocess.run(["docker", "exec", "-i", db, "psql", "-U", "postgres", "-At", "-c", sql],
                          capture_output=True, text=True).stdout


def kong():
    return sh("docker ps -a --format {{.Names}} --filter name=supabase_kong").stdout.split()[0]


def launch(p, tmp, ext, profile="profile", with_ext=True):
    global PUMP
    args = ["--no-first-run"]
    if with_ext:
        args = [f"--disable-extensions-except={ext}", f"--load-extension={ext}"] + args
    launch_args = dict(user_data_dir=str(Path(tmp) / profile), headless=False, args=args,
                       viewport={"width": 1100, "height": 760})
    if os.environ.get("CHROME_PATH"):
        launch_args["executable_path"] = os.environ["CHROME_PATH"]
    else:
        launch_args["channel"] = "chromium"
    ctx = p.chromium.launch_persistent_context(**launch_args)
    if not with_ext:
        PUMP = ctx.pages[0]
        return ctx, PUMP

    def fulfill_form(route):
        if "formResponse" in route.request.url:
            route.fulfill(content_type="text/html", body="<!doctype html><title>Recorded</title>Your response was recorded.")
        else:
            route.fulfill(content_type="text/html", body=FORM_HTML)

    ctx.route("https://docs.google.com/forms/**", fulfill_form)
    ctx.route(re.compile(r"^https://(?!docs\.google\.com)[^/]+/.*"), lambda r: r.fulfill(content_type="text/html", body=PLAIN_HTML))
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
    helper = ctx.pages[0]
    helper.goto(f"chrome-extension://{sw.url.split('/')[2]}/src/popup/popup.html")
    PUMP = helper
    return ctx, helper


def overlay(page, text):
    return page.locator("#eg-host .cn-modal").filter(has_text=text)


def start_exam(page):
    page.goto(FORM_URL)
    if not wait_until(lambda: overlay(page, "Before you begin").count() > 0, timeout=12):
        return False
    page.locator("#eg-host #eg-name").fill(NAME)
    page.locator("#eg-host #eg-email").fill("e2e@school.edu")
    page.locator("#eg-host #eg-agree").check()
    page.locator("#eg-host button", has_text="Start exam").click()
    return True


def hud(page):
    return page.locator("#eg-host .cn-hud").inner_text() if page.locator("#eg-host .cn-hud").count() else ""


def main():
    tmp = tempfile.mkdtemp(prefix="cheatnono-e2e-sb-")
    try:
        teacher = Teacher()
    except Exception as e:
        sys.exit(f"Cannot reach the local stack or sign in as the seed teacher ({e}). Run: supabase start && supabase db reset")
    teacher.set_test_status("live")
    ext = prepare_extension(tmp)
    with sync_playwright() as p:
        ctx, helper = launch(p, tmp, ext)
        try:
            flow_a(ctx, helper, teacher)
            ctx.close()
            ctx, helper = launch(p, tmp, ext)  # a full browser restart: chrome.storage.session is gone
            flow_b(ctx, helper, teacher)
            attempt_x = flow_outage(ctx, helper, teacher)
            ctx.close()
            ctx, helper = launch(p, tmp, ext, with_ext=False)  # same profile, extension absent = disabled mid-exam
            flow_disabled(ctx, teacher, attempt_x)
            ctx.close()
            ctx, helper = launch(p, tmp, ext)
            flow_closed_in_sql(ctx, teacher, attempt_x)
            flow_c(ctx, helper, teacher)
            ctx.close()
            teacher.set_test_status("live")  # flow_c ended the test
            ctx, helper = launch(p, tmp, ext, profile="profile-b")  # a second Chrome profile
            flow_second_profile(ctx, teacher)
        finally:
            teacher.set_test_status("live")
            if kong() not in sh("docker ps --format {{.Names}}").stdout:
                sh(f"docker start {kong()}")
            ctx.close()
            shutil.rmtree(tmp, ignore_errors=True)
    print()
    if failures:
        print(f"{len(failures)} check(s) failed")
        sys.exit(1)
    print("All checks passed.")


def open_tab(helper, url):
    helper.evaluate("u => chrome.tabs.create({url: u, active: true})", url)


def flow_a(ctx, helper, teacher):
    old = len(teacher.attempts())
    page = ctx.new_page()
    page.goto(UNPROTECTED_URL)
    pause(1.2)
    check("unprotected form: nothing appears", page.locator("#eg-host").count() == 0)

    check("seeded form is live: consent screen appears", start_exam(page))
    check("exam starts", wait_until(lambda: page.locator("#eg-host .cn-hud").count() == 1) and "Strikes 0/3" in hud(page))
    check("start_attempt created one new attempt", wait_until(lambda: len(teacher.attempts()) == old + 1))
    a = teacher.latest()
    check("attempt row has the typed name and email", a["student_name"] == NAME and a["student_email"] == "e2e@school.edu", str(a))
    check("events reach the database (session_start)",
          wait_until(lambda: "session_start" in [e["type"] for e in teacher.events(a["id"])], timeout=8))

    # strikes 1..3
    n = len(ctx.pages)
    open_tab(helper, "https://example.org/")
    check("new tab -> warning", wait_until(lambda: overlay(page, "You left the exam tab").count() > 0, timeout=10))
    check("strike 1 reaches the database", wait_until(lambda: teacher.latest()["strikes"] == 1, timeout=6), str(teacher.latest()))
    check("new tab was closed", wait_until(lambda: len(ctx.pages) == n))
    page.locator("#eg-host button", has_text="Continue exam").click()
    open_tab(helper, "https://example.net/")
    check("strike 2 -> final warning", wait_until(lambda: overlay(page, "One more and your exam pauses").count() > 0, timeout=10))
    page.locator("#eg-host button", has_text="Return to exam").click()
    open_tab(helper, "https://example.com/")
    check("strike 3 -> locked screen", wait_until(lambda: overlay(page, "Your exam is paused").count() > 0, timeout=10))
    check("locked state reaches the database",
          wait_until(lambda: teacher.latest()["status"] == "locked" and teacher.latest()["strikes"] == 3, timeout=6), str(teacher.latest()))

    # unlock within 6 s, consumed exactly once
    sent = time.time()
    teacher.unlock(a["id"])
    unlocked = wait_until(lambda: overlay(page, "Your exam is paused").count() == 0, timeout=9, step=0.1)
    took = time.time() - sent
    check(f"unlock reaches the student within 6 s (took {took:.1f}s)", unlocked and took <= 6.5)
    cmds = teacher.get(f"/rest/v1/commands?select=id,consumed_at&attempt_id=eq.{a['id']}")
    check("the unlock command was consumed exactly once", len(cmds) == 1 and cmds[0]["consumed_at"] is not None, str(cmds))
    check("unlocked: strikes 2, status active in the database",
          wait_until(lambda: teacher.latest()["strikes"] == 2 and teacher.latest()["status"] == "active", timeout=6), str(teacher.latest()))
    check("unlocked: HUD shows Strikes 2/3", wait_until(lambda: "Strikes 2/3" in hud(page)), hud(page))

    # kill the service worker mid-exam: nothing is lost
    cdp = ctx.new_cdp_session(helper)
    cdp.send("ServiceWorker.enable")
    cdp.send("ServiceWorker.stopAllWorkers")
    pause(1.0)
    helper.evaluate("() => new Promise(r => chrome.runtime.sendMessage({type: 'DEV_STATE'}, r))")  # wakes the worker
    page.reload()
    check("worker killed: reload resumes without consent and keeps 2 strikes",
          wait_until(lambda: "Strikes 2/3" in hud(page), timeout=10) and overlay(page, "Before you begin").count() == 0, hud(page))
    open_tab(helper, "https://example.org/")
    check("worker killed: the next strike locks again",
          wait_until(lambda: overlay(page, "Your exam is paused").count() > 0, timeout=10))
    check("worker killed: the lock reaches the database",
          wait_until(lambda: teacher.latest()["status"] == "locked" and teacher.latest()["strikes"] == 3, timeout=8), str(teacher.latest()))
    check("worker killed: no events lost (contiguous seq in the database)",
          wait_until(lambda: contiguous(teacher.events(a["id"])), timeout=10), str(teacher.events(a["id"])[-6:]))
    check("worker killed: the attempt was never duplicated", len(teacher.attempts()) == old + 1)
    page.close()


def contiguous(events):
    seqs = sorted(e["seq"] for e in events)
    return bool(seqs) and seqs == list(range(1, len(seqs) + 1))


def flow_b(ctx, helper, teacher):
    old_attempt = teacher.latest()
    count = len(teacher.attempts())
    page = ctx.new_page()
    check("after a browser restart the consent screen is shown again", start_exam(page))
    check("restart: the same locked attempt is resumed (FR-26)",
          wait_until(lambda: overlay(page, "Your exam is paused").count() > 0, timeout=10))
    check("restart: no second attempt (same anonymous identity)",
          len(teacher.attempts()) == count and teacher.latest()["id"] == old_attempt["id"])

    teacher.unlock(old_attempt["id"])
    check("restart: unlock works after a restart", wait_until(lambda: overlay(page, "Your exam is paused").count() == 0, timeout=10))
    def typed(kind):
        return teacher.get(f"/rest/v1/events?select=data&attempt_id=eq.{old_attempt['id']}&type=eq.{kind}")

    pastes_before = len(typed("paste_attempt"))
    page.evaluate("for (let i = 0; i < 25; i++) document.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }))")
    pause(3)
    check("cap: 25 rapid paste attempts store only 10 events",
          wait_until(lambda: len(typed("paste_attempt")) - pastes_before == 10, timeout=10),
          str(len(typed("paste_attempt")) - pastes_before))
    page.goto(RESPONSE_URL)
    check("cap: the other 15 are summarised as one events_capped event when the exam ends",
          wait_until(lambda: [e["data"].get("dropped") for e in typed("events_capped") if e["data"].get("kind") == "paste_attempt"] == [15], timeout=10),
          str([e["data"] for e in typed("events_capped")]))
    check("submit: the attempt ends as submitted",
          wait_until(lambda: teacher.latest()["status"] == "submitted" and teacher.latest()["ended_at"], timeout=10), str(teacher.latest()))
    check("submit: the final event reached the database before finish",
          "submitted" in [e["type"] for e in teacher.events(old_attempt["id"])])
    check("submit: events stay contiguous", contiguous(teacher.events(old_attempt["id"])))
    page.close()


def parse_ts(v):
    return datetime.fromisoformat(v.replace("Z", "+00:00"))


def flow_outage(ctx, helper, teacher):
    page = ctx.new_page()
    check("outage: new exam starts", start_exam(page) and wait_until(lambda: page.locator("#eg-host .cn-hud").count() == 1))
    check("outage: new attempt row", wait_until(lambda: teacher.latest()["status"] == "active" and teacher.latest()["strikes"] == 0))
    x = teacher.latest()
    wait_until(lambda: "session_start" in [e["type"] for e in teacher.events(x["id"])], timeout=8)
    seqs_before = len(teacher.events(x["id"]))

    gateway = kong()
    sh(f"docker stop {gateway}")
    t0 = time.time()
    open_tab(helper, "https://example.org/")  # a strike while the network is down
    check("outage: the strike still shows locally", wait_until(lambda: overlay(page, "You left the exam tab").count() > 0, timeout=10))
    page.locator("#eg-host button", has_text="Continue exam").click()
    pause(max(0.0, 60 - (time.time() - t0)))  # about 60 s without a network
    sh(f"docker start {gateway}")
    back = time.time()
    check("outage: the API comes back", wait_until(lambda: teacher.get("/rest/v1/tests?select=id"), timeout=60, step=1))
    check("outage: queued events arrive after reconnect",
          wait_until(lambda: "strike" in [e["type"] for e in teacher.events(x["id"])], timeout=60, step=1))
    print(f"      (events arrived {time.time() - back:.0f}s after the API came back)")
    wait_until(lambda: teacher.get(f"/rest/v1/events?select=data&attempt_id=eq.{x['id']}&type=eq.connection_gap"), timeout=30, step=1)
    gaps = teacher.get(f"/rest/v1/events?select=data&attempt_id=eq.{x['id']}&type=eq.connection_gap")
    check("D12/Phase 5: the outage is recorded as one connection_gap event of about a minute",
          len(gaps) == 1 and 30 <= gaps[0]["data"]["seconds"] <= 150, str(gaps))
    evs = teacher.events(x["id"])
    check("outage: events carry contiguous sequence numbers", contiguous(evs) and len(evs) > seqs_before, str([e["seq"] for e in evs]))
    check("outage: strike count reaches the database", wait_until(lambda: teacher.latest()["strikes"] == 1, timeout=15), str(teacher.latest()))
    check("D12: the outage itself is not penalized (1 strike, not locked)",
          teacher.latest()["strikes"] == 1 and teacher.latest()["status"] in ("active", "warned", "away") and "Strikes 1/3" in hud(page), hud(page))
    page.close()
    return teacher.latest()


def flow_disabled(ctx, teacher, x):
    ctx.new_page().goto("about:blank")
    before = parse_ts(teacher.latest()["last_heartbeat"])
    pause(25)
    a = teacher.latest()
    check("extension disabled: the attempt stays active (not finished)", a["id"] == x["id"] and a["status"] in ("active", "warned", "away"), str(a))
    check("extension disabled: last_heartbeat goes stale",
          parse_ts(a["last_heartbeat"]) == before and (datetime.now(timezone.utc) - before).total_seconds() > 20, str(a["last_heartbeat"]))


def flow_closed_in_sql(ctx, teacher, x):
    page = ctx.new_page()
    check("closed-in-SQL: reopening the form resumes the same attempt", start_exam(page)
          and wait_until(lambda: page.locator("#eg-host .cn-hud").count() == 1, timeout=10) and teacher.latest()["id"] == x["id"])
    psql(f"update public.attempts set status='closed', ended_at=now() where id='{x['id']}'")
    sent = time.time()
    seen = wait_until(lambda: overlay(page, "Your teacher has ended this exam").count() > 0, timeout=12, step=0.2)
    took = time.time() - sent
    check(f"closed-in-SQL: the student sees the closed screen within about 5 s (took {took:.1f}s)", seen and took <= 6.5)
    check("closed-in-SQL: the HUD is gone and monitoring stopped", page.locator("#eg-host .cn-hud").count() == 0)
    page.locator("#eg-host button", has_text="Close").click()
    check("closed-in-SQL: the screen can be dismissed", wait_until(lambda: page.locator("#eg-host").count() == 0))
    check("closed-in-SQL: the attempt stays closed", teacher.latest()["status"] == "closed")
    page.close()


def flow_second_profile(ctx, teacher):
    used = {a["student_uid"] for a in teacher.attempts()}
    page = ctx.new_page()
    check("second profile: consent screen", start_exam(page))
    check("second profile: exam starts", wait_until(lambda: page.locator("#eg-host .cn-hud").count() == 1))
    ok = wait_until(lambda: teacher.latest()["student_uid"] not in used, timeout=8)
    check("second profile: a new attempt with a different student_uid", ok, str(teacher.latest()))
    rows = teacher.attempts()
    print(f"      ({len(rows)} attempts for this student name, {len({a['student_uid'] for a in rows})} distinct student_uid values)")
    page.close()


def flow_c(ctx, helper, teacher):
    before = teacher.latest()
    page = ctx.new_page()
    check("second exam: consent screen", start_exam(page))
    check("second exam starts", wait_until(lambda: page.locator("#eg-host .cn-hud").count() == 1))
    check("a finished attempt does not block a new one",
          wait_until(lambda: teacher.latest()["id"] != before["id"] and teacher.latest()["status"] == "active", timeout=8))
    cur = teacher.latest()
    # A teacher ends a test long after students start. Ending it within a few hundred milliseconds of the attempt appearing races the
    # extension's first upload, and the server rejects events for a closed attempt, so wait until the first events are stored.
    wait_until(lambda: "session_start" in [e["type"] for e in teacher.events(cur["id"])], timeout=8)
    sent = time.time()
    teacher.set_test_status("ended")
    check("End closes the attempt in the database at once", wait_until(lambda: teacher.latest()["status"] == "closed", timeout=3), str(teacher.latest()))
    gone = wait_until(lambda: page.locator("#eg-host .cn-hud").count() == 0, timeout=9, step=0.2)
    check(f"the student's HUD goes away within about 5 s (took {time.time() - sent:.1f}s)", gone and time.time() - sent <= 6.5)
    check("the student sees the closed screen", overlay(page, "Your teacher has ended this exam").count() > 0)
    check("events before close reached the database", "session_start" in [e["type"] for e in teacher.events(cur["id"])])
    page.close()


if __name__ == "__main__":
    main()
