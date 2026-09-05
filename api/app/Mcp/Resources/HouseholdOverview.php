<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mcp\Resources;

use Illuminate\Support\Carbon;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Resource;

#[Description('A snapshot of the household: children, members, who is on duty, any running timers, and today\'s totals.')]
class HouseholdOverview extends Resource
{
    public function handle(Request $request): Response
    {
        $user = $request->user();
        if (! $user->tokenCan('profile:read') || ! $user->tokenCan('entries:read')) {
            return Response::error('This token needs the `profile:read` and `entries:read` scopes.');
        }

        $household = $user->household()->with(['users', 'children'])->first();
        $tz = $user->notifyPrefs()['tz'] ?: config('app.timezone');
        $day = Carbon::now($tz)->startOfDay();
        $today = $household->entries()->where('deleted', false)
            ->where('t', '>=', $day->getTimestampMs())->get(['type', 'detail']);

        $count = fn (string ...$types) => $today->whereIn('type', $types)->count();
        $timers = $household->runningTimers();
        $onDuty = $household->users->firstWhere('id', $household->on_duty_user_id)?->name;

        $lines = [
            '# MyBabyNotes household',
            '',
            'Children: '.($household->children->where('archived', false)
                ->map(fn ($b) => $b->name.($b->birthdate ? " (born {$b->birthdate})" : ''))->implode(', ') ?: 'none yet'),
            'Members: '.$household->users->sortBy('id')
                ->map(fn ($u) => $u->name.' ('.($u->role ?? 'parent').')')->implode(', '),
            'On duty: '.($onDuty ?? 'nobody'),
            'Running timers: '.($timers
                ? collect($timers)->map(fn ($t) => $t['type'].' since '.Carbon::createFromTimestampMs($t['started_at'])->toIso8601String())->implode(', ')
                : 'none'),
            '',
            "## Today ({$day->toDateString()}, {$tz})",
            'Feeds: '.$count('bottle', 'nurse').' · Diapers: '.$count('wet', 'dirty', 'both')
                .' · Sleeps: '.$count('sleep').' · Pumps: '.$count('pump'),
        ];

        return Response::text(implode("\n", $lines));
    }
}
