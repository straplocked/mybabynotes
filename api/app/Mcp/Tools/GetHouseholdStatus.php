<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mcp\Tools;

use Illuminate\Support\Carbon;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
#[Description('Who is in the household, who is on duty, the latest shift, and any running timers.')]
class GetHouseholdStatus extends BabylogTool
{
    public function handle(Request $request): Response
    {
        if ($denied = $this->requireAbilities($request, 'profile:read')) {
            return $denied;
        }

        $user = $this->user($request);
        $household = $user->household()->with(['users', 'children'])->first();
        $shift = $household->shifts()->latest('id')->first();
        $names = $this->memberNames($user);
        $enrich = fn (array $timer) => array_merge($timer, [
            'started' => Carbon::createFromTimestampMs($timer['started_at'])->toIso8601String(),
            'elapsed_minutes' => (int) floor((now()->getTimestampMs() - $timer['started_at']) / 60000),
            'by' => $names[$timer['user_id']] ?? null,
        ]);
        $legacy = $household->legacyTimerFor($user);

        return Response::json([
            'members' => $household->users->sortBy('id')->values()
                ->map(fn ($u) => ['id' => $u->id, 'name' => $u->name, 'role' => $u->role ?? 'parent'])->all(),
            'on_duty' => $household->on_duty_user_id
                ? ['user_id' => $household->on_duty_user_id,
                    'name' => $household->users->firstWhere('id', $household->on_duty_user_id)?->name]
                : null,
            'children' => $household->children->where('archived', false)->values()
                ->map(fn ($b) => ['id' => $b->id, 'name' => $b->name, 'birthdate' => $b->birthdate])->all(),
            'shift' => $shift ? [
                'state' => $shift->state,
                'requester_id' => $shift->requester_id,
                'user_id' => $shift->user_id,
                'note' => $shift->note,
                'until' => $shift->until,
            ] : null,
            'timer' => $legacy ? $enrich($legacy) : null,
            'timers' => array_map($enrich, $household->runningTimers()),
        ]);
    }
}
