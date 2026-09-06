# Trial journal

Live-with-it notes for the testing period. Add entries as they happen — a one-liner beats a forgotten annoyance. When we start iterating, this file becomes the backlog source.

**How to log a note:** add a row. Severity: 💔 blocks/annoys daily · 🤔 friction worth fixing · 💡 idea/nice-to-have · ✅ delighted.

| Date | Who | What happened / what I wanted | Severity |
|---|---|---|---|
| 2026-09-02 | C+K | Cluster feeding skews the feed-rhythm average — Maddux's "every 3h-and-change" window is wrong because back-to-back feeds count as separate rhythm beats. → Fixed: feeds within 45m now group into one session for the average/plan. | 🤔 |
| 2026-09-02 | C+K | We don't track diapers (no health reason to) but the app assumes everyone tracks everything — "0.3 diapers/day" stats are noise. Want per-household on/off for metrics, ideally with the app suggesting it. → Fixed: "What you track" toggles in History + a low-usage nudge; entries are never deleted. | 🤔 |
| 2026-09-02 | C+K | Want wake-window tracking, and the baby's actual DOB so the app tracks age in weeks (the onboarding "2–8 wks" label never advances). → Added: DOB at onboarding + History → About; header age computes live; wake-window avg tile + insight compared against age-typical ranges from docs/feeding-patterns.md. | 💡 |
| 2026-09-05 | C | On duty and there's no checklist — K sees one, I never do, and the whole handoff direction reads backwards. Cause: the plan/checklist only ever existed for whoever *accepted* a handoff. Duty is seeded to the account that created the household and handed straight back by "Hand back", and neither opens a shift — so the person duty keeps returning to sits in a dead state forever, while the person who accepts gets the whole feature. → Fixed: "on duty, nothing started" is now a real state with a start card (drafted plan + "Start my shift") and its own sheet; a pending ask of yours reads "Waiting for {name}" instead of vanishing; "Your shift so far" no longer borrows the other parent's window. | 💔 |
| 2026-09-05 | C | Handoffs read backwards even after the duty fix. Root cause was authorship: `/shifts/request` only ever carried a *note*, and the structured plan was drafted by whoever **accepted**. So the person with the context (who last nursed, what's in the fridge) sent prose, and the person taking over invented the plan. → Fixed: the ask now carries the plan, the "until", an optional recipient, and a note; the receiver adjusts and accepts. "Ask X to take over" became a compose sheet instead of a one-tap send. | 🤔 |
| 2026-09-05 | C | Unfinished plan items died with the shift — a 9am dose nobody got to just vanished when duty changed. → Fixed: non-feed items carry into the next draft at their original (now late) time. Feeds deliberately don't: they're rhythmic, not owed. | 💡 |
| 2026-09-05 | C | Nothing in a plan could be changed — no way to retime an item, drop one, or add anything but another feed. Left over from when the plan was a machine guess the receiver rubber-stamped; once the *asker* authors it, "here's what needs to happen" without a time control is half a feature. → Fixed: every plan row's time is a tap-to-pick control on both sides of a handoff, pending items can be dropped, and "Add to plan" offers any scheduleable tracked type. Logged items freeze. | 🤔 |
| 2026-09-05 | C | Every other entry marks when something *started* — a bottle is stamped at the first sip — but naps landed in the log at the wake-up, so a long nap sorted below feeds that happened during it and the timeline stopped reading top-down. → Fixed in the UI only: rows, day buckets, the shift report, CSV rows and the log sheet's stamp all read `t − duration`. The wire still stamps the wake-up (the timer, the import, the wake-window math and old installed clients all depend on it), and the "since last slept"/"Last nap ended" readouts still measure from the end, which is the point of them. | 🤔 |
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
- Does request → accept → hand back match how you two actually trade off, or is instant handoff ("you have him now") the real pattern? (Partly answered 2026-09-05: neither — the common case is *nobody asked*, one of you just has the baby. Hence the start card. Still open: should handing back auto-start a shift for whoever receives it, or is one tap right?)
- Should there be a way to say "K is usually the one with him" so duty defaults to the right person after a reset, or is the duty pill enough?
- **The ask is heavier now** (plan + window + note) on the bet that it went unused *because* it carried nothing. Watch whether that's right: does composing a handoff actually happen, or does the extra step push you further toward one of you just taking the baby? It's built to be two taps if you accept the defaults — is it?
- Does the receiver ever *change* the plan they're sent, or is it always accepted as-is? (If always as-is, the toggles are ceremony and the carer case wants the plan locked instead.)
- Now that plan times are editable: do you actually retime items, or is the rhythm's guess always close enough? And is tapping the time discoverable, or does the pencil need to be louder?
- Does a carried-forward dose actually get done, or does it just accumulate as a late red row that gets ignored?
- Is the auto-drafted plan (next feeds from rhythm + meds) believable? Right number of items?
- Did you miss a handoff request because the app was closed? (→ push notifications priority)
- Is the shift report card the right summary, or do you want different rows?

### Home & History
- The since-cards are now picked per household from seven (fed, pumped, diaper, slept, tummy time, bath, meds) — which did you actually keep, and is the picker discoverable?
- Is 12 timeline entries enough per day? Do you reach for "older days" and hit the 7-day wall?
- Naps now sit at their start time, but the "Slept" since-card still counts from the **wake-up** (that's the wake window, and it's the number you act on). Does the card showing 6:00 AM next to a row showing 3:00 AM read as two facts or as a bug? Same question for "Last nap ended" in a shift report.
- Is the feeds-rhythm insight ("roughly every 3h 23m") useful or noise?

### Feel
- Anything that felt slow, janky, or mis-tapped on a real phone (tap targets, sheet height, keyboard overlap on inputs)?
- Does the peach/plum branding hold up on-device? Icon/splash on the home screen okay?
- Set the app to another language for a day — does anything overflow, read wrong, or stay stubbornly English where it shouldn't?

## Iteration parking lot

Bigger ideas that surfaced — no commitment implied. See also [docs/known-limitations.md](docs/known-limitations.md) for the remaining known gaps (no custom entry types or per-entry notes, no month view, household-level shifts and meds nudge, unreviewed translations…).

- 
