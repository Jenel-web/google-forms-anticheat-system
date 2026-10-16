import { useMemo, useState } from 'react';
import { DEFAULT_BLOCKLIST, DEFAULT_SETTINGS, formLinkIssue, mergeSettings, parseFormId } from '@shared/constants.js';
import { createTest, deleteTest, goLive, updateTest } from '../lib/api.js';
import { cleanSiteEntry } from '../lib/format.js';
import { navigate } from '../router.jsx';
import { Banner, Icon, Modal } from '../ui.jsx';

const LINK_PROBLEMS = {
  EMPTY: 'Paste the link to your Google Form.',
  EDIT_LINK: 'That is the edit link. Use the published link instead: in your form click Send, open the link tab and copy it.',
  EDITOR_ID_LINK: 'That link uses the form editor ID, which students never see. Use Send, then the link tab, and paste the link that contains /d/e/.',
  NOT_A_FORM_LINK: 'That does not look like a Google Form link. Use Send, then the link tab, and paste the link that starts with docs.google.com/forms.',
};

function Setting({ title, hint, children, stack }) {
  return (
    <div className={`cn-setting ${stack ? 'cn-setting--stack' : ''}`}>
      <div className="cn-setting__t"><b>{title}</b>{hint ? <span>{hint}</span> : null}</div>
      {children}
    </div>
  );
}

function Toggle({ title, hint, checked, onChange }) {
  return (
    <Setting title={title} hint={hint}>
      <input type="checkbox" className="cn-switch" aria-label={title} checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </Setting>
  );
}

function SiteTags({ id, label, hint, values, onChange }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  function add() {
    if (!text.trim()) return;
    const clean = cleanSiteEntry(text);
    if (!clean) return setProblem('Enter a site such as desmos.com');
    setProblem('');
    if (!values.includes(clean)) onChange([...values, clean]);
    setText('');
  }
  return (
    <div className="cn-field" style={{ marginTop: 12 }}>
      <label className="cn-label" htmlFor={id}>{label} {hint ? <span className="cn-muted" style={{ fontWeight: 400 }}>({hint})</span> : null}</label>
      <div className="dash-row">
        <input id={id} className="cn-input dash-small-input" placeholder="Add a site" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" className="cn-btn cn-btn--secondary cn-btn--sm" onClick={add}>Add</button>
      </div>
      {problem ? <p className="cn-hint cn-hint--error">{problem}</p> : null}
      <div className="cn-tags" style={{ marginTop: 4 }}>
        {values.map((v) => (
          <span className="cn-tag" key={v}>
            {v}
            <button type="button" className="cn-btn cn-btn--ghost" style={{ padding: 0, minHeight: 0, height: 20 }}
              aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}><Icon name="x" /></button>
          </span>
        ))}
      </div>
    </div>
  );
}

function GoLiveDialog({ onClose, onConfirm, busy, error }) {
  const [one, setOne] = useState(false);
  const [verified, setVerified] = useState(false);
  return (
    <Modal title="Before you go live" eyebrow="Google Form settings" icon="shield" onClose={onClose}
      actions={(
        <>
          <button className="cn-btn cn-btn--primary cn-btn--lg" type="button" disabled={!(one && verified) || busy}
            onClick={() => onConfirm(one, verified)}>{busy ? 'Going live…' : 'Go live'}</button>
          <button className="cn-btn cn-btn--secondary cn-btn--lg" type="button" onClick={onClose}>Not yet</button>
        </>
      )}>
      <p className="cn-lead">
        We cannot read your Form settings, so please confirm both. Without them, a student could submit twice or
        without a verified address.
      </p>
      <label className="cn-checkrow" htmlFor="ack-one">
        <input id="ack-one" type="checkbox" className="cn-checkbox" checked={one} onChange={(e) => setOne(e.target.checked)} />
        <span><b>Limit to 1 response is on</b><br /><span className="cn-sm cn-muted">Form → Settings → Responses → Limit to 1 response.</span></span>
      </label>
      <label className="cn-checkrow" htmlFor="ack-verified">
        <input id="ack-verified" type="checkbox" className="cn-checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
        <span><b>Collect email addresses is set to Verified</b><br /><span className="cn-sm cn-muted">Form → Settings → Responses → Collect email addresses → Verified.</span></span>
      </label>
      {error ? <Banner kind="danger" icon="alert">{error}</Banner> : null}
    </Modal>
  );
}

export default function Editor({ test, onLive }) {
  const initial = useMemo(() => mergeSettings(test?.settings), [test]);
  const [saved, setSaved] = useState(test);
  const [title, setTitle] = useState(test?.title || '');
  const [link, setLink] = useState(test?.form_url || '');
  const [linkTouched, setLinkTouched] = useState(false);
  const [settings, setSettings] = useState(test ? initial : { ...DEFAULT_SETTINGS });
  const [error, setError] = useState('');
  const [titleError, setTitleError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // 'live' | 'delete'
  const [liveError, setLiveError] = useState('');

  const issue = formLinkIssue(link);
  const formId = issue ? null : parseFormId(link);
  const set = (key) => (value) => setSettings((s) => ({ ...s, [key]: value }));

  async function save() {
    setError('');
    setLinkTouched(true);
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > 200) { setTitleError('Give the test a name (up to 200 characters).'); return null; }
    setTitleError('');
    if (issue || !formId) return null;
    const fields = {
      title: cleanTitle,
      form_id: formId,
      form_url: `https://docs.google.com/forms/d/e/${formId}/viewform`,
      settings,
    };
    try {
      const row = saved ? await updateTest(saved.id, fields) : await createTest(fields);
      setSaved(row);
      return row;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }

  async function saveDraft() {
    setBusy(true);
    const row = await save();
    setBusy(false);
    if (row) navigate('/');
  }

  async function openGoLive() {
    setBusy(true);
    const row = await save();
    setBusy(false);
    if (row) { setLiveError(''); setDialog('live'); }
  }

  async function confirmLive(one, verified) {
    setBusy(true);
    setLiveError('');
    try {
      const row = await goLive(saved.id, one, verified);
      setDialog(null);
      navigate(`/tests/${row.id}`, { replace: true });
      if (onLive) onLive(row);
    } catch (e) {
      setLiveError(e.code === '23505' ? 'This form is already live in another test. End that test first, then try again.' : e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteTest(saved.id);
      navigate('/');
    } catch (e) {
      setError(e.message);
      setDialog(null);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="cn-pagehead">
        <div className="cn-pagehead__t">
          <h1 className="cn-h1">{saved ? 'Edit test' : 'Add test'}</h1>
          <p className="cn-muted cn-sm">Paste the published link, choose the rules, then go live when students are ready.</p>
        </div>
        <div className="cn-actions">
          <button className="cn-btn cn-btn--ghost" type="button" onClick={() => navigate('/')}>Cancel</button>
          <button className="cn-btn cn-btn--secondary" type="button" disabled={busy} onClick={saveDraft}>Save draft</button>
          <button className="cn-btn cn-btn--primary" type="button" disabled={busy} onClick={openGoLive}>Go live…</button>
        </div>
      </div>

      {error ? <Banner kind="danger" icon="alert">{error}</Banner> : null}

      <div className="dash-stack" style={{ maxWidth: 880 }}>
        <div className="cn-card dash-stack">
          <div className="cn-field">
            <label className="cn-label" htmlFor="form-link">Google Form link</label>
            <input id="form-link" className={`cn-input ${linkTouched && issue ? 'cn-input--error' : ''}`} value={link}
              placeholder="https://docs.google.com/forms/d/e/…/viewform"
              onChange={(e) => setLink(e.target.value)} onBlur={() => setLinkTouched(true)} aria-describedby="link-hint" />
            <p id="link-hint" className={`cn-hint ${linkTouched && issue ? 'cn-hint--error' : formId ? 'cn-hint--ok' : ''}`} role="status">
              {issue && (linkTouched || link) ? LINK_PROBLEMS[issue] : null}
              {!issue && formId ? `Form found. ID ${formId.slice(0, 14)}…` : null}
              {issue && !linkTouched && !link ? 'In Google Forms click Send, open the link tab and copy it.' : null}
            </p>
          </div>
          <div className="cn-field">
            <label className="cn-label" htmlFor="title">Test name</label>
            <input id="title" className={`cn-input ${titleError ? 'cn-input--error' : ''}`} value={title} maxLength={200}
              placeholder="Chemistry midterm, Section B" onChange={(e) => setTitle(e.target.value)} />
            {titleError ? <p className="cn-hint cn-hint--error">{titleError}</p> : null}
          </div>
        </div>

        <div className="cn-card">
          <h2 className="cn-h2">Rules</h2>
          <Setting title="Mode" hint="Record only logs everything but never blocks, closes tabs or shows warnings." stack>
            <div className="cn-seg" role="radiogroup" aria-label="Mode">
              {[['enforce', 'Enforce'], ['record', 'Record only']].map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={settings.mode === value}
                  className={settings.mode === value ? 'is-on' : ''} onClick={() => set('mode')(value)}>{label}</button>
              ))}
            </div>
          </Setting>
          <Setting title="Strikes before lock" hint="Students see the count in their HUD." stack>
            <div className="cn-stepper">
              <button type="button" aria-label="Fewer" onClick={() => set('maxStrikes')(Math.max(1, settings.maxStrikes - 1))}><Icon name="minus" /></button>
              <b data-testid="max-strikes">{settings.maxStrikes}</b>
              <button type="button" aria-label="More" onClick={() => set('maxStrikes')(Math.min(10, settings.maxStrikes + 1))}><Icon name="plus" /></button>
            </div>
          </Setting>
          <Toggle title="Snap back" hint="Bring students back to the exam tab when they leave, and close new tabs." checked={settings.snapBack} onChange={set('snapBack')} />
          <Toggle title="Block AI and answer sites" hint="Search engines, AI assistants, translators and messaging sites." checked={settings.blockAiSites} onChange={set('blockAiSites')} />
          {settings.blockAiSites ? (
            <details style={{ padding: '4px 0 12px' }}>
              <summary className="cn-label" style={{ cursor: 'pointer' }}>Blocked sites ({settings.blocklist.length}): view or edit the list</summary>
              <div style={{ marginTop: 12 }}>
                <SiteTags id="blocklist" label="Blocked sites" hint="subdomains included"
                  values={settings.blocklist} onChange={set('blocklist')} />
                {settings.blocklist.length !== DEFAULT_BLOCKLIST.length ? (
                  <button type="button" className="cn-btn cn-btn--ghost cn-btn--sm" style={{ marginTop: 8 }}
                    onClick={() => set('blocklist')(DEFAULT_BLOCKLIST)}>Restore the default list</button>
                ) : null}
              </div>
            </details>
          ) : null}
          <SiteTags id="allowlist" label="Allow-list" hint="always allowed, for example a calculator"
            values={settings.allowlist} onChange={set('allowlist')} />
          <Toggle title="Require fullscreen" hint="Hide the exam when a student leaves fullscreen." checked={settings.requireFullscreen} onChange={set('requireFullscreen')} />
          <Toggle title="Block copy and paste" hint="Inside the exam page only." checked={settings.blockCopyPaste} onChange={set('blockCopyPaste')} />
          <Toggle title="Log page titles" hint="Off by default. Domains are always logged; titles can reveal private content." checked={settings.logTabTitles} onChange={set('logTabTitles')} />
        </div>

        {saved ? (
          <div className="dash-row">
            <button className="cn-btn cn-btn--danger cn-btn--sm" type="button" onClick={() => setDialog('delete')}><Icon name="trash" />Delete draft</button>
          </div>
        ) : null}
      </div>

      {dialog === 'live' ? <GoLiveDialog busy={busy} error={liveError} onClose={() => setDialog(null)} onConfirm={confirmLive} /> : null}
      {dialog === 'delete' ? (
        <Modal title="Delete this draft?" icon="trash" tone="danger" onClose={() => setDialog(null)}
          actions={(
            <>
              <button className="cn-btn cn-btn--danger cn-btn--lg" type="button" disabled={busy} onClick={remove}>Delete</button>
              <button className="cn-btn cn-btn--secondary cn-btn--lg" type="button" onClick={() => setDialog(null)}>Keep it</button>
            </>
          )}>
          <p className="cn-lead">This removes the draft and its settings. It has no student data yet.</p>
        </Modal>
      ) : null}
    </>
  );
}
