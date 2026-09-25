/*
 * Race control for a hosted event.
 *
 * The console speaks to the broadcast server by sending actions and receiving state. It
 * sends fifty six different actions across a hundred and nineteen call sites, and none of
 * them need to change, because the thing that understands those actions is RaceState, and
 * RaceState now runs in a browser.
 *
 * So this bus does what the server used to: it holds one authoritative RaceState, applies
 * actions to it, and lets it write the rows that changed. Overlays and phones read those
 * rows. The console is the timing computer, exactly as the server was.
 *
 * It deliberately does not subscribe to Realtime. It is the writer; listening for its own
 * writes coming back would be a loop, and a slower and less reliable copy of the state it
 * already holds.
 */

import { RaceState } from './race-state.js';
import { SupabaseStore } from './supabase-store.js';
import { CloudBus } from './cloudbus.js';

export class CloudPanelBus {

  constructor(role, opts) {
    this.role = role;
    this.opts = opts;
    this.clientId = `${role}-${Math.random().toString(36).slice(2, 8)}`;
    this.state = null;
    this.handlers = { state: new Set(), signal: new Set(), open: new Set(), close: new Set() };
    this.race = null;
    // Sign-ins this console is mid-way through writing, and ones it has deleted. Both
    // exist so a read arriving in the middle of a write does not undo it.
    this.pending = new Set();
    this.gone = new Set();
    this.connect();
  }

  on(evt, fn) { this.handlers[evt].add(fn); return () => this.handlers[evt].delete(fn); }

  async connect() {
    try {
      const { createClient } = await import(
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');

      // The session from signing in on this site. Writing needs it: every policy checks
      // that the event belongs to whoever is asking.
      this.sb = createClient(this.opts.url, this.opts.anonKey);
      const { data: { session } } = await this.sb.auth.getSession();
      if (!session) {
        this.fail('Sign in first', '/login');
        return;
      }

      // Loading and shaping the event is the same job the overlays do, so it is the same
      // code. What differs is what happens afterwards.
      const loader = new CloudBus('panel-load', this.opts);
      await new Promise((resolve, reject) => {
        const off = loader.on('state', () => { off(); resolve(); });
        setTimeout(() => reject(new Error(`No event with code ${this.opts.code}`)), 15000);
      });
      if (loader.channel) loader.sb.removeChannel(loader.channel);

      if (loader.event.owner !== session.user.id) {
        this.fail('That event belongs to somebody else');
        return;
      }

      this.store = new SupabaseStore(this.sb, loader.event, loader.state);
      this.race = new RaceState(this.store);
      this.race.subscribe((s) => {
        this.state = s;
        this.handlers.state.forEach((f) => f(s));
      });

      // The sign-in queue, which is the one thing here the console does not author. A
      // phone calls driver_register and a row appears; without this the card on the race
      // page stayed empty for ever and Accept changed nothing anybody could see.
      this.event = loader.event;
      this.sb.realtime.setAuth(session.access_token);
      await this.pullRegistrations();
      this.watchRegistrations();
      // Incident reports from the driver app. Polled rather than subscribed: they are rare,
      // and a missed Realtime message would leave one waiting unseen.
      await this.pullIncidents();
      clearInterval(this.incTimer);
      this.incTimer = setInterval(() => this.pullIncidents(), 5000);

      document.documentElement.classList.remove('disconnected');
      this.handlers.open.forEach((f) => f());
      this.race.emit();

      /*
       * A tick, for the same reason the server has one.
       *
       * Some things become true because time passed rather than because anybody did
       * something: a yellow lifts once the track has been clear for a few seconds, and the
       * predicted running order moves as cars cover ground. Without this the race would sit
       * on a yellow until the next lap crossing happened to wake it up.
       *
       * It costs nothing on the wire. The state only reaches the database when a value
       * actually changed, and between crossings almost nothing does.
       */
      clearInterval(this.tick);
      this.tick = setInterval(() => {
        const r = this.race.state.race;
        if (!r.startedAt) return;
        if (!['green', 'yellow', 'red', 'formation'].includes(r.status)) return;
        this.race.emit();
      }, 1000);

    } catch (err) {
      this.fail(err.message || String(err));
    }
  }

  fail(message, goto) {
    document.documentElement.classList.add('disconnected');
    this.handlers.close.forEach((f) => f());
    console.error('[race control]', message);
    // The operator is about to run a session. A console that quietly shows nothing is worse
    // than one that says why, so this is not left to the console log alone.
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;inset:0 0 auto 0;z-index:9999;padding:14px 18px;'
      + 'background:#b3001b;color:#fff;font:600 15px/1.4 Inter,system-ui,sans-serif';
    bar.textContent = message;
    document.addEventListener('DOMContentLoaded', () => document.body.append(bar));
    if (document.body) document.body.append(bar);
    if (goto) setTimeout(() => location.replace(goto), 2000);
  }

  // ---------------------------------------------------------------- the queue

  /**
   * The whole list, each time.
   *
   * A sign-in arrives once a night at most, so there is nothing to save by tracking
   * individual rows, and a full read cannot get out of step the way a stream of patches
   * can after one dropped message.
   */
  async pullRegistrations() {
    const { data, error } = await this.sb.from('registrations')
      .select('*').eq('event_id', this.event.id).order('created_at', { ascending: true });
    if (error) { console.error('[race control] sign-ins:', error.message); return; }

    /*
     * A row the console is still writing keeps whatever the console decided.
     *
     * Accepting somebody takes two statements — the car, then the queue row that points
     * at it — and a change arriving from another phone in between would otherwise read
     * the half-written truth back and put the driver returned to pending on screen.
     */
    const local = new Map((this.race.state.registrations || []).map((r) => [r.id, r]));
    const rows = (data || []).map((r) => {
      const held = this.pending.has(r.id) ? local.get(r.id) : null;
      return {
        id: r.id,
        accountId: r.account_id,
        nick: r.nick,
        num: r.num,
        team: r.team || '',
        at: new Date(r.created_at).getTime(),
        status: held ? held.status : r.status,
        driverId: held ? held.driverId : r.driver_id,
        // Present once the league migration has run; absent (undefined) before it.
        checkedInAt: r.checked_in_at ? new Date(r.checked_in_at).getTime() : null
      };
    });
    // Rows this console removed but has not finished deleting stay off the list either way:
    // they are gone locally, and a pull that still sees them must not put them back.
    this.race.apply({ type: 'registration.sync', rows: rows.filter((r) => !this.gone.has(r.id)) });
  }

  watchRegistrations() {
    if (this.regChannel) this.sb.removeChannel(this.regChannel);
    this.regChannel = this.sb.channel(`queue:${this.event.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'registrations',
          filter: `event_id=eq.${this.event.id}` },
        () => this.pullRegistrations())
      .subscribe();
  }

  /**
   * Accept, refuse or forget a sign-in, against the database rather than only on screen.
   *
   * The order matters and is the reason this is not left to the diffing store: the queue
   * row points at a car by foreign key, so the car has to exist first. Applying the action
   * locally creates it, waiting on the store puts it in Postgres, and only then does the
   * row get to say which car it became.
   */
  async writeRegistration(type, id) {
    const r = (this.race.state.registrations || []).find((x) => x.id === id);
    if (!r) return;

    this.pending.add(id);
    this.race.apply({ type, id });
    const after = (this.race.state.registrations || []).find((x) => x.id === id);

    try {
      // Not the debounced save. RaceState waits up to 400ms before writing, and the queue
      // row about to be written points at the car by foreign key: send it late and the
      // update is rejected for naming a driver that is not there yet.
      this.race.writeNow();
      await this.store.chain;
      let error = null;
      if (type === 'registration.remove') {
        this.gone.add(id);
        ({ error } = await this.sb.from('registrations').delete().eq('id', id));
      } else {
        ({ error } = await this.sb.from('registrations')
          .update({ status: after.status, driver_id: after.driverId || null })
          .eq('id', id));
      }
      if (error) throw error;
    } catch (err) {
      // Say so. The whole point of this change is that the card used to look like it had
      // worked, and an operator who believes a driver is on the grid stops checking.
      console.error('[race control] sign-in write failed:', err.message || err);
      this.handlers.signal.forEach((f) => f('toast',
        { text: `Could not save that sign-in: ${err.message || err}` }));
      this.gone.delete(id);
    } finally {
      this.pending.delete(id);
      this.pullRegistrations();
    }
  }

  /*
   * The incident queue. The table arrives with the league migration; before it has been run
   * the read fails, and the queue simply stays empty rather than showing an error on every
   * poll.
   */
  async pullIncidents() {
    if (!this.sb || !this.event || this.noIncidents) return;
    const { data, error } = await this.sb.from('incident_reports')
      .select('id,from_nick,from_num,against_num,lap,text,status,created_at')
      .eq('event_id', this.event.id).order('created_at', { ascending: false }).limit(100);
    if (error) {
      if (/incident_reports|does not exist|schema cache|42P01|PGRST20/i.test(error.message || '')) this.noIncidents = true;
      else console.error('[race control] reports:', error.message);
      return;
    }
    this.heldIncidents = this.heldIncidents || new Map();
    this.race.apply({ type: 'incident.sync', rows: (data || []).map((r) => ({
      id: r.id, at: new Date(r.created_at).getTime(), fromNum: r.from_num, fromName: r.from_nick,
      againstNum: r.against_num, lap: r.lap, text: r.text,
      status: this.heldIncidents.get(r.id) || r.status
    })) });
  }

  async writeIncident(id, status) {
    this.heldIncidents = this.heldIncidents || new Map();
    this.heldIncidents.set(id, status);
    this.race.apply({ type: 'incident.set', id, status });
    const { error } = await this.sb.from('incident_reports').update({ status }).eq('id', id);
    this.heldIncidents.delete(id);
    if (error) {
      this.handlers.signal.forEach((f) => f('toast', { text: `Could not save that report: ${error.message}` }));
      this.pullIncidents();
    }
  }

  /** Every action the console already sends, applied to the state that understands them. */
  action(type, extra = {}) {
    if (!this.race) return;
    if (type === 'incident.set') { this.writeIncident(extra.id, extra.status); return; }
    // Three of the fifty six do not belong to the timing state: they are the operator
    // answering a request that lives in its own table.
    if (type === 'registration.approve' || type === 'registration.reject'
        || type === 'registration.remove') {
      this.writeRegistration(type, extra.id);
      return;
    }
    this.race.apply({ type, ...extra });
  }

  /**
   * Nothing here, and it says so.
   *
   * On the socket bus this carried the list of connected pages, a demo trigger and the
   * WebRTC handshake for capturing from a phone. None of them are state, none survive a
   * page reload, and none are worth a metered Realtime broadcast.
   *
   * The console hides the controls that depend on them (see hostedMode in panel.js), so
   * nothing should reach here. If something does, it is a control that was missed, and a
   * message on screen is how that gets found — a silent return is how the capture node
   * button spent a week looking like it worked.
   */
  signal(channel) {
    if (this.told && this.told.has(channel)) return;
    (this.told = this.told || new Set()).add(channel);
    console.warn('[race control] no signal channel on a hosted event:', channel);
    this.handlers.signal.forEach((f) => f('toast',
      { text: 'That control needs the broadcast server, which a hosted event does not have.' }));
  }

  raw() { /* the socket protocol has no meaning here */ }
}
