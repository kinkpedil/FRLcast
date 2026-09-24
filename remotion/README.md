# FRLcast recap video (Remotion PoC)

A proof of concept: render a race recap video (MP4) from event data, in the FRLcast look.
This is offline video generation, separate from the live OBS overlays. It has its own
dependencies so it never touches the server's `node_modules`.

## What it makes

A 20 second, 1080p recap: intro title card, animated podium, final standings, winner outro,
with the `FRLcast by kinkpedil12 · frlcast.my.id` credit throughout.

## Run it

```bash
cd remotion
npm install
npm run studio     # preview + scrub in the browser (Remotion Studio)
npm run render     # writes out/recap.mp4
```

The first render downloads a headless Chrome shell once.

## Where the data comes from

`src/data.ts` holds the `RecapData` shape (event header + drivers) and sample data. It mirrors
what FRLcast already has, so wiring it to a real event later means filling `RecapData` from the
hosted event (the `results` table + standings) or the local server's state, and passing it as
the composition's `data` prop, no change to the composition itself.

## Status

PoC only. Not wired to live data, not part of the Vercel deploy, not bundled in the desktop
download. Kept in the repo so the approach can be evaluated before committing to it. Note
Remotion's licence: free for individuals and teams up to three people (fine for a solo
operator), paid above that.
