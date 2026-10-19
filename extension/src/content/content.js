// Page monitoring + boot flow. Classic script; runs after styles.js (EG_CSS), ui.js (EG_UI) and formmap.js (EG_FORM).
(() => {
  'use strict';

  const QUESTION_SELECTOR = 'div[role="listitem"]'; // Google Forms DOM is unofficial: keep the selector in one place
  // The form itself is still on the page when /formResponse shows the next section; the final confirmation has none.
  const FORM_SELECTOR = 'form[action*="/formResponse"], input[name="pageHistory"]';
  const HEARTBEAT_MS = 5000;
  const BLUR = 'blur(7px) saturate(.9)';
  const GUARDED_EVENTS = [
    'click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend',
    'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'change', 'submit', 'dragstart', 'drop',
    'contextmenu', 'copy', 'cut', 'paste',
  ];

  let test = null;
  let identity = null;
  let state = null;        // latest public state from the worker
  let monitoring = false;
  let shownKey = '';
  let wantBlur = false;
  let lastInputLog = 0;
  let lastQ = null;
  let formOrder = null;    // ids of all the form's questions in order, so numbers count across pages (see formmap.js)
  let hbTimer = null;
  let enforceTimer = null;

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => { void chrome.runtime.lastError; resolve(res); });
      } catch {
        resolve(undefined); // extension reloaded: this content script is orphaned
      }
    });
  }

  const enforceMode = () => !!state && state.mode === 'enforce';

  // ------------------------------------------------------------ lock enforcement (FR-20)
  // A capture-phase guard on window, independent of page DOM. Installed at document_start so the page's
  // own window-level listeners can't run before it. Events from the overlay itself pass through.
  function guard(ev) {
    if (!EG_UI.showing) return;
    if (EG_UI.host && ev.composedPath().includes(EG_UI.host)) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    if (!state) return;
    const now = Date.now();
    if (ev.type === 'submit') {
      send({ type: 'EVENT', kind: 'submit_while_blocked', detail: { via: ev.type } });
    } else if (now - lastInputLog >= 1000) {
      lastInputLog = now;
      send({ type: 'EVENT', kind: 'input_while_blocked', detail: { via: ev.type } });
    }
  }
  GUARDED_EVENTS.forEach((name) => window.addEventListener(name, guard, true));

  window.addEventListener('focusin', (ev) => {
    if (EG_UI.showing && !(EG_UI.host && ev.composedPath().includes(EG_UI.host))) EG_UI.focusPrimary();
  }, true);

  function setBlur(on) {
    wantBlur = on;
    const b = document.body;
    if (!b) return;
    if (on) {
      if (b.style.getPropertyValue('filter') !== BLUR) b.style.setProperty('filter', BLUR, 'important');
      b.style.setProperty('user-select', 'none', 'important');
    } else if (b.style.getPropertyValue('filter')) {
      b.style.removeProperty('filter');
      b.style.removeProperty('user-select');
    }
  }

  // Every 250 ms: rebuild the overlay if it was removed or hidden, and re-assert inert and blur.
  function enforce() {
    if (!EG_UI.host) return;
    EG_UI.ensureAttached();
    const need = EG_UI.showing;
    if (document.body) {
      if (document.body.inert !== need) document.body.inert = need;
      setBlur(wantBlur);
    }
    if (need && document.activeElement !== EG_UI.host) EG_UI.focusPrimary();
  }

  // ------------------------------------------------------------ screens
  function errorText(code) {
    switch (code) {
      case 'NAME_REQUIRED': return 'Enter your full name.';
      case 'EMAIL_REQUIRED': return 'Enter a valid email address.';
      case 'SERVER_UNREACHABLE': return "Can't reach the exam server. Check your connection and try again.";
      case 'NOT_PROTECTED':
      case 'NOT_A_FORM': return "This exam isn't available right now. Reload the page.";
      default: return 'Something went wrong. Reload the page and try again.';
    }
  }

  function wantsFullscreen(settings) {
    return !!settings && settings.mode === 'enforce' && settings.requireFullscreen !== false;
  }

  function enterFullscreen() {
    try {
      return document.documentElement.requestFullscreen().catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  function showConsent() {
    shownKey = 'consent';
    EG_UI.show('consent', { test, identity, errorText, onStart, onDecline });
    document.body.inert = true;
  }

  // D10: refusing is allowed, has no penalty, and nothing is sent to the worker or the server.
  function onDecline() {
    shownKey = 'declined';
    EG_UI.show('declined', { onReview: showConsent });
  }

  function onStart({ name, email }) {
    // User-gesture rule: requestFullscreen() runs synchronously here, before any await.
    const fs = wantsFullscreen(test && test.settings) ? enterFullscreen() : Promise.resolve();
    return Promise.all([send({ type: 'START_EXAM', url: location.href, name, email }), fs]).then(([res]) => {
      if (res && res.state) {
        startMonitoring(res.state);
        return {};
      }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (res && res.error === 'INCOGNITO') {
        shownKey = 'incognito';
        EG_UI.show('incognito', {});
        return {};
      }
      return { error: (res && res.error) || 'INTERNAL' };
    });
  }

  function onAck() {
    send({ type: 'ACK' }).then((res) => { if (res && res.state) applyState(res.state); });
  }

  function onFullscreen() {
    enterFullscreen(); // synchronous inside the click handler
  }

  function applyState(st) {
    if (!st) return;
    if (st.ended) {
      teardown();
      if (st.closed) {
        shownKey = 'closed';
        EG_UI.show('closed', { onDismiss: () => EG_UI.destroy() });
      }
      return;
    }
    state = st;
    const enforcing = st.mode === 'enforce';
    EG_UI.setHud(enforcing ? st : null); // record mode: no HUD, no overlays (FR-27)
    let screen = null;
    if (enforcing) {
      if (st.phase === 'locked') screen = 'locked';
      else if (st.phase === 'blurred') screen = 'blurred';
      else if (st.phase === 'warning') screen = 'warning';
      else if (st.requireFullscreen && !document.fullscreenElement) screen = 'fullscreen';
    }
    const key = screen ? [screen, st.strikes, st.max, st.lastEpisode && st.lastEpisode.t].join('|') : '';
    if (key !== shownKey) {
      shownKey = key;
      if (screen) EG_UI.show(screen, { state: st, onAck, onFullscreen });
      else EG_UI.hide();
    }
    setBlur(!!screen);
    if (document.body) document.body.inert = !!screen;
  }

  function teardown() {
    monitoring = false;
    state = null;
    shownKey = '';
    clearInterval(hbTimer);
    hbTimer = null;
    setBlur(false);
    EG_UI.destroy();
    if (document.body) document.body.inert = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  // ------------------------------------------------------------ monitoring (FR-12, FR-13, FR-14)
  function report(kind, detail) {
    if (monitoring && state) send({ type: 'EVENT', kind, detail });
  }

  function onClipboard(ev) {
    report(ev.type + '_attempt');
    if (state && state.blockCopyPaste) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }

  function shortcutName(ev) {
    const mod = ev.ctrlKey || ev.metaKey;
    const k = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
    if (k === 'F12') return 'F12';
    if (mod && ev.shiftKey && ['I', 'J', 'C'].includes(k)) return 'Ctrl+Shift+' + k;
    if (mod && !ev.shiftKey && ['U', 'P', 'S'].includes(k)) return 'Ctrl+' + k;
    return null;
  }

  function pageFormOrder() {
    return EG_FORM.orderFromScripts(Array.from(document.scripts, (s) => s.textContent || ''));
  }

  function itemIdOf(el) {
    for (const node of el.querySelectorAll('[data-params]')) {
      const id = EG_FORM.idFromParams(node.getAttribute('data-params'));
      if (id !== null) return id;
    }
    return null;
  }

  // Learn the form's structure from this page and tell the worker, which keeps it for the pages that follow.
  function syncFormMap() {
    const order = pageFormOrder();
    if (!order) return;
    formOrder = order;
    send({ type: 'FORM_MAP', order });
  }

  function currentQuestion() {
    const items = Array.from(document.querySelectorAll(QUESTION_SELECTOR));
    if (!items.length) return null;
    const mid = window.innerHeight / 2;
    if (formOrder) {
      // Number by the whole form: the question's position among all questions on every page ("11 of 50").
      let bestNum = 0;
      let bestD = Infinity;
      for (const el of items) {
        const num = EG_FORM.numberFor(formOrder, itemIdOf(el));
        if (!num) continue; // a description, image or section title is not a question
        const r = el.getBoundingClientRect();
        const d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < bestD) { bestD = d; bestNum = num; }
      }
      if (bestNum) return { i: bestNum, n: formOrder.length };
    }
    // Structure unknown (Google changed its markup): count the items on this page, as before.
    let best = 0;
    let bestDist = Infinity;
    items.forEach((el, idx) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs((r.top + r.bottom) / 2 - mid);
      if (d < bestDist) { bestDist = d; best = idx; }
    });
    return { i: best + 1, n: items.length };
  }

  function trackQuestion() {
    if (!monitoring) return;
    const q = currentQuestion();
    if (q && (!lastQ || lastQ.i !== q.i || lastQ.n !== q.n)) {
      lastQ = q;
      send({ type: 'QUESTION', q });
    }
  }

  function attachMonitors() {
    ['copy', 'cut', 'paste', 'contextmenu'].forEach((n) => document.addEventListener(n, onClipboard, true));
    document.addEventListener('keydown', (ev) => {
      if (!monitoring) return;
      const combo = shortcutName(ev);
      if (!combo) return;
      report('shortcut_blocked', { combo });
      if (enforceMode()) { ev.preventDefault(); ev.stopImmediatePropagation(); }
    }, true);
    document.addEventListener('keyup', (ev) => {
      if (monitoring && ev.key === 'PrintScreen') report('printscreen');
    }, true);
    document.addEventListener('visibilitychange', () => {
      report(document.visibilityState === 'hidden' ? 'visibility_hidden' : 'visibility_visible');
    });
    document.addEventListener('fullscreenchange', () => {
      if (!monitoring) return;
      report(document.fullscreenElement ? 'fullscreen_enter' : 'fullscreen_exit');
      applyState(state);
    });
    window.addEventListener('scroll', () => trackQuestion(), { passive: true });
  }

  let monitorsAttached = false;
  function startMonitoring(st) {
    monitoring = true;
    if (!monitorsAttached) { attachMonitors(); monitorsAttached = true; }
    EG_UI.hide(); // clears the consent screen
    shownKey = '';
    applyState(st);
    syncFormMap();
    lastQ = null;
    trackQuestion();
    clearInterval(hbTimer);
    const beat = () => {
      trackQuestion();
      send({ type: 'HEARTBEAT', fullscreen: !!document.fullscreenElement });
    };
    hbTimer = setInterval(beat, HEARTBEAT_MS);
    beat();
  }

  // ------------------------------------------------------------ boot
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'STATE' && (monitoring || msg.state.ended)) applyState(msg.state);
    });
  } catch { /* orphaned content script */ }

  function waitFor(test, timeoutMs) {
    return new Promise((resolve) => {
      const end = Date.now() + timeoutMs;
      const tick = () => {
        let hit = null;
        try { hit = test(); } catch { /* keep waiting */ }
        if (hit) resolve(hit);
        else if (Date.now() >= end) resolve(null);
        else setTimeout(tick, 100);
      };
      tick();
    });
  }

  async function boot() {
    const res = await send({ type: 'PAGE_LOADED', url: location.href });
    if (!res || !res.protected) return; // not a protected exam: stay silent
    if (res.responsePage) {
      // Google Forms shows the next section at /formResponse too. Wait briefly for the form to be there before deciding.
      const section = await waitFor(() => document.querySelector(FORM_SELECTOR), 2000);
      send({ type: 'RESPONSE_PAGE', final: !section });
      if (!section) return; // the final confirmation page: the exam is over, the worker ends the session
    }
    test = res.test;
    identity = res.identity;
    formOrder = pageFormOrder() || res.itemOrder || null; // this page's own data, else what the worker kept
    enforceTimer = setInterval(enforce, 250);
    if (res.incognito) {
      shownKey = 'incognito';
      EG_UI.show('incognito', {});
      document.body.inert = true;
    } else if (res.resume) {
      startMonitoring(res.state);
    } else {
      showConsent();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
