/*
 * The contact form's sender: one message from frlcast.my.id/contact, kept in the owner's
 * private inbox (Supabase, read on /inbox) and emailed to the owner through Resend.
 *
 * Configuration lives in the Vercel project's environment, never in this repository:
 *   SUPABASE_SERVICE_ROLE_KEY  stores the message for /inbox (see api/_inbox.js).
 *   RESEND_API_KEY  sends the email copy.
 *   RESEND_FROM     optional. Until the frlcast.my.id domain is verified in Resend, only
 *                   Resend's own onboarding@resend.dev may send, and only to the address the
 *                   Resend account was made with, so CONTACT_TO must be that address.
 *   CONTACT_TO      optional, defaults to the owner's address.
 * Either one is enough for the form to work; with neither, the form says so and offers the
 * email-app buttons.
 *
 * Anyone on the internet can reach this, so it is deliberately narrow: our own pages only,
 * a hidden field and a minimum time on the page against bots, hard length limits, a small
 * per-address limit, and plain text only (nothing a visitor writes is rendered as HTML). The
 * visitor's address goes in Reply-To, so answering is just pressing Reply.
 */

const crypto = require('crypto');
const { OWNER, guessCategory, configured, rest, send, readBody, refOf, subjectOf, sendMail, domainReady } = require('./_inbox.js');

const TOPICS = ['Question', 'Bug report', 'Feature idea', 'League or partnership', 'Other',
  'Pertanyaan', 'Laporan bug', 'Ide fitur', 'Liga atau kerja sama', 'Lainnya'];
const ORIGINS = ['https://www.frlcast.my.id', 'https://frlcast.my.id', 'https://frl-broadcast.vercel.app'];
const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,180}\.[A-Za-z]{2,24}$/;

// Best effort only: an instance keeps this while it is warm, which is enough to stop one
// visitor (or one script) sending a burst. Five messages per address per ten minutes.
const recent = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const PER_WINDOW = 5;

function allowedOrigin(origin) {
  if (!origin) return true;               // same-origin form posts may omit it
  if (ORIGINS.includes(origin)) return true;
  // the project's own preview deployments
  return /^https:\/\/frl-broadcast-[a-z0-9-]+-kinkpedil\.vercel\.app$/.test(origin);
}

function tooMany(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= PER_WINDOW) { recent.set(ip, list); return true; }
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return false;
}

const oneLine = (s, max) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

async function store(m) {
  if (!configured()) return false;
  try {
    await rest('contact_messages', { method: 'POST', prefer: 'return=minimal', body: m });
    return true;
  } catch (err) {
    console.error('[contact] store', err.message);
    return false;
  }
}

/** The owner's copy: the message, with the visitor in Reply-To. */
function email(m) {
  // The reference code puts this email and the inbox entry on one thread: /inbox opens the
  // Gmail conversation by searching for it, and Reply there answers the sender (Reply-To).
  const text = [
    m.message,
    '',
    '--',
    `From: ${m.name || '(no name)'} <${m.email}>`,
    `Topic: ${m.topic}`,
    `Page language: ${m.lang}`,
    `Reference: ${refOf(m.id)}`,
    'Sent from the contact form on frlcast.my.id. Reply to answer the sender directly,',
    'or open www.frlcast.my.id/inbox to see every message sorted by category.'
  ].join('\n');
  return sendMail({ to: OWNER, subject: subjectOf(m), text, replyTo: m.email });
}

/*
 * The sender's receipt, once the site can mail visitors (domainReady). Same subject as every
 * later email about this message, so a reply from /inbox usually joins it in their mailbox;
 * Reply-To is the owner, so answering it reaches the owner's Gmail.
 */
function confirm(m) {
  if (!domainReady() || process.env.CONTACT_CONFIRM === 'off') return Promise.resolve(false);
  const id = m.lang === 'id';
  const quoted = m.message.split('\n').map((l) => '> ' + l).join('\n');
  const text = (id
    ? [`Halo${m.name ? ' ' + m.name : ''},`, '', 'Terima kasih, pesanmu sudah kami terima. Kami akan membalas ke email ini, biasanya dalam beberapa hari.', '', 'Pesanmu:', quoted, '', `Kode: ${refOf(m.id)}`, '', 'FRLcast by kinkpedil12', 'https://www.frlcast.my.id']
    : [`Hi${m.name ? ' ' + m.name : ''},`, '', 'Thanks, we have your message. We will reply to this email, usually within a few days.', '', 'Your message:', quoted, '', `Reference: ${refOf(m.id)}`, '', 'FRLcast by kinkpedil12', 'https://www.frlcast.my.id']
  ).join('\n');
  return sendMail({ to: m.email, subject: subjectOf(m), text, replyTo: OWNER });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'method' });
  }
  if (!allowedOrigin(req.headers.origin)) return send(res, 403, { ok: false, error: 'origin' });

  const b = await readBody(req);
  if (!b || typeof b !== 'object') return send(res, 400, { ok: false, error: 'invalid' });

  // A filled hidden field, or a form sent within three seconds of the page opening, is a
  // bot. It gets a success answer so it has no reason to try again differently.
  const opened = Number(b.t);
  if (b.website || (Number.isFinite(opened) && Date.now() - opened < 3000)) return send(res, 200, { ok: true });

  const name = oneLine(b.name, 80);
  const addr = oneLine(b.email, 254);
  const topic = TOPICS.includes(b.topic) ? b.topic : 'Other';
  const message = String(b.message == null ? '' : b.message).replace(/\r\n/g, '\n').trim().slice(0, 4000);
  const lang = b.lang === 'id' ? 'id' : 'en';

  if (!EMAIL_RE.test(addr)) return send(res, 400, { ok: false, error: 'email' });
  if (message.length < 10) return send(res, 400, { ok: false, error: 'message' });

  const ip = oneLine(String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '?', 64);
  if (tooMany(ip)) return send(res, 429, { ok: false, error: 'rate' });

  if (!configured() && !process.env.RESEND_API_KEY) return send(res, 503, { ok: false, error: 'not_configured' });

  // The id is made here rather than by the database, so the email can carry its reference.
  const m = { id: crypto.randomUUID(), name, email: addr, topic, category: guessCategory(topic, message), message, lang };
  // Kept and emailed side by side: either one reaching the owner is a delivered message.
  const [kept, mailed] = await Promise.all([store(m), email(m), confirm(m)]);
  if (!kept && !mailed) return send(res, 502, { ok: false, error: 'send' });
  return send(res, 200, { ok: true });
};
