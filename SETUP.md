# Putting FRL Broadcast online

Forty minutes, no card, no bill. Two accounts, two migrations, one deploy.

Nothing here changes how your league runs today. The broadcast server on your laptop keeps
working exactly as it does now, and both the driver app and the overlays talk to whichever
one you point them at.

---

## What you are building

```
Landing page  ->  Sign in          ->  Driver app
Overlays          (Vercel)             (event code)
(Vercel)               |                    |
                       +-- Supabase --------+
                           Postgres, Auth, Realtime
```

Free tier on both. You cannot be billed on Supabase Free or Vercel Hobby: there is no card
and no overage. Exceed a limit and you get throttled, not invoiced.

---

## 1. Supabase, about ten minutes

1. Sign up at **supabase.com** and create a project. Pick the region closest to your
   drivers: **Southeast Asia (Singapore)** for an Indonesian league.
2. Choose a database password and keep it somewhere. You will rarely need it and you
   cannot recover it.
3. Wait for provisioning, about two minutes.

### Load the schema

Open **SQL Editor**, then **New query**. Paste the contents of each file and run it:

1. `supabase/migrations/20260908000000_init.sql`
2. `supabase/migrations/20260908010000_timing.sql`
3. `supabase/migrations/20260908020000_team.sql`

The first creates the tables, the security policies, and the four functions a driver's
phone signs in through. The second adds the timing columns. The third adds the team a
driver types on their phone, and replaces the two sign-in functions with versions that
carry it.

Both are safe to run again. If you are unsure whether one worked, run it a second time:
nothing happens twice.

With the Supabase CLI you can skip the copying entirely:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### Check it landed

Paste `supabase/check.sql` and run it. You are looking for three things:

- every row says `ok`, none say `MISSING`
- every table says row level security is `on`
- the last line says `driver_accounts is unreachable through the API`

Anything marked `MISSING` means that migration did not finish. Run it again.

### Copy your keys

**Project Settings**, then **API**. Two values:

- **Project URL**, like `https://abcdefgh.supabase.co`
- **anon public** key, a long string starting `eyJ`

The anon key goes into the website and into the phone app. That is correct: it is a public
key by design and grants nothing on its own. What a signed-in person may read or write is
decided by the policies you just loaded.

The **service_role** key on that same page bypasses every policy. Never put it in the
website, the app, or anywhere a browser can reach.

---

## 2. The website, about fifteen minutes

### One config file

Open `site/supabase-config.js` and fill in both values:

```js
window.FRL_SUPABASE = {
  url: 'https://abcdefgh.supabase.co',
  anonKey: 'eyJ...'
};
```

The landing page, the sign-in page and every overlay read this same file. There is nothing
else to configure.

### Assemble and deploy

The landing page lives in `site/`, the overlays live in `public/` because that is what the
broadcast server serves. One script brings them together:

```bash
bash site/prepare.sh
```

Then:

```bash
npm i -g vercel
cd site
vercel
```

Answer **no** when it asks about a framework. `vercel --prod` publishes properly. You get a
URL like `frl-broadcast.vercel.app`.

Run `prepare.sh` again before every deploy: it re-copies the overlays and the latest driver
APK.

> Do not point Vercel at the top of the repository instead. `data/state.json` holds your
> whole event and would be downloadable by anyone who guessed the path.

### Language

The landing page, the sign-in page and the dashboard come in English and Indonesian. The
switch is the **ID / EN** pair at the left of the header on each of them; the choice is kept
in the browser, and a first-time visitor gets Indonesian if that is what their browser asks
for. `?lang=id` on any of those addresses forces one, which is what to send somebody when
you share a link.

The operator console has the same switch, under the brand in its sidebar, and remembers the
same choice: pick Indonesian on the landing page and race control opens in Indonesian.

The **manual** on the Help page switches with everything else. It carries its own
translations rather than going through the dictionary: its blocks are paragraphs and table
rows, and a sentence-keyed lookup is the wrong tool for those. Both languages sit side by
side on every block, so one cannot quietly drift from the other.

The **overlays** are the one thing left in English. They are read by an audience that never
chose a language and cannot press a switch on a video.

Live race text is never translated either — the event log, driver names, the reason you
typed on a penalty, the names of your network adapters. That is your data, and a driver
called "Copy" should not turn into something else mid-race.

If you edit the English anywhere, its Indonesian stops matching and that one sentence
quietly stays English. Open the page with `?i18n=debug` and the browser console lists
exactly which sentences have no Indonesian yet; `FRL_I18N.missing()` hands back the same
list as an array, which is easier to read when there are ninety of them.

### Make your account

Visit `/login` on your new URL and create your operator account. If sign-up asks for email
confirmation, turn it off while testing under **Authentication, Providers, Email**.

---

## 3. Your first event, about five minutes

Sign in, and you land on **/dashboard**. Fill in the name, pick a code, press
**Create event**.

The **code** is what drivers type into the app and what the overlays take in their URL.
Keep it unambiguous: no letter O next to a zero.

Each event on that page gives you three things: a button into race control, the overlay URL
to paste into OBS, and the driver sign-in queue. Somebody registering on their phone appears
there without a refresh.

---

## 4. Race control

The **Open race control** button on each event opens the console against that event. It is
the same console you run locally, pointed at the hosted room instead of at a server on your
machine: flags, laps, penalties, the grid and the championship all write straight to the
event, and the overlays follow.

The **Driver sign-ins** card on the race page works there too, so you can accept somebody
who turns up late without leaving race control. Accepting puts them on the grid and starts
their flags, exactly as it does on the dashboard — the two are the same queue.

The overlay preview and the layout editor show the hosted event, and the OBS addresses on
the **OBS setup** page already carry the event code, so they can be copied straight into a
Browser Source.

`npm start` and `http://localhost:4700` still work exactly as before, for a league that is
not hosted.

---

## 5. Overlays in OBS, about five minutes

Add a **Browser** source:

```
https://your-site.vercel.app/overlay/all.html?event=NDL3
```

Set it to **1920 x 1080** and leave **Shutdown source when not visible** unticked, so it
stays connected between scenes.

### The race report

```
https://your-site.vercel.app/report.html?event=NDL3
```

Not a Browser Source — a page for the people who were not watching. Winner and margin,
fastest lap, every steward decision with the reason race control typed, who gained the most
places, and where the championship stands with this round counted. **Copy for Discord** on
that page hands you the text rather than a screenshot, so a driver can search for their own
name in the channel six weeks later.

It needs no login: the timing on it is already public, because it was being broadcast.

Every event on the **dashboard** carries a **Race report** button and its address, beside
the button into race control. In the console itself it lives on the **Championship** page,
next to the table it reports on.

Two things it will not do, on purpose. It will not name a biggest mover when no starting
grid was set — there is no honest way to know who gained. And it labels itself
**provisional** until the race is flagged finished, so nobody pastes a result that is still
moving.

### Broadcast skin

Two looks for the same overlays, chosen on the **Layout** page under **Broadcast skin**:

- **Classic** — the original look. The default; nothing changes unless you switch.
- **MotoGP** — reshapes the widgets into the tilted-number-chip tower style: the driver's
  number sits in a skewed coloured chip on the right, names go uppercase, headings turn hard
  italic, and an orange-to-red accent runs under them.

The skin only changes *shape*. The **Template** below it still sets the *colours*, so any
skin works with any of the ten themes. It is saved with the event and reaches OBS on the
next frame — no need to refresh the Browser Source.

Two elements come with the MotoGP look and also help under Classic:

- a **GAP divider** that drops between the leading group and the rest once there is a real
  break in the order (race only, and only when the gaps are measured, not predicted);
- a **flag banner** that appears across the top on a yellow, red, safety-car, VSC or
  formation flag, and clears itself when the track goes green. It shows itself — there is no
  toggle to forget — and can be repositioned on the Layout page like any widget.

### The spoken commentator

There is one more Browser Source, and it makes sound rather than pictures:

```
https://your-site.vercel.app/overlay/commentary.html?event=NDL3
```

Add it **once**. Every copy works the same lines out from the same race and would speak them
in chorus. Its audio arrives in the OBS mixer like any other source, so set its level under
the game.

Switch it on and choose how much it talks on the console's **Overlays** page. It reads the
flags, the penalties with the reason race control typed, the lead, overtakes, and — on the
busiest setting — who is likely to win, who is fighting for a podium and whose pace is
falling away. Those numbers are not guessed: the race is run forward a few thousand times
from each driver's own measured lap times, and while there are too few laps to be sure it
says so rather than quoting a figure.

Nothing is sent anywhere to produce a sentence. The page already has the race, so the
commentary costs no egress, needs no key, has no bill, and keeps working with the internet
down on a local event.

**Pick the voice.** The **Voice** list on the Overlays page holds every voice installed on
the machine running the console, and **Hear this voice** reads a sample line through the
same code the commentary uses — the pronunciation table included, so you are comparing what
you will actually get. Leave it on *Best one for the language* and the language setting
decides.

That list is the console machine's. If OBS runs somewhere else, that machine needs the same
voice installed; when it does not, the overlay falls back to the best voice it has for the
language and says which one it could not find.

**The words follow the voice.** Windows does not ship an Indonesian voice. Ask for
Indonesian on a machine that has not got one and the commentary is spoken *and written* in
English, because Indonesian read by an English voice is not a worse accent — it is
unintelligible. The Overlays page says which voice it found and which language it is
therefore writing in.

To get Indonesian, on the machine running OBS:

1. **Settings**, **Time & language**, **Language & region**, **Add a language**
2. Pick **Indonesian (Indonesia)**. On the options page make sure **Speech** is ticked —
   the display language on its own installs no voice.
3. Install, then **restart the browser and OBS**. Voices are read once at start-up.
4. Confirm under **Settings**, **Time & language**, **Speech**, where the new voice appears
   in the list, and on the console's **Overlays** page, which will name it.

Teach it any name it will mangle while you are there. The **How to say a name** box takes
one per line, `written = spoken`, and applies everywhere that name is read out.

The other overlays are separate pages if you would rather place them yourself:
`leaderboard.html`, `tower.html`, `gap.html`, `lowerthird.html`, `results.html`,
`trackmap.html`, `standings.html`, `grid.html`, `h2h.html`, `battle.html`, `bracket.html`,
`status.html`.

Leave `?event=` off entirely and the page talks to the broadcast server on your laptop,
exactly as it does today.

---

## 6. The driver app, about five minutes

```bash
cd android
cp supabase.properties.example supabase.properties
```

Put the same two values in it, then:

```bash
bash build.sh
```

The build writes them into the app and prints the project it used. Then
`bash site/prepare.sh` picks up the new APK, and your next deploy serves it from
`/dl/FRLDriver.apk`.

A driver opens the app and types:

- **Event code or server**: `NDL3`
- **Race number** and **password**: theirs to choose the first time
- **Team**: optional, and the reason it is on the sign-in screen as well as the
  registration one is that it is the detail that changes between rounds. Accepting the
  sign-in puts it on their car, so nobody in race control types a team list by hand.
  Leaving it empty changes nothing; it never clears a team already set.

That field wants the **code**, not the website address. The website has no event in it, and
the app now says so instead of spending a timeout looking for a broadcast server on it.
Pasting a link that carries one — the OBS URL, the race control URL — works, because the
code is in the query string.

They tap **Create account**, and their name appears in your sign-in queue. Until you accept
it they get no flags, and the app says so rather than sitting silent.

---

## What is not finished

Be clear-eyed about this before your next race night.

**The commentator's voice is the browser's own.** It is free, offline and needs no key,
and it sounds like it. Everything above the engine — what is worth saying, in what order,
and what to drop when the race has moved on — is separate from the part that makes the
sound, so a paid voice could be put underneath it later without changing a sentence. That
would mean a key, a server to hold it, and a bill.

**Three things still need the broadcast server.** Capturing from a second machine, the
`/api/lap/` trigger, and the rehearsal button on the overlay page all went through the
server's socket, and a hosted event has no socket. On a hosted event the console says so
on each of those cards rather than accepting the click and doing nothing. The console's own
screen capture and detection work anywhere, so capture on the machine running the console.

**One console at a time.** The console holds the authoritative timing and writes it; two
open on the same event would each believe they were the only one. Open it in one tab.

**Free projects pause after a week of no activity.** A weekly league never notices. After a
month off, open the Supabase dashboard once to wake it before race day.

---

## If something is wrong

**`column ... already exists` when running a migration.** It already ran. The current
scripts are written to be repeatable, so this only happens on an older copy of them.

**The overlay is a 404.** You deployed before running `bash site/prepare.sh`, so the
overlays were never copied into `site/`.

**The overlay is blank.** Open the browser console on that source. `No event with code X`
means the code does not match the `code` column. Nothing at all usually means
`site/supabase-config.js` was still empty when you deployed.

**The app says it cannot reach the event.** Check the code matches exactly. Check
`supabase.properties` was filled in before you built: `build.sh` prints the project it
used, and prints `building for local servers only` when there is none.

**The app says that is the website address.** It is. The driver typed or pasted the site
the APK came from, which names no event. Give them the code instead, or a link with
`?event=` in it.

**A driver registers but never gets flags.** They are waiting for you. Accept them in the
sign-in queue; the app tells them that is what is happening.

**You are worried about the free tier.** The number that matters is egress, not messages.
The design sends changes only, never a heartbeat, which puts a two hour event near 4 MB
against a 5 GB monthly allowance. Watch **Reports, Usage** in Supabase for your first
couple of events.
