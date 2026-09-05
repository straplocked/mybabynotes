<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\StartTimerRequest;
use App\Services\TimerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The household's running timers. Timers stack (a nursing timer for one twin
 * beside a sleep timer for the other): PUT starts one, DELETE stops one by id.
 * `timer` in responses is the legacy singular slot — your newest timer — kept
 * for pre-multi-timer clients; new code should read `timers`. Stopping never
 * writes an entry — the server stores facts, not in-flight guesses; log the
 * resulting entry yourself via POST /v1/entries, exactly like the app does.
 */
class TimerController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $household = $request->user()->household;

        return response()->json([
            'timer' => $household->legacyTimerFor($request->user()),
            'timers' => $household->runningTimers(),
            'server_time' => now()->getTimestampMs(),
        ]);
    }

    public function store(StartTimerRequest $request, TimerService $timers): JsonResponse
    {
        $data = $request->validated();
        $timer = $timers->start(
            $request->user(),
            $data['type'],
            isset($data['baby_id']) ? (int) $data['baby_id'] : null,
        );

        return response()->json(['timer' => $timer]);
    }

    public function destroy(Request $request, TimerService $timers): JsonResponse
    {
        $data = $request->validate([
            // which timer to stop; omitted = your newest (the legacy singular slot)
            'id' => ['sometimes', 'string', 'max:64'],
        ]);

        $stopped = $timers->stop($request->user(), $data['id'] ?? null);

        return response()->json(['stopped' => $stopped]);
    }
}
