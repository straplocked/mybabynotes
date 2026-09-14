# Changelog

## 1.4.0

- **Shifts became covers, and nobody is on duty by default.** The app no longer insists one grown-up
  is always responsible — a cover is what you start when someone actually takes over, and every
  cover ends back at "you're both on it". Existing households are migrated on upgrade; one that's
  genuinely mid-cover keeps its holder.
- **Put a sitter on cover in one tap.** A parent can hand the cover straight to a grandparent or
  caregiver with the plan and a note, no acceptance step — and a named "until" now ends the cover on
  its own rather than only pinging about it.
- **One ending, not two.** A running cover has a single "End my cover" plus a link to hand it on,
  replacing the two buttons that named the same person without saying which one waited. See the
  app's [CHANGELOG](https://github.com/straplocked/mybabynotes/blob/main/CHANGELOG.md#140--2026-09-14).
- The Home Assistant `on_duty` sensor is unchanged — it still publishes a name, or `nobody`, which
  now means the grown-ups are sharing rather than something being wrong.

## 1.3.0

- **History reflects the household reading it.** A new **History charts** picker in Settings chooses
  which bar charts History draws — feeds, sleep, diapers, pump, tummy time, bath, meds — with sleep
  counted in hours rather than rows. Until you pick, the screen is unchanged.
- **Two new cards.** History now names the nap your days keep agreeing on ("Naps around 12:05 PM most
  days"), and says when the feeds tightened — cluster feeding, and the return to normal — instead of
  hiding both inside a 7-day average. See the app's
  [CHANGELOG](https://github.com/straplocked/mybabynotes/blob/main/CHANGELOG.md#130--2026-09-14).
- Resume now survives a feed logged mid-nap, so settling the baby back down still rewrites one row
  instead of stacking a second.
- Nothing to configure, and nothing changes about the add-on's own container.

## 1.2.1

- **Resume a sleep.** A baby who stirs for a few minutes and settles again used to cost two rows —
  stop the timer, start another — for what was one nap. The newest sleep entry now carries a
  **Resume** button: the timer picks back up from where that nap began, and stopping it rewrites
  that same entry with the whole span instead of stacking a second one. See the app's
  [CHANGELOG](https://github.com/straplocked/mybabynotes/blob/main/CHANGELOG.md#121--2026-09-11).
- Nothing to configure, and nothing changes about the add-on's own container.
- Version 1.2.0 was tagged but never published — its image build stalled in the emulated arm64
  leg this add-on is built from. 1.2.1 is the same app code with that build fixed.

## 1.1.0

- Security release — the add-on runs the same all-in-one image as every other install, so it
  picks up the whole batch from the app's [CHANGELOG](https://github.com/straplocked/mybabynotes/blob/main/CHANGELOG.md#110--2026-09-11).
  Nothing to configure. The two that touch the add-on's own container:
- Reverb, the scheduler and the MQTT listener now run as `www-data` instead of root inside the
  container; only supervisord and nginx (port 80) stay privileged.
- A client-supplied `X-Forwarded-For` no longer reaches the API, so the login throttle can't be
  sidestepped by forging one. Ingress still works: Home Assistant's proxy is the direct peer.
- Every response now carries a `Content-Security-Policy`. Ingress embeds the panel on Home
  Assistant's own origin, so `frame-ancestors 'self'` behaves like the existing
  `X-Frame-Options: SAMEORIGIN` did.
- If you created a scoped API token for a third party (an MCP client on another machine, a
  dashboard), revoke and re-issue it after updating — see
  [SECURITY.md](https://github.com/straplocked/mybabynotes/blob/main/SECURITY.md#fixed-issues).

## 1.0.2

- Documentation only; the add-on itself is unchanged from 1.0.1.
- Says out loud that **Show in sidebar** has to be turned on after installing.
  Home Assistant hides the panel for every newly installed ingress add-on and
  no manifest key can change that, but the docs read as though the sidebar
  entry appeared by itself.
- Explains that opening the ingress URL directly returns `401: Unauthorized`
  by design, so it isn't mistaken for a broken install.
- Remote mode said it needed "v1.1 or newer", a version that has never
  existed. It needs **v1.0.0 or newer**.

## 1.0.1

- First installable release. 1.0.0 pushed its add-on images under a tag Home
  Assistant never asks for, so the add-on appeared in the store but the
  install failed to pull. Nothing about the add-on itself changed.

## 1.0.0

- Initial add-on: ingress UI, `local` mode (full instance on the HA box,
  state in `/data`), `remote` mode (proxy an existing instance), optional
  direct LAN port for the installable PWA.
