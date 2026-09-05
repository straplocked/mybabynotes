# Trial journal

Live-with-it notes for the testing period. Add entries as they happen — a one-liner beats a forgotten annoyance. When we start iterating, this file becomes the backlog source.

**How to log a note:** add a row. Severity: 💔 blocks/annoys daily · 🤔 friction worth fixing · 💡 idea/nice-to-have · ✅ delighted.

| Date | Who | What happened / what I wanted | Severity |
|---|---|---|---|
| 2026-09-02 | C+K | Cluster feeding skews the feed-rhythm average — Maddux's "every 3h-and-change" window is wrong because back-to-back feeds count as separate rhythm beats. → Fixed: feeds within 45m now group into one session for the average/plan. | 🤔 |
| 2026-09-02 | C+K | We don't track diapers (no health reason to) but the app assumes everyone tracks everything — "0.3 diapers/day" stats are noise. Want per-household on/off for metrics, ideally with the app suggesting it. → Fixed: "What you track" toggles in History + a low-usage nudge; entries are never deleted. | 🤔 |
| 2026-09-02 | C+K | Want wake-window tracking, and the baby's actual DOB so the app tracks age in weeks (the onboarding "2–8 wks" label never advances). → Added: DOB at onboarding + History → About; header age computes live; wake-window avg tile + insight compared against age-typical ranges from docs/feeding-patterns.md. | 💡 |
| | | | |

## Questions worth answering while we use it

Seeded from design intent + known soft spots — jot verdicts inline.

### The 3-tap promise
- Is *open → + → Save* actually the common case, or do you usually override the prediction?
- How often is smart prefill **right** (type + amount/side)? When it's wrong, is it wrong in a predictable way?
- Are the time nudges (−5/−15/−1h) the right increments for real backfilling?
- PWA from the home screen: cold-start speed at 3am? Does it open to Home logged-in every time?

### Both of you, one log
- Did partner's entries ever feel stale or missing? (Realtime should be ~instant with the app open; note any lag + whether on LAN or cellular.)
- Any duplicate or lost entries after offline stretches (elevator, airplane mode, dead zones)?
- Invite flow: was sharing the code manually awkward enough to justify real emails?

### Shifts
- Does request → accept → hand back match how you two actually trade off, or is instant handoff ("you have him now") the real pattern?
- Is the auto-drafted plan (next feeds from rhythm + meds) believable? Right number of items?
- Did you miss a handoff request because the app was closed? (→ push notifications priority)
- Is the shift report card the right summary, or do you want different rows?

### Home & History
- The since-cards are now picked per household from seven (fed, pumped, diaper, slept, tummy time, bath, meds) — which did you actually keep, and is the picker discoverable?
- Is 12 timeline entries enough per day? Do you reach for "older days" and hit the 7-day wall?
- Is the feeds-rhythm insight ("roughly every 3h 23m") useful or noise?

### Feel
- Anything that felt slow, janky, or mis-tapped on a real phone (tap targets, sheet height, keyboard overlap on inputs)?
- Does the peach/plum branding hold up on-device? Icon/splash on the home screen okay?
- Set the app to another language for a day — does anything overflow, read wrong, or stay stubbornly English where it shouldn't?

## Iteration parking lot

Bigger ideas that surfaced — no commitment implied. See also [docs/known-limitations.md](docs/known-limitations.md) for the remaining known gaps (no custom entry types or per-entry notes, no month view, household-level shifts and meds nudge, unreviewed translations…).

- 
