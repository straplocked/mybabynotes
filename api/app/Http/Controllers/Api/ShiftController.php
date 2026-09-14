<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api;

use App\Events\HouseholdTouched;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\PushService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShiftController extends Controller
{
    /**
     * Handoff pushes deliberately ignore quiet hours — this is one grown-up
     * addressing another directly, not the app nagging.
     */
    private function pushHandoff(?User $to, string|array $title, string|array $body): void
    {
        if ($to && $to->notifyPrefs()['handoff']) {
            app(PushService::class)->notify($to, 'shift', $title, $body);
        }
    }

    /** Same handoff push, fanned out to a set of members. */
    private function pushHandoffToAll(iterable $users, string|array $title, string|array $body): void
    {
        foreach ($users as $to) {
            $this->pushHandoff($to, $title, $body);
        }
    }

    /**
     * Plan items arrive with ms timestamps the client derives from an averaged
     * feed gap — a float. Rejecting the whole handoff over a fractional
     * millisecond is how accepts silently failed; coerce instead.
     */
    private const PLAN_RULES = [
        'plan' => ['nullable', 'array', 'max:20'],
        'plan.*.id' => ['required', 'string', 'max:40'],
        'plan.*.type' => ['required', 'string', 'max:20'],
        'plan.*.at' => ['required', 'numeric'],
    ];

    private function intPlan(?array $plan): array
    {
        return array_map(fn ($p) => [...$p, 'at' => (int) round($p['at'])], $plan ?? []);
    }

    /**
     * On-duty parent asks the partner to take over ("Hand off"). Asking again
     * while a request is pending refreshes it and re-pings — a deliberate
     * nudge, not a silent no-op.
     */
    public function request(Request $request): JsonResponse
    {
        $data = $request->validate([
            ...self::PLAN_RULES,
            'note' => ['nullable', 'string', 'max:500'],
            'until' => ['nullable', 'string', 'max:60'],
            'until_at' => ['nullable', 'numeric'],
            // who the ask is for; null fans it out to everyone, which is what a
            // two-adult household always wants
            'target_id' => ['nullable', 'integer'],
        ]);

        $user = $request->user();
        $household = $user->household;

        // an ask can only name someone who is actually in this household
        $target = isset($data['target_id']) ? $household->othersFor($user)->firstWhere('id', $data['target_id']) : null;

        $pending = $household->shifts()->where('state', 'requested')->latest('id')->first();
        $values = [
            'requester_id' => $user->id,
            'target_id' => $target?->id,
            'note' => $data['note'] ?? null,
            // the ask now carries the plan and the window the asker is proposing,
            // on the columns an active shift already uses — the accepter adjusts
            // and commits them rather than inventing them from scratch
            'plan' => $this->intPlan($data['plan'] ?? null),
            'until' => $data['until'] ?? null,
            'until_at' => isset($data['until_at']) ? (int) round($data['until_at']) : null,
            'requested_at' => now()->getTimestampMs(),
        ];
        if ($pending) {
            $pending->update($values);
        } else {
            $household->shifts()->create(['state' => 'requested', ...$values]);
        }
        // an addressed ask pings only its recipient; an open one goes to
        // everyone, since anyone may answer it either way
        $this->pushHandoffToAll(
            $target ? [$target] : $household->othersFor($user),
            [':name is asking you to cover', ['name' => $user->name]],
            ($data['note'] ?? null) ?: ['Open mybabynotes to see the cover.'],
        );

        HouseholdTouched::send($household->id, 'shift');

        return response()->json(['ok' => true]);
    }

    /** "I've got him" — start my shift (accepts a pending request if one exists). */
    public function accept(Request $request): JsonResponse
    {
        $data = $request->validate([
            ...self::PLAN_RULES,
            'until' => ['nullable', 'string', 'max:60'],
            // client-resolved ms epoch for clock-time "until" labels; numeric,
            // not integer, for the same fractional-ms tolerance as plan.at
            'until_at' => ['nullable', 'numeric'],
        ]);

        $user = $request->user();
        $household = $user->household;

        $shift = $household->shifts()->where('state', 'requested')->latest('id')->first();
        // any member except the asker may answer — accepting your own ask
        // would just quietly re-crown you
        if ($shift && $shift->requester_id === $user->id) {
            return response()->json(['message' => __('You asked for this cover — someone else has to take it.')], 422);
        }
        $shift ??= $household->shifts()->make(['requested_at' => null]);

        // the asker seeds, the accepter adjusts: a client that sends its own
        // plan/until wins, and one that sends nothing inherits what the ask
        // proposed rather than silently dropping it
        $plan = array_key_exists('plan', $data) ? $this->intPlan($data['plan']) : ($shift->plan ?? []);
        $until = array_key_exists('until', $data) ? $data['until'] : $shift->until;
        $untilAt = array_key_exists('until_at', $data)
            ? (isset($data['until_at']) ? (int) round($data['until_at']) : null)
            : $shift->until_at;

        $shift->fill([
            'household_id' => $household->id,
            'state' => 'active',
            'user_id' => $user->id,
            'plan' => $plan,
            'until' => $until,
            'until_at' => $untilAt,
            'until_notified_at' => null, // a fresh acceptance re-arms the once-only "shift over" ping
            'started_at' => now()->getTimestampMs(),
        ])->save();

        $household->update(['on_duty_user_id' => $user->id]);

        HouseholdTouched::send($household->id, 'shift');
        $until = $until ?: null; // an inherited-or-sent label, empty string included
        $requester = $shift->requester_id ? $household->users->firstWhere('id', $shift->requester_id) : null;
        foreach ($household->othersFor($user) as $other) {
            // the one who asked hears "you're covered"; the rest just learn who's on.
            // the stored until label is canonical English ('Until 6 AM') — the
            // lcfirst'd form is its own catalog key, so it lands mid-sentence
            // correctly in every language
            $this->pushHandoff(
                $other,
                $other->id === $requester?->id
                    ? [':name is covering — you’re off', ['name' => $user->name]]
                    : [':name is covering now', ['name' => $user->name]],
                $until
                    ? ['Covering :until.', ['until' => [lcfirst($until)]]]
                    : ($other->id === $requester?->id ? ['Get some rest.'] : ['Cover just changed hands.']),
            );
        }

        return response()->json(['ok' => true, 'shift' => $shift]);
    }

    /** Replace the plan on my active shift (e.g. "Add to plan"). */
    public function plan(Request $request): JsonResponse
    {
        $data = $request->validate([...self::PLAN_RULES, 'plan' => ['present', 'array', 'max:20']]);

        $user = $request->user();
        $shift = $user->household->shifts()->where('state', 'active')->where('user_id', $user->id)->latest('id')->first();
        $shift?->update(['plan' => $this->intPlan($data['plan'])]);

        HouseholdTouched::send($user->household_id, 'shift');

        return response()->json(['ok' => true]);
    }

    /** End my shift and hand duty back to whoever asked for the cover, with a note + report window. */
    public function handback(Request $request): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);

        $user = $request->user();
        $household = $user->household;

        $shift = $household->shifts()->where('state', 'active')->where('user_id', $user->id)->latest('id')->first();
        if ($shift) {
            $shift->update([
                'state' => 'completed',
                'ended_at' => now()->getTimestampMs(),
                'ended_by' => 'handback',
                'handback_note' => $data['note'] ?? null,
            ]);
        }
        // duty is moving anyway — a still-pending "take over?" ask would only
        // leave someone a stale incoming card
        $household->shifts()->where('state', 'requested')->update(['state' => 'cancelled']);

        // duty returns to the shift's stored requester — whoever asked for the
        // cover is owed it back, parent or caregiver alike. A self-started shift
        // (or a requester who has since been removed) falls back to another
        // *parent* first: "first other member by id" would hand a newborn to the
        // night carer just because their account was created earlier.
        //
        // This whole chain is now the OLD-CLIENT CONTRACT and must not move.
        // Installed PWAs POST {note} here and expect duty to land on a person;
        // the current client ends a cover through /shifts/end (duty → nobody)
        // and passes one on through /shifts/assign, so it never relies on the
        // fallback. Handing back to a named person stays exactly as it was.
        $requester = $shift?->requester_id ? $household->users->firstWhere('id', $shift->requester_id) : null;
        $others = $household->othersFor($user);
        $to = ($requester && $requester->id !== $user->id ? $requester : null)
            ?? $others->first(fn (User $u) => $u->isParent())
            ?? $others->first()
            ?? $user;

        $household->update(['on_duty_user_id' => $to->id]);

        HouseholdTouched::send($household->id, 'shift');
        if ($to->id !== $user->id) {
            $this->pushHandoff(
                $to,
                [':name handed :baby back', ['name' => $user->name, 'baby' => $household->baby?->name ?? ['the baby']]],
                ($data['note'] ?? null) ?: ['Their cover report is waiting in the app.'],
            );
        }

        return response()->json(['ok' => true, 'shift' => $shift]);
    }

    /**
     * Put someone else on cover, starting now — no acceptance step.
     *
     * This is the grandparent case: by the time you reach for the phone the
     * handover has already happened in the kitchen, and asking a question whose
     * answer is "obviously yes" is ceremony. `request` still exists for the
     * trade that genuinely waits on a yes.
     *
     * Parent-only. Covering is volunteering — any member may `accept`. Assigning
     * is writing duty onto someone else's name and redirecting their reminders,
     * which is household-shaping, the same class as removing a member.
     */
    public function assign(Request $request): JsonResponse
    {
        if ($deny = $this->parentsOnly($request)) {
            return $deny;
        }

        $data = $request->validate([
            ...self::PLAN_RULES,
            'user_id' => ['required', 'integer'],
            'note' => ['nullable', 'string', 'max:500'],
            'until' => ['nullable', 'string', 'max:60'],
            'until_at' => ['nullable', 'numeric'],
        ]);

        $user = $request->user();
        $household = $user->household;

        // self is allowed: it collapses to `accept`, and a member picker
        // shouldn't have to special-case the person holding the phone
        $to = $household->users->firstWhere('id', $data['user_id']);
        if (! $to) {
            return response()->json(['message' => __('That person isn’t in this log.')], 422);
        }

        $now = now()->getTimestampMs();
        // one cover at a time — a new one supersedes whatever was running, and a
        // pending ask would otherwise render as a phantom incoming card beside it
        $household->shifts()->where('state', 'active')
            ->update(['state' => 'completed', 'ended_at' => $now, 'ended_by' => 'assign']);
        $household->shifts()->where('state', 'requested')->update(['state' => 'cancelled']);

        $shift = $household->shifts()->create([
            'state' => 'active',
            'user_id' => $to->id,
            // the assigner is the requester, so ending the cover still knows who
            // arranged it — and an old client on the assignee's phone reads this
            // as "someone handed me this" and offers its hand-back button
            'requester_id' => $user->id,
            'target_id' => $to->id,
            'note' => $data['note'] ?? null,
            'plan' => $this->intPlan($data['plan'] ?? null),
            'until' => $data['until'] ?? null,
            'until_at' => isset($data['until_at']) ? (int) round($data['until_at']) : null,
            'until_notified_at' => null,
            'requested_at' => null,
            'started_at' => $now,
        ]);

        $household->update(['on_duty_user_id' => $to->id]);

        HouseholdTouched::send($household->id, 'shift');

        $until = $data['until'] ?? null;
        foreach ($household->othersFor($user) as $other) {
            $this->pushHandoff(
                $other,
                $other->id === $to->id
                    ? [':name asked you to cover', ['name' => $user->name]]
                    : [':name is covering now', ['name' => $to->name]],
                $other->id === $to->id
                    ? (($data['note'] ?? null) ?: ($until
                        ? ['You’re covering :until.', ['until' => [lcfirst($until)]]]
                        : ['You’re covering from now.']))
                    : ['Cover just changed hands.'],
            );
        }

        return response()->json(['ok' => true, 'shift' => $shift]);
    }

    /**
     * End the cover — duty goes back to nobody.
     *
     * The missing primitive: a cover you started yourself could only be ended by
     * someone else taking it, so its row sat `active` forever and the household
     * never got back to "we're both on it".
     *
     * The holder may always end their own cover (a caregiver saying "I'm done"
     * is the whole point). A parent may also end one someone forgot to close —
     * grandma leaves at four and never taps.
     */
    public function end(Request $request): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);

        $user = $request->user();
        $household = $user->household;

        $shift = $household->shifts()->where('state', 'active')->latest('id')->first();
        $mine = $shift && $shift->user_id === $user->id;
        if ($shift && ! $mine && ! $user->isParent()) {
            return response()->json(['message' => __('Only a parent can change that.')], 403);
        }

        $shift?->update([
            'state' => 'completed',
            'ended_at' => now()->getTimestampMs(),
            'ended_by' => $mine ? 'holder' : 'parent',
            'handback_note' => $data['note'] ?? null,
        ]);
        // no active row is not an error: a household carrying seeded duty from
        // before covers existed gets back to shared this way too
        $household->shifts()->where('state', 'requested')->update(['state' => 'cancelled']);

        $household->update(['on_duty_user_id' => null]);

        HouseholdTouched::send($household->id, 'shift');

        $holder = $shift ? $household->users->firstWhere('id', $shift->user_id) : $user;
        foreach ($household->othersFor($user) as $other) {
            $this->pushHandoff(
                $other,
                [':name finished covering', ['name' => $holder?->name ?? $user->name]],
                ($data['note'] ?? null) ?: ['Back to sharing — their report is in the app.'],
            );
        }

        return response()->json(['ok' => true, 'shift' => $shift]);
    }
}
