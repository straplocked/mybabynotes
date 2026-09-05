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
#[Description('The household\'s running timers (nursing, pumping, or sleep) — `timers` lists every one; `timer` is the caller\'s newest (or null), kept for older clients.')]
class GetTimer extends BabylogTool
{
    public function handle(Request $request): Response
    {
        if ($denied = $this->requireAbilities($request, 'timer:read')) {
            return $denied;
        }

        $user = $this->user($request);
        $names = $this->memberNames($user);
        $enrich = fn (array $timer) => array_merge($timer, [
            'started' => Carbon::createFromTimestampMs($timer['started_at'])->toIso8601String(),
            'elapsed_minutes' => (int) floor((now()->getTimestampMs() - $timer['started_at']) / 60000),
            'by' => $names[$timer['user_id']] ?? null,
        ]);

        $legacy = $user->household->legacyTimerFor($user);

        return Response::json([
            'timer' => $legacy ? $enrich($legacy) : null,
            'timers' => array_map($enrich, $user->household->runningTimers()),
        ]);
    }
}
