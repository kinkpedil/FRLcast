# FRL Broadcast site

The public landing page. Static: no build step, no framework, no dependencies to install.

```
site/
  index.html          the landing page
  login.html          Supabase sign in
  styles.css          one stylesheet, tokens at the top
  app.js              scroll reveal, the only script
  supabase-config.js  your project URL and anon key go here
  vercel.json         clean URLs and cache headers
  fonts/              Geist and Geist Mono, latin subset, self hosted
  shots/              product screenshots
  dl/FRLDriver.apk    the Android driver app
```

## Deploying to Vercel

```bash
npm i -g vercel
cd site
vercel
```

Answer "no" when it asks about a framework. Set the root directory to `site` if you are
deploying from the repository root. `vercel --prod` publishes.

## Connecting Supabase

1. Create a project at supabase.com.
2. Project Settings, then API. Copy the project URL and the `anon` `public` key.
3. Put both into `supabase-config.js` and redeploy.

The anon key belongs in the browser. It is public by design and grants nothing on its own:
what a signed in user may read or write is decided by row level security policies on your
tables. The `service_role` key is the one that must never be in this directory.

Until those two values are filled in, `/login` says so plainly rather than showing a form
that fails.

## Updating the screenshots

`shots/` holds real captures of the running product, not mockups. To refresh them, start the
server, then:

```bash
chrome --headless=new --window-size=1440,760 --force-device-scale-factor=2 \
  --screenshot=shots/dashboard.png http://localhost:4700/
```

The overlay page is transparent by design, for OBS. Capture it with
`--default-background-color=00000000` and composite it onto a dark surface, otherwise it
renders on white and looks broken.

## Updating the driver app download

`dl/FRLDriver.apk` is a copy. Rebuild the app and copy it across:

```bash
bash ../android/build.sh && cp ../android/FRLDriver.apk dl/FRLDriver.apk
```

The version string on the page is written by hand in `index.html`. Update the size next to
the download button when the app grows.

## What is not here yet

The landing page and sign in are live. The hosted dashboard behind that sign in is not: the
operator console currently runs on the operator's own machine from `server/`, holds its
state in memory and talks to overlays over a WebSocket. None of that runs on Vercel, which
gives you short lived stateless functions and no persistent socket. Moving it needs the
race state to live in Postgres and the live updates to go through Supabase Realtime, or a
long running host such as Fly.io or Railway alongside this site.
