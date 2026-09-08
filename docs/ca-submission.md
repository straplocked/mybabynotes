# Submitting mybabynotes to Unraid Community Apps

The template is [deploy/unraid/ca-template.xml](../deploy/unraid/ca-template.xml). It consumes the
all-in-one image `ghcr.io/straplocked/mybabynotes-aio:latest` (built by
[.github/workflows/release.yml](../.github/workflows/release.yml) on `v*` tag pushes — a `main` push
does **not** build the AIO image, so `:latest` only ever moves on a tagged release).

**Status: submitted and auto-approved, 2026-09-07.** The listing appears once the next Community
Applications build publishes. All the pre-submission gates below are done. What remains is the
support thread, which the Docker Containers subforum won't let a non-Community-Developer post
directly — see "The support thread" below for the route around that.

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
5. ~~**`ca_profile.xml` in the repository root.**~~ Done — CA's scan requires it and **blocks
   submission without it**, which this runbook originally didn't mention because the requirement
   is newer than the doc. It needs a non-empty `<Profile>`; `<Icon>` and `<WebPage>` are the
   recommended extras, `<Forum>` optional. Note the split: `<Profile>` is the *repository* blurb
   (short — what's here, where support is), while `<Overview>` in the app template is the *app
   listing* copy (long). CA renders `<Profile>` as **plain text**, so markdown ships as literal
   asterisks.
6. **Create the support thread** — see "The support thread" below. It is *not* a prerequisite:
   nothing in the submission wizard asks for a forum URL, and `<Support>` in the template already
   points at GitHub issues.

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

**Submitted 2026-09-07 and auto-approved** (`https://ca.unraid.net` → My submissions). The portal
is a five-step wizard — Before You Begin → Sign In → Add Repository → Review → Submit — not the
"register as an application author" flow this runbook used to describe.

1. Sign in at **https://ca.unraid.net** with your Unraid forum account, then **Submit**.
2. Paste the repository URL. **Validate** runs cheap checks (public, active, license detected).
3. **Scan Repository** runs the real one, the same pipeline CA builds with. What it reports:
   - *Valid apps found* — `deploy/unraid/ca-template.xml` parses as one Docker app;
   - *Repository overview* — `ca_profile.xml` found and `<Profile>` extracted;
   - *Docker images pullable* — this **times out at 10s on a cold pull** and reports "couldn't
     verify"; it is not a failure, and a second scan cleared it;
   - *Template warnings: `not_unraid_application: 1`* — this is **`api/phpunit.xml`**, Laravel's
     test config, which CA's scanner picks up simply because it is XML. It is **non-blocking**
     and there is nothing to fix; the only clean escape is the dedicated-template-repo option
     above, which is not worth it for a cosmetic warning.
   - The scan reads the repo through a cache that lags roughly a revision behind. After pushing a
     `ca_profile.xml` change, expect the preview to show the *previous* text for a few minutes.
     The catalog ingests the repo at build time, so what publishes is the current file.
4. **Continue to Submit** → confirm. A Docker-only submission with no duplicate app names is
   **auto-approved on the spot** — there is no moderator wait. Plugin and Compose submissions
   still get manual review.
5. Apps appear after the next Community Applications build publishes.
6. **Ongoing:** template fixes are just pushes to `main` (the feed re-scans). App updates ship by
   tagging releases — `release.yml` owns `:latest`, so CA's "update available" tracking works
   without touching the template.

The repository's display name in CA defaults to `<your-username>'s Repository` and is set in the
confirm step — worth choosing deliberately, since changing it afterwards isn't offered on the
submissions screen.

If the portal drifts again, the canonical instructions are pinned in the Community Applications
section of the Unraid forums — follow those over this doc, and update this doc after.

## The support thread

**You probably cannot post it directly.** The Docker Containers subforum only lets *Community
Developers* create topics — there is no "Start New Topic" button otherwise. Per the pinned
["Why Can't I Post New Topics In Here?"](https://forums.unraid.net/topic/40696-why-cant-i-post-new-topics-in-here/):

- you earn Community Developer status partly **by** having containers integrated with CA, which is
  why the submission sensibly comes first;
- meanwhile, **post the thread in a subforum you can post in and PM a moderator to move it**;
- or request the status from support once there's a track record of answering questions.

Once the thread exists, uncomment `<Forum>` in `ca_profile.xml` with its URL. Until then the
profile deliberately says support is via GitHub issues rather than pointing at a thread that
doesn't exist.

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
