/*
 * The owner's inbox: every contact-form message, for the private /inbox page.
 *
 * Only someone holding the owner's secret key gets in. The key is INBOX_KEY in the Vercel
 * project's environment (at least 16 characters, chosen by the owner, never in this
 * repository); the page sends it in the X-Inbox-Key header on every call. It is compared in
 * constant time, and an address that keeps guessing wrong is shut out for a while, so the
 * key cannot be found by trying.
 *
 *   GET     ?status=new|replied|archived|all  &category=...  &q=text   list + counts
 *   PATCH   { id, status?, category? }                                 file or mark a message
 *   POST    { id, text }                                               reply to the sender
 *   DELETE  { id }                                                     remove it for good
 *
 * A reply goes from the site's own address (RESEND_FROM, a verified domain) to the sender,
 * with the owner in Reply-To and in Bcc (so Gmail keeps a copy), under the message's shared
 * subject, and is kept on the message (replies) with the time it was sent.
 */

const crypto = require('crypto');
const { CATEGORIES, OWNER, configured, rest, send, readBody, refOf, subjectOf, sendMail, domainReady } = require('./_inbox.js');

const STATUSES = ['new', 'replied', 'archived'];
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Wrong keys per address, while this instance is warm: ten tries per fifteen minutes.
const misses = new Map();
const MISS_WINDOW = 15 * 60 * 1000;
const MISS_LIMIT = 10;

function lockedOut(ip) {
  const now = Date.now();
  const list = (misses.get(ip) || []).filter((t) => now - t < MISS_WINDOW);
  misses.set(ip, list);
  return list.length >= MISS_LIMIT;
}
function miss(ip) {
  const list = misses.get(ip) || [];
  list.push(Date.now());
  misses.set(ip, list);
  if (misses.size > 5000) misses.clear();
}

// Hashing both sides first gives equal-length buffers, so timingSafeEqual can compare them
// without the length itself leaking anything.
function keyMatches(given) {
  const want = process.env.INBOX_KEY || '';
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const key = process.env.INBOX_KEY || '';
  if (key.length < 16 || !configured()) return send(res, 503, { ok: false, error: 'not_configured' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '?';
  if (lockedOut(ip)) return send(res, 429, { ok: false, error: 'locked' });
  if (!keyMatches(req.headers['x-inbox-key'])) {
    miss(ip);
    return send(res, 401, { ok: false, error: 'key' });
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const status = url.searchParams.get('status') || 'new';
      const category = url.searchParams.get('category') || '';
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
      const filters = [];
      if (STATUSES.includes(status)) filters.push(`status=eq.${status}`);
      if (CATEGORIES.includes(category)) filters.push(`category=eq.${category}`);
      if (q) {
        // PostgREST "or" filter; characters that would end the expression are dropped
        const safe = q.replace(/[(),*%\\]/g, ' ').trim();
        if (safe) filters.push(`or=(name.ilike.*${encodeURIComponent(safe)}*,email.ilike.*${encodeURIComponent(safe)}*,message.ilike.*${encodeURIComponent(safe)}*)`);
      }
      const list = await rest(`contact_messages?select=*&order=created_at.desc&limit=500${filters.length ? '&' + filters.join('&') : ''}`);
      // Counts for the side bar come from one small read of just the two columns.
      const all = await rest('contact_messages?select=status,category&limit=5000');
      const counts = { status: {}, category: {}, newByCategory: {} };
      for (const r of all) {
        counts.status[r.status] = (counts.status[r.status] || 0) + 1;
        counts.category[r.category] = (counts.category[r.category] || 0) + 1;
        if (r.status === 'new') counts.newByCategory[r.category] = (counts.newByCategory[r.category] || 0) + 1;
      }
      return send(res, 200, { ok: true, messages: list, counts, total: all.length, canReply: domainReady() });
    }

    const b = await readBody(req);
    if (!b || !ID_RE.test(String(b.id || ''))) return send(res, 400, { ok: false, error: 'id' });

    if (req.method === 'PATCH') {
      const patch = {};
      if (STATUSES.includes(b.status)) {
        patch.status = b.status;
        patch.replied_at = b.status === 'replied' ? new Date().toISOString() : null;
      }
      if (CATEGORIES.includes(b.category)) patch.category = b.category;
      if (!Object.keys(patch).length) return send(res, 400, { ok: false, error: 'nothing' });
      await rest(`contact_messages?id=eq.${b.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST') {
      const text = String(b.text == null ? '' : b.text).replace(/\r\n/g, '\n').trim().slice(0, 8000);
      if (text.length < 2) return send(res, 400, { ok: false, error: 'text' });
      if (!domainReady()) return send(res, 409, { ok: false, error: 'domain' });
      const rows = await rest(`contact_messages?id=eq.${b.id}&select=*`);
      const m = rows && rows[0];
      if (!m) return send(res, 404, { ok: false, error: 'id' });
      const when = new Date(m.created_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
      const quoted = m.message.split('\n').map((l) => '> ' + l).join('\n');
      const body = `${text}\n\n${when}, ${m.name || m.email} <${m.email}>:\n${quoted}\n\n${refOf(m.id)}`;
      const sent = await sendMail({ to: m.email, subject: 'Re: ' + subjectOf(m), text: body, replyTo: OWNER, bcc: OWNER });
      if (!sent) return send(res, 502, { ok: false, error: 'send' });
      // Kept after it went out: a failed save must not make the owner send it twice.
      const at = new Date().toISOString();
      const replies = (Array.isArray(m.replies) ? m.replies : []).concat([{ at, text }]);
      try {
        await rest(`contact_messages?id=eq.${b.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { replies, status: 'replied', replied_at: at } });
      } catch (err) {
        console.error('[inbox] reply sent but not saved', err.message);
        return send(res, 200, { ok: true, saved: false });
      }
      return send(res, 200, { ok: true, saved: true });
    }

    if (req.method === 'DELETE') {
      await rest(`contact_messages?id=eq.${b.id}`, { method: 'DELETE', prefer: 'return=minimal' });
      return send(res, 200, { ok: true });
    }

    res.setHeader('Allow', 'GET, PATCH, POST, DELETE');
    return send(res, 405, { ok: false, error: 'method' });
  } catch (err) {
    console.error('[inbox]', err.message);
    return send(res, 502, { ok: false, error: 'database' });
  }
};
