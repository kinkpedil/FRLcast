#!/usr/bin/env bash
#
# Assemble everything Vercel should serve.
#
# The landing page lives in site/, the overlays live in public/ because that is what the
# broadcast server serves. Deploying the repository root instead would put data/state.json,
# with the whole league's timing in it, on a public URL, so the two are brought together
# here rather than by pointing Vercel at the top of the tree.
#
# Run before `vercel`. Safe to run repeatedly.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

echo "==> overlays"
rm -rf "$HERE/overlay" "$HERE/js"
cp -r "$ROOT/public/overlay" "$HERE/overlay"
cp -r "$ROOT/public/js" "$HERE/js"

rm -f "$HERE/overlay/README.md"

echo "==> race control"
# The console page and its stylesheet. It runs against a hosted event when opened with
# ?event=CODE, and against a server on the operator's own machine without one.
cp "$ROOT/public/index.html" "$HERE/console.html"
# The post-race report. A page for people who were not watching, so it is linked from
# outside the broadcast and needs no login: the timing it prints is already public.
cp "$ROOT/public/report.html" "$HERE/report.html"
# The live public timing page — same idea as the report, but it updates during the race.
cp "$ROOT/public/live.html" "$HERE/live.html"
# The operator control-room / multiview page.
cp "$ROOT/public/multiview.html" "$HERE/multiview.html"
# The version the hosted console shows in its sidebar (js/update-panel.js). Run from the
# root so node gets a relative path: a Git Bash /d/... path means nothing to Windows node.
( cd "$ROOT" && printf '%s' "$(node -p "require('./package.json').version")" ) > "$HERE/app-version.txt"
rm -rf "$HERE/css"
cp -r "$ROOT/public/css" "$HERE/css"

echo "==> driver app"
if [ -f "$ROOT/android/FRLDriver.apk" ]; then
  mkdir -p "$HERE/dl"
  cp "$ROOT/android/FRLDriver.apk" "$HERE/dl/FRLDriver.apk"
  echo "    $(du -h "$HERE/dl/FRLDriver.apk" | cut -f1)"
else
  echo "    no APK built yet, leaving the one already there"
fi

echo "==> busting module caches"
#
# OBS's Browser Source caches by URL and never asks again. The overlay HTML already carries
# a version query on its entry script, but ES `import` specifiers inside the JS did not — so
# `overlay.js?v=N` was refetched while the `cloudbus.js`, `shared.js`, `timing.js` it imports
# stayed frozen at whatever OBS first downloaded. A fix that lived in an imported module never
# reached the broadcast. It bit twice; now every deploy stamps the WHOLE module graph with one
# fresh version, so a Refresh (or just an OBS restart) always pulls the current code.
#
# One version for the whole deploy: every specifier resolving to the same URL means the
# browser keeps one instance of each module, so this cannot split a module in two.
VER="$(date +%Y%m%d%H%M%S)"
echo "    v=$VER"
# 1) Relative module imports in every copied .js:  from '../js/x.js' -> from '../js/x.js?v=VER'
find "$HERE/js" "$HERE/overlay" -name '*.js' -type f -print0 \
  | xargs -0 sed -ri "s#(from '(\.\.?/)[^']*\.js)'#\1?v=$VER'#g; s#(import\('(\.\.?/)[^']*\.js)'#\1?v=$VER'#g"
# 2) Entry scripts in the HTML:  overlay.js?v=liveN (or unversioned .js) -> ?v=VER
find "$HERE" -maxdepth 2 -name '*.html' -type f -print0 \
  | xargs -0 sed -ri "s#(src=\"[^\"]*\.js)(\?v=[^\"]*)?\"#\1?v=$VER\"#g"
# 3) The stamp the overlay polls to notice a new deploy and reload itself (see overlay.js).
printf '%s' "$VER" > "$HERE/version.txt"

echo "==> checking vercel.json"
#
# Vercel rejects any key its schema does not know, including the "//" that JSON has no
# other way of carrying a comment in. It fails at deploy, after everything else has been
# assembled, so it is caught here where the fix is thirty seconds away.
node -e '
  const cfg = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const bad = [];
  (function walk(v, path) {
    if (!v || typeof v !== "object") return;
    for (const k of Object.keys(v)) {
      if (k.startsWith("//")) bad.push(path + "/" + k);
      walk(v[k], path + "/" + k);
    }
  })(cfg, "");
  if (bad.length) {
    console.error("    STOP: vercel.json has keys its schema will refuse: " + bad.join(", "));
    process.exit(1);
  }
  console.log("    valid JSON, no stray keys");
' "$HERE/vercel.json"

echo "==> checking the config"
#
# The one mismatch that costs an evening.
#
# Nothing errors when the website and the driver app name different projects. Phones sign
# in against one database, the operator reads another, and the sign-in queue is simply
# empty: no request fails, no console message appears, and the obvious conclusion is that
# the app is broken. It happened once, so it is checked here rather than remembered.
SITE_URL="$(grep -m1 "url:" "$HERE/supabase-config.js" | grep -oE "https?://[^'\"]*" | head -1)"
APP_URL="$(sed -n 's/^SUPABASE_URL=//p' "$ROOT/android/supabase.properties" 2>/dev/null | head -1)"

if [ -z "$SITE_URL" ]; then
  echo "    supabase-config.js is still empty."
  echo "    The landing page and overlays will work, but sign-in and hosted events will not."
elif echo "$SITE_URL" | grep -qE '127\.0\.0\.1|localhost'; then
  echo "    STOP: supabase-config.js points at $SITE_URL"
  echo "    That is a Supabase running on this machine. Deployed, no visitor can reach it."
  exit 1
elif [ -n "$APP_URL" ] && [ "$SITE_URL" != "$APP_URL" ]; then
  echo "    STOP: the website and the driver app name different projects."
  echo "      site/supabase-config.js   $SITE_URL"
  echo "      android/supabase.properties  $APP_URL"
  echo "    Drivers would register into one and never appear in the other."
  exit 1
else
  echo "    $SITE_URL, same project as the app"
fi

echo
echo "ready. deploy with:  cd site && vercel --prod"
