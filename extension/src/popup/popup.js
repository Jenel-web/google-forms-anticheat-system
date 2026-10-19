// DEV panel (temporary): protect a form, simulate a teacher unlock, inspect attempts and events.
const $ = (id) => document.getElementById(id);

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  children.flat().forEach((c) => { if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c))); });
  return el;
}

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => { void chrome.runtime.lastError; resolve(res); }));
}

function say(text, kind) {
  const m = $('msg');
  m.hidden = !text;
  m.className = 'cn-banner' + (kind ? ' cn-banner--' + kind : '');
  m.textContent = text || '';
}

const ERRORS = {
  NOT_A_FORM: 'That is not a published form link. Use Send → link and copy the /d/e/.../viewform address.',
};

async function protect() {
  const res = await send({
    type: 'DEV_ADD_TEST',
    url: $('url').value.trim(),
    title: $('title').value.trim(),
    settings: { mode: $('mode').value, maxStrikes: Number($('max').value), allowlist: $('allow').value },
  });
  if (res && res.error) say(ERRORS[res.error] || res.error, 'danger');
  else say('Protected. Open the form link in a normal window to start.', 'ok');
  refresh();
}

function statusChip(status) {
  const known = ['active', 'away', 'warned', 'locked', 'submitted'];
  return h('span', { class: 'cn-chip cn-chip--' + (known.includes(status) ? status : 'missing') }, status);
}

function time(iso) {
  return iso ? new Date(iso).toLocaleTimeString() : '';
}

async function refresh() {
  const s = await send({ type: 'DEV_STATE' });
  if (!s) return;
  $('tests').replaceChildren(...(s.tests.length ? s.tests.map((t) => h('div', { class: 'cn-card' },
    h('div', { class: 'cn-kv' }, h('b', {}, t.title), h('span', {}, t.status)),
    h('div', { class: 'cn-kv' }, h('span', {}, 'mode / max strikes'), h('span', {}, t.settings.mode + ' / ' + t.settings.maxStrikes)),
    h('div', { class: 'cn-kv' }, h('span', {}, 'form id'), h('span', { class: 'cn-data' }, t.formId.slice(0, 18) + '…')),
    h('div', { class: 'cn-kv' }, h('span', {}, 'allowlist'), h('span', {}, (t.settings.allowlist || []).join(', ') || 'none')))) : [h('p', { class: 'cn-sm cn-muted' }, 'None yet.')]));
  $('attempts').replaceChildren(...(s.attempts.length ? s.attempts.map((a) => h('div', { class: 'cn-card' },
    h('div', { class: 'cn-kv' }, h('b', {}, a.student.name), statusChip(a.status)),
    h('div', { class: 'cn-kv' }, h('span', {}, a.student.email + (a.student.verified ? ' ✓' : '')), h('span', {}, 'strikes ' + a.strikes)),
    a.status === 'locked' ? h('button', { class: 'cn-btn cn-btn--secondary cn-btn--sm', type: 'button', 'data-unlock': a.id, onclick: async () => { await send({ type: 'DEV_UNLOCK', attemptId: a.id }); say('Unlock queued. It reaches the student on their next heartbeat (within 5 s).', 'ok'); } }, 'Unlock') : null)) : [h('p', { class: 'cn-sm cn-muted' }, 'No attempts. Refusing consent creates none.')]));
  const log = $('log');
  const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  log.replaceChildren(...s.events.slice(-60).map((e) => {
    const extra = Object.entries(e).filter(([k]) => !['attemptId', 't', 'type', 'q', 'seq'].includes(k)).map(([k, v]) => k + '=' + (Array.isArray(v) ? v.join('|') : v)).join(' ');
    return h('div', {}, time(e.t) + ' ', h('b', {}, e.type), e.q ? ' q' + e.q.i : '', extra ? ' ' + extra : '');
  }));
  if (stick) log.scrollTop = log.scrollHeight;
}

// Status line: which server this build talks to, and whether the open page matches a live test.
function say2(el, text, kind) {
  el.className = 'cn-banner' + (kind ? ' cn-banner--' + kind : '');
  el.textContent = text;
}

async function diagnose(url) {
  const box = $('diag');
  const d = await send({ type: 'DIAG', url });
  if (!d) { say2(box, 'The extension did not answer. Open chrome://extensions and click reload on CheatNoNo.', 'danger'); return null; }
  const local = d.server && /127\.0\.0\.1|localhost/.test(d.server);
  const host = d.server ? new URL(d.server).host : null;
  $('backend-chip').textContent = d.backend === 'mock' ? 'test build (no server)' : local ? 'local test server' : 'live server';
  $('dev').style.display = d.backend === 'mock' ? '' : 'none'; // the developer controls only make sense on the mock build
  const foot = ' (v' + d.version + ')';
  if (d.backend === 'mock') {
    say2(box, 'This is the source folder, which uses a fake local backend and never contacts your server. Load the built dist folder instead (chrome://extensions, Load unpacked, pick dist).' + foot, 'danger');
  } else if (local) {
    say2(box, 'This build points at 127.0.0.1, the computer it runs on, so it only works where the local test server runs. Rebuild with your hosted project (see DEPLOY.md), then reload this extension.' + foot, 'danger');
  } else if (d.result === 'not-a-form') {
    say2(box, 'Connected to ' + host + '. Open your exam link to check it.' + foot);
  } else if (d.result === 'live-test') {
    say2(box, 'Connected to ' + host + '. This form is protected by the test "' + d.title + '". You should see the "Before you begin" screen. If you do not, reload the page.' + foot, 'ok');
  } else if (d.result === 'no-live-test') {
    say2(box, 'Connected to ' + host + ', but no live test uses this form (form ID ' + d.formId + '). Open the Student link from your dashboard and check the test is Live.' + foot, 'warn');
  } else {
    say2(box, 'Could not reach ' + host + ': ' + d.error + foot, 'danger');
  }
  return d;
}

$('protect').addEventListener('click', protect);
$('reset').addEventListener('click', async () => { await send({ type: 'DEV_RESET' }); say('All mock data cleared.', 'ok'); refresh(); });

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const url = tabs && tabs[0] && tabs[0].url;
  if (url && /docs\.google\.com\/forms\//.test(url)) $('url').value = url;
  diagnose(url || '');
});

refresh();
setInterval(refresh, 2000);
