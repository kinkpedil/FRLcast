/*
 * A tiny obs-websocket v5 client, enough to switch scenes and save a replay-buffer clip
 * from the operator console. It runs in the browser and talks to the OBS running on the
 * operator's own machine.
 *
 * Note on reachability: OBS exposes a plain ws:// endpoint. A console served over https can
 * only reach it because browsers treat ws://localhost / 127.0.0.1 as a secure context — so
 * the address must stay on the loopback interface. A LAN address (ws://192.168.x.x) from an
 * https page is blocked as mixed content; for that, open the console over http instead.
 */
export class ObsWs {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.reqs = new Map();
    this.seq = 0;
    this.handlers = { open: new Set(), close: new Set(), event: new Set() };
  }
  on(evt, fn) { this.handlers[evt].add(fn); return () => this.handlers[evt].delete(fn); }
  emit(evt, arg) { this.handlers[evt].forEach((f) => { try { f(arg); } catch (e) {} }); }

  async connect(url, password) {
    this.close();
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try { ws = new WebSocket(url); } catch (e) { return reject(e); }
      this.ws = ws;
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error('Could not reach OBS at ' + url)); } };
      ws.onclose = () => { this.connected = false; this.emit('close'); if (!settled) { settled = true; reject(new Error('OBS closed the connection')); } };
      ws.onmessage = async (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.op === 0) {                    // Hello → Identify
          const d = { rpcVersion: 1 };
          const a = m.d && m.d.authentication;
          if (a) d.authentication = await this._authString(password || '', a.salt, a.challenge);
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (m.op === 2) {             // Identified
          this.connected = true;
          settled = true;
          this.emit('open');
          resolve(true);
        } else if (m.op === 7) {             // RequestResponse
          const p = this.reqs.get(m.d.requestId);
          if (p) {
            this.reqs.delete(m.d.requestId);
            if (m.d.requestStatus && m.d.requestStatus.result) p.resolve(m.d.responseData || {});
            else p.reject(new Error((m.d.requestStatus && m.d.requestStatus.comment) || 'OBS request failed'));
          }
        } else if (m.op === 5) {             // Event
          this.emit('event', m.d);
        }
      };
    });
  }

  close() {
    if (this.ws) { try { this.ws.close(); } catch (e) {} this.ws = null; }
    this.connected = false;
    this.reqs.clear();
  }

  request(requestType, requestData) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.ws) return reject(new Error('OBS not connected'));
      const requestId = 'r' + (++this.seq);
      this.reqs.set(requestId, { resolve, reject });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData: requestData || {} } }));
      setTimeout(() => { if (this.reqs.has(requestId)) { this.reqs.delete(requestId); reject(new Error('OBS request timed out')); } }, 5000);
    });
  }

  async scenes() {
    const r = await this.request('GetSceneList');
    return (r.scenes || []).map((s) => s.sceneName).reverse();   // OBS lists bottom-up
  }
  setScene(sceneName) { return this.request('SetCurrentProgramScene', { sceneName }); }
  saveReplay() { return this.request('SaveReplayBuffer'); }
  startReplay() { return this.request('StartReplayBuffer'); }

  // obs-websocket v5 auth: base64( sha256( base64(sha256(pw+salt)) + challenge ) )
  async _authString(password, salt, challenge) {
    const sha = async (str) => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      let bin = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    };
    return sha((await sha(password + salt)) + challenge);
  }
}
