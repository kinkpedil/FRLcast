/*
 * Reading FRLcast release notes: the console's update banner and the site's /changelog page
 * both show the same GitHub release text, in the reader's language.
 *
 * The notes are written by scripts/release-notes.mjs with fixed headings: "## Highlights"
 * (English), "## Sorotan" (Indonesian), "## Changes · Perubahan" and a few more. Splitting on
 * them is what lets one release body serve both languages. Older releases without those
 * headings simply show whole.
 *
 * The markdown here is the small subset those notes use (headings, lists, bold, code, links,
 * quotes), rendered with everything escaped first, so a release body can never inject markup.
 */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

/** Markdown subset to HTML. Headings are shifted down by `shift` levels to fit the page. */
export function mdToHtml(md, { shift = 2 } = {}) {
  const out = [];
  let list = false;
  let para = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    if (list) { out.push('</ul>'); list = false; }
  };
  for (const raw of String(md || '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      const lv = Math.min(6, m[1].length + shift);
      out.push(`<h${lv}>${inline(m[2])}</h${lv}>`);
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flush();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else {
      if (list) { out.push('</ul>'); list = false; }
      para.push(line.trim());
    }
  }
  flush();
  return out.join('\n');
}

/** { title -> body } for every "## " section, in order. */
export function sections(md) {
  const map = new Map();
  let cur = '';
  for (const line of String(md || '').split(/\r?\n/)) {
    const m = /^##\s+(.*?)\s*$/.exec(line);
    if (m) { cur = m[1]; map.set(cur, []); continue; }
    if (!map.has(cur)) map.set(cur, []);
    map.get(cur).push(line);
  }
  const out = new Map();
  for (const [k, v] of map) out.set(k, v.join('\n').trim());
  return out;
}

/**
 * The parts a reader wants, in their language:
 *   highlights - the hand-written summary (the other language when theirs is missing)
 *   changes    - the grouped change list
 *   sha        - the zip's SHA-256, when the notes carry one
 */
export function readNotes(md, lang = 'en') {
  const s = sections(md);
  const en = s.get('Highlights') || '';
  const id = s.get('Sorotan') || '';
  const changesKey = [...s.keys()].find((k) => /^Changes\b/.test(k));
  const sha = (/\*\*SHA-256\*\*[^`]*`([a-f0-9]{64})`/i.exec(md || '') || [])[1] || '';
  const structured = !!(en || id || changesKey);
  return {
    structured,
    highlights: lang === 'id' ? (id || en) : (en || id),
    changes: changesKey ? s.get(changesKey) : (structured ? '' : String(md || '')),
    sha
  };
}
