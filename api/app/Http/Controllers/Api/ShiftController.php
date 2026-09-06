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
            [':name is asking you to take over', ['name' => $user->name]],
            ($data['note'] ?? null) ?: ['Open mybabynotes to see the handoff.'],
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
            return response()->json(['message' => __('You asked for this handoff — someone else has to take it.')], 422);
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
                    ? [':name took over — you’re covered', ['name' => $user->name]]
                    : [':name is on duty now', ['name' => $user->name]],
                $until
                    ? ['On duty :until.', ['until' => [lcfirst($until)]]]
                    : ($other->id === $requester?->id ? ['Get some rest.'] : ['Duty just changed hands.']),
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
                ($data['note'] ?? null) ?: ['Their shift report is waiting in the app.'],
            );
        }

        return response()->json(['ok' => true, 'shift' => $shift]);
    }
}
