// All overlay styling for the student screens. Theme tokens come from CheatNoNo/tokens.css (keep in sync);
// component rules are the student-side subset of CheatNoNo/components/bundle.css.
// Classic script: defines the global EG_CSS used by ui.js.
// eslint-disable-next-line no-unused-vars
const EG_CSS = `
:host{
all:initial;
--surface:#ffffff;--surface-tint:#f2f9ff;--surface-sky:#e3f2fd;--sky-200:#bfe3fb;--sky-300:#8fcdf6;
--brand:#1b8fe6;--brand-strong:#0b63b5;--brand-deep:#084f93;--on-brand:#ffffff;
--ink:#0b2545;--ink-muted:#475f7d;--line:#d3e5f5;--line-strong:#6f93b8;--focus:var(--brand-strong);
--amber:#f6b02c;--warning-bg:#fff3d6;--warning-text:#7a4a00;--danger:#c2331f;--danger-bg:#fdebe7;
--success:#0a6f7d;--success-bg:#def4f6;--scrim:#0b2545c7;
--shadow-md:0 6px 16px rgba(11,37,69,0.10), 0 2px 4px rgba(11,37,69,0.06);
--shadow-lg:0 24px 48px rgba(11,37,69,0.22), 0 6px 12px rgba(11,37,69,0.10);
--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;--space-6:32px;
--radius-sm:8px;--radius-md:12px;--radius-lg:20px;--radius-pill:999px;
--font-display:"Sora","Avenir Next",system-ui,sans-serif;
--font-sans:"DM Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
--font-mono:"DM Mono",ui-monospace,"SF Mono",Menlo,monospace;
}
[hidden]{display:none!important}
.cn{font-family:var(--font-sans);font-size:16px;line-height:24px;color:var(--ink);-webkit-font-smoothing:antialiased}
.cn *,.cn *::before,.cn *::after{box-sizing:border-box}
.cn h1,.cn h2,.cn h3,.cn p{margin:0}
.cn-h1{font:700 28px/34px var(--font-display);letter-spacing:-.01em}
.cn-h3{font:600 18px/24px var(--font-display)}
.cn-lead{font:400 18px/28px var(--font-sans);color:var(--ink-muted)}
.cn-muted{color:var(--ink-muted)}
.cn-sm{font:400 14px/20px var(--font-sans)}
.cn-data{font:400 13px/20px var(--font-mono)}
.cn-eyebrow{font:600 13px/16px var(--font-sans);letter-spacing:.06em;text-transform:uppercase;color:var(--brand-strong)}
.cn-eyebrow--warn{color:var(--warning-text)}
.cn-eyebrow--danger{color:var(--danger)}
.cn-ico{width:20px;height:20px;flex:none;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.cn :focus-visible{outline:3px solid var(--focus);outline-offset:2px}

.cn-logo{display:inline-flex;align-items:center;gap:10px;color:var(--ink)}
.cn-logo svg{width:28px;height:28px;flex:none}
.cn-logo__word{font:700 18px/1 var(--font-display);letter-spacing:-.02em;color:var(--ink)}
.cn-logo__word b{font-weight:700;color:var(--brand)}

.cn-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 20px;border-radius:var(--radius-md);border:1.5px solid transparent;background:var(--surface);color:var(--ink);font:600 16px/24px var(--font-sans);cursor:pointer;white-space:nowrap}
.cn-btn--primary{background:var(--brand-strong);color:var(--on-brand)}
.cn-btn--primary:hover{background:var(--brand-deep)}
.cn-btn--secondary{background:var(--surface);color:var(--brand-strong);border-color:var(--line-strong)}
.cn-btn--secondary:hover{background:var(--surface-sky)}
.cn-btn--ghost{background:transparent;color:var(--brand-strong)}
.cn-btn--ghost:hover{background:var(--surface-sky)}
.cn-btn--danger{background:var(--danger);color:var(--on-brand)}
.cn-btn--lg{min-height:52px;padding:0 28px;font-size:17px}
.cn-btn[disabled]{background:var(--surface-sky);color:var(--ink-muted);border-color:transparent;cursor:not-allowed}
.cn-btn .cn-ico{width:18px;height:18px}

.cn-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px 0 10px;border-radius:var(--radius-pill);font:600 13px/16px var(--font-sans);letter-spacing:.02em;white-space:nowrap;border:1.5px solid transparent}
.cn-chip .cn-ico{width:14px;height:14px;stroke-width:2.25}
.cn-chip--submitted{background:var(--surface-sky);color:var(--brand-strong)}
.cn-chip--active{background:var(--success-bg);color:var(--success)}

.cn-pips{display:inline-flex;gap:4px;align-items:center}
.cn-pip{flex:none;display:inline-block;width:12px;height:12px;border-radius:var(--radius-pill);border:2px solid var(--line-strong);background:transparent}
.cn-pip.is-used{background:var(--amber);border-color:var(--warning-text)}
.cn-pips--danger .cn-pip.is-used{background:var(--danger);border-color:var(--danger)}
.eg-hud{position:fixed;top:14px;right:14px;z-index:1;pointer-events:none}
.cn-hud{display:inline-flex;align-items:center;gap:10px;padding:6px 16px 6px 6px;border-radius:var(--radius-pill);background:var(--surface);color:var(--ink);box-shadow:var(--shadow-md),inset 0 0 0 1.5px var(--line);font:600 14px/20px var(--font-sans);white-space:nowrap}
.cn-hud__icon{width:32px;height:32px;border-radius:var(--radius-pill);display:grid;place-items:center;background:var(--brand-strong);color:var(--on-brand)}
.cn-hud__icon .cn-ico{width:18px;height:18px}
.cn-hud__sep{width:4px;height:4px;border-radius:50%;background:var(--line-strong)}
.cn-hud__strikes{font:500 13px/20px var(--font-mono);color:var(--ink-muted)}
.cn-hud--warn .cn-hud__icon{background:var(--amber);color:var(--ink)}
.cn-hud--danger .cn-hud__icon{background:var(--danger);color:var(--on-brand)}
.cn-hud--danger .cn-hud__strikes{color:var(--danger)}

.cn-field{display:grid;gap:6px;width:100%}
.cn-label{font:600 14px/20px var(--font-sans);color:var(--ink)}
.cn-hint{font:400 14px/20px var(--font-sans);color:var(--ink-muted);display:flex;gap:6px;align-items:flex-start}
.cn-hint--error{color:var(--danger)}
.cn-hint--ok{color:var(--success)}
.cn-hint .cn-ico{width:16px;height:16px;margin-top:2px}
.cn-input{display:block;width:100%;min-height:48px;padding:12px 14px;border:1.5px solid var(--line-strong);border-radius:var(--radius-md);background:var(--surface);color:var(--ink);font:400 16px/24px var(--font-sans);appearance:none}
.cn-input::placeholder{color:var(--ink-muted);opacity:1}
.cn-input:focus{border-color:var(--brand-strong);outline:3px solid var(--focus);outline-offset:1px}
.cn-input--error{border-color:var(--danger)}
.cn-checkrow{display:flex;gap:12px;align-items:flex-start;font:400 16px/24px var(--font-sans);cursor:pointer}
input.cn-checkbox{appearance:none;-webkit-appearance:none;margin:0;flex:none;cursor:pointer;border:1.5px solid var(--line-strong);background:var(--surface);width:24px;height:24px;border-radius:7px}
input.cn-checkbox:checked{background:var(--brand-strong) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E") center/18px no-repeat;border-color:var(--brand-strong)}
.cn-banner{display:flex;gap:12px;align-items:flex-start;width:100%;padding:12px 16px;border-radius:var(--radius-md);font:400 14px/20px var(--font-sans)}
.cn-banner b{font-weight:600}
.cn-banner--info{background:var(--surface-sky);color:var(--ink)}
.cn-banner--info .cn-ico{color:var(--brand-strong)}
.cn-banner--danger{background:var(--danger-bg);color:var(--danger)}

.cn-overlay,.cn-fullscreen{position:fixed;inset:0;z-index:2;display:flex;padding:var(--space-4);overflow:auto;pointer-events:auto}
.cn-overlay{background:var(--scrim)}
.cn-fullscreen{background:var(--surface-sky)}
.cn-overlay>*,.cn-fullscreen>*{margin:auto}
.cn-modal{width:min(560px,100%);background:var(--surface);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:var(--space-6);display:grid;gap:var(--space-4);justify-items:start}
.cn-modal--wide{width:min(780px,100%)}
.cn-modal--center{justify-items:center;text-align:center}
.cn-modal__icon{width:56px;height:56px;border-radius:var(--radius-pill);display:grid;place-items:center;background:var(--surface-sky);color:var(--brand-strong)}
.cn-modal__icon .cn-ico{width:28px;height:28px}
.cn-modal__icon--warn{background:var(--warning-bg);color:var(--warning-text)}
.cn-modal__icon--danger{background:var(--danger-bg);color:var(--danger)}
.cn-modal__actions{display:flex;gap:12px;flex-wrap:wrap;width:100%;align-items:center}
.cn-modal--center .cn-modal__actions{justify-content:center}
.cn-detect{display:flex;gap:12px;align-items:center;width:100%;padding:12px 16px;border-radius:var(--radius-md);background:var(--surface-tint);border:1px solid var(--line)}
.cn-detect .cn-ico{color:var(--ink-muted)}
.cn-detect__t{margin-left:auto;font:400 13px/20px var(--font-mono);color:var(--ink-muted)}
.cn-cols{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-5);width:100%}
.cn-list{display:grid;gap:12px;margin:0;padding:0;list-style:none}
.cn-list li{display:flex;gap:12px;align-items:flex-start;font:400 15px/22px var(--font-sans)}
.cn-list .cn-ico{color:var(--brand-strong);margin-top:1px}
.cn-list--no .cn-ico{color:var(--danger)}
.cn-status{display:inline-flex;align-items:center;gap:8px;font:600 14px/20px var(--font-sans);color:var(--ink)}
.cn-status>i{width:10px;height:10px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 3px var(--warning-bg),0 0 0 4.5px var(--warning-text)}
.cn-steps{display:grid;gap:14px;margin:0;padding:0;list-style:none;counter-reset:s;width:100%}
.cn-steps li{counter-increment:s;display:grid;grid-template-columns:32px 1fr;gap:12px;align-items:start;font:400 15px/22px var(--font-sans)}
.cn-steps li::before{content:counter(s);width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--brand-strong);color:var(--on-brand);font:700 14px/1 var(--font-display)}
.cn-kbd{display:inline-block;padding:1px 8px;border-radius:6px;border:1.5px solid var(--line-strong);background:var(--surface);font:500 12px/18px var(--font-mono)}
@media (max-width:760px){
  .cn-cols{grid-template-columns:1fr}
  .cn-modal{padding:var(--space-5)}
}
@media (prefers-reduced-motion:no-preference){
  .cn-btn{transition:background .12s ease}
}
`;
