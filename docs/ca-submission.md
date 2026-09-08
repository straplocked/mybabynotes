# Submitting mybabynotes to Unraid Community Apps

The template is [deploy/unraid/ca-template.xml](../deploy/unraid/ca-template.xml). It consumes the
all-in-one image `ghcr.io/straplocked/mybabynotes-aio:latest` (built by
[.github/workflows/release.yml](../.github/workflows/release.yml) on `v*` tag pushes — a `main` push
does **not** build the AIO image, so `:latest` only ever moves on a tagged release).

**Status: not submitted.** Steps 1–4 below are done — releases are tagged, every GHCR package is
public and anonymously pullable, and the template has been installed and run on real Unraid
hardware. What remains is the manual part: the support thread and the submission itself.

## Pre-submission checklist

1. ~~**Publish the image.**~~ Done — `release.yml` pushes `mybabynotes-aio:vX.Y.Z` and `:latest` to
   GHCR on every `v*` tag.
2. ~~**Make the GHCR package public.**~~ Done — `mybabynotes-aio`, `-app`, `-api` and the two
   `-ha-addon-*` packages all pull anonymously. (If a *new* package name ever appears it starts
   private: GitHub → your profile → Packages → the package → Package settings → Danger Zone →
   Change visibility → Public. A private package fails with a misleading "manifest not found".)
3. ~~**Test the template on a real Unraid box.**~~ Done — installed from this template on Unraid
   7.2.4 and run against an empty data folder, which is the path a Community Apps user actually
   takes. Re-run this if the image or entrypoint changes. Copy `ca-template.xml` to
   `/boot/config/plugins/dockerMan/templates-user/` on the flash share (any filename ending
   `.xml`), then Docker tab → **Add Container** → pick it from the Template dropdown. What was
   verified, and what to verify again:
   - first boot logs `==> first boot: generating secrets into /data/.env`, then runs migrations;
   - the data folder then holds `database.sqlite` and a `0600` `.env` carrying `APP_KEY` and the
     three `REVERB_*` secrets, owned by uid 82;
   - the **WebUI** button opens the mapped port and the app loads (`/` → 200, `/api/state` → 401
     with an `Accept: application/json` header — **without** that header it 500s, which is
     long-standing behaviour and not a failed install);
   - the landing screen offers "Create an account" — on an unclaimed instance the first
     registration claims it;
   - restart reuses the secrets: `.env` is byte-identical afterwards and `first boot:` appears
     exactly once in the log, never twice.
4. ~~**Confirm the raw URLs resolve.**~~ Both are live on `main`; re-check only if either file moves:
   - `https://raw.githubusercontent.com/straplocked/mybabynotes/main/deploy/unraid/ca-template.xml`
   - `https://raw.githubusercontent.com/straplocked/mybabynotes/main/public/icons/icon-512.png`
5. **Create the support thread** on the Unraid forums (draft below) so the listing has a
   human-facing support venue alongside the GitHub issues link in `<Support>`.

## Where the template lives

CA ingests templates from a GitHub repository registered in its application feed. Two options:

- **In-repo (current setup):** register `https://github.com/straplocked/mybabynotes` as the template
  repository. CA scans the repo for `<Container>` XMLs and will find
  `deploy/unraid/ca-template.xml`; `<TemplateURL>` already points at its raw `main` URL, so edits
  land by pushing to `main`.
- **Dedicated template repo:** if the moderators prefer a templates-only repo (some do — it keeps
  their scanner away from unrelated XML), create `straplocked/unraid-templates`, copy the file in,
  and update `<TemplateURL>` to the new raw URL. Keep the copy in sync from this repo (a one-line
  step in the release checklist, or a small workflow later).

Start with the in-repo path; switch only if review feedback asks for it.

## Submission flow

1. Sign in at **https://ca.unraid.net** with your Unraid forum account and register as an
   application author.
2. Add the template repository URL (whichever option above you chose) and fill in the profile
   fields (support thread URL, donate link if any).
3. Wait for moderation. Moderators check that the image is public, the template parses, the icon
   loads, and the Overview isn't spam. Respond to feedback in the submission thread.
4. After approval the appfeed picks the template up on its next scan (a couple of hours). Search
   "mybabynotes" in CA on a test server to confirm.
5. **Ongoing:** template fixes are just pushes to `main` (the feed re-scans). App updates ship by
   tagging releases — `release.yml` owns `:latest`, so CA's "update available" tracking works
   without touching the template.

If any of the portal details have drifted (the CA account flow has moved before), the canonical
instructions are pinned in the Community Applications section of the Unraid forums — follow those
over this doc and update this doc after.

## Remote access requirement (say it everywhere)

On the LAN the container works over plain HTTP. For anything more, users need an **HTTPS reverse
proxy with websocket support** (Nginx Proxy Manager, SWAG, Caddy) pointing at the container's
mapped port, because:

- the PWA install prompt and web-push notifications only exist on HTTPS origins;
- realtime sync is a websocket at `/app` — without proxied websockets the app silently degrades to
  20-second polling;
- `APP_URL` should then be set to the public origin (template's advanced variable) so emails and
  the push VAPID subject are correct.

This is stated in the template's `<Requires>` and Overview, and belongs in the support thread's
opening post too (below).

## Support thread draft

**Forum:** Unraid forums → Docker Containers support subforum (create it before submitting so the
URL exists).

**Title:**

> [Support] mybabynotes — self-hosted baby tracker for your household (offline PWA, realtime sync, shift handoffs)

**Body:**

> This is the support thread for the **mybabynotes** Community Apps template.
>
> mybabynotes is a baby tracker built for one household sharing its babies' log — parents plus the
> caregivers they trust — running entirely on your server: one container, one SQLite file, no
> cloud account, no telemetry.
>
> **What it does**
> - **Three taps from pocket to logged.** The entry sheet opens pre-stamped with the current time
>   and a prediction of what you're about to log (alternating nursing sides, last bottle amount,
>   feed-vs-diaper rhythm). Overriding the guess costs one tap.
> - **The whole household, one log.** Everyone joins by invite — as a parent (full control) or a
>   caregiver (logs and covers shifts) — and sees the same log live over websockets. Entries write
>   locally first and sync when there's signal — 3am logging never waits on the network.
> - **Shift handoffs.** "I need to sleep, take him" is a first-class flow: request with a note,
>   accept with an auto-drafted plan from the baby's rhythm, hand back with a summary.
> - Installable PWA, Now/History views, 7-day charts, sleep/nursing/pump timers, CSV export for
>   the pediatrician, optional web-push reminders (self-hosted VAPID — no FCM).
>
> **Install notes**
> - First boot generates all secrets into `/data/.env` — there is nothing to configure to try it
>   on the LAN. The first account registered claims the instance; registration is invite-only
>   after that.
> - Everything lives in the one appdata share (`database.sqlite` + `.env`). Back that folder up
>   and you've backed up the app. Keep the `.env` with it — it holds the instance's secrets, and
>   losing it means fresh keys and re-pairing realtime on next boot.
> - **Remote access / phones outside the LAN:** put an HTTPS reverse proxy with **websocket
>   support** in front (NPM, SWAG, Caddy). HTTPS is required for the PWA install prompt and push
>   notifications; without proxied websockets, live sync falls back to 20-second polling. Set the
>   `APP_URL` variable (Advanced view) to your public origin.
> - Invite emails need SMTP (`MAIL_*` appended to `/data/.env`); without it the app shows a
>   shareable invite code instead, so email is optional.
>
> **Honest scope:** it's built for one household per instance — up to six adults (parent and
> caregiver roles) and up to ten children — with no custom entry types, and a 7-day stats window
> (with day-by-day drill-down). If you need growth charts or a broader tracker, Baby Buddy may
> fit better; this one optimizes for offline logging, live household sync, and the shift handoff.
> (Switching over? Settings can import a Baby Buddy CSV export.)
>
> Source (AGPL): https://github.com/straplocked/mybabynotes — bugs are best as GitHub issues, but
> this thread works too.
