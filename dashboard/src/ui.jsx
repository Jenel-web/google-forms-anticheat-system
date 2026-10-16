import { useEffect, useRef } from 'react';
import icons from './icons.json';

// Icon markup comes from our own design-system file (static strings), never from user data.
export function Icon({ name, size, className = '' }) {
  const style = size ? { width: size, height: size } : undefined;
  return (
    <svg
      className={`cn-ico ${className}`}
      style={style}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icons[name] || '' }}
    />
  );
}

export function Logo({ small }) {
  return (
    <span className={`cn-logo ${small ? 'cn-logo--sm' : ''}`}>
      <svg viewBox="0 0 48 48" role="img" aria-label="CheatNoNo">
        <path d="M24 3.5 40.5 9.8v13.4C40.5 33.6 33.6 41.4 24 44.8 14.4 41.4 7.5 33.6 7.5 23.2V9.8z" fill="#1b8fe6" />
        <path d="M24 3.5 40.5 9.8v13.4C40.5 33.6 33.6 41.4 24 44.8z" fill="#0b63b5" opacity=".28" />
        <path d="M15.4 24.2l6 6 11.2-12.6" fill="none" stroke="#fff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="38.5" cy="9" r="5.6" fill="#f6b02c" stroke="#fff" strokeWidth="2.6" />
      </svg>
      <span className="cn-logo__word">Cheat<b>NoNo</b></span>
    </span>
  );
}

const CHIPS = {
  active: ['active', 'check-circle', 'Active'],
  away: ['away', 'leave', 'Away'],
  warned: ['warned', 'alert', 'Warned'],
  locked: ['locked', 'lock', 'Locked'],
  submitted: ['submitted', 'check', 'Submitted'],
  closed: ['ended', 'x-circle', 'Closed'],
  abandoned: ['ended', 'x-circle', 'Closed'],
  noheartbeat: ['missing', 'wifi-off', 'No heartbeat'],
  draft: ['draft', 'pencil', 'Draft'],
  live: ['live', 'globe', 'Live'],
  ended: ['ended', 'clock', 'Ended'],
};

export function Chip({ kind }) {
  const [cls, icon, label] = CHIPS[kind] || ['missing', 'help', kind];
  return (
    <span className={`cn-chip cn-chip--${cls}`}>
      <Icon name={icon} />
      {label}
    </span>
  );
}

export function Pips({ used, max }) {
  const danger = used >= max;
  return (
    <span className={`cn-pips ${danger ? 'cn-pips--danger' : ''}`} role="img" aria-label={`${used} of ${max} strikes`}>
      {Array.from({ length: max }, (_, i) => <i key={i} className={`cn-pip ${i < used ? 'is-used' : ''}`} />)}
    </span>
  );
}

export function Avatar({ text }) {
  return <span className="cn-avatar" aria-hidden="true">{text}</span>;
}

export function Banner({ kind = 'info', icon, children, role }) {
  return (
    <div className={`cn-banner cn-banner--${kind}`} role={role || (kind === 'danger' ? 'alert' : 'status')}>
      {icon ? <Icon name={icon} /> : null}
      <div>{children}</div>
    </div>
  );
}

// A centred dialog over a scrim. Escape closes it, focus moves inside, and focus returns on close.
export function Modal({ title, eyebrow, icon = 'info', tone, onClose, children, actions }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const first = ref.current && ref.current.querySelector('input, button, [href]');
    if (first) first.focus();
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previous && previous.focus) previous.focus(); };
  }, [onClose]);
  return (
    <div className="cn-overlay" role="presentation">
      <section className="cn-modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title" ref={ref}>
        <div className={`cn-modal__icon ${tone ? `cn-modal__icon--${tone}` : ''}`}><Icon name={icon} /></div>
        <div>
          {eyebrow ? <p className="cn-eyebrow">{eyebrow}</p> : null}
          <h2 className="cn-h1" id="dlg-title">{title}</h2>
        </div>
        {children}
        <div className="cn-modal__actions">{actions}</div>
      </section>
    </div>
  );
}

export function Empty({ icon = 'list', title, children, action }) {
  return (
    <div className="cn-empty">
      <div className="cn-empty__art"><Icon name={icon} size={32} /></div>
      <h2 className="cn-h2">{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
