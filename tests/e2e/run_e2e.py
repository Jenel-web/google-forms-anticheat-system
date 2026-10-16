"""End-to-end test for the CheatNoNo extension (mock backend).

    pip install playwright && python -m playwright install chromium
    python tests/e2e/run_e2e.py

Opens a real (headed) Chromium window, so don't click around while it runs: the extension treats focus
changes as leaving the exam. Uses Playwright's "chromium" channel; override with CHROME_PATH=/path/to/chrome.
Branded Google Chrome 137+ ignores --load-extension, so use Chromium or Chrome for Testing.

Google Forms is served from a local fake (context.route), so no network is needed. The closed Shadow DOM is
patched to 'open' in a temp copy of the extension so Playwright can see the overlays.
"""
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
FORM_ID = "1FAIpQLSe2eTestFormId"
FORM_URL = f"https://docs.google.com/forms/d/e/{FORM_ID}/viewform"
RESPONSE_URL = f"https://docs.google.com/forms/d/e/{FORM_ID}/formResponse"
UNPROTECTED_URL = "https://docs.google.com/forms/d/e/1FAIpQLSnotProtected/viewform"

QUESTIONS = "".join(
    f'<div role="listitem" style="height:420px;border:1px solid #ccc;padding:16px">Question {i} <input type="text"></div>'
    for i in range(1, 9)
)
FORM_HTML = f"""<!doctype html><html><head><title>Practice exam</title></head>
<body style="margin:0"><div role="list">{QUESTIONS}</div>
<div role="button" id="submit" tabindex="0" style="padding:16px;background:#ddd"
     onclick="window.__submitted=(window.__submitted||0)+1">Submit</div></body></html>"""
PLAIN_HTML = "<!doctype html><title>Other site</title><body>Other site</body>"

failures = []


def check(name, ok, extra=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{extra}]" if extra and not ok else ""))
    if not ok:
        failures.append(name)


PUMP = None  # a Playwright page; its wait_for_timeout lets the sync API process events (time.sleep does not)


def pause(seconds):
    PUMP.wait_for_timeout(int(seconds * 1000))


def wait_until(fn, timeout=8.0, step=0.15):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if fn():
                return True
        except Exception:
            pass
        pause(step)
    return False


def prepare_extension(tmp):
    dest = Path(tmp) / "extension"
    shutil.copytree(ROOT / "extension", dest, ignore=shutil.ignore_patterns("node_modules", "dist", "package*.json", "build.mjs", ".gitignore"))
    ui = dest / "src" / "content" / "ui.js"
    text = ui.read_text(encoding="utf-8")
    patched, n = re.subn(r"mode:\s*'closed'", "mode: 'open'", text)
    assert n == 1, "expected exactly one closed shadow root in ui.js"
    ui.write_text(patched, encoding="utf-8")
    return dest


def main():
    tmp = tempfile.mkdtemp(prefix="cheatnono-e2e-")
    ext = prepare_extension(tmp)
    with sync_playwright() as p:
        launch = dict(
            user_data_dir=str(Path(tmp) / "profile"),
            headless=False,
            args=[f"--disable-extensions-except={ext}", f"--load-extension={ext}", "--no-first-run"],
            viewport={"width": 1100, "height": 760},
        )
        if os.environ.get("CHROME_PATH"):
            launch["executable_path"] = os.environ["CHROME_PATH"]
        else:
            launch["channel"] = "chromium"
        ctx = p.chromium.launch_persistent_context(**launch)
        try:
            run(ctx)
        finally:
            ctx.close()
            shutil.rmtree(tmp, ignore_errors=True)


def run(ctx):
    def fulfill_form(route):
        if "formResponse" in route.request.url:
            route.fulfill(content_type="text/html", body="<!doctype html><title>Recorded</title>Your response was recorded.")
        else:
            route.fulfill(content_type="text/html", body=FORM_HTML)

    ctx.route("https://docs.google.com/forms/**", fulfill_form)
    ctx.route(re.compile(r"^https://(?!docs\.google\.com)[^/]+/.*"),
              lambda r: r.fulfill(content_type="text/html", body=PLAIN_HTML))

    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
    ext_id = sw.url.split("/")[2]
    global PUMP
    helper = ctx.pages[0]
    PUMP = helper
    helper.goto(f"chrome-extension://{ext_id}/src/popup/popup.html")

    def bg(msg):
        return helper.evaluate("m => new Promise(r => chrome.runtime.sendMessage(m, r))", msg)

    def state():
        return bg({"type": "DEV_STATE"})

    def events(kind=None):
        evs = state()["events"]
        return [e for e in evs if kind is None or e["type"] == kind]

    def attempt():
        a = state()["attempts"]
        return a[0] if a else None

    def rule_count():
        return len(helper.evaluate("chrome.declarativeNetRequest.getSessionRules()"))

    def open_tab(url):
        helper.evaluate("u => chrome.tabs.create({url: u, active: true})", url)

    def overlay(page, text):
        return page.locator("#eg-host .cn-modal").filter(has_text=text)

    # ---------------------------------------------------------------- unprotected form stays silent
    bg({"type": "DEV_RESET"})
    page = ctx.new_page()
    page.goto(UNPROTECTED_URL)
    pause(1.2)
    check("unprotected form: nothing appears", page.locator("#eg-host").count() == 0)

    # ---------------------------------------------------------------- protect + consent
    res = bg({"type": "DEV_ADD_TEST", "url": FORM_URL, "title": "Practice exam",
              "settings": {"mode": "enforce", "maxStrikes": 3, "allowlist": "allowed.test"}})
    check("popup protects a form", bool(res.get("test")), str(res))
    page.goto(FORM_URL)
    check("protected form: consent screen appears", overlay(page, "Before you begin").first.is_visible() if wait_until(lambda: overlay(page, "Before you begin").count() > 0) else False)

    name = page.locator("#eg-host #eg-name")
    email = page.locator("#eg-host #eg-email")
    agree = page.locator("#eg-host #eg-agree")
    start = page.locator("#eg-host button", has_text="Start exam")
    name.fill("Test Student")
    email.fill("not-an-email")
    agree.check()
    start.click()
    check("invalid email is rejected", page.locator("#eg-host").get_by_text("Enter a valid email address.").is_visible())
    check("invalid email creates no attempt", len(state()["attempts"]) == 0)

    # D10: "I don't agree" shows a message and creates no attempt
    page.locator("#eg-host button", has_text="I don't agree").click()
    check("D10: 'I don't agree' shows the contact-your-teacher message",
          page.locator("#eg-host").get_by_text("contact your teacher").is_visible())
    st = state()
    check("D10: no attempt and no events recorded", len(st["attempts"]) == 0 and len(st["events"]) == 0)
    page.locator("#eg-host button", has_text="Review the rules again").click()
    check("D10: consent screen comes back", overlay(page, "Before you begin").count() == 1)

    # ---------------------------------------------------------------- start
    page.locator("#eg-host #eg-name").fill("Test Student")  # the consent screen was rebuilt, so refill it
    page.locator("#eg-host #eg-email").fill("student@school.edu")
    page.locator("#eg-host #eg-agree").check()
    page.locator("#eg-host button", has_text="Start exam").click()
    started = wait_until(lambda: page.locator("#eg-host .cn-hud").count() == 1)
    check("exam starts: HUD shows Protected, Strikes 0/3", started and "Strikes 0/3" in page.locator("#eg-host .cn-hud").inner_text())
    a = attempt()
    check("exactly one attempt created", a is not None and len(state()["attempts"]) == 1)
    check("session events logged", bool(events("consent_accepted")) and bool(events("session_start")))
    check("DNR blocklist rules installed", rule_count() > 0)
    fs = page.evaluate("!!document.fullscreenElement")
    check("start enters fullscreen (user gesture)", fs)

    # ---------------------------------------------------------------- strike 1: new tab is closed
    tabs_before = len(ctx.pages)
    open_tab("https://example.org/")
    warned = wait_until(lambda: overlay(page, "You left the exam tab").count() > 0, timeout=10)
    check("new tab -> warning shown", warned)
    check("new tab -> strike 1", attempt()["strikes"] == 1, str(attempt()))
    check("new tab was closed", wait_until(lambda: len(ctx.pages) == tabs_before))
    page.locator("#eg-host button", has_text="Continue exam").click()
    check("Continue exam dismisses the warning", wait_until(lambda: page.locator("#eg-host .cn-modal").count() == 0))

    # ---------------------------------------------------------------- allowlisted site: no strike
    open_tab("https://allowed.test/")
    pause(1.5)
    check("allowlisted tab is not closed", wait_until(lambda: len(ctx.pages) == tabs_before + 1, timeout=3))
    check("allowlisted site adds no strike", attempt()["strikes"] == 1, str(attempt()))
    check("allowlisted site is logged", bool(events("allowed_tab_opened")))
    helper.evaluate("async () => { const [t] = await chrome.tabs.query({url: 'https://allowed.test/*'}); await chrome.tabs.remove(t.id); }")
    pause(1.0)
    check("closing the allowlisted tab adds no strike", attempt()["strikes"] == 1 and page.locator("#eg-host .cn-modal").count() == 0)

    # ---------------------------------------------------------------- strike 2: blocked site shows the blocked page
    open_tab("https://chatgpt.com/")
    blocked = None
    if wait_until(lambda: any("blocked.html" in pg.url for pg in ctx.pages), timeout=10):
        blocked = next(pg for pg in ctx.pages if "blocked.html" in pg.url)
    check("chatgpt.com -> blocked page", blocked is not None and "chatgpt.com" in blocked.inner_text("body"))
    if blocked:
        check("blocked page says Strike 2 of 3 added",
              wait_until(lambda: "Strike 2 of 3 added" in blocked.inner_text("body")), blocked.inner_text("body"))
        blocked.locator("#back").click()
    check("blocked attempt logged", bool(events("blocked_site_attempt")))
    check("strike 2 -> final warning (blur)", wait_until(lambda: overlay(page, "One more and your exam pauses").count() > 0, timeout=10))
    check("final warning blurs the page", "blur" in page.evaluate("getComputedStyle(document.body).filter"))
    page.locator("#eg-host button", has_text="Return to exam").click()
    check("Return to exam clears the final warning", wait_until(lambda: page.locator("#eg-host .cn-modal").count() == 0))

    # a reload while the exam is active must not cost a strike (the page fires visibility_hidden while unloading)
    page.reload()
    wait_until(lambda: page.locator("#eg-host .cn-hud").count() == 1 or overlay(page, "fullscreen").count() > 0, timeout=10)
    pause(1.0)
    check("reload while active costs no strike", attempt()["strikes"] == 2, str(attempt()))
    btn = page.locator("#eg-host button", has_text="Return to fullscreen")
    if btn.count():
        btn.click()
        wait_until(lambda: page.locator("#eg-host .cn-modal").count() == 0)

    # ---------------------------------------------------------------- strike 3: locked
    open_tab("https://example.net/")
    locked = wait_until(lambda: overlay(page, "Your exam is paused").count() > 0, timeout=10)
    check("strike 3 -> locked screen", locked)
    check("locked screen has no message box (D1)", page.locator("#eg-host textarea").count() == 0)
    check("attempt is locked with 3 strikes", wait_until(lambda: attempt()["status"] == "locked" and attempt()["strikes"] == 3), str(attempt()))

    # ---------------------------------------------------------------- tamper: delete overlay + click Submit
    page.evaluate("() => { document.getElementById('eg-host').remove(); document.body.inert = false; }")
    box = page.locator("#submit").bounding_box()
    page.mouse.click(box["x"] + 20, box["y"] + 10)
    page.locator("#submit").focus()
    page.keyboard.press("Enter")
    pause(0.4)
    check("tamper: Submit did nothing", page.evaluate("window.__submitted || 0") == 0)
    check("tamper: input_while_blocked logged", wait_until(lambda: bool(events("input_while_blocked"))))
    check("tamper: overlay rebuilt within 250ms", wait_until(lambda: overlay(page, "Your exam is paused").count() > 0, timeout=3))
    check("tamper: body inert again", page.evaluate("document.body.inert"))

    # ---------------------------------------------------------------- reload mid-exam
    page.reload()
    check("reload: no second consent screen", wait_until(lambda: overlay(page, "Your exam is paused").count() > 0, timeout=10)
          and overlay(page, "Before you begin").count() == 0)
    check("reload: strikes kept", attempt()["strikes"] == 3 and len(state()["attempts"]) == 1)
    check("reload logged", bool(events("page_reload")))

    # ---------------------------------------------------------------- teacher unlock via heartbeat
    bg({"type": "DEV_UNLOCK", "attemptId": attempt()["id"]})
    check("unlock arrives within 7 s",
          wait_until(lambda: overlay(page, "Your exam is paused").count() == 0, timeout=7))
    check("unlock sets strikes to max-1", wait_until(lambda: attempt()["strikes"] == 2 and attempt()["status"] != "locked"), str(attempt()))
    check("unlock is logged", bool(events("unlocked")))

    # ---------------------------------------------------------------- fullscreen
    # A reload drops fullscreen, so the fullscreen screen is already waiting after the unlock.
    check("after reload the fullscreen screen is shown", wait_until(lambda: overlay(page, "Return to fullscreen to continue").count() > 0))
    page.locator("#eg-host button", has_text="Return to fullscreen").click()
    check("Return to fullscreen restores the exam", wait_until(lambda: page.locator("#eg-host .cn-modal").count() == 0))
    page.evaluate("document.exitFullscreen()")
    check("exiting fullscreen shows the fullscreen screen", wait_until(lambda: overlay(page, "Return to fullscreen to continue").count() > 0))
    check("fullscreen exit adds no strike", attempt()["strikes"] == 2)
    check("fullscreen exit is logged", bool(events("fullscreen_exit")))
    page.locator("#eg-host button", has_text="Return to fullscreen").click()
    check("returning to fullscreen clears the screen again", wait_until(lambda: page.locator("#eg-host .cn-modal").count() == 0))

    # ---------------------------------------------------------------- submit ends the session
    page.goto(RESPONSE_URL)
    check("/formResponse -> attempt submitted", wait_until(lambda: attempt()["status"] == "submitted"), str(attempt()))
    check("/formResponse -> DNR rules removed", wait_until(lambda: rule_count() == 0))

    # ---------------------------------------------------------------- the exam tab itself goes to a blocked / other site
    bg({"type": "DEV_RESET"})
    bg({"type": "DEV_ADD_TEST", "url": FORM_URL, "title": "Navigation exam", "settings": {"mode": "enforce", "maxStrikes": 10}})
    page.goto(FORM_URL)
    wait_until(lambda: overlay(page, "Before you begin").count() > 0)
    page.locator("#eg-host #eg-name").fill("Nav Student")
    page.locator("#eg-host #eg-email").fill("nav@school.edu")
    page.locator("#eg-host #eg-agree").check()
    page.locator("#eg-host button", has_text="Start exam").click()
    wait_until(lambda: attempt() is not None and attempt()["status"] == "active")
    page.goto("https://chatgpt.com/")
    check("exam tab -> chatgpt.com shows the blocked page in that tab",
          wait_until(lambda: "blocked.html" in page.url and "chatgpt.com" in page.inner_text("body")), page.url)
    check("exam tab -> blocked page counts one strike", wait_until(lambda: attempt()["strikes"] == 1), str(attempt()))
    check("exam tab -> blocked attempt logged once", len(events("blocked_site_attempt")) == 1, str(len(events("blocked_site_attempt"))))
    page.locator("#back").click()
    check("Back to exam returns to the form", wait_until(lambda: "viewform" in page.url))
    check("Back to exam shows the warning naming the site", wait_until(lambda: overlay(page, "A blocked site was opened: chatgpt.com").count() > 0, timeout=10))
    check("Back to exam is not logged as a reload", not events("page_reload"))
    page.locator("#eg-host button", has_text="Continue exam").click()
    page.goto("https://example.org/")
    check("exam tab -> other site goes back to the form", wait_until(lambda: "viewform" in page.url, timeout=10), page.url)
    check("exam tab -> other site counts a strike", wait_until(lambda: attempt()["strikes"] == 2), str(attempt()))
    check("exam tab -> navigated_away logged", bool(events("navigated_away")))

    # ---------------------------------------------------------------- record mode stays silent
    bg({"type": "DEV_RESET"})
    bg({"type": "DEV_ADD_TEST", "url": FORM_URL, "title": "Record exam", "settings": {"mode": "record", "maxStrikes": 3}})
    page.goto(FORM_URL)
    wait_until(lambda: overlay(page, "Before you begin").count() > 0)
    page.locator("#eg-host #eg-name").fill("Record Student")
    page.locator("#eg-host #eg-email").fill("rec@school.edu")
    page.locator("#eg-host #eg-agree").check()
    page.locator("#eg-host button", has_text="Start exam").click()
    wait_until(lambda: attempt() is not None and attempt()["status"] == "active")
    pause(0.8)
    check("record mode: no HUD, no overlay after consent", page.locator("#eg-host .cn-hud").count() == 0 and page.locator("#eg-host .cn-modal").count() == 0)
    check("record mode: no DNR rules", rule_count() == 0)
    n_tabs = len(ctx.pages)
    open_tab("https://example.org/")
    counted = wait_until(lambda: attempt()["strikes"] == 1, timeout=10)
    pause(0.8)
    check("record mode: strike is counted", counted)
    check("record mode: new tab is not closed", wait_until(lambda: len(ctx.pages) == n_tabs + 1, timeout=3))
    check("record mode: still no overlay", page.locator("#eg-host .cn-modal").count() == 0)

    print()
    if failures:
        print(f"{len(failures)} check(s) FAILED:")
        for f in failures:
            print("  - " + f)
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()
