// D8: find students who submitted without a monitored attempt. Runs entirely in the browser: the Forms responses file is
// read here, only its email column is kept, and nothing is sent anywhere.
import { readCsvColumn } from './csv.js';

const norm = (v) => String(v || '').trim().toLowerCase();

// Prefer Forms' own "Email Address" column; otherwise the first header that mentions email.
export function pickEmailColumn(header) {
  const names = header.map(norm);
  let i = names.findIndex((n) => n === 'email address' || n === 'email' || n === 'e-mail');
  if (i < 0) i = names.findIndex((n) => /e-?mail/.test(n));
  return i;
}

export function readResponseEmails(text) {
  const res = readCsvColumn(text, pickEmailColumn);
  if (!res.found) return { found: false, emails: [], rows: res.rows };
  return { found: true, emails: res.values.map(norm).filter(Boolean), rows: res.rows };
}

// attempts: rows with student_name, student_email, chrome_email, status. emails: lower-cased emails from the responses.
// An attempt matches on the email the student typed or on the Chrome profile email.
export function reconcile(attempts, emails) {
  const responses = new Map();
  for (const e of emails) responses.set(e, (responses.get(e) || 0) + 1);

  const claimed = new Set();
  const matched = [];
  const noSubmission = [];
  for (const a of attempts) {
    const keys = [norm(a.student_email), norm(a.chrome_email)].filter(Boolean);
    const key = keys.find((k) => responses.has(k));
    if (key) {
      claimed.add(key);
      matched.push({ attempt: a, email: key, responses: responses.get(key) });
    } else {
      noSubmission.push({ attempt: a });
    }
  }
  const noAttempt = [...responses.entries()].filter(([e]) => !claimed.has(e)).map(([email, n]) => ({ email, responses: n }));
  return { matched, noAttempt, noSubmission, totalResponses: emails.length };
}
