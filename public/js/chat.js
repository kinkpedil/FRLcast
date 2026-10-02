/*
 * Live chat from the stream, read in the operator's console tab.
 *
 * Twitch chat is read anonymously over its IRC WebSocket (a "justinfan" guest login), so it
 * needs no account and no key. YouTube Live Chat goes through the YouTube Data API with the
 * operator's own API key: the key stays in this browser, every call is made from here, and
 * the polling interval follows what YouTube asks for (each read spends quota, about 2.5
 * hours of reading per day on the default 10,000 units, so it never polls faster than 6 s).
 *
 * Messages come out as { platform, user, userId, text, at } through onMessage. What a
 * message does (a poll vote, a command) is the console's business, not this file's.
 */

const TWITCH_WS = 'wss://irc-ws.chat.twitch.tv:443';
const YT_API = 'https://www.googleapis.com/youtube/v3';

export class ChatHub {
  constructor() {
    this.handlers = { message: [], status: [] };
    this.twitch = { ws: null, channel: '', state: 'off', retry: 0, timer: 0, want: false };
    this.yt = { key: '', video: '', chatId: '', page: '', state: 'off', timer: 0, want: false, error: '' };
  }

  on(ev, fn) { this.handlers[ev].push(fn); }
  emit(ev, data) { for (const fn of this.handlers[ev]) { try { fn(data); } catch (e) { console.error('[chat]', e); } } }
  status() {
    return { twitch: { state: this.twitch.state, channel: this.twitch.channel },
      youtube: { state: this.yt.state, video: this.yt.video, error: this.yt.error } };
  }
  setState(which, state, error) {
    if (which === 'twitch') this.twitch.state = state;
    else { this.yt.state = state; this.yt.error = error || ''; }
    this.emit('status', this.status());
  }

  // ---------------------------------------------------------------- Twitch
  connectTwitch(channel) {
    const ch = String(channel || '').trim().replace(/^#/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').split(/[/?#]/)[0].toLowerCase();
    if (!/^[a-z0-9_]{3,25}$/.test(ch)) { this.setState('twitch', 'error'); return false; }
    this.disconnectTwitch();
    this.twitch.channel = ch;
    this.twitch.want = true;
    this.openTwitch();
    return true;
  }

  openTwitch() {
    const t = this.twitch;
    this.setState('twitch', 'connecting');
    const ws = new WebSocket(TWITCH_WS);
    t.ws = ws;
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags');
      ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
      ws.send(`JOIN #${t.channel}`);
    };
    ws.onmessage = (ev) => {
      for (const line of String(ev.data).split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) { ws.send(line.replace('PING', 'PONG')); continue; }
        if (line.includes(` JOIN #${t.channel}`) || / 366 /.test(line)) { t.retry = 0; this.setState('twitch', 'live'); continue; }
        const m = /^(?:@(\S+) )?:([^!\s]+)!\S+ PRIVMSG #\S+ :(.*)$/.exec(line);
        if (!m) continue;
        const tags = Object.fromEntries((m[1] || '').split(';').map((kv) => kv.split('=')));
        const user = (tags['display-name'] || m[2] || '').replace(/\\s/g, ' ');
        this.emit('message', { platform: 'twitch', user, userId: tags['user-id'] || m[2], text: m[3].slice(0, 300), at: Date.now() });
      }
    };
    ws.onclose = () => {
      if (t.ws !== ws) return;
      t.ws = null;
      if (!t.want) { this.setState('twitch', 'off'); return; }
      // back off up to half a minute, and keep trying: a stream outlives a dropped socket
      t.retry = Math.min(t.retry + 1, 6);
      this.setState('twitch', 'reconnecting');
      t.timer = setTimeout(() => this.openTwitch(), Math.min(30000, 1000 * 2 ** t.retry));
    };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* already closed */ } };
  }

  disconnectTwitch() {
    const t = this.twitch;
    t.want = false;
    clearTimeout(t.timer);
    if (t.ws) { const ws = t.ws; t.ws = null; try { ws.close(); } catch (e) { /* closed */ } }
    this.setState('twitch', 'off');
  }

  // ---------------------------------------------------------------- YouTube
  static videoId(input) {
    const s = String(input || '').trim();
    const m = /(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/.exec(s);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : '';
  }

  async connectYouTube(video, key) {
    this.disconnectYouTube();
    const id = ChatHub.videoId(video);
    const y = this.yt;
    if (!id) { this.setState('youtube', 'error', 'video'); return false; }
    if (!/^[A-Za-z0-9_-]{20,60}$/.test(String(key || ''))) { this.setState('youtube', 'error', 'key'); return false; }
    Object.assign(y, { key, video: id, chatId: '', page: '', want: true });
    this.setState('youtube', 'connecting');
    try {
      const r = await fetch(`${YT_API}/videos?part=liveStreamingDetails&id=${id}&key=${encodeURIComponent(key)}`);
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || 'request');
      const chatId = j.items && j.items[0] && j.items[0].liveStreamingDetails && j.items[0].liveStreamingDetails.activeLiveChatId;
      if (!chatId) throw new Error('nochat');
      y.chatId = chatId;
      // The first read only takes the page token: chat from before the connection is not
      // counted, or every old message would arrive as a vote at once.
      await this.pollYouTube(true);
      return true;
    } catch (e) {
      this.setState('youtube', 'error', e.message);
      y.want = false;
      return false;
    }
  }

  async pollYouTube(first) {
    const y = this.yt;
    if (!y.want || !y.chatId) return;
    let wait = 8000;
    try {
      const url = `${YT_API}/liveChat/messages?liveChatId=${encodeURIComponent(y.chatId)}&part=snippet,authorDetails&maxResults=200`
        + `${y.page ? '&pageToken=' + encodeURIComponent(y.page) : ''}&key=${encodeURIComponent(y.key)}`;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) {
        const reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || 'request';
        // A finished stream or a spent quota will not fix itself by retrying every few seconds.
        if (['liveChatEnded', 'liveChatNotFound', 'quotaExceeded', 'forbidden', 'keyInvalid'].includes(reason)) {
          y.want = false;
          this.setState('youtube', 'error', reason);
          return;
        }
        throw new Error(reason);
      }
      y.page = j.nextPageToken || y.page;
      wait = Math.max(6000, Number(j.pollingIntervalMillis) || 8000);
      if (!first) {
        for (const it of j.items || []) {
          const sn = it.snippet || {};
          const text = (sn.textMessageDetails && sn.textMessageDetails.messageText) || sn.displayMessage || '';
          if (!text) continue;
          const a = it.authorDetails || {};
          this.emit('message', { platform: 'youtube', user: a.displayName || 'viewer', userId: a.channelId || a.displayName, text: text.slice(0, 300), at: Date.now() });
        }
      }
      if (y.state !== 'live') this.setState('youtube', 'live');
    } catch (e) {
      this.setState('youtube', 'reconnecting', e.message);
      wait = 15000;
    }
    if (y.want) y.timer = setTimeout(() => this.pollYouTube(false), wait);
  }

  disconnectYouTube() {
    const y = this.yt;
    y.want = false;
    clearTimeout(y.timer);
    y.chatId = '';
    y.page = '';
    this.setState('youtube', 'off');
  }
}

/**
 * A chat line as a poll vote: "2", "#2", "!vote 2", "!pilih 2", or an option's label typed
 * out ("!vote kinkpedil" or just "kinkpedil"). Returns the option id, or null.
 */
export function chatVote(text, options) {
  if (!options || !options.length) return null;
  let s = String(text || '').trim().toLowerCase();
  const cmd = /^!(vote|pilih|v)\s+(.+)$/.exec(s);
  if (cmd) s = cmd[2].trim();
  const n = /^#?(\d{1,2})$/.exec(s);
  if (n) {
    const i = Number(n[1]) - 1;
    return i >= 0 && i < options.length ? options[i].id : null;
  }
  // a label only when it is the whole message (or after !vote), so ordinary chat that
  // happens to mention a driver does not count as a vote
  const hit = options.find((o) => String(o.label || '').trim().toLowerCase() === s);
  return hit ? hit.id : null;
}

/** The poll tally: the website's votes (state.votes) plus the chat's (poll.chat). */
export function pollTally(state) {
  const web = (state && state.votes) || { counts: {}, total: 0 };
  const chat = (state && state.overlay && state.overlay.poll && state.overlay.poll.chat) || { counts: {}, total: 0 };
  const counts = { ...(web.counts || {}) };
  for (const [k, v] of Object.entries(chat.counts || {})) counts[k] = (counts[k] || 0) + (Number(v) || 0);
  return { counts, total: (web.total || 0) + (chat.total || 0), chat: chat.total || 0 };
}
