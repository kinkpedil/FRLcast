/*
 * The contact form's sender: one message from frlcast.my.id/contact to the owner's inbox,
 * through Resend (https://resend.com).
 *
 * Configuration lives in the Vercel project's environment, never in this repository:
 *   RESEND_API_KEY  required. Without it the form says so and offers the email-app buttons.
 *   RESEND_FROM     optional. Until the frlcast.my.id domain is verified in Resend, only
 *                   Resend's own onboarding@resend.dev may send, and only to the address the
 *                   Resend account was made with, so CONTACT_TO must be that address.
 *   CONTACT_TO      optional, defaults to the owner's address.
 *
 * Anyone on the internet can reach this, so it is deliberately narrow: our own pages only,
 * a hidden field and a minimum time on the page against bots, hard length limits, a small
 * per-address limit, and plain text only (nothing a visitor writes is rendered as HTML). The
 * visitor's address goes in Reply-To, so answering is just pressing Reply.
 */

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
  const email = oneLine(b.email, 254);
  const topic = TOPICS.includes(b.topic) ? b.topic : 'Other';
  const message = String(b.message == null ? '' : b.message).replace(/\r\n/g, '\n').trim().slice(0, 4000);
  const lang = b.lang === 'id' ? 'id' : 'en';

  if (!EMAIL_RE.test(email)) return send(res, 400, { ok: false, error: 'email' });
  if (message.length < 10) return send(res, 400, { ok: false, error: 'message' });

  const ip = oneLine(String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '?', 64);
  if (tooMany(ip)) return send(res, 429, { ok: false, error: 'rate' });

  const key = process.env.RESEND_API_KEY;
  if (!key) return send(res, 503, { ok: false, error: 'not_configured' });

  const from = process.env.RESEND_FROM || 'FRLcast contact <onboarding@resend.dev>';
  const to = process.env.CONTACT_TO || 'kinkpedil12@gmail.com';
  const subject = `[FRLcast] ${topic}${name ? ` (${name})` : ''}`;
  const text = [
    message,
    '',
    '--',
    `From: ${name || '(no name)'} <${email}>`,
    `Topic: ${topic}`,
    `Page language: ${lang}`,
    'Sent from the contact form on frlcast.my.id. Reply to answer the sender directly.'
  ].join('\n');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], reply_to: email, subject, text })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[contact] resend', r.status, detail.slice(0, 300));
      return send(res, 502, { ok: false, error: 'send' });
    }
    return send(res, 200, { ok: true });
  } catch (err) {
    console.error('[contact] resend unreachable', err && err.message);
    return send(res, 502, { ok: false, error: 'send' });
  }
};
