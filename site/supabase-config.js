/*
 * Supabase project settings for the whole site.
 *
 * The landing page, the sign in page, the dashboard, race control and every overlay read
 * this one file, so there is a single place where the project is named and no second copy
 * to go stale.
 *
 * The anon key belongs in the browser. It is a public key by design and carries no
 * authority of its own; what a signed in user may read or write is decided by row level
 * security policies on the tables, not by hiding this string. The service_role key is the
 * one that must never appear here or anywhere else a browser can reach.
 *
 * This must name the same project the driver app was built against, in
 * android/supabase.properties. When the two drift apart nothing errors: phones sign in
 * against one database and the operator reads another, so the sign in queue looks empty.
 */
window.FRL_SUPABASE = {
  url: 'https://mtagkpblakgcdovzqbut.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10YWdrcGJsYWtnY2RvdnpxYnV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MzM5NzQsImV4cCI6MjEwNDQwOTk3NH0.J_cYZTiXcwYKPqBavO4bNJMziAXJYAv3fHjqd8Hu8TM'
};
