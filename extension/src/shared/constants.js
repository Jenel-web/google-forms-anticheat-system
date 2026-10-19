// Pure helpers shared by the service worker (and, later, the dashboard). No chrome.* calls here.

export const DEFAULT_BLOCKLIST = [
  // AI assistants
  'chatgpt.com', 'chat.openai.com', 'openai.com', 'gemini.google.com', 'bard.google.com', 'claude.ai',
  'perplexity.ai', 'copilot.microsoft.com', 'poe.com', 'character.ai', 'deepseek.com', 'grok.com',
  // Search engines and translation tools
  'google.com/search', 'bing.com', 'duckduckgo.com', 'search.brave.com', 'search.yahoo.com',
  'translate.google.com', 'deepl.com',
  // Answer sites
  'chegg.com', 'coursehero.com', 'brainly.com', 'quizlet.com', 'quora.com', 'wolframalpha.com',
  // Messaging and file sharing
  'web.whatsapp.com', 'web.telegram.org', 'messenger.com', 'discord.com', 'slack.com',
  'dropbox.com', 'mega.nz', 'wetransfer.com',
];

export const DEFAULT_SETTINGS = {
  mode: 'enforce',
  maxStrikes: 3,
  snapBack: true,
  blockAiSites: true,
  blocklist: DEFAULT_BLOCKLIST,
  allowlist: [],
  requireFullscreen: true,
  blockCopyPaste: true,
  logTabTitles: false,
};

// Hosts the exam tab itself may be on (the Form, and Google's sign-in used by "Limit to 1 response").
export const EXAM_HOSTS = ['docs.google.com', 'accounts.google.com'];

export const HEARTBEAT_MS = 5000;

export function mergeSettings(partial) {
  const s = { ...DEFAULT_SETTINGS, ...(partial || {}) };
  s.mode = s.mode === 'record' ? 'record' : 'enforce';
  s.maxStrikes = Math.min(10, Math.max(1, Number.parseInt(s.maxStrikes, 10) || 3));
  s.blocklist = Array.isArray(s.blocklist) ? s.blocklist : DEFAULT_BLOCKLIST;
  s.allowlist = Array.isArray(s.allowlist) ? s.allowlist : [];
  return s;
}

// /forms/[u/N/]d/[e/]<id>/viewform  ->  <id>. Only /viewform pages count (FR-1, FR-2).
export function parseFormId(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'docs.google.com') return null;
    const m = u.pathname.match(/^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?([A-Za-z0-9_-]+)\/viewform\/?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Why a pasted link cannot be protected: 'EMPTY', 'NOT_A_FORM_LINK', 'EDIT_LINK' (/d/<id>/edit) or 'EDITOR_ID_LINK'
// (/d/<id>/viewform: the form's editor ID, which students' published /d/e/<id> links never match). null = accepted.
export function formLinkIssue(url) {
  const text = typeof url === 'string' ? url.trim() : '';
  if (!text) return 'EMPTY';
  let u;
  try { u = new URL(text); } catch { return 'NOT_A_FORM_LINK'; }
  if (u.hostname !== 'docs.google.com') return 'NOT_A_FORM_LINK';
  if (/^\/forms\/(?:u\/\d+\/)?d\/(?!e\/)[A-Za-z0-9_-]+\/edit\/?$/.test(u.pathname)) return 'EDIT_LINK';
  if (/^\/forms\/(?:u\/\d+\/)?d\/(?!e\/)[A-Za-z0-9_-]+\/viewform\/?$/.test(u.pathname)) return 'EDITOR_ID_LINK';
  return parseFormId(text) ? null : 'NOT_A_FORM_LINK';
}

// The published form ID of a /formResponse address, or null. Google Forms posts every page of a multi-page form (and the
// final submit) to this address, so it alone cannot tell "next section" from "submitted".
export function parseResponseFormId(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'docs.google.com') return null;
    const m = u.pathname.match(/^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?([A-Za-z0-9_-]+)\/formResponse\/?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function isFormResponseUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'docs.google.com' && /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[A-Za-z0-9_-]+\/formResponse\/?$/.test(u.pathname);
  } catch {
    return false;
  }
}

// Domain only, never the full URL (NFR-1). Empty string when the URL can't be parsed.
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function domainMatches(host, domain) {
  if (!host || !domain) return false;
  const d = String(domain).toLowerCase().replace(/^\.+/, '');
  return host === d || host.endsWith('.' + d);
}

// A blocklist entry is a domain ("chatgpt.com", subdomains included) or a host/path prefix ("google.com/search").
export function entryMatchesUrl(entry, url) {
  try {
    const u = new URL(url);
    const i = entry.indexOf('/');
    if (i === -1) return domainMatches(u.hostname.toLowerCase(), entry);
    const host = entry.slice(0, i);
    const path = entry.slice(i);
    return domainMatches(u.hostname.toLowerCase(), host) && u.pathname.startsWith(path);
  } catch {
    return false;
  }
}

// FR-19 ladder. 0 -> active, 1 -> warning, max-1 -> blurred, max -> locked.
export function phaseForStrikes(strikes, max) {
  if (strikes <= 0) return 'active';
  if (strikes >= max) return 'locked';
  if (strikes === max - 1) return 'blurred';
  return 'warning';
}

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
