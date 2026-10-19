import * as backend from './backend.js';
import {
  EXAM_HOSTS, mergeSettings, parseFormId, parseResponseFormId, isFormResponseUrl, hostOf, domainMatches, entryMatchesUrl,
  phaseForStrikes, isValidEmail,
} from '../shared/constants.js';
import { allowEvent, endedSummaries } from '../shared/throttle.js';

// ---------------------------------------------------------------- session store
// The MV3 worker can die at any time: every mutation goes through withSessions (mutex + load/save).

const SESSIONS_KEY = 'eg_sessions';
const BLOCKED_BASE = chrome.runtime.getURL('src/blocked/blocked.html');
const EVENT_KINDS = new Set([
  'copy_attempt', 'cut_attempt', 'paste_attempt', 'contextmenu_attempt', 'shortcut_blocked', 'printscreen',
  'fullscreen_exit', 'fullscreen_enter', 'input_while_blocked', 'submit_while_blocked',
  'visibility_hidden', 'visibility_visible',
]);
const RESERVED = new Set(['type', 't', 'q', 'attemptId']);

let lock = Promise.resolve();

function withSessions(fn) {
  const run = async () => {
    const sessions = (await chrome.storage.session.get(SESSIONS_KEY))[SESSIONS_KEY] || {};
    const result = await fn(sessions);
    await chrome.storage.session.set({ [SESSIONS_KEY]: sessions });
    return result;
  };
  const p = lock.then(run, run);
  lock = p.catch(() => {});
  return p;
}

const isEnforce = (s) => s.settings.mode === 'enforce';
const isBlank = (url) => !url || url === 'about:blank';
// A tab that hasn't committed yet has an empty url but a pendingUrl.
const tabUrl = (tab) => tab.url || tab.pendingUrl || '';

// The single allowlist check (FR-16). Don't add a second one elsewhere.
function allowlisted(s, url) {
  const host = hostOf(url);
  return !!host && s.settings.allowlist.some((d) => domainMatches(host, d));
}

function blockedEntry(s, url) {
  if (!s.settings.blockAiSites || allowlisted(s, url)) return null;
  return s.settings.blocklist.find((e) => entryMatchesUrl(e, url)) || null;
}

function examHostOk(s, url) {
  const host = hostOf(url);
  return EXAM_HOSTS.some((d) => domainMatches(host, d)) || allowlisted(s, url);
}

function cleanDetail(detail) {
  const out = {};
  if (!detail || typeof detail !== 'object') return out;
  for (const [k, v] of Object.entries(detail)) {
    if (RESERVED.has(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => String(x).slice(0, 100));
  }
  return JSON.stringify(out).length < 1500 ? out : {};
}

function emit(s, type, detail = {}) {
  const ev = { attemptId: s.attemptId, t: new Date().toISOString(), type, q: s.q || null, ...detail };
  backend.appendEvent(ev).catch(() => {});
}

// Noisy event types are capped per minute (shared/throttle.js); what was dropped is summarised as one `events_capped`.
function log(s, type, detail = {}) {
  s.throttle = s.throttle || {}; // lives in the session, so a worker restart does not reset the window
  const gate = allowEvent(s.throttle, type, Date.now());
  gate.summaries.forEach((x) => emit(s, 'events_capped', { kind: x.kind, dropped: x.dropped, seconds: 60 }));
  if (gate.allow) emit(s, type, detail);
}

// Summaries for windows that ended with no further event (heartbeat), or all of them when the session ends.
function flushCapped(s, force = false) {
  if (!s.throttle) return;
  endedSummaries(s.throttle, Date.now(), force).forEach((x) => emit(s, 'events_capped', { kind: x.kind, dropped: x.dropped, seconds: 60 }));
}

function statusFor(s) {
  if (s.phase === 'locked') return 'locked';
  if (s.episode) return 'away';
  if (s.phase === 'warning' || s.phase === 'blurred') return 'warned';
  return 'active';
}

function patchStatus(s) {
  backend.patchAttempt(s.attemptId, { status: statusFor(s), strikes: s.strikes }).catch(() => {});
}

function publicState(s) {
  const enforce = isEnforce(s);
  return {
    phase: s.phase,
    strikes: s.strikes,
    max: s.settings.maxStrikes,
    mode: s.settings.mode,
    title: s.title,
    requireFullscreen: enforce && s.settings.requireFullscreen,
    blockCopyPaste: enforce && s.settings.blockCopyPaste,
    lastEpisode: s.lastEpisode,
    ended: false,
  };
}

function pushState(s) {
  if (s.tabId == null) return;
  chrome.tabs.sendMessage(s.tabId, { type: 'STATE', state: publicState(s) }).catch(() => {});
}

// ---------------------------------------------------------------- DNR blocklist (FR-18)

async function syncRules(sessions) {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const addRules = [];
  const seen = new Set();
  let id = 1;
  for (const s of Object.values(sessions)) {
    if (!isEnforce(s) || !s.settings.blockAiSites) continue;
    for (const entry of s.settings.blocklist) {
      const host = entry.split('/')[0];
      if (s.settings.allowlist.some((d) => domainMatches(host, d))) continue; // allowlisted: never redirected
      if (seen.has(entry)) continue;
      seen.add(entry);
      const where = entry.includes('/') ? { urlFilter: '||' + entry } : { requestDomains: [entry] };
      addRules.push({
        id: id++,
        priority: 1,
        action: { type: 'redirect', redirect: { extensionPath: '/src/blocked/blocked.html?site=' + encodeURIComponent(host) } },
        condition: { ...where, resourceTypes: ['main_frame'] },
      });
    }
  }
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: existing.map((r) => r.id), addRules });
}

// ---------------------------------------------------------------- leave episodes (FR-8..FR-10)

// One episode = one strike. Never increment s.strikes anywhere else.
function startEpisode(s, reason, detail = {}, extra = {}) {
  log(s, reason, detail);
  const domain = detail.domain;
  if (s.episode) {
    if (!s.episode.reasons.includes(reason)) s.episode.reasons.push(reason);
    if (domain && !s.episode.domains.includes(domain)) s.episode.domains.push(domain);
    if (extra.blockedSite) s.episode.blockedSite = extra.blockedSite;
    return false;
  }
  if (s.phase === 'locked') return false; // already locked: nothing more to count
  s.episode = {
    t0: Date.now(), reasons: [reason], domains: domain ? [domain] : [], blockedSite: extra.blockedSite || null,
  };
  s.strikes += 1;
  log(s, 'strike', { n: s.strikes, reason });
  patchStatus(s);
  return true;
}

async function examTabFocused(s) {
  if (s.tabId == null) return false;
  try {
    const tab = await chrome.tabs.get(s.tabId);
    if (!tab.active || !examHostOk(s, tab.url || '')) return false;
    s.windowId = tab.windowId;
    const win = await chrome.windows.get(tab.windowId);
    return win.focused;
  } catch {
    return false;
  }
}

async function maybeCloseEpisode(s) {
  if (!s.episode || !(await examTabFocused(s))) return;
  const ep = s.episode;
  s.episode = null;
  const durationMs = Date.now() - ep.t0;
  s.lastEpisode = {
    reasons: ep.reasons, domains: ep.domains, blockedSite: ep.blockedSite, durationMs, t: new Date().toISOString(),
  };
  log(s, 'returned', { durationMs, reasons: ep.reasons, domains: ep.domains });
  s.phase = isEnforce(s) ? phaseForStrikes(s.strikes, s.settings.maxStrikes) : 'active';
  if (s.phase === 'locked') log(s, 'locked', { strikes: s.strikes });
  patchStatus(s);
  pushState(s);
}

async function snapBack(s) {
  if (!isEnforce(s) || !s.settings.snapBack || s.tabId == null) return;
  try {
    await chrome.windows.update(s.windowId, { focused: true, drawAttention: true });
    await chrome.tabs.update(s.tabId, { active: true });
  } catch { /* the exam tab or its window is gone */ }
}

// ---------------------------------------------------------------- session lifecycle

// D13: after the teacher ends the test the session is over, but a later submission from that tab must still be
// flagged. This remembers only {tabId: attemptId}; nothing else is monitored after close.
const CLOSED_KEY = 'eg_closed_tabs';
let closedLock = Promise.resolve();

function withClosed(fn) {
  const run = async () => {
    const map = (await chrome.storage.session.get(CLOSED_KEY))[CLOSED_KEY] || {};
    const result = await fn(map);
    await chrome.storage.session.set({ [CLOSED_KEY]: map });
    return result;
  };
  const p = closedLock.then(run, run);
  closedLock = p.catch(() => {});
  return p;
}

async function endSession(sessions, s, status) {
  flushCapped(s, true);
  log(s, status === 'submitted' ? 'submitted' : 'closed');
  if (status === 'closed' && s.tabId != null) {
    await withClosed(async (map) => {
      map[s.tabId] = s.attemptId;
      const ids = Object.keys(map);
      if (ids.length > 20) delete map[ids[0]];
    }).catch(() => {});
  }
  await backend.patchAttempt(s.attemptId, { status, endedAt: new Date().toISOString() }).catch(() => {});
  delete sessions[s.attemptId];
  await syncRules(sessions);
  if (s.tabId != null) {
    chrome.tabs.sendMessage(s.tabId, { type: 'STATE', state: { ended: true, closed: status === 'closed' } }).catch(() => {});
  }
}

function getChromeEmail() {
  return new Promise((resolve) => {
    try {
      chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => resolve((info && info.email) || null));
    } catch {
      resolve(null);
    }
  });
}

async function tabExists(tabId) {
  try { await chrome.tabs.get(tabId); return true; } catch { return false; }
}

// ---------------------------------------------------------------- new tabs (FR-16)

async function decideNewTab(s, tabId, url) {
  const domain = hostOf(url);
  if (allowlisted(s, url)) {
    log(s, 'allowed_tab_opened', { domain });
    return;
  }
  const hit = blockedEntry(s, url);
  if (hit) log(s, 'blocked_site_attempt', { domain: hit.split('/')[0] });
  if (hit && isEnforce(s)) {
    // Keep the tab so the student sees the blocked page; it is closed from that page ("Back to exam").
    s.blockedTabs.push(tabId);
    startEpisode(s, 'tab_opened', { domain: hit.split('/')[0] }, { blockedSite: hit.split('/')[0] });
    return;
  }
  startEpisode(s, 'tab_opened', { domain });
  if (isEnforce(s)) {
    s.closedTabs.push(tabId);
    if (s.closedTabs.length > 50) s.closedTabs.shift();
    await chrome.tabs.remove(tabId).catch(() => {});
    await snapBack(s);
  }
}

async function onTabCreated(s, tab) {
  if (tab.id === s.tabId) return;
  const url = tab.pendingUrl || tab.url || '';
  if (s.tabId == null && parseFormId(url) === s.formId) return; // exam tab being reopened; adopted at PAGE_LOADED
  if (isBlank(url)) {
    s.pendingTabs.push(tab.id); // decided at its first navigation
    return;
  }
  await decideNewTab(s, tab.id, url);
}

async function onExamNavigation(sessions, s, url) {
  if (isFormResponseUrl(url)) {
    // Google Forms posts every page of a multi-page form, and the final submit, to /formResponse. Only the page that
    // loads tells them apart (the next section still has the form on it), so wait for the content script's verdict
    // (RESPONSE_PAGE) instead of ending the exam here. Moving between sections is not a strike or a reload.
    s.responsePending = true;
    s.skipReload = true;
    return;
  }
  // A blocklisted URL is about to be (or has been) redirected to the blocked page: no goBack, the student
  // sees the page and leaves it with "Back to exam". Logged once, whichever of the two URLs we see first.
  const hit = isEnforce(s) ? blockedEntry(s, url) : null;
  const isBlockedPage = url.startsWith(BLOCKED_BASE);
  if (hit || isBlockedPage) {
    const site = isBlockedPage ? new URL(url).searchParams.get('site') || '' : hit.split('/')[0];
    if (!s.episode || s.episode.blockedSite !== site) log(s, 'blocked_site_attempt', { domain: site });
    startEpisode(s, 'navigated_away', { domain: site }, { blockedSite: site });
    return;
  }
  if (examHostOk(s, url)) return;
  startEpisode(s, 'navigated_away', { domain: hostOf(url) });
  if (isEnforce(s)) await chrome.tabs.goBack(s.tabId).catch(() => {});
}

async function benignHide(s) {
  try {
    // A reload fires visibility_hidden while the tab is still the active tab of the focused window: not a leave.
    // Real leaves are caught by tabs.onActivated / windows.onFocusChanged instead.
    const [tab, win] = await Promise.all([chrome.tabs.get(s.tabId), chrome.windows.get(s.windowId)]);
    if (tab.active && win.focused) return true;
    const [active] = await chrome.tabs.query({ active: true, windowId: s.windowId });
    if (!active || active.id === s.tabId) return false;
    return allowlisted(s, tabUrl(active)) || s.pendingTabs.includes(active.id);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- browser event listeners (top level)

// A submission after End (D13): finish_attempt on a closed attempt leaves a submitted_after_close flag behind.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url || !isFormResponseUrl(info.url)) return;
  withClosed(async (map) => {
    const attemptId = map[tabId];
    if (!attemptId) return;
    delete map[tabId];
    backend.patchAttempt(attemptId, { status: 'submitted', endedAt: new Date().toISOString() }).catch(() => {});
  }).catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  withClosed(async (map) => { delete map[tabId]; }).catch(() => {});
});

chrome.tabs.onCreated.addListener((tab) => {
  withSessions(async (sessions) => {
    for (const s of Object.values(sessions)) await onTabCreated(s, tab);
  }).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  withSessions(async (sessions) => {
    for (const s of Object.values(sessions)) {
      if (tabId === s.tabId) { await maybeCloseEpisode(s); continue; }
      if (windowId !== s.windowId) continue;
      if (s.closedTabs.includes(tabId) || s.pendingTabs.includes(tabId)) continue;
      let tab;
      try { tab = await chrome.tabs.get(tabId); } catch { continue; } // tab already gone
      const url = tabUrl(tab);
      if (isBlank(url) && !s.blockedTabs.includes(tabId)) continue; // undecided new tab: judged at first navigation
      const domain = hostOf(url);
      if (allowlisted(s, url)) { log(s, 'allowed_site_viewed', { domain }); continue; }
      const detail = { domain };
      if (s.settings.logTabTitles && tab.title) detail.title = tab.title;
      startEpisode(s, 'tab_switch', detail);
      if (!s.blockedTabs.includes(tabId)) await snapBack(s);
    }
  }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  const url = changeInfo.url;
  withSessions(async (sessions) => {
    for (const s of Object.values(sessions)) {
      if (tabId === s.tabId) { await onExamNavigation(sessions, s, url); continue; }
      if (s.pendingTabs.includes(tabId)) {
        if (isBlank(url)) continue;
        s.pendingTabs = s.pendingTabs.filter((x) => x !== tabId);
        await decideNewTab(s, tabId, url);
        continue;
      }
      if (s.blockedTabs.includes(tabId)) {
        if (url.startsWith(BLOCKED_BASE) || blockedEntry(s, url)) continue; // still on the blocked site / its redirect
        s.blockedTabs = s.blockedTabs.filter((x) => x !== tabId);
        if (!allowlisted(s, url) && isEnforce(s)) {
          s.closedTabs.push(tabId);
          await chrome.tabs.remove(tabId).catch(() => {});
          await snapBack(s);
        }
        continue;
      }
      if (s.episode && !s.closedTabs.includes(tabId) && !allowlisted(s, url)) {
        const domain = hostOf(url);
        startEpisode(s, 'tab_navigated', { domain });
      }
    }
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  withSessions(async (sessions) => {
    for (const s of Object.values(sessions)) {
      s.pendingTabs = s.pendingTabs.filter((x) => x !== tabId);
      s.blockedTabs = s.blockedTabs.filter((x) => x !== tabId);
      if (tabId === s.tabId) {
        s.tabId = null; // orphaned: reopening the same form resumes it (FR-24)
        startEpisode(s, 'exam_tab_closed');
      }
    }
  }).catch(() => {});
});

chrome.tabs.onAttached.addListener((tabId, { newWindowId }) => {
  withSessions(async (sessions) => {
    for (const s of Object.values(sessions)) if (tabId === s.tabId) s.windowId = newWindowId;
  }).catch(() => {});
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  withSessions(async (sessions) => {
    for (const s of Object.values(sessions)) {
      if (windowId === chrome.windows.WINDOW_ID_NONE) { startEpisode(s, 'left_browser'); continue; }
      if (windowId === s.windowId) { await maybeCloseEpisode(s); continue; }
      const [active] = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
      if (active && allowlisted(s, tabUrl(active))) {
        log(s, 'allowed_site_viewed', { domain: hostOf(tabUrl(active)) });
        continue;
      }
      startEpisode(s, 'other_window', active ? { domain: hostOf(tabUrl(active)) } : {});
      await snapBack(s);
    }
  }).catch(() => {});
});

chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener((state) => {
  const type = state === 'active' ? 'idle_end' : 'idle_' + state;
  withSessions(async (sessions) => {
    for (const s of Object.values(sessions)) log(s, type);
  }).catch(() => {});
});

// Teacher commands arrive in the heartbeat response; registered synchronously at top level.
backend.onCommand((cmd) => withSessions(async (sessions) => {
  const s = sessions[cmd.attemptId];
  if (!s) return;
  if (cmd.type === 'closed') { // the teacher ended the test (D13, FR-25)
    await endSession(sessions, s, 'closed');
    return;
  }
  if (cmd.type !== 'unlock' || s.phase !== 'locked') return;
  s.phase = 'active';
  s.strikes = Math.max(0, s.settings.maxStrikes - 1); // next violation locks again (FR-21)
  log(s, 'unlocked', { strikes: s.strikes });
  patchStatus(s);
  pushState(s);
}));

// ---------------------------------------------------------------- messages from content / popup / blocked page

function validName(v) { return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 100; }

async function handlePageLoaded(msg, sender) {
  const tab = sender.tab;
  const responsePage = !!tab && isFormResponseUrl(msg.url);
  const formId = tab && (parseFormId(msg.url) || (responsePage ? parseResponseFormId(msg.url) : null));
  if (!formId) return { protected: false };
  const existing = await withSessions(async (sessions) => {
    const s = Object.values(sessions).find((x) => x.formId === formId);
    if (!s) return null;
    if (s.tabId === tab.id) {
      if (s.skipReload) s.skipReload = false; else log(s, 'page_reload');
    } else if (s.tabId == null || !(await tabExists(s.tabId))) {
      s.tabId = tab.id; // reopening the exam resumes the session (FR-24)
      s.windowId = tab.windowId;
      log(s, 'tab_reopened');
    } else {
      return { protected: false }; // a second copy of the form; the first tab owns the exam
    }
    await maybeCloseEpisode(s);
    await syncRules(sessions);
    return { protected: true, resume: true, responsePage, state: publicState(s), test: { title: s.title }, itemOrder: s.itemOrder || null };
  });
  if (existing) return existing;
  if (responsePage) return { protected: false }; // an exam never starts from a response page
  let test;
  try {
    test = await backend.getTestByFormId(formId);
  } catch {
    return { protected: false }; // server unreachable: stay silent on forms we can't prove are protected (D8 catches the gap)
  }
  if (!test) return { protected: false };
  if (tab.incognito) return { protected: true, incognito: true, test: { title: test.title } };
  const settings = mergeSettings(test.settings);
  return {
    protected: true,
    resume: false,
    test: {
      title: test.title,
      settings: {
        mode: settings.mode, maxStrikes: settings.maxStrikes, requireFullscreen: settings.requireFullscreen,
        blockCopyPaste: settings.blockCopyPaste, blockAiSites: settings.blockAiSites,
      },
    },
    identity: { chromeEmail: await getChromeEmail() },
  };
}

// Popup status line: which server this build talks to, and whether the page the student is on matches a live test.
// Read-only and shows nothing a student could not already see (the server address is inside the extension).
async function handleDiag(msg) {
  const info = backend.info();
  const out = { backend: info.backend, server: info.server, version: chrome.runtime.getManifest().version, formId: null, result: 'not-a-form' };
  const formId = typeof msg.url === 'string' ? parseFormId(msg.url) : null;
  if (!formId) return out;
  out.formId = formId;
  try {
    const test = await backend.getTestByFormId(formId);
    out.result = test ? 'live-test' : 'no-live-test';
    out.title = test ? test.title : null;
  } catch (e) {
    out.result = 'error';
    out.error = String((e && e.message) || e).slice(0, 200);
  }
  return out;
}

// The page that loaded at /formResponse is either the next section (the form is still on it) or the final
// confirmation. The content script looks and tells us; only the final page ends the exam.
function handleResponsePage(msg, sender) {
  return withSessions(async (sessions) => {
    const s = Object.values(sessions).find((x) => x.tabId === sender.tab?.id);
    if (!s || !s.responsePending) return { ok: false };
    s.responsePending = false;
    if (msg.final === true) await endSession(sessions, s, 'submitted');
    return { ok: true };
  });
}

async function handleStartExam(msg, sender) {
  const tab = sender.tab;
  const formId = tab && parseFormId(msg.url);
  if (!formId) return { error: 'NOT_A_FORM' };
  if (tab.incognito) return { error: 'INCOGNITO' };
  const name = typeof msg.name === 'string' ? msg.name.trim() : '';
  const email = typeof msg.email === 'string' ? msg.email.trim() : '';
  if (!validName(name)) return { error: 'NAME_REQUIRED' };
  if (!isValidEmail(email)) return { error: 'EMAIL_REQUIRED' };
  let test;
  try {
    test = await backend.getTestByFormId(formId);
  } catch {
    return { error: 'SERVER_UNREACHABLE' };
  }
  if (!test) return { error: 'NOT_PROTECTED' };
  const settings = mergeSettings(test.settings);
  const chromeEmail = await getChromeEmail();
  const student = {
    name, email, chromeEmail, verified: !!chromeEmail && chromeEmail.toLowerCase() === email.toLowerCase(),
  };
  let row;
  try {
    row = await backend.createAttempt({ testId: test.id, formId, student });
  } catch {
    return { error: 'SERVER_UNREACHABLE' };
  }
  return withSessions(async (sessions) => {
    let s = sessions[row.id];
    if (s) return { state: publicState(s) }; // double click
    s = {
      attemptId: row.id, testId: test.id, formId, title: test.title, settings, student,
      tabId: tab.id, windowId: tab.windowId, strikes: row.strikes,
      // FR-26: restore the lock from the server's copy; strikes at the maximum can only mean locked
      phase: settings.mode === 'enforce' && (row.status === 'locked' || row.strikes >= settings.maxStrikes) ? 'locked' : 'active',
      episode: null, lastEpisode: null, closedTabs: [], pendingTabs: [], blockedTabs: [], q: null, skipReload: false,
    };
    sessions[row.id] = s;
    if (row.resumed) {
      log(s, 'tab_reopened', { afterRestart: true });
    } else {
      log(s, 'consent_accepted');
      log(s, 'session_start', { mode: settings.mode });
    }
    await syncRules(sessions);
    return { state: publicState(s) };
  });
}

function handleEvent(msg, sender) {
  const kind = msg.kind;
  if (!EVENT_KINDS.has(kind)) return { ok: false };
  return withSessions(async (sessions) => {
    const s = Object.values(sessions).find((x) => x.tabId === sender.tab?.id);
    if (!s) return { ok: false };
    const detail = cleanDetail(msg.detail);
    if (kind === 'visibility_hidden') {
      if (await benignHide(s)) log(s, kind);
      else startEpisode(s, kind);
    } else if (kind === 'visibility_visible') {
      log(s, kind);
      await maybeCloseEpisode(s);
    } else {
      log(s, kind, detail);
    }
    return { ok: true };
  });
}

// The form's question ids in order (from the first page), kept for the pages that follow so "Q11 of 50" counts across
// pages even when a later page does not carry the form's structure. Ids only; it never leaves the browser.
function handleFormMap(msg, sender) {
  const order = Array.isArray(msg.order) ? msg.order.filter(Number.isSafeInteger).slice(0, 500) : [];
  if (!order.length) return Promise.resolve({ ok: false });
  return withSessions(async (sessions) => {
    const s = Object.values(sessions).find((x) => x.tabId === sender.tab?.id);
    if (!s) return { ok: false };
    s.itemOrder = order;
    return { ok: true };
  });
}

function handleQuestion(msg, sender) {
  const q = msg.q;
  if (!q || !Number.isInteger(q.i) || !Number.isInteger(q.n)) return { ok: false };
  return withSessions(async (sessions) => {
    const s = Object.values(sessions).find((x) => x.tabId === sender.tab?.id);
    if (!s) return { ok: false };
    s.q = { i: q.i, n: q.n };
    log(s, 'question_changed');
    return { ok: true };
  });
}

async function handleHeartbeat(msg, sender) {
  // backend.heartbeat may dispatch commands that take the session lock, so it must run outside withSessions.
  const info = await withSessions(async (sessions) => {
    const s = Object.values(sessions).find((x) => x.tabId === sender.tab?.id);
    if (!s) return null;
    s.fullscreen = !!msg.fullscreen;
    await maybeCloseEpisode(s); // safety net if a focus event was missed
    flushCapped(s);
    return { attemptId: s.attemptId, status: statusFor(s), strikes: s.strikes, q: s.q };
  });
  if (!info) return { ok: false };
  await backend.heartbeat(info.attemptId, info).catch(() => {});
  return { ok: true };
}

function handleAck(sender) {
  return withSessions(async (sessions) => {
    const s = Object.values(sessions).find((x) => x.tabId === sender.tab?.id);
    if (!s) return { ok: false };
    if (s.phase === 'warning' || s.phase === 'blurred') {
      s.phase = 'active';
      log(s, 'ack');
      patchStatus(s);
    }
    return { ok: true, state: publicState(s) };
  });
}

function handleBlockedInfo() {
  return withSessions(async (sessions) => {
    const s = Object.values(sessions)[0];
    if (!s) return { hasSession: false };
    return { hasSession: true, mode: s.settings.mode, strikes: s.strikes, max: s.settings.maxStrikes };
  });
}

function handleBlockedBack(sender) {
  return withSessions(async (sessions) => {
    const s = Object.values(sessions)[0];
    const tabId = sender.tab?.id;
    if (!s || tabId == null) return { ok: false };
    if (tabId === s.tabId) {
      s.skipReload = true;
      await chrome.tabs.goBack(tabId).catch(() => {});
    } else {
      s.blockedTabs = s.blockedTabs.filter((x) => x !== tabId);
      s.closedTabs.push(tabId);
      await chrome.tabs.remove(tabId).catch(() => {});
      await chrome.windows.update(s.windowId, { focused: true }).catch(() => {});
      if (s.tabId != null) await chrome.tabs.update(s.tabId, { active: true }).catch(() => {});
    }
    return { ok: true };
  });
}

function cleanDomainList(list) {
  return (Array.isArray(list) ? list : String(list || '').split(/[\s,]+/))
    .map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, ''))
    .filter(Boolean);
}

async function handleDev(msg) {
  switch (msg.type) {
    case 'DEV_STATE': {
      const sessions = await withSessions(async (x) => JSON.parse(JSON.stringify(x)));
      return {
        tests: await backend.listTests(),
        attempts: await backend.listAttempts(),
        events: (await backend.listEvents()).slice(-300),
        sessions: Object.values(sessions).map((s) => ({
          attemptId: s.attemptId, phase: s.phase, strikes: s.strikes, tabId: s.tabId, episode: !!s.episode,
        })),
      };
    }
    case 'DEV_ADD_TEST': {
      const formId = parseFormId(msg.url);
      if (!formId) return { error: 'NOT_A_FORM' };
      const settings = mergeSettings({
        ...(msg.settings || {}),
        ...(msg.settings && msg.settings.allowlist !== undefined ? { allowlist: cleanDomainList(msg.settings.allowlist) } : {}),
      });
      const test = await backend.saveTest({
        title: String(msg.title || 'Untitled exam').slice(0, 200), formId, formUrl: msg.url, status: 'live', settings,
      });
      return { test };
    }
    case 'DEV_UNLOCK':
      await backend.sendCommand(msg.attemptId, 'unlock');
      return { ok: true };
    case 'DEV_RESET':
      await backend.reset();
      await withSessions(async (sessions) => {
        for (const k of Object.keys(sessions)) delete sessions[k];
        await syncRules(sessions);
      });
      return { ok: true };
    default:
      return { error: 'UNKNOWN' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  let work;
  switch (msg && msg.type) {
    case 'PAGE_LOADED': work = handlePageLoaded(msg, sender); break;
    case 'START_EXAM': work = handleStartExam(msg, sender); break;
    case 'EVENT': work = handleEvent(msg, sender); break;
    case 'QUESTION': work = handleQuestion(msg, sender); break;
    case 'FORM_MAP': work = handleFormMap(msg, sender); break;
    case 'HEARTBEAT': work = handleHeartbeat(msg, sender); break;
    case 'ACK': work = handleAck(sender); break;
    case 'BLOCKED_INFO': work = handleBlockedInfo(); break;
    case 'BLOCKED_BACK': work = handleBlockedBack(sender); break;
    case 'RESPONSE_PAGE': work = handleResponsePage(msg, sender); break;
    case 'DIAG': work = handleDiag(msg); break;
    case 'DEV_STATE': case 'DEV_ADD_TEST': case 'DEV_UNLOCK': case 'DEV_RESET': work = handleDev(msg); break;
    default: return false;
  }
  work.then(sendResponse).catch((err) => sendResponse({ error: 'INTERNAL', message: String(err && err.message) }));
  return true;
});
