// Student screens, rendered in a closed Shadow DOM so the Form's own CSS and scripts can't reach them.
// Classic script: defines the global EG_UI. Markup follows CheatNoNo/components/* and copy.md.
// eslint-disable-next-line no-unused-vars
const EG_UI = (() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ---- DOM helpers: children that are strings become text nodes. Never innerHTML with dynamic values.
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  }

  function svg(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    children.forEach((c) => el.append(c));
    return el;
  }

  const ICONS = {
    shield: [['path', { d: 'M12 3l7.5 2.8v5.7c0 4.6-3.1 8-7.5 9.5-4.4-1.5-7.5-4.9-7.5-9.5V5.8z' }], ['path', { d: 'M8.8 12l2.4 2.4 4.2-4.6' }]],
    tab: [['rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 2.5 }], ['path', { d: 'M3.5 9.5h17' }]],
    globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z' }]],
    fullscreen: [['path', { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' }]],
    copy: [['path', { d: 'M9 5h9v4M9 5H6v15h12v-8M9 5v4h4' }]],
    xcircle: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M9 9l6 6M15 9l-6 6' }]],
    alert: [['path', { d: 'M12 4.2l9 15.6H3z' }], ['path', { d: 'M12 10v4.2M12 17.2v.1' }]],
    lock: [['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }], ['path', { d: 'M8 11V8a4 4 0 018 0v3' }]],
    info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v5M12 8v.1' }]],
    check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  };

  function icon(name) {
    const el = svg('svg', { class: 'cn-ico', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    for (const [tag, attrs] of ICONS[name] || []) el.append(svg(tag, attrs));
    return el;
  }

  function logo() {
    const mark = svg(
      'svg', { viewBox: '0 0 48 48', role: 'img', 'aria-label': 'CheatNoNo' },
      svg('path', { d: 'M24 3.5 40.5 9.8v13.4C40.5 33.6 33.6 41.4 24 44.8 14.4 41.4 7.5 33.6 7.5 23.2V9.8z', fill: '#1b8fe6' }),
      svg('path', { d: 'M24 3.5 40.5 9.8v13.4C40.5 33.6 33.6 41.4 24 44.8z', fill: '#0b63b5', opacity: '.28' }),
      svg('path', { d: 'M15.4 24.2l6 6 11.2-12.6', fill: 'none', stroke: '#fff', 'stroke-width': '4.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svg('circle', { cx: 38.5, cy: 9, r: 5.6, fill: '#f6b02c', stroke: '#fff', 'stroke-width': '2.6' }),
    );
    return h('span', { class: 'cn-logo' }, mark, h('span', { class: 'cn-logo__word' }, 'Cheat', h('b', {}, 'NoNo')));
  }

  const REASON_TEXT = {
    tab_switch: 'You switched to another tab',
    tab_opened: 'A new tab was opened',
    tab_navigated: 'Another tab was used',
    other_window: 'You switched to another window',
    left_browser: 'You left the browser',
    navigated_away: 'The exam tab went to another site',
    exam_tab_closed: 'The exam tab was closed',
    visibility_hidden: 'The exam page was hidden',
  };

  function durationText(ms) {
    const s = Math.max(1, Math.round((ms || 0) / 1000));
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }

  function clock(iso) {
    const d = iso ? new Date(iso) : new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  }

  function detectedText(ep) {
    if (!ep) return 'You left the exam tab';
    if (ep.blockedSite) return 'A blocked site was opened: ' + ep.blockedSite;
    const base = REASON_TEXT[ep.reasons && ep.reasons[0]] || 'You left the exam tab';
    return base + ' for ' + durationText(ep.durationMs);
  }

  function pips(strikes, max, danger) {
    const items = [];
    for (let i = 0; i < max; i++) items.push(h('i', { class: 'cn-pip' + (i < strikes ? ' is-used' : '') }));
    return h('span', { class: 'cn-pips' + (danger ? ' cn-pips--danger' : ''), role: 'img', 'aria-label': strikes + ' of ' + max + ' strikes' }, items);
  }

  function li(iconName, text) {
    return h('li', {}, icon(iconName), text);
  }

  // ---- screens. Each returns the overlay element for the current layer.

  const screens = {
    consent(ctx) {
      const settings = ctx.test.settings || {};
      const enforce = settings.mode !== 'record';
      const nameIn = h('input', { class: 'cn-input', id: 'eg-name', type: 'text', maxlength: 100, autocomplete: 'name', placeholder: 'As it appears on your class list' });
      const emailIn = h('input', { class: 'cn-input', id: 'eg-email', type: 'email', maxlength: 200, autocomplete: 'email', placeholder: 'you@school.edu', value: (ctx.identity && ctx.identity.chromeEmail) || '' });
      const nameHint = h('div', { class: 'cn-hint cn-hint--error', role: 'alert', hidden: true });
      const emailHint = h('div', { class: 'cn-hint', id: 'eg-email-hint' });
      const banner = h('div', { class: 'cn-banner cn-banner--danger', role: 'alert', hidden: true });
      const agree = h('input', { class: 'cn-checkbox', type: 'checkbox', id: 'eg-agree' });
      const start = h('button', { class: 'cn-btn cn-btn--primary cn-btn--lg', type: 'button', disabled: true, 'data-autofocus': true }, icon('fullscreen'), 'Start exam');

      const refreshEmailHint = () => {
        const chrome = ctx.identity && ctx.identity.chromeEmail;
        emailHint.replaceChildren();
        emailHint.classList.remove('cn-hint--ok', 'cn-hint--error');
        if (chrome && emailIn.value.trim().toLowerCase() === chrome.toLowerCase()) {
          emailHint.classList.add('cn-hint--ok');
          emailHint.append(icon('check'), 'Matches the account in this Chrome profile.');
        } else {
          emailHint.append('Your teacher uses this to match you to your Form response.');
        }
      };
      emailIn.addEventListener('input', refreshEmailHint);
      refreshEmailHint();
      agree.addEventListener('change', () => { start.disabled = !agree.checked; });

      const fail = (msg) => { banner.hidden = false; banner.replaceChildren(icon('alert'), h('div', {}, msg)); };

      start.addEventListener('click', () => {
        const name = nameIn.value.trim();
        const email = emailIn.value.trim();
        const nameOk = name.length >= 1 && name.length <= 100;
        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
        nameIn.classList.toggle('cn-input--error', !nameOk);
        emailIn.classList.toggle('cn-input--error', !emailOk);
        nameHint.hidden = nameOk;
        nameHint.replaceChildren(icon('alert'), 'Enter your full name.');
        if (!emailOk) {
          emailHint.className = 'cn-hint cn-hint--error';
          emailHint.replaceChildren(icon('alert'), 'Enter a valid email address.');
        } else {
          emailHint.className = 'cn-hint';
          refreshEmailHint();
        }
        if (!nameOk || !emailOk) return;
        banner.hidden = true;
        start.disabled = true;
        // ctx.onStart runs synchronously up to requestFullscreen (user-gesture rule); it returns a promise.
        Promise.resolve(ctx.onStart({ name, email })).then((res) => {
          start.disabled = !agree.checked;
          if (res && res.error) fail(ctx.errorText(res.error));
        });
      });

      const monitored = [
        li('tab', 'Leaving the exam tab, and for how long'),
        li('globe', 'Websites you open (domain only, never page content)'),
      ];
      if (settings.requireFullscreen !== false && enforce) monitored.push(li('fullscreen', 'Leaving fullscreen'));
      monitored.push(li('copy', 'Copy and paste'));

      const blockedCol = enforce && settings.blockAiSites !== false
        ? h('div', {},
          h('h2', { class: 'cn-h3', style: 'margin-bottom:10px' }, 'What is blocked'),
          h('ul', { class: 'cn-list cn-list--no' },
            li('xcircle', 'AI assistants such as ChatGPT and Gemini'),
            li('xcircle', 'Search engines and translation tools'),
            li('xcircle', 'Messaging and file-sharing sites')))
        : h('div', {},
          h('h2', { class: 'cn-h3', style: 'margin-bottom:10px' }, 'What is blocked'),
          h('p', { class: 'cn-sm cn-muted' }, 'Nothing. This exam only records activity for your teacher.'));

      return h('div', { class: 'cn-overlay' },
        h('section', { class: 'cn-modal cn-modal--wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'eg-t' },
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center;width:100%;gap:12px' },
            logo(),
            h('span', { class: 'cn-chip cn-chip--submitted' }, icon('shield'), 'Protected exam')),
          h('div', {},
            h('p', { class: 'cn-eyebrow' }, 'Before you begin'),
            h('h1', { class: 'cn-h1', id: 'eg-t' }, ctx.test.title || 'Exam')),
          banner,
          h('div', { class: 'cn-field' }, h('label', { class: 'cn-label', for: 'eg-name' }, 'Your full name'), nameIn, nameHint),
          h('div', { class: 'cn-field' }, h('label', { class: 'cn-label', for: 'eg-email' }, 'Your email'), emailIn, emailHint),
          h('div', { class: 'cn-cols' },
            h('div', {}, h('h2', { class: 'cn-h3', style: 'margin-bottom:10px' }, 'What we monitor'), h('ul', { class: 'cn-list' }, monitored)),
            blockedCol),
          h('label', { class: 'cn-checkrow' }, agree, h('span', {}, 'I understand what is monitored and blocked, and I agree to take this exam under these rules.')),
          h('div', { class: 'cn-modal__actions' },
            start,
            h('button', { class: 'cn-btn cn-btn--secondary cn-btn--lg', type: 'button', onclick: () => ctx.onDecline() }, "I don't agree"),
            h('span', { class: 'cn-sm cn-muted' }, enforce && settings.requireFullscreen !== false ? 'Starting the exam opens fullscreen.' : ''))));
    },

    // D10: refusing consent is allowed, has no penalty and records nothing.
    declined(ctx) {
      return h('div', { class: 'cn-fullscreen' },
        h('section', { class: 'cn-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'eg-t' },
          h('div', { class: 'cn-modal__icon' }, icon('info')),
          h('div', {}, h('p', { class: 'cn-eyebrow' }, 'Exam not started'), h('h1', { class: 'cn-h1', id: 'eg-t' }, 'You chose not to agree')),
          h('p', { class: 'cn-lead' }, 'That is okay. Please contact your teacher about how to take this exam.'),
          h('p', { class: 'cn-sm cn-muted' }, 'Nothing was recorded, and this is not counted against you.'),
          h('div', { class: 'cn-modal__actions' },
            h('button', { class: 'cn-btn cn-btn--secondary cn-btn--lg', type: 'button', 'data-autofocus': true, onclick: () => ctx.onReview() }, 'Review the rules again'))));
    },

    // D13: the teacher ended the test. Informational only; the student can dismiss it.
    closed(ctx) {
      return h('div', { class: 'cn-fullscreen' },
        h('section', { class: 'cn-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'eg-t' },
          h('div', { class: 'cn-modal__icon' }, icon('info')),
          h('div', {}, h('p', { class: 'cn-eyebrow' }, 'Exam closed'), h('h1', { class: 'cn-h1', id: 'eg-t' }, 'Your teacher has ended this exam')),
          h('p', { class: 'cn-lead' }, "Monitoring has stopped. Answers you haven't submitted may not be counted."),
          h('p', { class: 'cn-sm cn-muted' }, 'Contact your teacher if you have questions.'),
          h('div', { class: 'cn-modal__actions' },
            h('button', { class: 'cn-btn cn-btn--secondary cn-btn--lg', type: 'button', 'data-autofocus': true, onclick: () => ctx.onDismiss() }, 'Close'))));
    },

    incognito() {
      return h('div', { class: 'cn-fullscreen' },
        h('section', { class: 'cn-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'eg-t' },
          h('div', { class: 'cn-modal__icon cn-modal__icon--warn' }, icon('alert')),
          h('div', {}, h('p', { class: 'cn-eyebrow cn-eyebrow--warn' }, 'Private window'), h('h1', { class: 'cn-h1', id: 'eg-t' }, "Exam can't start in this mode")),
          h('p', { class: 'cn-lead' }, "You're in a private (Incognito) window. CheatNoNo can't protect the exam here."),
          h('ol', { class: 'cn-steps' },
            h('li', {}, 'Close this private window.'),
            h('li', {}, 'Open a normal Chrome window.'),
            h('li', {}, 'Open the exam link again.'))));
    },

    warning(ctx) {
      const st = ctx.state;
      return h('div', { class: 'cn-overlay' },
        h('section', { class: 'cn-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'eg-t' },
          h('div', { class: 'cn-modal__icon cn-modal__icon--warn' }, icon('alert')),
          h('div', {}, h('p', { class: 'cn-eyebrow cn-eyebrow--warn' }, 'Strike ' + st.strikes + ' of ' + st.max), h('h1', { class: 'cn-h1', id: 'eg-t', style: 'margin-top:4px' }, 'You left the exam tab')),
          h('div', { class: 'cn-detect' }, icon('tab'), h('span', { class: 'cn-sm' }, h('b', {}, detectedText(st.lastEpisode))), h('span', { class: 'cn-detect__t' }, clock(st.lastEpisode && st.lastEpisode.t))),
          h('p', { class: 'cn-lead' }, 'This is a friendly warning. A third strike pauses your exam until your teacher unlocks it.'.replace('third', ordinal(st.max))),
          h('div', { class: 'cn-status', style: 'gap:12px' }, pips(st.strikes, st.max, false), h('span', {}, remaining(st))),
          h('div', { class: 'cn-modal__actions' },
            h('button', { class: 'cn-btn cn-btn--primary cn-btn--lg', type: 'button', 'data-autofocus': true, onclick: () => ctx.onAck() }, 'Continue exam'))));
    },

    blurred(ctx) {
      const st = ctx.state;
      return h('div', { class: 'cn-overlay' },
        h('section', { class: 'cn-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'eg-t' },
          h('div', { class: 'cn-modal__icon cn-modal__icon--danger' }, icon('alert')),
          h('div', {}, h('p', { class: 'cn-eyebrow cn-eyebrow--danger' }, 'Strike ' + st.strikes + ' of ' + st.max + ' · Final warning'), h('h1', { class: 'cn-h1', id: 'eg-t', style: 'margin-top:4px' }, 'One more and your exam pauses')),
          h('div', { class: 'cn-detect' }, icon('tab'), h('span', { class: 'cn-sm' }, h('b', {}, detectedText(st.lastEpisode))), h('span', { class: 'cn-detect__t' }, clock(st.lastEpisode && st.lastEpisode.t))),
          h('p', { class: 'cn-lead' }, 'Your questions are hidden until you return. Your answers so far are saved.'),
          h('div', { class: 'cn-status', style: 'gap:12px' }, pips(st.strikes, st.max, true), h('span', {}, remaining(st))),
          h('div', { class: 'cn-modal__actions' },
            h('button', { class: 'cn-btn cn-btn--danger cn-btn--lg', type: 'button', 'data-autofocus': true, onclick: () => ctx.onAck() }, 'Return to exam'))));
    },

    // D1: status only. No message box.
    locked(ctx) {
      const st = ctx.state;
      return h('div', { class: 'cn-fullscreen' },
        h('section', { class: 'cn-modal cn-modal--center', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'eg-t', tabindex: '-1', 'data-autofocus': true },
          h('div', { class: 'cn-modal__icon cn-modal__icon--danger' }, icon('lock')),
          h('div', {}, h('p', { class: 'cn-eyebrow cn-eyebrow--danger' }, 'Strike ' + st.strikes + ' of ' + st.max), h('h1', { class: 'cn-h1', id: 'eg-t', style: 'margin-top:4px' }, 'Your exam is paused')),
          h('div', { class: 'cn-status' }, h('i', {}), 'Waiting for your teacher to unlock it'),
          pips(st.strikes, st.max, true),
          h('p', { class: 'cn-sm cn-muted' }, 'Your answers are saved. Keep this tab open.')));
    },

    fullscreen(ctx) {
      return h('div', { class: 'cn-fullscreen' },
        h('section', { class: 'cn-modal cn-modal--center', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'eg-t' },
          h('div', { class: 'cn-modal__icon' }, icon('fullscreen')),
          h('h1', { class: 'cn-h1', id: 'eg-t' }, 'Return to fullscreen to continue'),
          h('p', { class: 'cn-lead' }, 'The exam is hidden until you are back in fullscreen.'),
          h('div', { class: 'cn-modal__actions' },
            h('button', { class: 'cn-btn cn-btn--primary cn-btn--lg', type: 'button', 'data-autofocus': true, onclick: () => ctx.onFullscreen() }, icon('fullscreen'), 'Return to fullscreen')),
          h('p', { class: 'cn-sm cn-muted' }, 'Pressed ', h('span', { class: 'cn-kbd' }, 'Esc'), ' by accident? This brings you back.')));
    },
  };

  function ordinal(max) {
    return max === 1 ? 'first' : max === 2 ? 'second' : max === 3 ? 'third' : max + 'th';
  }

  function remaining(st) {
    const n = Math.max(0, st.max - st.strikes);
    return n + (n === 1 ? ' strike remaining' : ' strikes remaining');
  }

  function hudEl(state) {
    const left = state.max - state.strikes;
    const cls = state.strikes >= state.max - 1 && state.strikes > 0 ? ' cn-hud--danger' : state.strikes > 0 ? ' cn-hud--warn' : '';
    return h('div', { class: 'eg-hud' },
      h('span', { class: 'cn-hud' + cls, role: 'status', 'aria-label': 'Protected. Strikes ' + state.strikes + ' of ' + state.max + '. ' + left + ' remaining.' },
        h('span', { class: 'cn-hud__icon' }, icon('shield')),
        'Protected',
        h('span', { class: 'cn-hud__sep' }),
        h('span', { class: 'cn-hud__strikes' }, 'Strikes ' + state.strikes + '/' + state.max)));
  }

  // ---- host + layers. The shadow root stays 'closed' in source; the e2e test patches a temp copy to 'open'.

  const HOST_STYLE = {
    all: 'initial', position: 'fixed', inset: '0', 'z-index': '2147483647', display: 'block',
    'pointer-events': 'none', visibility: 'visible', opacity: '1', transform: 'none', filter: 'none',
  };

  let host = null;
  let root = null;
  let hudLayer = null;
  let overlayLayer = null;
  let current = null;

  function applyHostStyle() {
    for (const [k, v] of Object.entries(HOST_STYLE)) host.style.setProperty(k, v, 'important');
  }

  function mount() {
    if (host) return host;
    host = document.createElement('div');
    host.id = 'eg-host';
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = EG_CSS;
    const container = h('div', { class: 'cn' });
    hudLayer = h('div', {});
    overlayLayer = h('div', {});
    container.append(hudLayer, overlayLayer);
    root.append(style, container);
    applyHostStyle();
    document.documentElement.append(host);
    return host;
  }

  // Re-attach / re-style the host if the page removed or hid it (FR-20). Returns true if it had to repair.
  function ensureAttached() {
    if (!host) return false;
    let repaired = false;
    if (!host.isConnected) { document.documentElement.append(host); repaired = true; }
    if (host.hidden || host.style.getPropertyValue('display') !== 'block' || host.style.getPropertyValue('visibility') !== 'visible' || host.style.getPropertyValue('opacity') !== '1' || host.style.getPropertyValue('z-index') !== '2147483647') {
      host.hidden = false;
      applyHostStyle();
      repaired = true;
    }
    return repaired;
  }

  function focusPrimary() {
    const target = root && root.querySelector('[data-autofocus]');
    if (target) target.focus({ preventScroll: true });
  }

  function show(name, ctx) {
    mount();
    overlayLayer.replaceChildren(screens[name](ctx));
    current = name;
    focusPrimary();
  }

  function hide() {
    if (!overlayLayer) return;
    overlayLayer.replaceChildren();
    current = null;
  }

  function setHud(state) {
    mount();
    hudLayer.replaceChildren(...(state ? [hudEl(state)] : []));
  }

  function destroy() {
    if (host) host.remove();
    host = root = hudLayer = overlayLayer = current = null;
  }

  return {
    mount, show, hide, setHud, destroy, ensureAttached, focusPrimary,
    get host() { return host; },
    get current() { return current; },
    get showing() { return current !== null; },
  };
})();
