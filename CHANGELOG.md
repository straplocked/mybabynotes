# Changelog

User-visible changes to the app, the API, and the images, newest first. The Home Assistant add-on
keeps its own log in [deploy/ha-addon/CHANGELOG.md](deploy/ha-addon/CHANGELOG.md), because Home
Assistant renders that one in the add-on store.

## 1.5.0 — 2026-09-15

Fixing a sleep that was timed late no longer means re-entering it.

### Added

- **Start a timer "15m ago".** The timer usually gets started after the baby is already down, so the timer sheet now keeps the time row: −5/−15/−1h, or tap the time, and the timer runs from then. It works for nursing, pumping, sleep, and tummy time. The start can't be in the future and reaches back a day at most.
- **A sleep's end time is editable on its own.** Sleep and tummy time entries show "Ended 6:10 AM" under the start. Picking it keeps the start and changes the duration, which fixes a timer that ran on after the baby woke.
- **Integrations can backdate timers too.** `PUT /api/v1/timer` accepts `started_at` (epoch ms), the MCP `start-timer` tool takes `minutes_ago` or `started_at`, and the MQTT `timer_start` command takes either, so a Home Assistant automation can start a sleep timer from ten minutes back. The internal `POST /timer/start` takes `started_at` as well. All of them clamp to now and a day back.

### Changed

- **Moving a sleep's start keeps its wake-up.** Picking an earlier start on a sleep or tummy time entry used to keep the duration and slide the end along with it, so correcting a late start took two edits. Now the end stays where it was and the duration grows or shrinks to fit, including across midnight. The −5/−15/−1h nudges do the same when editing, so "−15" means it began fifteen minutes earlier. A start that would stretch the session past 14 hours is read as moving the nap instead, and keeps its duration.

## 1.4.0 — 2026-09-14

Nobody is on duty unless somebody is actually covering.

### Added

- **Covers replace shifts, and nobody covering is the resting state.** The app used to insist exactly one grown-up was responsible: duty was seeded to the founding account at registration and every exit reassigned it to *someone*, so it was never unset. Two parents at home read a rota they didn't have. A **cover** is now something you switch on when that stops being true — one of you takes the night, or a grandparent sits for an afternoon — and a household that hasn't started one simply has nobody covering. New households begin there, and every ending returns there. Existing households are migrated on upgrade: stale covers left `active` by the old "no self-serve end" bug are closed first, then duty is cleared for anyone who isn't genuinely mid-cover. A household where someone *is* covering right now keeps its holder — this resets a default, it doesn't interrupt anybody's afternoon.
- **A parent can put someone on cover directly.** "Gran is covering until 4" starts on the spot, with the plan and a note, and no acceptance step — by the time you've reached for the phone she's already holding the baby, and asking a question whose answer is obviously yes is ceremony. Asking still exists for the trade that genuinely waits on a yes; the compose sheet offers both and its button says which one you're about to do. Assigning is parent-only: covering is volunteering, which any member may do, but writing duty onto somebody else's name is household-shaping.
- **A cover can be ended.** One you started yourself previously had no exit at all — hand-back needs a person to hand *to* — so its row sat open forever and no summary was ever produced for it. "End my cover" closes it and returns duty to nobody. A parent can also close one somebody forgot to end, which is the grandma-left-at-four case.
- **A named "until" now ends the cover, not just the conversation.** It warns both people when the time passes, then closes the cover a quarter of an hour later and hands duty back to nobody. "Grandma until 4" has to end at 4 without anyone acting at 4. Quiet hours silence the warning but never the ending — a cover that expires at 2am must not still be open in the morning.

### Changed

- **A running cover has one ending, not two rival verbs.** "Hand back to Sam now" and "Ask Sam to take over" sat side by side naming the same person with nothing saying which one waited — the worst confusion this app has shipped. The running-cover sheet now has a single **End my cover**, plus a neutral "Hand it to someone else" link into the compose sheet where the button spells out whether it starts now or waits. No two controls name the same person; a test pins that.
- **"Only while I'm on duty" became "Mute while someone else is covering"**, which is what it always did — reminders were only ever suppressed when *another* member held duty, so with nobody covering they reach everybody.
- The vocabulary moved from shift / handoff / on-duty to **cover** throughout the app and its push copy, in all 15 languages. **The wire didn't**: `/shifts/*`, `onDutyUserId`, the notification preference keys and the Home Assistant `on_duty` sensor keep their old names, because installed phones hit the new server before their own code updates and published dashboards key on that entity. `nobody` on the sensor now means "the grown-ups are sharing" rather than "shouldn't happen".

### Fixed

- Picking who to hand a cover to drew the wrong face. The compose sheet's you→them graphic was wired to the legacy "partner", so choosing the caregiver still showed your co-parent above their name.
- Removing a member who held duty no longer puts the person who removed them in charge; duty returns to nobody.
- The server catalog check only ever spot-checked a single string, so a vocabulary sweep could have shipped with half the languages missing their new push copy. It now compares every key, and every `:placeholder` inside it, against the English reference.

## 1.3.0 — 2026-09-14

History stops being a fixed screen and starts reflecting the household reading it.

### Added

- **History draws the charts you care about.** History had exactly two bar charts, both hardcoded: feeds per day, and diapers per day for anyone who tracks diapers. A **History charts** picker in Settings — beside the Now-cards one, parents only — now chooses from feeds, sleep, diapers, pump, tummy time, bath and meds. Nobody's screen changes until they choose: an empty pick still draws feeds and diapers, exactly what History always drew. A chart can't outlive the tracker it depends on. Sleep is the one chart that isn't a count — it totals hours, so three naps read as "2h" where a row count would have said "3" — and a nap counts toward the day it *started*, which is the same day its drill-down opens.
- **History names the nap your days keep agreeing on.** A card reads, for example, "Naps around 12:05 PM most days · On 5 of the last 7 days Riley went down between 11:58 AM and 12:20 PM, for about 2h." It clusters nap *start* times within ±45 minutes across the last 7 days, one nap per day, and needs three separate days before it says anything at all. Only the strongest cluster renders, and the length clause is dropped when the cluster's naps don't agree on one — 25m one day and 3h the next has no typical. Overnight sleep is left out on purpose: it's the most regular sleep there is and would win the card every time. No honest pattern, no card.
- **History says when the feeds tightened, and when they went back.** A 7-day average hides exactly the thing worth noticing — 4h that became 2h reads as "roughly every 3h". A card now reports the change instead, comparing the last 24h against a 72h–7d baseline on medians so one late feed is not a trend. Tighter by 30% and half an hour names cluster feeding as a likely, normal reason; coming back within 15% of the baseline after a genuinely tighter spell says so too. Never both, and nothing at all on a steady week.

### Changed

- **History's header counts what you picked.** It used to insist on "48 feeds · 33 diapers logged" over a screen you had deliberately swapped diapers out of. It now tallies whatever charts the household chose, with sleep in hours like its chart.
- **Resume rides the most recent sleep, not the newest entry.** Stopping a sleep timer, feeding the baby, then wanting to put them back down for the same nap used to lose the Resume button at exactly the moment it was needed. It now survives whatever has been logged since, and ends on the clock instead: once the baby has been awake longer than the upper bound of their age-typical wake window, the next sleep is a new nap. A newer sleep still takes the button over, a running sleep timer still blocks it, and an unsynced row still can't be resumed.
- Sum bar charts round to one decimal. "10h 32m" needs about 52px where seven bar labels leave about 40px, so every sleep label wrapped to two lines and shortened every bar to pay for it. The exact figure is one tap away in the day view.

### Fixed

- The Hindi nap-pattern line no longer assumes the baby is a boy. "सोए" agrees with the child, so the sentence picked a gender the app never knows; Hindi now makes the nap the subject and agrees with झपकी, which is what the other gendered-language catalogs (ur/mr/bn/ru) already did.

## 1.2.1 — 2026-09-11

**1.2.0 carried this same app code but never published.** Its release build stalled in the
all-in-one image's emulated arm64 leg — 2h35m, then 30+ minutes on a re-run, against a normal
11 minutes — so no release, no `:latest`, and nothing to update to. 1.2.1 is that code plus the
build fix below.

### Added

- **Resume a sleep.** A baby who stirs for a few minutes and settles again used to cost two rows — stop the timer, start another — for what was one nap. The newest sleep entry now carries a **Resume** button: the timer picks back up from where that nap began, and stopping it rewrites that same entry with the whole span (Nap/Night tag and author kept) instead of stacking a second one. The link lives on the server (`POST /api/timer/resume`, `resumes` on the running timer), so either phone can end the session correctly. Offered only while that sleep is still the newest thing logged for the child on screen, and never beside a sleep timer that's already running.

### Fixed

- The all-in-one image's PWA and Composer stages are now pinned to the **build** platform (`FROM --platform=$BUILDPLATFORM`). That image goes multi-arch for HAOS boxes, and without the pin buildx ran the whole Vite build and Composer install a second time under arm64 emulation to produce a `dist/` and a `vendor/` that are byte-identical either way. Nothing about the published images changes — the same artifacts land in both architectures — but the release build no longer does the slowest work twice.

## 1.1.0 — 2026-09-11

### Security

A code audit on 2026-09-11 drove one batch of fixes, most severe first. See
[SECURITY.md](SECURITY.md#fixed-issues) for the one that warrants action from you.

- A personal access token minted from Settings → API access could call the PWA's own `/api/*` routes (state, invites, membership, settings, the MQTT broker config, the household websocket channel) regardless of the scopes it was minted with; every unversioned route now requires a first-party login token, and a token with any scope set gets 403 outside `/api/v1` and `/mcp`.
- `POST /api/push/subscribe` accepted any URL as a push endpoint, so a signed-in user could make every later household write POST an encrypted request at an address of their choosing, including LAN and loopback ones; endpoints must now be public `https://` URLs that neither are nor resolve to a private, loopback, link-local, CGNAT or multicast address.
- In the all-in-one image, a client-supplied `X-Forwarded-For` reached Laravel unchanged, so anyone could give themselves a fresh login/register/forgot-password throttle bucket per request; nginx now overwrites that header (and `X-Forwarded-Proto`) on every path into php-fpm, matching what the compose stack's front already did.
- nginx now enforces a `Content-Security-Policy` on every response (`default-src 'self'`, the one inline script allowed by hash, Google Fonts as the only third-party origins, `object-src 'none'`, `frame-ancestors 'self'`), which is the mitigation that matters for the bearer token kept in `localStorage`.
- The password-reset email linked to `?reset=<token>`, which lands the token in reverse-proxy and nginx access logs and in `Referer` headers; the link now carries it in the URL fragment (`/#reset=…`), and the app still accepts the old form for mails already sent.
- In the all-in-one image, Reverb, the scheduler and the MQTT listener ran as root; they now run as `www-data` under supervisord, leaving only supervisord and nginx (port 80) privileged inside the container.
- Web Push sends ran inside the HTTP request that triggered them with a 10-second timeout, so a slow or hostile push endpoint could hold a partner's write; sends now go out after the response, under a 5-second per-endpoint and 15-second per-flush budget.
- The MQTT "Test connection" button echoed the driver's raw exception text (hostnames, ports, OpenSSL detail) to the client; it now reports one of three fixed messages (unreachable, credentials rejected, TLS failed) and writes the detail to the API log instead.
- The Full-log CSV export wrote member names and detail text verbatim, so a member renamed to `=HYPERLINK(...)` opened as a formula in Excel, Sheets or LibreOffice; free-text cells that open with `=`, `+`, `-`, `@`, tab or CR are now prefixed with an apostrophe before quoting.
- Responses for `/assets/*` and `/sw.js` were missing `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`, because a location-level `add_header` in nginx replaces the server-level set; both nginx configs now repeat the security headers in those locations.

### Changed

- The compose stack's API (`3501`) and Reverb (`3502`) host ports bind to `127.0.0.1` instead of every interface; they exist for the Vite dev proxy, and the app container on `3500` is the only port meant to be reached from the LAN.

### Fixed

- The plain-text invite and password-reset emails were HTML-escaped, so a reset link arrived as `…&amp;email=…` and never opened the reset screen; both templates now render their text unescaped.
