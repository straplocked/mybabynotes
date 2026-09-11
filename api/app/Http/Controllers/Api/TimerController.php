<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\TimerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The live nursing/pump/sleep timers. Only running state lives here — when a
 * timer stops, the client writes the resulting entry through the normal
 * outbox, so the log stays the single source of truth (the server stores facts,
 * not in-flight guesses). Timers stack; each start/stop names one by id.
 */
class TimerController extends Controller
{
    /** Start a timer. `id` is the client-generated id, entry-style. */
    public function start(Request $request, TimerService $timers): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', 'in:nurse,pump,sleep,tummy'],
            'baby_id' => ['nullable', 'integer'],
            'id' => ['sometimes', 'string', 'max:64'],
        ]);

        $timer = $timers->start(
            $request->user(),
            $data['type'],
            isset($data['baby_id']) ? (int) $data['baby_id'] : null,
            $data['id'] ?? null,
        );

        return response()->json(['ok' => true, 'timer' => $timer]);
    }

    /**
     * Re-open a sleep that already ended — the stir-and-settle case, where
     * stopping and starting again stacked two naps for what was one. The timer
     * comes back backdated to where that entry began and carries `resumes`, so
     * stopping it rewrites that entry instead of logging a second one.
     */
    public function resume(Request $request, TimerService $timers): JsonResponse
    {
        $data = $request->validate([
            'entry_id' => ['required', 'string', 'max:64'],
            'id' => ['sometimes', 'string', 'max:64'],
        ]);

        $timer = $timers->resume($request->user(), $data['entry_id'], $data['id'] ?? null);
        if ($timer === null) {
            // deleted, edited into another type, or never ours to begin with
            return response()->json(['ok' => false, 'message' => __('That sleep is no longer there to resume.')], 404);
        }

        return response()->json(['ok' => true, 'timer' => $timer]);
    }

    /**
     * Stop one timer by id. The entry itself is logged client-side. No id is
     * the pre-multi-timer form: stops the caller's newest timer.
     */
    public function stop(Request $request, TimerService $timers): JsonResponse
    {
        $data = $request->validate([
            'id' => ['sometimes', 'string', 'max:64'],
        ]);

        $stopped = $timers->stop($request->user(), $data['id'] ?? null);

        return response()->json(['ok' => true, 'stopped' => $stopped]);
    }
}
