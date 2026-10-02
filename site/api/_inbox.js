/*
 * Shared by the contact form (api/contact.js) and the owner's inbox (api/inbox.js).
 * The leading underscore keeps Vercel from serving this file as an endpoint of its own.
 *
 * The messages live in Supabase's contact_messages table, which no browser can read (see
 * supabase/migrations/20261003000000_inbox.sql). These functions reach it with the service
 * role key from the Vercel environment, never from the page.
 *   SUPABASE_SERVICE_ROLE_KEY  required for storing and reading messages
 *   SUPABASE_URL               optional, defaults to the project the site already uses
 *
 * Email goes out through Resend (RESEND_API_KEY). Until the frlcast.my.id domain is verified
 * there, Resend only lets onboarding@resend.dev write to the account owner, so mail to a
 * visitor (the confirmation, a reply from /inbox) waits for RESEND_FROM to name an address
 * on our own domain; domainReady() is that test.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mtagkpblakgcdovzqbut.supabase.co';

const CATEGORIES = ['question', 'bug', 'idea', 'league', 'other', 'spam'];
const TOPIC_CATEGORY = {
  'Question': 'question', 'Pertanyaan': 'question',
  'Bug report': 'bug', 'Laporan bug': 'bug',
  'Feature idea': 'idea', 'Ide fitur': 'idea',
  'League or partnership': 'league', 'Liga atau kerja sama': 'league',
  'Other': 'other', 'Lainnya': 'other'
};
const BUG_WORDS = /\b(bug|error|crash|freez|frozen|hang|broken|not working|doesn'?t work|tidak bisa|gak bisa|ga bisa|nggak bisa|gagal|macet|rusak|eror|ngebug|stuck|blank)\b/i;
const SPAM_WORDS = /\b(casino|crypto|bitcoin|forex|viagra|loan|backlinks?|seo services?|guest post|slot gacor|judi|pinjol|whatsapp marketing)\b/i;

/** The form's topic, corrected when the words clearly say bug report or spam. */
function guessCategory(topic, message) {
  const links = (message.match(/https?:\/\//gi) || []).length;
  if (links >= 3 || SPAM_WORDS.test(message)) return 'spam';
  const base = TOPIC_CATEGORY[topic] || 'other';
  if ((base === 'question' || base === 'other') && BUG_WORDS.test(message)) return 'bug';
  return base;
}

const configured = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const OWNER = process.env.CONTACT_TO || 'kinkpedil12@gmail.com';

/** True once RESEND_FROM is an address on a domain of our own (not Resend's test sender). */
function domainReady() {
  const from = process.env.RESEND_FROM || '';
  const m = /@([A-Za-z0-9.-]+)>?\s*$/.exec(from);
  return !!(process.env.RESEND_API_KEY && m && !/resend\.dev$/i.test(m[1]));
}

/** One email through Resend. Returns true when Resend accepted it. */
async function sendMail({ to, subject, text, replyTo, bcc }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.RESEND_FROM || 'FRLcast contact <onboarding@resend.dev>';
  const body = { from, to: [].concat(to), subject, text };
  if (replyTo) body.reply_to = replyTo;
  if (bcc) body.bcc = [].concat(bcc);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      console.error('[mail] resend', r.status, (await r.text().catch(() => '')).slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[mail] resend unreachable', err && err.message);
    return false;
  }
}

/** A message's short reference, in the email subject and on /inbox: FRL-1A2B3C4D. */
const refOf = (id) => 'FRL-' + String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();

/** One PostgREST call with the service role. Throws with the database's own message. */
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return null; } }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) return null;
  }
  try { return JSON.parse(raw || '{}'); } catch (e) { return null; }
}

/** The subject every email about one message shares, so a reply lands in the same thread. */
const subjectOf = (m) => `[FRLcast] ${m.topic}${m.name ? ` (${m.name})` : ''} · ${refOf(m.id)}`;

module.exports = { CATEGORIES, OWNER, guessCategory, configured, rest, send, readBody, refOf, subjectOf, sendMail, domainReady };
