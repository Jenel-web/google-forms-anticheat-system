const site = new URLSearchParams(location.search).get('site') || 'this site';
document.getElementById('site').textContent = site;

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function render(info) {
  const row = document.getElementById('strike-row');
  const note = document.getElementById('note');
  if (!info || !info.hasSession) {
    row.hidden = true;
    return;
  }
  if (info.mode === 'record') {
    note.textContent = 'No strike was added. Your teacher can see this attempt.';
    row.hidden = true;
    return;
  }
  note.textContent = 'This attempt was recorded.';
  const pips = document.getElementById('pips');
  pips.replaceChildren();
  for (let i = 0; i < info.max; i++) pips.append(el('i', 'cn-pip' + (i < info.strikes ? ' is-used' : '')));
  pips.setAttribute('aria-label', info.strikes + ' of ' + info.max + ' strikes');
  document.getElementById('strike-text').textContent = 'Strike ' + info.strikes + ' of ' + info.max + ' added';
  row.hidden = false;
}

function load() {
  chrome.runtime.sendMessage({ type: 'BLOCKED_INFO' }, (info) => { void chrome.runtime.lastError; render(info); });
}

load();
setTimeout(load, 500); // the strike is counted just as this page loads

document.getElementById('back').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'BLOCKED_BACK' }, () => { void chrome.runtime.lastError; });
});
