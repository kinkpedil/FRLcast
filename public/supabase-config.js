/*
 * Empty on purpose.
 *
 * The broadcast server serves this file so the console and the overlays can ask for it
 * without a 404, and finding it empty is how they decide they are talking to a server on
 * this machine rather than to a hosted event.
 *
 * The deployed copy of this file, in site/, carries the real project. This one never
 * should: it would point a locally served page at the cloud.
 */
window.FRL_SUPABASE = { url: '', anonKey: '' };
