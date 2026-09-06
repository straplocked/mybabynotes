<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api;

use App\Events\HouseholdTouched;
use App\Http\Controllers\Controller;
use App\Models\PushSubscription;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PushController extends Controller
{
    /**
     * Register this device for Web Push. Device-scoped, not household state —
     * nothing the partner renders changes, so no HouseholdTouched poke.
     */
    public function subscribe(Request $request): JsonResponse
    {
        $data = $request->validate([
            'endpoint' => ['required', 'url', 'max:500'],
            'keys.p256dh' => ['required', 'string', 'max:255'],
            'keys.auth' => ['required', 'string', 'max:255'],
            'tz' => ['nullable', 'timezone:all'],
            // device language, like tz — push copy renders per subscription
            'lang' => ['nullable', 'string', 'in:'.implode(',', config('babylog.locales', ['en']))],
        ]);

        // the endpoint identifies the device — re-subscribing (or a partner
        // logging in on the same phone) moves it to the current user
        PushSubscription::updateOrCreate(
            ['endpoint' => $data['endpoint']],
            [
                'user_id' => $request->user()->id,
                'p256dh' => $data['keys']['p256dh'],
                'auth' => $data['keys']['auth'],
                'timezone' => $data['tz'] ?? null,
                'lang' => $data['lang'] ?? null,
            ],
        );

        return response()->json(['ok' => true]);
    }

    public function unsubscribe(Request $request): JsonResponse
    {
        $data = $request->validate(['endpoint' => ['required', 'string', 'max:500']]);

        $request->user()->pushSubscriptions()->where('endpoint', $data['endpoint'])->delete();

        return response()->json(['ok' => true]);
    }

    /** Per-parent notification choices. Last write wins, merged over what's stored. */
    public function prefs(Request $request): JsonResponse
    {
        $data = $request->validate([
            'handoff' => ['sometimes', 'boolean'],
            'timer' => ['sometimes', 'boolean'],
            'partner' => ['sometimes', 'boolean'],
            'feed' => ['sometimes', 'boolean'],
            'feedEvery' => ['sometimes', 'nullable', 'integer', 'in:120,150,180,210,240'],
            'feedEveryByChild' => ['sometimes', 'array'],
            'feedEveryByChild.*' => ['nullable', 'integer', 'in:120,150,180,210,240'],
            'onDutyOnly' => ['sometimes', 'boolean'],
            'wake' => ['sometimes', 'boolean'],
            'meds' => ['sometimes', 'boolean'],
            'medsTime' => ['sometimes', 'date_format:H:i'],
            'quiet' => ['sometimes', 'boolean'],
            'quietStart' => ['sometimes', 'date_format:H:i'],
            'quietEnd' => ['sometimes', 'date_format:H:i'],
            'tz' => ['sometimes', 'nullable', 'timezone:all'],
        ]);

        $user = $request->user();
        if (array_key_exists('feedEveryByChild', $data)) {
            // the map replaces wholesale (the client always sends the full map) —
            // keys for children outside this household, and null "inherit" values,
            // are silently dropped rather than rejected, so a stale client can't
            // brick its own prefs save
            $childIds = $user->household?->children()->pluck('id')->all() ?? [];
            $kept = array_intersect_key($data['feedEveryByChild'] ?? [], array_flip($childIds));
            $data['feedEveryByChild'] = array_map('intval', array_filter($kept, fn ($v) => $v !== null));
        }
        $user->update(['notify_prefs' => array_merge($user->notify_prefs ?? [], $data)]);

        // prefs are per-user but ride /state — poke so my *other* devices converge
        HouseholdTouched::send($user->household_id, 'notify');

        return response()->json(['ok' => true, 'prefs' => $user->notifyPrefs()]);
    }
}
