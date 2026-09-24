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

## Tutorial kit (compositions: `Tutorial`)

A second use: wrapping a screen recording into a proper usage tutorial in the FRLcast look.
`src/tutorial/TutorialKit.tsx` has the reusable pieces (intro card, step lower-third, callout
arrow + highlight, caption band, progress bar, outro) and `src/tutorial/Tutorial.tsx` assembles
a demo segment from them. The narration/steps follow `docs/TUTORIAL-SCRIPT.md` (the naskah).

To use your own OBS recording:

1. Record the screen with OBS at 1920x1080, 30fps.
2. Put the file at `remotion/public/recording.mp4` (Remotion reads it with `staticFile`).
3. In `src/Root.tsx`, set the `Tutorial` composition's `recordingSrc` to `'recording.mp4'`,
   and adjust `durationInFrames` if your recording is longer (also bump `BODY` in `Tutorial.tsx`).
4. Edit `STEPS` and `CALLOUTS` in `src/tutorial/Tutorial.tsx` to match the moments in your
   recording (frame numbers are at 30fps, relative to when the screen section starts).
5. `npx remotion studio` to scrub and line the labels up, then
   `npx remotion render src/index.ts Tutorial out/tutorial.mp4`.

Without a recording it renders a placeholder screen, so you can design the labels first. The
demo is 16:9 for YouTube; for Shorts/Reels change the `Tutorial` composition to 1080x1920.

## Status

PoC only. Not wired to live data, not part of the Vercel deploy, not bundled in the desktop
download. Kept in the repo so the approach can be evaluated before committing to it. Note
Remotion's licence: free for individuals and teams up to three people (fine for a solo
operator), paid above that.
